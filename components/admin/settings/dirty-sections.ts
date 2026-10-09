import type { Settings } from "./types";
import { isPlainObject } from "@/lib/utils";
import { CREDENTIAL_FIELD_PATHS } from "@/lib/settings/credential-fields";
import {
  pickPreorderRules,
  STORE_PREORDER_KEYS,
  VENDOR_PREORDER_KEYS,
} from "./preorder-rule-keys";

/**
 * Dirty tracking for the settings form: a section counts as changed when its
 * comparable shape differs from what was loaded. "Comparable" drops empty
 * strings, nulls and undefineds so a field cleared to "" does not read as a
 * change from an absent one — the API treats them the same. The same rule
 * decides which edits outlive a save (`keepUnsavedEdits`).
 */
export function normalizeComparableValue(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;

  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparableValue(item));
  }

  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const next = normalizeComparableValue(nestedValue);
      if (next !== undefined) normalized[key] = next;
    }
    return normalized;
  }

  return value;
}

function comparableJson(value: unknown) {
  return JSON.stringify(normalizeComparableValue(value));
}

function pickSecurityFields(
  settings: Settings,
  keys: Array<keyof Settings["security"]>,
) {
  const security = settings.security || {};
  return keys.reduce<Record<string, unknown>>((acc, key) => {
    acc[String(key)] = security[key];
    return acc;
  }, {});
}

export function getComparableSection(section: string, settings: Settings): unknown {
  if (section === "oauth") {
    return pickSecurityFields(settings, [
      "googleOAuthEnabled",
      "googleClientId",
      "googleClientSecret",
      "facebookOAuthEnabled",
      "facebookAppId",
      "facebookAppSecret",
    ]);
  }

  if (section === "twoFactor") {
    return pickSecurityFields(settings, [
      "twoFactorEnabled",
      "twoFactorRequiredForAdmin",
      "twoFactorRequiredForVendors",
      "twoFactorRequiredForStaff",
    ]);
  }

  if (section === "emailVerification") {
    return pickSecurityFields(settings, [
      "emailVerificationRequired",
      "emailVerificationForVendors",
    ]);
  }

  // Settings → Products spans two stored sections; only these keys are its.
  if (section === "products") {
    return {
      physicalProducts: settings.catalog?.physicalProducts,
      digitalProducts: settings.catalog?.digitalProducts,
      priceOnRequest: settings.catalog?.priceOnRequest,
      preorder: pickPreorderRules(settings.preorder, STORE_PREORDER_KEYS),
    };
  }

  // Multi-Vendor Mode edits the vendor half of `preorder`; the other half is
  // Settings → Products' (preorder-rule-keys.ts).
  if (section === "preorder") {
    return pickPreorderRules(settings.preorder, VENDOR_PREORDER_KEYS);
  }

  // `orders.commission` is edited in Vendors → Configuration only; Order
  // Settings shows it and links there. Each page watches its own half.
  if (section === "orders") {
    const { commission, ...orders } = settings.orders ?? {};
    return orders;
  }
  if (section === "vendorCommission") {
    return settings.orders?.commission;
  }

  if (section === "security") {
    return pickSecurityFields(settings, [
      "sessionMaxAgeDays",
      "maxLoginAttempts",
      "lockoutDurationMinutes",
      "rateLimiting",
      "minPasswordLength",
      "requireUppercase",
      "requireNumbers",
      "requireSpecialChars",
    ]);
  }

  const key = section === "marketplace" ? "multiVendorMode" : section;
  return (settings as unknown as Record<string, unknown>)[key];
}

/** The secrets a page's form holds, by the dirty id the page uses. */
function credentialPathsOf(section: string): readonly string[] {
  if (section === "oauth") {
    return CREDENTIAL_FIELD_PATHS.filter((path) =>
      /^security\.(google|facebook)/.test(path),
    );
  }
  // The Security page itself holds no secret; the OAuth ones stored under
  // `security` belong to the OAuth page above.
  if (section === "security") return [];
  return CREDENTIAL_FIELD_PATHS.filter((path) =>
    path.startsWith(`${section}.`),
  );
}

/**
 * Which of the page's secrets are stored. Secrets never reach the form, so a
 * Remove shows up only here (`withCredentialCleared` drops the flag).
 */
