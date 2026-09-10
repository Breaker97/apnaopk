import { ValidationError } from "@/lib/api/errors";
import { connectDB } from "@/lib/db";
import { reloadAuthInstance } from "@/lib/auth/auth";
import {
  MAX_LOCKOUT_MINUTES,
  MAX_LOGIN_ATTEMPTS,
  MAX_SESSION_MAX_AGE_DAYS,
  MIN_LOCKOUT_MINUTES,
  MIN_LOGIN_ATTEMPTS,
  MIN_SESSION_MAX_AGE_DAYS,
} from "@/lib/security-limits";
import {
  MAX_ALLOWED_PASSWORD_LENGTH,
  MIN_ALLOWED_PASSWORD_LENGTH,
} from "@/lib/auth/password-policy";
import { EmailDelivery, getSettings } from "@/models";
import { loadSettingsDocument } from "@/models/settings.model";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { createAuditContext, auditSettingsChange } from "@/lib/audit";
import { setRateLimitSettingsFromSecurity } from "@/lib/api/rate-limit-config";
import {
  CONTENT_PAGE_KEYS,
  normalizeContentPagesSettings,
} from "@/lib/site-config/content-pages-config";
import { normalizeFooterSettings } from "@/lib/site-config/footer-config";
import { normalizeCheckoutSettings } from "@/lib/checkout/checkout-config";
import { normalizeProductCardConfig } from "@/lib/products/product-card-config";
import { resolveSmtpConfig } from "@/lib/settings/credentials";
import { clearStorageConfigCache } from "@/lib/storage";
import { normalizePathPrefix } from "@/lib/storage/key";
import {
  MAX_UPLOAD_SIZE_MB,
  isSupportedUploadMimeType,
} from "@/lib/storage/types";
import {
  getSmtpConfigurationFingerprint,
  isCurrentSmtpConfigurationVerified,
} from "@/lib/email/smtp-verification";
import {
  sanitizeSettings,
} from "@/lib/settings/sanitize-settings";
import { CARRIER_PROVIDERS } from "@/lib/shipping/carrier-config";
import {
  revalidateProductContent,
  revalidateSettingsContent,
} from "@/lib/cache-invalidation";
import { ORDER_PREFIX_PATTERN } from "@/lib/orders/order-settings";
import { RETURN_SHIPPING_REFUND_MODES } from "@/lib/returns/return-policy";
import { MAX_PLACEMENT_DEPTH } from "@/lib/boosts/boost-placement-depths";
import {
  BOOST_HOLD_MAX_MINUTES,
  BOOST_HOLD_MIN_MINUTES,
} from "@/config/app.config";
import {
  RATE_LIMIT_PRESETS,
  VENDOR_DOCUMENT_KEYS,
} from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import {
  COUNTRY_AVAILABILITY_MODES,
  areCountryValuesEquivalent,
  isCountryAllowed,
  isKnownCountryCode,
  sanitizeCountryCodes,
} from "@/lib/intl/country-availability";
import {
  isValidCurrencyCode,
  normalizeCurrencyCode,
  sanitizeCurrencyCodes,
} from "@/lib/intl/currency-codes";
import { z } from "zod";
import { isPlainObject } from "@/lib/utils";
import { validateBody } from "@/lib/api/validate";
import { normalizeHeaderSettings } from "@/lib/site-config/header-config";
import { normalizeHomePageSettings } from "@/lib/site-config/home-page-config";
import {
  applyCredentialUpdateMarkers,
  applySectionAllowList,
} from "@/lib/settings/section-registry";
import { assertSectionVersions } from "@/lib/settings/section-versions";


function toPlainRecord(value: unknown): Record<string, unknown> {
  if (isPlainObject(value)) return value;

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const maybeDoc = value as { toObject?: () => unknown };
    if (typeof maybeDoc.toObject === "function") {
      const obj = maybeDoc.toObject();
      return isPlainObject(obj) ? obj : {};
    }
    try {
      const obj = JSON.parse(JSON.stringify(value)) as unknown;
      return isPlainObject(obj) ? obj : {};
    } catch {
      return {};
    }
  }

  return {};
}

function flattenToDotPaths(
  basePath: string,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const walk = (prefix: string, current: unknown) => {
    if (isPlainObject(current)) {
      for (const [k, v] of Object.entries(current)) {
        walk(`${prefix}.${k}`, v);
      }
      return;
    }
    out[prefix] = current;
  };

  for (const [k, v] of Object.entries(value)) {
    walk(`${basePath}.${k}`, v);
  }

  return out;
}

/**
 * Decide what an inbound credential field means.
 *
 * The field renders empty by design — its value lives only in the masked hint —
 * so an untouched form echoes it back as `""`. That has to mean "keep what is
 * saved", which for a long time left no way to *remove* a credential at all: a
 * Stripe secret entered once stayed in the database forever, and turning the
 * provider off left it sitting there. So the two cases are now distinguished:
 *
 *   ""    the form was not touched  → drop the key, keep the stored value
 *   null  the operator hit Remove   → set undefined, which Mongoose turns into
 *                                     an `$unset` on save
 *
 * Only credential paths are read this way; `null` anywhere else is untouched.
 */
function requireFiniteNumber(
  value: unknown,
  label: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new ValidationError(`${label} must be between ${min} and ${max}`);
  }
}

/**
 * The path prefix is a free-text field, and every object key is built by
 * concatenating it — so a value without its trailing slash fuses the prefix
 * onto the date folder ("media" + "2026/08/…" = "media2026/08/…"). Cleaned on
 * the way in so the stored value is the one the key builders expect; the
 * runtime config normalizes again for documents written before this existed.
 */
function normalizeStorageSettings(data: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(data, "pathPrefix")) return;
  if (typeof data.pathPrefix !== "string") {
    delete data.pathPrefix;
    return;
  }
  data.pathPrefix = normalizePathPrefix(data.pathPrefix) || "uploads/";
}

/**
 * Guard the two storage fields that decide what the server will accept.
 *
 * `allowedMimeTypes` is the entire content-type gate in `validateUpload`, and it
 * comes straight from a settings save — so a request adding `text/html` would
 * turn the public bucket into a host for attacker-supplied pages served from
 * the merchant's own media domain. The admin may only narrow
 * `SUPPORTED_UPLOAD_MIME_TYPES`. The size limits are bounded for the duller
 * reason that a mistyped one asks the server to buffer an absurd upload.
 */
function validateStorageSettings(data: Record<string, unknown>) {
  const errors: Record<string, string[]> = {};

  for (const key of [
    "maxFileSizeMB",
    "maxImageSizeMB",
    "maxVideoSizeMB",
    "maxModelSizeMB",
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const value = data[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_UPLOAD_SIZE_MB
    ) {
      errors[`storage.${key}`] = [
        `Must be a whole number of megabytes between 1 and ${MAX_UPLOAD_SIZE_MB}`,
      ];
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "allowedMimeTypes")) {
    if (!Array.isArray(data.allowedMimeTypes)) {
      errors["storage.allowedMimeTypes"] = ["Allowed file types must be a list"];
    } else {
      const cleaned: string[] = [];
      const seen = new Set<string>();
      for (const entry of data.allowedMimeTypes) {
        if (!isSupportedUploadMimeType(entry)) {
          errors["storage.allowedMimeTypes"] = [
            `Unsupported file type: ${String(entry)}`,
          ];
          break;
        }
        const normalized = entry.trim().toLowerCase();
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        cleaned.push(normalized);
      }
      // An empty list disables the gate entirely in `validateUpload`, which is
      // the opposite of what emptying the field looks like it does.
      if (!errors["storage.allowedMimeTypes"] && cleaned.length === 0) {
        errors["storage.allowedMimeTypes"] = ["Select at least one file type"];
      }
      if (!errors["storage.allowedMimeTypes"]) {
        data.allowedMimeTypes = cleaned;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
}

/**
 * Currencies are not restricted to a bundled list — admins can add any ISO 4217
 * code from the settings UI — so codes are validated by shape, normalized to
 * uppercase and de-duplicated here before they reach the store.
 */
function validateCurrencySettings(data: Record<string, unknown>) {
  const hasSupported = Object.prototype.hasOwnProperty.call(
    data,
    "supportedCurrencies",
  );
  const hasDefault = Object.prototype.hasOwnProperty.call(
    data,
    "defaultCurrency",
  );
  if (!hasSupported && !hasDefault) return;

  let supported: string[] | undefined;

  if (hasSupported) {
    if (!Array.isArray(data.supportedCurrencies)) {
      throw new ValidationError("Supported currencies must be a list");
    }
    for (const code of data.supportedCurrencies) {
      if (!isValidCurrencyCode(code)) {
        throw new ValidationError(`Invalid currency code: ${String(code)}`);
      }
    }
    supported = sanitizeCurrencyCodes(data.supportedCurrencies);
    if (supported.length === 0) {
      throw new ValidationError("Select at least one supported currency");
    }
    data.supportedCurrencies = supported;
  }

  if (hasDefault) {
    const code = normalizeCurrencyCode(data.defaultCurrency);
    if (!isValidCurrencyCode(code)) {
      throw new ValidationError(
        `Invalid default currency: ${String(data.defaultCurrency)}`,
      );
    }
    // A default outside the supported list would leave the store rendering a
    // currency it doesn't officially support, so keep the two in sync.
    if (supported && !supported.includes(code)) {
      data.supportedCurrencies = [...supported, code];
    }
    data.defaultCurrency = code;
  }
}

/**
 * Bounds for the boosting numbers that govern money and inventory.
 *
 * Mongoose `min`/`max` plus the tab's `clampInt` are not enough on their own:
 * `clampInt` is client-side, and `findOneAndUpdate` (which the settings save
 * uses) does not run validators. An out-of-range `holdMinutes` decides how long
 * premium inventory sits off the market for free, and anything under 35 makes
 * every Stripe boost checkout fail with `Invalid expires_at` — a value worth
 * refusing at the door rather than debugging from a vendor's bug report.
 */
function validateBoostingSettings(data: Record<string, unknown>) {
  const bounded: Array<[string, number, number]> = [
    ["listingSlots", 1, MAX_PLACEMENT_DEPTH],
    ["productPageSlots", 1, MAX_PLACEMENT_DEPTH],
    ["holdMinutes", BOOST_HOLD_MIN_MINUTES, BOOST_HOLD_MAX_MINUTES],
    ["bookingHorizonDays", 7, 365],
    ["maxBookingDays", 1, 365],
  ];
  for (const [key, min, max] of bounded) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const value = data[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      throw new ValidationError(
        `${key} must be a whole number between ${min} and ${max}`,
      );
    }
  }
}

/**
 * Bounds for the security section.
 *
 * This was the one section with a save handler and no validator, and the
 * numbers it carries are the ones that can lock the whole store out:
 * `sessionMaxAgeDays: -1` reaches Better Auth's JWT lifetime and expires every
 * session including the admin's own, and `minPasswordLength: 1` opens sign-up to
 * single-character passwords. The schema cannot hold the line here — a bound
 * there would reject every future save from a store already holding a bad value
 * (see the comment on the security block in `models/settings.model.ts`) — so
 * this is where a new bad value gets refused.
 *
 * Every limit is imported from the module that enforces it at read time. A
 * second copy of the number here is precisely how the API and the behaviour
 * drift apart.
 */
function validateSecuritySettings(data: Record<string, unknown>) {
  const bounded: Array<[string, number, number]> = [
    ["sessionMaxAgeDays", MIN_SESSION_MAX_AGE_DAYS, MAX_SESSION_MAX_AGE_DAYS],
    ["maxLoginAttempts", MIN_LOGIN_ATTEMPTS, MAX_LOGIN_ATTEMPTS],
    ["lockoutDurationMinutes", MIN_LOCKOUT_MINUTES, MAX_LOCKOUT_MINUTES],
    [
      "minPasswordLength",
      MIN_ALLOWED_PASSWORD_LENGTH,
      MAX_ALLOWED_PASSWORD_LENGTH,
    ],
  ];

  for (const [key, min, max] of bounded) {
    if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
    const value = data[key];
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      throw new ValidationError(
        `${key} must be a whole number between ${min} and ${max}`,
      );
    }
  }

  const booleanKeys = [
    "emailVerificationRequired",
    "emailVerificationForVendors",
    "twoFactorEnabled",
    "twoFactorRequiredForAdmin",
    "twoFactorRequiredForVendors",
    "twoFactorRequiredForStaff",
    "googleOAuthEnabled",
    "facebookOAuthEnabled",
    "requireUppercase",
    "requireNumbers",
    "requireSpecialChars",
  ] as const;
  for (const key of booleanKeys) {
    if (
      Object.prototype.hasOwnProperty.call(data, key) &&
      typeof data[key] !== "boolean"
    ) {
      throw new ValidationError(`${key} must be true or false`);
    }
  }

  if (!Object.prototype.hasOwnProperty.call(data, "rateLimiting")) return;
  if (!isPlainObject(data.rateLimiting)) {
    throw new ValidationError("Rate limiting settings are invalid");
  }

  const rateLimiting = data.rateLimiting;
  if (
    Object.prototype.hasOwnProperty.call(rateLimiting, "enabled") &&
    typeof rateLimiting.enabled !== "boolean"
  ) {
    throw new ValidationError("Rate limiting must be switched on or off");
  }

  const allowedPresets = new Set<string>(RATE_LIMIT_PRESETS);
  for (const [key, value] of Object.entries(rateLimiting)) {
    if (key === "enabled") continue;
    if (!key.endsWith("Preset")) {
      throw new ValidationError(`Invalid rate limiting setting: ${key}`);
    }
    if (typeof value !== "string" || !allowedPresets.has(value)) {
      throw new ValidationError(
        `${key} must be one of: ${RATE_LIMIT_PRESETS.join(", ")}`,
      );
    }
  }
}

const STORE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A public URL, with or without its scheme ("example.com" is accepted). */
function isValidStoreDomain(value: string): boolean {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname.includes(".") || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

function validateGeneralSettings(data: Record<string, unknown>) {
  validateCurrencySettings(data);

  const errors: Record<string, string[]> = {};
  if (Object.prototype.hasOwnProperty.call(data, "storeName")) {
    const name = typeof data.storeName === "string" ? data.storeName.trim() : "";
    if (!name) errors.storeName = ["Store name is required"];
    else if (name.length > 120) errors.storeName = ["Store name is too long"];
    else data.storeName = name;
  }
  if (Object.prototype.hasOwnProperty.call(data, "storeEmail")) {
    const email =
      typeof data.storeEmail === "string" ? data.storeEmail.trim() : "";
    if (!STORE_EMAIL_PATTERN.test(email) || email.length > 320) {
      errors.storeEmail = ["Enter a valid store email address"];
    } else {
      data.storeEmail = email;
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, "storeDomain")) {
    const domain =
      typeof data.storeDomain === "string" ? data.storeDomain.trim() : "";
    if (domain && (domain.length > 253 || !isValidStoreDomain(domain))) {
      errors.storeDomain = [
        "Enter the store's public address, like https://example.com",
      ];
    } else {
      data.storeDomain = domain;
    }
  }
  if (Object.prototype.hasOwnProperty.call(data, "storePhone")) {
    const phone =
      typeof data.storePhone === "string" ? data.storePhone.trim() : "";
    if (phone.length > 40) errors.storePhone = ["Phone number is too long"];
    else data.storePhone = phone;
  }
  if (Object.keys(errors).length > 0) throw new ValidationError(errors);

  if (!Object.prototype.hasOwnProperty.call(data, "countryAvailability")) {
    return;
  }

  if (!isPlainObject(data.countryAvailability)) {
    throw new ValidationError("Country availability settings are invalid");
  }

  const availability = data.countryAvailability;
  const allowedKeys = new Set(["mode", "countryCodes"]);
  for (const key of Object.keys(availability)) {
    if (!allowedKeys.has(key)) {
      throw new ValidationError(`Invalid country availability setting: ${key}`);
    }
  }

  const mode = availability.mode;
  if (
    mode !== COUNTRY_AVAILABILITY_MODES.ALL &&
    mode !== COUNTRY_AVAILABILITY_MODES.SELECTED
  ) {
    throw new ValidationError(
      'Country availability mode must be "all" or "selected"',
    );
  }

  if (!Array.isArray(availability.countryCodes)) {
    throw new ValidationError("Country codes must be a list");
  }

  for (const code of availability.countryCodes) {
    if (typeof code !== "string" || !isKnownCountryCode(code)) {
      throw new ValidationError(`Invalid country code: ${String(code)}`);
    }
  }

  const countryCodes = sanitizeCountryCodes(availability.countryCodes);
  if (
    mode === COUNTRY_AVAILABILITY_MODES.SELECTED &&
    countryCodes.length === 0
  ) {
    throw new ValidationError(
      "Select at least one country when using selected countries",
    );
  }

  data.countryAvailability = {
    mode,
    countryCodes:
      mode === COUNTRY_AVAILABILITY_MODES.ALL ? [] : countryCodes,
  };
}

function validateShippingCountrySettings(
  data: Record<string, unknown>,
  currentSettings: unknown,
  availability: unknown,
) {
  const errors: Record<string, string[]> = {};
  const currentShipping = toPlainRecord(
    toPlainRecord(currentSettings).shipping,
  );

  if (isPlainObject(data.origin)) {
    const nextCountry = data.origin.country;
    if (nextCountry !== undefined && typeof nextCountry !== "string") {
      errors["shipping.origin.country"] = ["Country must be text"];
    } else if (typeof nextCountry === "string" && nextCountry.trim()) {
      const previousCountry = toPlainRecord(currentShipping.origin).country;
      if (
        !areCountryValuesEquivalent(nextCountry, previousCountry) &&
        !isCountryAllowed(nextCountry, availability)
      ) {
        errors["shipping.origin.country"] = [
          "Selected country is not available",
        ];
      }
    }
  }

  if (Array.isArray(data.zones)) {
    const currentZones = Array.isArray(currentShipping.zones)
      ? currentShipping.zones
      : [];
    const currentZonesById = new Map(
      currentZones
        .map((zone) => toPlainRecord(zone))
        .filter((zone) => typeof zone.id === "string" && zone.id.trim())
        .map((zone) => [String(zone.id), zone]),
    );

    data.zones.forEach((rawZone, zoneIndex) => {
      const zone = toPlainRecord(rawZone);
      if (!Array.isArray(zone.countries)) return;

      const currentZone =
        (typeof zone.id === "string" && currentZonesById.get(zone.id)) ||
        toPlainRecord(currentZones[zoneIndex]);
      const previousCountries = Array.isArray(currentZone.countries)
        ? currentZone.countries
        : [];

      zone.countries.forEach((country, countryIndex) => {
        const path = `shipping.zones.${zoneIndex}.countries.${countryIndex}`;
        if (typeof country !== "string") {
          errors[path] = ["Country must be text"];
          return;
        }
        if (!country.trim() || isCountryAllowed(country, availability)) return;

        const wasAlreadyConfigured = previousCountries.some((previous) =>
          areCountryValuesEquivalent(country, previous),
        );
        if (!wasAlreadyConfigured) {
          errors[path] = ["Selected country is not available"];
        }
      });
    });
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
}

/**
 * Drop the carrier auth-failure flag from an inbound save.
 *
 * It is written by the worker and the Test-connection action and cleared the
 * moment a carrier accepts us again — the browser only ever holds a snapshot of
 * it. The save flattens to dot paths and sets each leaf, so a form loaded before
 * the credential was fixed would write its stale copy back and resurrect an
 * alarm that is no longer true. Nothing here is client-editable, so the whole
 * key goes.
 */
function stripCarrierAuthFailure(data: Record<string, unknown>) {
  const carriers = data.carriers;
  if (!isPlainObject(carriers)) return;
  for (const provider of CARRIER_PROVIDERS) {
    const block = carriers[provider];
    if (isPlainObject(block)) delete block.authFailure;
  }
}

/**
 * Guard the carrier, package and automation sub-sections.
 *
 * The section allow-list only screens top-level keys, so without this a
 * malformed package (no id, zero dimensions, three boxes all flagged default)
 * would save cleanly and only fail much later, inside a carrier call the
 * merchant has already paid for.
 */
function validateCarrierSettings(data: Record<string, unknown>) {
  const errors: Record<string, string[]> = {};

  stripCarrierAuthFailure(data);

  if (Object.prototype.hasOwnProperty.call(data, "packages")) {
    if (!Array.isArray(data.packages)) {
      errors["shipping.packages"] = ["Packages must be a list"];
    } else {
      const seenIds = new Set<string>();
      let defaults = 0;

      data.packages.forEach((rawPackage, index) => {
        const preset = toPlainRecord(rawPackage);
        const path = `shipping.packages.${index}`;

        const id = typeof preset.id === "string" ? preset.id.trim() : "";
        if (!id) {
          errors[`${path}.id`] = ["Package id is required"];
        } else if (seenIds.has(id)) {
          errors[`${path}.id`] = ["Package ids must be unique"];
        } else {
          seenIds.add(id);
        }

        if (typeof preset.name !== "string" || !preset.name.trim()) {
          errors[`${path}.name`] = ["Package name is required"];
        }

        // A zero on any axis makes the box unusable for a volumetric rate,
        // which every carrier charges by.
        for (const axis of ["length", "width", "height"] as const) {
          const value = Number(preset[axis]);
          if (!Number.isFinite(value) || value <= 0) {
            errors[`${path}.${axis}`] = [
              "Package dimensions must be greater than zero",
            ];
          }
        }

        for (const optional of ["emptyWeight", "maxWeight"] as const) {
          if (preset[optional] === undefined || preset[optional] === null) continue;
          const value = Number(preset[optional]);
          if (!Number.isFinite(value) || value < 0) {
            errors[`${path}.${optional}`] = ["Weight cannot be negative"];
          }
        }

        if (preset.isDefault === true && preset.active !== false) defaults += 1;
      });

      if (defaults > 1) {
        errors["shipping.packages"] = [
          "Only one package can be the default",
        ];
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "courierTrackingLinks")) {
    if (!Array.isArray(data.courierTrackingLinks)) {
      errors["shipping.courierTrackingLinks"] = ["Courier links must be a list"];
    } else {
      data.courierTrackingLinks.forEach((rawLink, index) => {
        const link = toPlainRecord(rawLink);
        const path = `shipping.courierTrackingLinks.${index}`;

        const carrier = typeof link.carrier === "string" ? link.carrier.trim() : "";
        if (!carrier) {
          errors[`${path}.carrier`] = ["Courier name is required"];
        }

        const template =
          typeof link.urlTemplate === "string" ? link.urlTemplate.trim() : "";
        if (!template) {
          errors[`${path}.urlTemplate`] = ["Tracking URL is required"];
          return;
        }

        // This value ends up in an `href` on a customer-facing page, so the
        // scheme is checked where it is stored rather than trusted to whichever
        // component renders it next. `{tracking}` survives the parse; a URL
        // that does not parse at all never had a chance of working.
        let parsed: URL;
        try {
          parsed = new URL(template);
        } catch {
          errors[`${path}.urlTemplate`] = ["Enter a full URL, including https://"];
          return;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          errors[`${path}.urlTemplate`] = ["Tracking URLs must be http or https"];
        }
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "automation")) {
    const automation = toPlainRecord(data.automation);

    const min = automation.minOrderValue;
    const max = automation.maxOrderValue;
    for (const [key, value] of [
      ["minOrderValue", min],
      ["maxOrderValue", max],
      ["maxLabelCost", automation.maxLabelCost],
    ] as const) {
      if (value === undefined || value === null || value === "") continue;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        errors[`shipping.automation.${key}`] = ["Must be a positive amount"];
      }
    }
    if (
      Number.isFinite(Number(min)) &&
      Number.isFinite(Number(max)) &&
      Number(max) > 0 &&
      Number(min) > Number(max)
    ) {
      errors["shipping.automation.maxOrderValue"] = [
        "Maximum must be greater than the minimum",
      ];
    }

    // A fixed-service rule with no service selected would silently fall back to
    // cheapest, which is not what the merchant asked for.
    if (
      automation.rateChoice === "fixed_service" &&
      automation.enabled === true &&
      !(
        typeof automation.fixedServiceToken === "string" &&
        automation.fixedServiceToken.trim()
      )
    ) {
      errors["shipping.automation.fixedServiceToken"] = [
        "Choose a service when using a fixed shipping service",
      ];
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }
}

function validateOrderSettings(data: Record<string, unknown>) {
  if (Object.prototype.hasOwnProperty.call(data, "prefix")) {
    if (typeof data.prefix !== "string") {
      throw new ValidationError("Order prefix must be text");
    }
    const prefix = data.prefix.trim().toUpperCase();
    data.prefix = prefix;
    if (!ORDER_PREFIX_PATTERN.test(prefix)) {
      throw new ValidationError(
        "Order prefix must contain 2 to 10 uppercase letters or numbers",
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "taxRate")) {
    // Tax is stored as a decimal fraction: 10% = 0.10.
    requireFiniteNumber(data.taxRate, "Tax rate", 0, 1);
  }
  if (Object.prototype.hasOwnProperty.call(data, "defaultShippingCost")) {
    requireFiniteNumber(data.defaultShippingCost, "Default shipping cost", 0);
  }
  if (Object.prototype.hasOwnProperty.call(data, "freeShippingThreshold")) {
    requireFiniteNumber(data.freeShippingThreshold, "Free shipping threshold", 0);
  }

  if (Object.prototype.hasOwnProperty.call(data, "returns")) {
    if (!isPlainObject(data.returns)) {
      throw new ValidationError("Return policy settings are invalid");
    }
    const allowedReturnKeys = new Set([
      "shippingRefund",
      "restockingFeePercent",
      "returnShippingFee",
      "refundAdminFeePercent",
      "refundAdminFeeCap",
      "billVendorCodShipping",
    ]);
    for (const key of Object.keys(data.returns)) {
      if (!allowedReturnKeys.has(key)) {
        throw new ValidationError(`Invalid return policy setting: ${key}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(data.returns, "shippingRefund")) {
      if (
        !(RETURN_SHIPPING_REFUND_MODES as readonly string[]).includes(
          String(data.returns.shippingRefund),
        )
      ) {
        throw new ValidationError(
          `Return shipping refund must be one of: ${RETURN_SHIPPING_REFUND_MODES.join(", ")}`,
        );
      }
    }
    if (
      Object.prototype.hasOwnProperty.call(data.returns, "restockingFeePercent")
    ) {
      requireFiniteNumber(
        data.returns.restockingFeePercent,
        "Restocking fee",
        0,
        100,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(data.returns, "returnShippingFee")
    ) {
      requireFiniteNumber(data.returns.returnShippingFee, "Return shipping fee", 0);
    }
    if (
      Object.prototype.hasOwnProperty.call(
        data.returns,
        "refundAdminFeePercent",
      )
    ) {
      requireFiniteNumber(
        data.returns.refundAdminFeePercent,
        "Refund administration fee",
        0,
        100,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(data.returns, "refundAdminFeeCap")
    ) {
      // No upper bound: 0 means uncapped, and any positive figure is a ceiling
      // the fee is already clamped to the commission by.
      requireFiniteNumber(
        data.returns.refundAdminFeeCap,
        "Refund administration fee cap",
        0,
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(data.returns, "billVendorCodShipping")
    ) {
      if (typeof data.returns.billVendorCodShipping !== "boolean") {
        throw new ValidationError(
          "Billing vendors for cash-on-delivery shipping must be true or false",
        );
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "commission")) {
    if (!isPlainObject(data.commission)) {
      throw new ValidationError("Commission settings are invalid");
    }
    const allowedCommissionKeys = new Set(["vendorRate", "minWithdrawalAmount"]);
    for (const key of Object.keys(data.commission)) {
      if (!allowedCommissionKeys.has(key)) {
        throw new ValidationError(`Invalid commission setting: ${key}`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(data.commission, "vendorRate")) {
      requireFiniteNumber(data.commission.vendorRate, "Commission rate", 0, 100);
    }
    if (
      Object.prototype.hasOwnProperty.call(data.commission, "minWithdrawalAmount")
    ) {
      requireFiniteNumber(
        data.commission.minWithdrawalAmount,
        "Minimum withdrawal amount",
        0,
      );
    }
  }
}

function validateVendorConfigSettings(data: Record<string, unknown>) {
  const booleanKeys = [
    "plansEnabled",
    "allowRegistration",
    "autoApprove",
    "requirePlanSelection",
  ] as const;
  for (const key of booleanKeys) {
    if (
      Object.prototype.hasOwnProperty.call(data, key) &&
      typeof data[key] !== "boolean"
    ) {
      throw new ValidationError(`${key} must be true or false`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(data, "freeTrialDays")) {
    requireFiniteNumber(data.freeTrialDays, "Free trial days", 0, 365);
  }

  if (Object.prototype.hasOwnProperty.call(data, "requiredDocuments")) {
    if (!Array.isArray(data.requiredDocuments)) {
      throw new ValidationError("Required documents must be a list");
    }
    const allowed = new Set<string>(VENDOR_DOCUMENT_KEYS);
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const item of data.requiredDocuments) {
      if (typeof item !== "string" || !allowed.has(item)) {
        throw new ValidationError(`Invalid required document: ${String(item)}`);
      }
      if (!seen.has(item)) {
        seen.add(item);
        cleaned.push(item);
      }
    }
    data.requiredDocuments = cleaned;
  }

  if (
    Object.prototype.hasOwnProperty.call(data, "defaultPlanId") &&
    data.defaultPlanId !== undefined &&
    data.defaultPlanId !== null &&
    typeof data.defaultPlanId !== "string"
  ) {
    throw new ValidationError("Default plan is invalid");
  }
}

function validateEmailSettings(data: Record<string, unknown>) {
  const enabled = data.enabled === true;
  const smtp = isPlainObject(data.smtp) ? data.smtp : {};
  const host = typeof smtp.host === "string" ? smtp.host.trim() : "";
  const user = typeof smtp.user === "string" ? smtp.user.trim() : "";
  const password = typeof smtp.password === "string" ? smtp.password : undefined;
  const port = Number(smtp.port);
  const fromEmail =
    typeof data.fromEmail === "string" ? data.fromEmail.trim() : "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (enabled && !host) throw new ValidationError("SMTP host is required");
  if (host && (!/^[a-z0-9.-]+$/i.test(host) || host.includes(".."))) {
    throw new ValidationError("SMTP host is invalid");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ValidationError("SMTP port must be between 1 and 65535");
  }
  if (enabled && !user) throw new ValidationError("SMTP username is required");
  if (user && (/\s/.test(user) || user.length > 320)) {
    throw new ValidationError("SMTP username is invalid");
  }
  if (fromEmail && !emailPattern.test(fromEmail)) {
    throw new ValidationError("From email must be a valid email address");
  }
  if (password !== undefined && password.length > 0 && password.trim().length === 0) {
    throw new ValidationError("SMTP password cannot contain only spaces");
  }

  smtp.host = host;
  smtp.user = user;
  smtp.port = port;
  // Retained in storage for backwards compatibility; runtime TLS is port-derived.
  smtp.secure = port === 465;
  data.smtp = smtp;
  if (fromEmail) data.fromEmail = fromEmail;
}

function mergeContentPagesSettings(
  existing: unknown,
  patch: Record<string, unknown>,
) {
  const current = normalizeContentPagesSettings(existing);
  const next: Record<string, unknown> = { ...current };

  for (const key of CONTENT_PAGE_KEYS) {
    const value = patch[key];
    if (isPlainObject(value)) {
      next[key] = {
        ...(current[key] as unknown as Record<string, unknown>),
        ...value,
      };
    }
  }

  if (Array.isArray(patch.customPages)) {
    next.customPages = patch.customPages;
  }

  return normalizeContentPagesSettings(next);
}

/**
 * GET /api/admin/settings
 * Get all settings
 */
export const GET = withApi(
  { auth: "admin" },
  async () => {
    const settings = await getSettings();

    return successResponse(sanitizeSettings(settings));
  },
);

// Envelope only: `data` is allow-listed per section further down.
const SettingsUpdateSchema = z.object({
  section: z.string().max(80).optional(),
  data: z.unknown().optional(),
  /** `_meta.sectionVersions` as loaded; a moved section answers 409. */
  expectedVersions: z.record(z.string(), z.string()).optional(),
  /** Overwrite knowingly after a 409 — the conflict dialog's "save anyway". */
  force: z.boolean().optional(),
});

/**
 * PUT /api/admin/settings
 * Update settings by section
 */
export const PUT = withApi(
  { auth: "admin", demo: "block-mutations" },
  async ({ request, session }) => {
    // Rate limiting - settings changes are sensitive
    await rateLimitByUser(
      request,
      session.user.id,
      "admin:settings:update",
      "moderate",
      session.user.role
    );

    await connectDB();

    const { section, data, expectedVersions, force } = await validateBody(
      request,
      SettingsUpdateSchema,
    );

    // Atomic upsert rather than find-then-create: two admins saving different
    // sections on a brand-new store must not each mint their own document.
    const settings = await loadSettingsDocument();

    // Stale-copy guard: the form vouches for the fingerprints it loaded; a
    // section someone else changed since then is not overwritten unnoticed.
    if (!force && expectedVersions) {
      const current = sanitizeSettings(settings)._meta as {
        sectionVersions?: Record<string, string>;
      };
      assertSectionVersions(current.sectionVersions ?? {}, expectedVersions);
    }

    // Capture before state for audit logging
    const auditContext = createAuditContext(request, session);
    const beforeSettings = settings.toObject();

    // Update by section (sub-document approach)
    if (section && data !== undefined) {
      const sectionData = applySectionAllowList(section, data);
      if (section === "general") validateGeneralSettings(sectionData);
      if (section === "boosting") validateBoostingSettings(sectionData);
      if (section === "shipping") {
        validateShippingCountrySettings(
          sectionData,
          beforeSettings,
          settings.general?.countryAvailability,
        );
        validateCarrierSettings(sectionData);
      }
      if (section === "orders") validateOrderSettings(sectionData);
      if (section === "security") validateSecuritySettings(sectionData);
      if (section === "email") validateEmailSettings(sectionData);
      if (section === "vendorConfig") validateVendorConfigSettings(sectionData);
      if (section === "storage") {
        normalizeStorageSettings(sectionData);
        validateStorageSettings(sectionData);
      }
      applyCredentialUpdateMarkers(section, sectionData);
      if (section === "contentPages") {
        // The /pages/<handle> namespace is shared with theme-engine landing
        // pages, and a landing page always wins the route — refuse to save a
        // custom page that would be silently unreachable behind one. (The
        // landing-page create API guards the other direction.)
        const incomingPages = (
          sectionData as { customPages?: { handle?: unknown }[] }
        ).customPages;
        if (Array.isArray(incomingPages) && incomingPages.length > 0) {
          const handles = incomingPages
            .map((page) => page?.handle)
            .filter(
              (candidate): candidate is string =>
                typeof candidate === "string" && candidate.length > 0,
            );
          if (handles.length > 0) {
            const [{ StorePage }, { buildLandingKey }] = await Promise.all([
              import("@/models/store-page.model"),
              import("@/lib/storefront/pages/handles"),
            ]);
            const clash = await StorePage.findOne({
              key: { $in: handles.map((entry) => buildLandingKey(entry)) },
            })
              .select("handle")
              .lean();
            if (clash) {
              throw new ValidationError(
                `A landing page already uses the handle "${clash.handle}" — the custom page would never be shown at /pages/${clash.handle}`,
              );
            }
          }
        }
        settings.set(
          "contentPages",
          mergeContentPagesSettings(settings.contentPages, sectionData),
        );
        settings.markModified("contentPages");
      } else if (section === "footer") {
        settings.set("footer", normalizeFooterSettings(sectionData));
        settings.markModified("footer");
      } else if (section === "checkout") {
        // Explicit normalize (like footer): policyLinks is an array, and
        // flattenToDotPaths would write it element-by-element.
        settings.set("checkout", normalizeCheckoutSettings(sectionData));
        settings.markModified("checkout");
      } else if (section === "productCard") {
        // Explicit normalize: `groups` is an array (same reason as checkout).
        settings.set("productCard", normalizeProductCardConfig(sectionData));
        settings.markModified("productCard");
      } else if (section === "header") {
        // Mixed sections are normalised on the way in as well as on the way
        // out, so the document never carries shapes the readers would drop.
        settings.set("header", normalizeHeaderSettings(sectionData));
        settings.markModified("header");
      } else if (section === "homePage") {
        settings.set("homePage", normalizeHomePageSettings(sectionData));
        settings.markModified("homePage");
      } else {
        const updates = flattenToDotPaths(section, sectionData);
        for (const [path, value] of Object.entries(updates)) {
          settings.set(path, value);
        }
      }
    } else if (data !== undefined) {
      if (!isPlainObject(data)) {
        throw new ValidationError("Invalid data payload");
      }

      // Update multiple sections at once
      const requestedGeneral = toPlainRecord(data.general);
      const effectiveCountryAvailability = Object.prototype.hasOwnProperty.call(
        requestedGeneral,
        "countryAvailability",
      )
        ? requestedGeneral.countryAvailability
        : settings.general?.countryAvailability;
      for (const [key, rawValue] of Object.entries(data)) {
        const value: unknown = applySectionAllowList(key, rawValue);
        if (key === "general" && isPlainObject(value)) {
          validateGeneralSettings(value);
        }
        if (key === "boosting" && isPlainObject(value)) {
          validateBoostingSettings(value);
        }
        if (key === "shipping" && isPlainObject(value)) {
          validateShippingCountrySettings(
            value,
            beforeSettings,
            effectiveCountryAvailability,
          );
          validateCarrierSettings(value);
        }
        if (key === "orders" && isPlainObject(value)) {
          validateOrderSettings(value);
        }
        if (key === "security" && isPlainObject(value)) {
          validateSecuritySettings(value);
        }
        if (key === "email" && isPlainObject(value)) {
          validateEmailSettings(value);
        }
        if (key === "vendorConfig" && isPlainObject(value)) {
          validateVendorConfigSettings(value);
        }
        if (key === "storage" && isPlainObject(value)) {
          normalizeStorageSettings(value);
          validateStorageSettings(value);
        }
        if (isPlainObject(value)) {
          applyCredentialUpdateMarkers(key, value);
        }
        if (key === "contentPages" && isPlainObject(value)) {
          settings.set(
            "contentPages",
            mergeContentPagesSettings(settings.contentPages, value),
          );
          settings.markModified("contentPages");
        } else if (key === "footer" && isPlainObject(value)) {
          settings.set("footer", normalizeFooterSettings(value));
          settings.markModified("footer");
        } else if (key === "checkout" && isPlainObject(value)) {
          settings.set("checkout", normalizeCheckoutSettings(value));
          settings.markModified("checkout");
        } else if (key === "productCard" && isPlainObject(value)) {
          settings.set("productCard", normalizeProductCardConfig(value));
          settings.markModified("productCard");
        } else if (key === "header" && isPlainObject(value)) {
          settings.set("header", normalizeHeaderSettings(value));
          settings.markModified("header");
        } else if (key === "homePage" && isPlainObject(value)) {
          settings.set("homePage", normalizeHomePageSettings(value));
          settings.markModified("homePage");
        } else if (isPlainObject(value)) {
          const updates = flattenToDotPaths(key, value);
          for (const [path, v] of Object.entries(updates)) {
            settings.set(path, v);
          }
        } else {
          settings.set(key, value);
        }
      }
    }

    settings.updatedBy = session.user.id;
    // The platform commission rate is cached onto every vendor, so changing it
    // here changes nothing by itself — see `lib/commission-reprojection.ts`.
    const previousCommissionRate = (
      beforeSettings as unknown as {
        orders?: { commission?: { vendorRate?: number } };
      }
    ).orders?.commission?.vendorRate;
    const ordersWasUpdated =
      section === "orders" ||
      (!section &&
        isPlainObject(data) &&
        Object.prototype.hasOwnProperty.call(data, "orders"));
    const emailWasUpdated =
      section === "email" ||
      (!section &&
        isPlainObject(data) &&
        Object.prototype.hasOwnProperty.call(data, "email"));
    if (
      emailWasUpdated &&
      settings.email?.enabled &&
      settings.email?.provider === "smtp" &&
      !resolveSmtpConfig(settings)
    ) {
      throw new ValidationError(
        "SMTP username and password are required. Enter a password or configure SMTP_USER and SMTP_PASS.",
      );
    }
    const beforeSecurity = isPlainObject(
      (beforeSettings as unknown as Record<string, unknown>).security,
    )
      ? ((beforeSettings as unknown as Record<string, unknown>)
          .security as Record<string, unknown>)
      : {};
    const enabledVerificationNow =
      (!Boolean(beforeSecurity.emailVerificationRequired) &&
        Boolean(settings.security?.emailVerificationRequired)) ||
      (!Boolean(beforeSecurity.emailVerificationForVendors) &&
        Boolean(settings.security?.emailVerificationForVendors));
    if (enabledVerificationNow) {
      if (!isCurrentSmtpConfigurationVerified(settings)) {
        throw new ValidationError(
          "Send a successful SMTP test email before enabling email verification.",
        );
      }
    }

    const beforeFingerprint = getSmtpConfigurationFingerprint(
      beforeSettings as unknown as typeof settings,
    );
    const currentFingerprint = getSmtpConfigurationFingerprint(settings);
    const smtpConfigurationChanged =
      emailWasUpdated && beforeFingerprint !== currentFingerprint;
    if (
      smtpConfigurationChanged &&
      (settings.security?.emailVerificationRequired ||
        settings.security?.emailVerificationForVendors)
    ) {
      throw new ValidationError(
        "Disable email verification before changing SMTP settings, then send a new successful test email.",
      );
    }
    if (smtpConfigurationChanged) {
      settings.set("security.smtpVerifiedAt", undefined);
      settings.set("security.smtpVerificationFingerprint", undefined);
    }

    const now = new Date();
    if (
      !Boolean(beforeSecurity.emailVerificationRequired) &&
      settings.security?.emailVerificationRequired
    ) {
      settings.set("security.emailVerificationRequiredSince", now);
    } else if (
      Boolean(beforeSecurity.emailVerificationRequired) &&
      !settings.security?.emailVerificationRequired
    ) {
      settings.set("security.emailVerificationRequiredSince", undefined);
    }
    if (
      !Boolean(beforeSecurity.emailVerificationForVendors) &&
      settings.security?.emailVerificationForVendors
    ) {
      settings.set("security.emailVerificationForVendorsSince", now);
    } else if (
      Boolean(beforeSecurity.emailVerificationForVendors) &&
      !settings.security?.emailVerificationForVendors
    ) {
      settings.set("security.emailVerificationForVendorsSince", undefined);
    }
    await settings.save();

    // Push a changed default onto the vendors still sitting on the old one.
    // Only when it actually changed: an unrelated Orders save must not restamp
    // every vendor, and re-running it is harmless but pointless.
    if (
      ordersWasUpdated &&
      settings.orders?.commission?.vendorRate !== previousCommissionRate
    ) {
      const { reprojectDefaultCommission } = await import(
        "@/lib/finance/commission-reprojection"
      );
      // Never fails the save. The rate is stored either way, and a sweep that
      // did not run can be re-triggered by saving again — losing the settings
      // write because a bulk update timed out would be the worse trade.
      await reprojectDefaultCommission(settings).catch((error) =>
        console.error("Failed to re-project vendor commission:", error),
      );
    }

    if (emailWasUpdated) {
      const beforeEmail = isPlainObject(
        (beforeSettings as unknown as Record<string, unknown>).email,
      )
        ? ((beforeSettings as unknown as Record<string, unknown>)
            .email as Record<string, unknown>)
        : {};
      const previousRetention = Number(beforeEmail.logRetentionDays || 30);
      const nextRetention = settings.email?.logRetentionDays ?? 30;
      if (previousRetention !== nextRetention) {
        await EmailDelivery.updateMany(
          { status: "sent" },
          {
            $set: {
              expiresAt: new Date(
                Date.now() + nextRetention * 24 * 60 * 60 * 1000,
              ),
            },
            $unset: { html: 1, text: 1, attachments: 1 },
          },
        );
      }
    }

    const shouldClearStorageCache =
      section === "storage" ||
      (!section &&
        isPlainObject(data) &&
        Object.prototype.hasOwnProperty.call(data, "storage"));
    if (shouldClearStorageCache) {
      clearStorageConfigCache();
    }

    const generalWasUpdated =
      section === "general" ||
      (!section &&
        isPlainObject(data) &&
        Object.prototype.hasOwnProperty.call(data, "general"));
    if (generalWasUpdated) {
      const { clearStoreCurrencyCache } = await import("@/lib/finance/post-events");
      clearStoreCurrencyCache();
    }

    const shouldSyncDefaultVendor =
      section === "general" ||
      section === "shipping" ||
      section === "multiVendorMode" ||
      (!section &&
        isPlainObject(data) &&
        (Object.prototype.hasOwnProperty.call(data, "general") ||
          Object.prototype.hasOwnProperty.call(data, "shipping") ||
          Object.prototype.hasOwnProperty.call(data, "multiVendorMode")));

    // The settings are already committed by this point, so a fault here is not
    // a reason to fail the request — and it must not skip what follows it.
    // Until this was caught, a single unrelated problem on the default vendor
    // (a permission value written by another branch, a validation rule it
    // predates) threw right here: the settings were saved, but
    // `revalidateSettingsContent`, the audit entry and the success response all
    // went with it. The merchant saw a red error, reloaded, was served the
    // still-cached old values, and reasonably concluded nothing had saved.
    let vendorSyncWarning: string | undefined;
    if (shouldSyncDefaultVendor) {
      try {
        const { syncDefaultVendorWithSettings } = await import(
          "@/lib/vendors/multi-vendor"
        );
        await syncDefaultVendorWithSettings(session.user.id, settings, {
          syncAddress:
            section === "shipping" ||
            (!section &&
              isPlainObject(data) &&
              Object.prototype.hasOwnProperty.call(data, "shipping")),
        });
        revalidateProductContent();
      } catch (error) {
        // Surfaced, never swallowed: the default vendor's address really is out
        // of step with the settings now, and the merchant is the only one who
        // can decide whether that matters.
        vendorSyncWarning =
          error instanceof Error ? error.message : String(error);
        console.error("Default vendor sync failed after settings save:", error);
      }
    }

    revalidateSettingsContent();

    // Audit log the settings change
    const sectionToAudit = section || "multiple";
    const beforeObj = beforeSettings as unknown as Record<string, unknown>;
    const afterObj = settings.toObject() as unknown as Record<string, unknown>;
    const beforeSection = section
      ? toPlainRecord(beforeObj[section])
      : beforeObj;
    const afterSection = section ? toPlainRecord(afterObj[section]) : afterObj;
    await auditSettingsChange(
      auditContext,
      sectionToAudit,
      beforeSection,
      afterSection,
    );

    // Handle multi-vendor toggle migration
    if (section === "multiVendorMode") {
      const beforeMV = (beforeSettings as unknown as Record<string, unknown>).multiVendorMode as
        | Record<string, unknown>
        | undefined;
      const wasPreviouslyEnabled = Boolean(beforeMV?.enabled);
      const isNowEnabled = Boolean(settings.multiVendorMode?.enabled);

      if (wasPreviouslyEnabled && !isNowEnabled) {
        const { migrateToSingleVendor } = await import("@/lib/vendors/multi-vendor");
        await migrateToSingleVendor(session.user.id);
      }
    }

    const shouldReloadAuth =
      section === "security" ||
      emailWasUpdated ||
      (isPlainObject(data) &&
        Object.prototype.hasOwnProperty.call(data, "security"));
    if (shouldReloadAuth) {
      setRateLimitSettingsFromSecurity(settings.security);
      await reloadAuthInstance();
    }

    return successResponse(
      sanitizeSettings(settings),
      vendorSyncWarning
        ? `Settings saved, but the default vendor could not be synced: ${vendorSyncWarning}`
        : "Settings updated successfully",
    );
  },
);