function storedCredentials(section: string, settings: Settings) {
  return credentialPathsOf(section).filter(
    (path) => settings._meta?.credentials?.[path]?.set,
  );
}

export function getEffectiveDirtySections(
  settings: Settings | null,
  initialSettings: Settings | null,
  dirtySectionHints: Set<string>,
) {
  const next = new Set<string>();
  if (!settings || !initialSettings) return next;

  for (const section of dirtySectionHints) {
    const current = getComparableSection(section, settings);
    const initial = getComparableSection(section, initialSettings);
    if (
      comparableJson(current) !== comparableJson(initial) ||
      storedCredentials(section, settings).join() !==
        storedCredentials(section, initialSettings).join()
    ) {
      next.add(section);
    }
  }

  return next;
}

/** Whether a request that sent `written` wrote `path`, or a block above it. */
function isWritten(path: string, written: readonly string[]) {
  return written.some((w) => path === w || path.startsWith(`${w}.`));
}

function mergeEdits(
  server: unknown,
  draft: unknown,
  loaded: unknown,
  path: string,
  written: readonly string[],
): unknown {
  if (isWritten(path, written)) return server;
  if (comparableJson(draft) === comparableJson(loaded)) return server;
  // An edit. Kept key by key while both sides are objects, so a sibling the
  // request wrote, or one nobody here touched, still comes from the server.
  if (!isPlainObject(draft) || !isPlainObject(server)) return draft;
  const base = isPlainObject(loaded) ? loaded : {};
  const out: Record<string, unknown> = { ...server };
  for (const key of new Set([...Object.keys(draft), ...Object.keys(base)])) {
    const value = mergeEdits(server[key], draft[key], base[key], `${path}.${key}`, written);
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}

/**
 * The form once the server answers a save: the server's copy, with every
 * edit the request did not write kept on top.
 *
 * The answer is the whole document, and the form used to adopt it wholesale.
 * The settings pages share one draft (the layout outlives a move between
 * them) and Back/Forward moves between them without the leave prompt, so an
 * edit on Email, Back to General and a save there reverted the Email edit
 * without a word, and its "Unsaved" mark in the sidebar went with it.
 *
 * A three-way merge against `loaded`, the copy the draft was compared with.
 * A value the admin changed stays theirs unless `written` (the paths the
 * request sent) covers it; everything else is the server's. So does a Remove
 * on a secret the request did not send. A section that keeps edits keeps the
 * version fingerprint they were made against, so saving it later still
 * answers 409 if someone else changed it in between.
 */
export function keepUnsavedEdits(
  server: Settings,
  draft: Settings,
  loaded: Settings,
  written: readonly string[],
): Settings {
  const serverDoc = server as unknown as Record<string, unknown>;
  const draftDoc = draft as unknown as Record<string, unknown>;
  const loadedDoc = loaded as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...serverDoc };
  for (const key of new Set([...Object.keys(draftDoc), ...Object.keys(loadedDoc)])) {
    if (key === "_meta") continue;
    const value = mergeEdits(serverDoc[key], draftDoc[key], loadedDoc[key], key, written);
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  if (!server._meta) return out as unknown as Settings;

  const draftFlags = draft._meta?.credentials ?? {};
  const loadedFlags = loaded._meta?.credentials ?? {};
  const keptRemoves = [
    ...new Set([...Object.keys(draftFlags), ...Object.keys(loadedFlags)]),
  ].filter(
    (path) =>
      !isWritten(path, written) &&
      Boolean(draftFlags[path]?.set) !== Boolean(loadedFlags[path]?.set),
  );
  const credentials = { ...server._meta.credentials };
  for (const path of keptRemoves) {
    credentials[path] = draftFlags[path] ?? { set: false };
  }

  const versions = { ...server._meta.sectionVersions };
  for (const section of Object.keys(versions)) {
    const before = draft._meta?.sectionVersions?.[section];
    const wrote = written.some(
      (w) => w === section || w.startsWith(`${section}.`),
    );
    const keepsEdits =
      comparableJson(draftDoc[section]) !== comparableJson(loadedDoc[section]) ||
      keptRemoves.some((path) => path.startsWith(`${section}.`));
    if (!wrote && keepsEdits && typeof before === "string") {
      versions[section] = before;
    }
  }

  out._meta = { ...server._meta, credentials, sectionVersions: versions };
  return out as unknown as Settings;
}
