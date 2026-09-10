import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Vendor, User } from "@/models";
import { getSettings } from "@/models/settings.model";
import {
  NotFoundError,
  AuthorizationError,
  ValidationError,
} from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { isAdmin, assertVendorPermission } from "@/lib/access/rbac";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { VENDOR_STATUS } from "@/config/app.config";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import { DEFAULT_VENDOR_SLUG } from "@/lib/vendors/multi-vendor";
import { withApi } from "@/lib/api/handler";
import { resolveShareSettings, type ShareSettings } from "@/lib/site-config/share-config";
import {
  PROFILE_DEMO_MODE_MESSAGE,
  isDemoModeEnabled,
} from "@/lib/demo-mode";
import {
  VENDOR_ADDRESS_DISPLAY_VALUES,
  resolveVendorStoreVisibility,
} from "@/lib/vendors/vendor-address";
import {
  MAX_SOCIAL_PROFILES,
  SOCIAL_PLATFORMS,
  resolveSocialProfiles,
  socialProfilesFromLegacyLinks,
} from "@/lib/site-config/social-profiles";
import {
  addressGeocodeKey,
  geocodeAddress,
  resolveCoordinates,
} from "@/lib/intl/geocoding";
import { vendorGeoPoint } from "@/lib/locations/vendor-geo";
import { syncInheritedLocationGeo } from "@/lib/locations/location-geo";
import {
  mergeVendorCarriers,
  sanitizeVendorCarriers,
} from "@/lib/shipping/carriers/vendor-carriers";
import { carrierSupportsOrigin } from "@/lib/shipping/carrier-config";
import type { VendorCarrierSettings } from "@/types";
import {
  normalizeInstagramUsername,
  normalizeMessengerUsername,
  normalizeTelegramUsername,
  normalizeWhatsAppNumber,
  resolveVendorMessaging,
} from "@/lib/notifications/vendor-messaging";
import {
  areCountryValuesEquivalent,
  isCountryAllowed,
} from "@/lib/intl/country-availability";

const OptionalUrlSchema = z
  .union([z.string().url("Must be a valid URL"), z.literal(""), z.null()])
  .optional();

const StoreSettingsSchema = z.object({
  storeName: z.string().min(3).max(100).optional(),
  slug: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
  logo: OptionalUrlSchema,
  banner: OptionalUrlSchema,
  address: z
    .object({
      street: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().optional(),
      phone: z.string().optional(),
    })
    .optional(),
  // What the public store page may publish. The address itself is collected for
  // payouts/KYC, so revealing it is an explicit vendor decision.
  storeVisibility: z
    .object({
      addressDisplay: z.enum(VENDOR_ADDRESS_DISPLAY_VALUES).optional(),
      showPhone: z.boolean().optional(),
    })
    .optional(),
});

const PaymentSettingsSchema = z.object({
  bankDetails: z
    .object({
      accountName: z.string().optional(),
      accountNumber: z.string().optional(),
      bankName: z.string().optional(),
      routingNumber: z.string().optional(),
      swiftCode: z.string().optional(),
    })
    .optional(),
  payoutSettings: z
    .object({
      schedule: z.enum(["weekly", "biweekly", "monthly"]).optional(),
      minimumAmount: z.number().min(0).optional(),
    })
    .optional(),
});

const NotificationSettingsSchema = z.object({
  notificationPreferences: z
    .object({
      newOrders: z.boolean().optional(),
      orderUpdates: z.boolean().optional(),
      lowStock: z.boolean().optional(),
      marketing: z.boolean().optional(),
    })
    .optional(),
});

const ChannelSettingsSchema = z.object({
  messaging: z.object({
    liveChatEnabled: z.boolean(),
    whatsapp: z.object({
      enabled: z.boolean(),
      phoneNumberE164: z.string().max(32),
    }),
    messenger: z.object({
      enabled: z.boolean(),
      pageUsername: z.string().max(160),
    }),
    instagram: z.object({
      enabled: z.boolean(),
      username: z.string().max(160),
    }),
    telegram: z.object({
      enabled: z.boolean(),
      username: z.string().max(160),
    }),
  }),
});

const ShareSettingsSchema = z.object({
  // Vendor-chosen list, so a seller can publish the platforms that matter to
  // them instead of a fixed four. The store's own website used to live beside
  // it as `socialLinks.website`; it is no longer collected or published, so the
  // field is gone from this schema — stored values are simply never read.
  socialProfiles: z
    .array(
      z.object({
        id: z.string().max(80).optional(),
        platform: z.enum(SOCIAL_PLATFORMS).optional(),
        label: z.string().max(40).optional(),
        url: z.union([z.string().max(500), z.literal("")]).optional(),
      }),
    )
    .max(MAX_SOCIAL_PROFILES)
    .optional(),
  shareSettings: z
    .object({
      enabled: z.boolean().optional(),
      copyLink: z.boolean().optional(),
      facebook: z.boolean().optional(),
      twitter: z.boolean().optional(),
      whatsapp: z.boolean().optional(),
      telegram: z.boolean().optional(),
      pinterest: z.boolean().optional(),
      linkedin: z.boolean().optional(),
      email: z.boolean().optional(),
      custom: z
        .array(
          z.object({
            id: z.string().max(80).optional(),
            label: z.string().max(60).optional(),
            urlTemplate: z.string().max(500).optional(),
            enabled: z.boolean().optional(),
            icon: OptionalUrlSchema,
          }),
        )
        .max(12)
        .optional(),
    })
    .optional(),
});

const AccountSettingsSchema = z.object({
  name: z.string().min(2).max(120),
  phone: z.union([z.string(), z.literal(""), z.null()]).optional(),
  image: OptionalUrlSchema,
});

const VendorShippingRateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["flat", "free_over", "subtotal_range", "weight_range"]),
  price: z.number().min(0).default(0),
  freeOver: z.number().min(0).optional(),
  minSubtotal: z.number().min(0).optional(),
  maxSubtotal: z.number().min(0).optional(),
  minWeight: z.number().min(0).optional(),
  maxWeight: z.number().min(0).optional(),
  pricePerWeightUnit: z.number().min(0).optional(),
  minDays: z.number().min(0).optional(),
  maxDays: z.number().min(0).optional(),
  active: z.boolean().default(true),
});

import {
  LocalPickupSchema,
} from "@/lib/validations/pickup";
const VendorShippingProfileSchema = z.object({
  enabled: z.boolean().default(false),
  weightUnit: z.enum(["kg", "lb"]).default("kg"),
  delivery: z
    .object({
      processingDaysMin: z.number().min(0).default(0),
      processingDaysMax: z.number().min(0).default(0),
      showEstimatedDelivery: z.boolean().default(true),
    })
    .optional(),
  // Legacy vendor-drawn geography. Still accepted so an unmigrated profile can
  // round-trip a save of another field, but the editor no longer writes it.
  zones: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        countries: z.array(z.string()).default([]),
        regions: z.array(z.string()).default([]),
        rates: z.array(VendorShippingRateSchema).default([]),
      }),
    )
    .default([]),
  zoneRates: z
    .array(
      z.object({
        zoneId: z.string().min(1).max(100),
        rates: z.array(VendorShippingRateSchema).default([]),
      }),
    )
    .default([]),
  fallbackRate: z
    .object({
      enabled: z.boolean().default(false),
      name: z.string().default("Standard"),
      price: z.number().min(0).default(0),
      minDays: z.number().min(0).optional(),
      maxDays: z.number().min(0).optional(),
    })
    .optional(),
  localPickup: LocalPickupSchema.optional(),
  // Tokens arrive as plaintext and are encrypted before storage; a blank one
  // means "leave the stored value alone" (see mergeVendorCarriers).
  carriers: z
    .object({
      mode: z.enum(["platform", "own"]).optional(),
      shippo: z
        .object({
          enabled: z.boolean().optional(),
          mode: z.enum(["test", "live"]).optional(),
          testToken: z.string().max(300).optional(),
          liveToken: z.string().max(300).optional(),
        })
        .optional(),
      shiprocket: z
        .object({
          enabled: z.boolean().optional(),
          email: z.string().max(200).optional(),
          password: z.string().max(300).optional(),
          pickupLocationName: z.string().max(120).optional(),
        })
        .optional(),
    })
    .optional(),
});

const ShippingSettingsSchema = z.object({
  shipping: VendorShippingProfileSchema,
});

const VendorSettingsUpdateSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("store"), data: StoreSettingsSchema }),
  z.object({ section: z.literal("payment"), data: PaymentSettingsSchema }),
  z.object({
    section: z.literal("notifications"),
    data: NotificationSettingsSchema,
  }),
  z.object({ section: z.literal("share"), data: ShareSettingsSchema }),
  z.object({ section: z.literal("account"), data: AccountSettingsSchema }),
  z.object({ section: z.literal("shipping"), data: ShippingSettingsSchema }),
  z.object({ section: z.literal("channels"), data: ChannelSettingsSchema }),
]);

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug.length > 0 ? slug : undefined;
}

function normalizeOptionalUrl(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeShareSettings(value: unknown): ShareSettings {
  const share = resolveShareSettings(value);
  return {
    ...share,
    custom: share.custom
      .map((item, index) => ({
        id: normalizeOptionalString(item.id) || `custom-${index + 1}`,
        label: normalizeOptionalString(item.label) || "",
        urlTemplate: normalizeOptionalString(item.urlTemplate) || "",
        enabled: item.enabled,
        icon: normalizeOptionalUrl(item.icon),
      }))
      .filter((item) => item.label && item.urlTemplate)
      .slice(0, 12),
  };
}

function buildSettingsPayload(vendor: {
  storeName?: string;
  description?: string;
  logo?: string;
  banner?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
  };
  socialLinks?: {
    website?: string;
    facebook?: string;
    instagram?: string;
    twitter?: string;
  };
  socialProfiles?: unknown;
  bankDetails?: {
    accountName?: string;
    accountNumber?: string;
    bankName?: string;
    routingNumber?: string;
    swiftCode?: string;
  };
  notificationPreferences?: {
    newOrders?: boolean;
    orderUpdates?: boolean;
    lowStock?: boolean;
    marketing?: boolean;
  };
  payoutSettings?: {
    schedule?: "weekly" | "biweekly" | "monthly";
    minimumAmount?: number;
  };
  shipping?: Record<string, unknown>;
  shareSettings?: unknown;
  storeVisibility?: unknown;
  messaging?: unknown;
  slug?: string;
}) {
  return {
    // Carrier tokens are stripped and replaced by presence flags + masked
    // hints; the raw blobs never leave the server.
    shipping: vendor.shipping
      ? {
          ...vendor.shipping,
          carriers: sanitizeVendorCarriers(
            vendor.shipping.carriers as VendorCarrierSettings | undefined,
          ),
        }
      : null,
    storeName: vendor.storeName || "",
    slug: vendor.slug || "",
    description: vendor.description || "",
    logo: vendor.logo || "",
    banner: vendor.banner || "",
    address: {
      street: vendor.address?.street || "",
      city: vendor.address?.city || "",
      state: vendor.address?.state || "",
      postalCode: vendor.address?.postalCode || "",
      country: vendor.address?.country || "",
      phone: vendor.address?.phone || "",
    },
    // A vendor who only ever filled the old fixed fields gets them promoted into
    // the list, so the form shows their links and one save migrates them.
    // `socialLinks.website` is deliberately absent: the store website is no
    // longer collected or published, so returning it would repopulate a field
    // the form no longer has.
    socialProfiles: (() => {
      const chosen = resolveSocialProfiles(vendor.socialProfiles);
      return chosen.length > 0
        ? chosen
        : socialProfilesFromLegacyLinks(vendor.socialLinks ?? {});
    })(),
    bankDetails: {
      accountName: vendor.bankDetails?.accountName || "",
      accountNumber: vendor.bankDetails?.accountNumber || "",
      bankName: vendor.bankDetails?.bankName || "",
      routingNumber: vendor.bankDetails?.routingNumber || "",
      swiftCode: vendor.bankDetails?.swiftCode || "",
    },
    notificationPreferences: {
      newOrders: vendor.notificationPreferences?.newOrders ?? true,
      orderUpdates: vendor.notificationPreferences?.orderUpdates ?? true,
      lowStock: vendor.notificationPreferences?.lowStock ?? true,
      marketing: vendor.notificationPreferences?.marketing ?? false,
    },
    payoutSettings: {
      schedule: vendor.payoutSettings?.schedule || "weekly",
      minimumAmount: vendor.payoutSettings?.minimumAmount ?? 0,
    },
    shareSettings: normalizeShareSettings(vendor.shareSettings),
    // Always resolved, never raw: a vendor created before this field existed
    // must read back as the safe default rather than as undefined.
    storeVisibility: resolveVendorStoreVisibility(vendor.storeVisibility),
    messaging: resolveVendorMessaging(vendor.messaging),
  };
}

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.VIEW_STORE_SETTINGS,
      "You do not have permission to view store settings",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:settings:read",
      "lenient",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    const userRecord = await User.findById(session.user.id)
      .select("name email phone image")
      .lean();

    if (!userRecord) {
      throw new NotFoundError("User");
    }

    return successResponse({
      demoMode: {
        enabled: isDemoModeEnabled(),
        message: PROFILE_DEMO_MODE_MESSAGE,
      },
      vendor: buildSettingsPayload(vendor),
      user: {
        name: userRecord.name || "",
        email: userRecord.email || "",
        phone: userRecord.phone || "",
        image: userRecord.image || "",
      },
      // Whether the store administrator has enabled per-vendor shipping. The
      // Settings form uses this to show/hide the Shipping tab.
      vendorShippingEnabled: Boolean(settings.shipping?.vendorShipping?.enabled),
      // The zones a vendor prices. Geography is the store's, so the editor
      // renders it read-only and the vendor only fills in money — which is also
      // why the store's rates ride along: a zone a vendor has not priced shows
      // what its items will be charged instead of an empty box.
      // Whether this vendor may connect a carrier account of its own. Without
      // carriers switched on at store level there is no platform account to
      // override, so the choice would be meaningless.
      carrierOverrideAllowed: Boolean(settings.shipping?.carriers?.enabled),
      // Shiprocket only dispatches from India, so a store shipping from
      // anywhere else must not be offered it.
      shiprocketAvailable: carrierSupportsOrigin(
        "shiprocket",
        settings.shipping?.origin?.country,
      ),
      platformShipping: {
        enabled: Boolean(settings.shipping?.enabled),
        weightUnit: settings.shipping?.weightUnit || "kg",
        zones: (settings.shipping?.zones ?? []).map((zone) => ({
          id: zone.id,
          name: zone.name,
          countries: zone.countries ?? [],
          regions: zone.regions ?? [],
          isFallback: Boolean(zone.isFallback),
          rates: zone.rates ?? [],
        })),
      },
    });
  },
);

export const PUT = withApi(
  // The GET above only tells the form to disable itself; this is what stops a
  // demo visitor from repointing store settings with a direct request.
  { auth: "user", demo: "block-mutations" },
  async ({ request, session }) => {
    const user = session.user;
    const body = await validateBody(request, VendorSettingsUpdateSchema);
    const requiredPermission =
      body.section === "channels"
        ? VENDOR_PERMISSIONS.MANAGE_CHANNELS
        : VENDOR_PERMISSIONS.EDIT_STORE_SETTINGS;
    await assertVendorPermission(
      user,
      requiredPermission,
      "You do not have permission to update store settings",
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "vendor:settings:update",
      "moderate",
      session.user.role,
    );

    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const vendor = await requireApprovedVendorByUserId(session.user.id, {
      allowPaymentRequiredSetup: true,
    });
    // Channel setup additionally requires a fully live store — a vendor still
    // in the unpaid setup window, or with selling switched off, must not wire
    // up outbound messaging. The MANAGE_CHANNELS grant itself is already
    // checked above via `hasVendorPermission`; re-testing the legacy
    // `vendor.permissions` array here would read a field nothing writes any
    // more and would ignore admin overrides entirely.
    if (
      body.section === "channels" &&
      !isAdmin(user) &&
      (vendor.status !== VENDOR_STATUS.APPROVED ||
        vendor.storeActive === false)
    ) {
      throw new AuthorizationError(
        "You do not have permission to manage messaging channels",
      );
    }

    if (body.section === "store") {
      const nextStoreName = normalizeOptionalString(body.data.storeName);
      if (body.data.storeName !== undefined && !nextStoreName) {
        throw new ValidationError({
          storeName: ["Store name is required"],
        });
      }

      const cleanAddress = {
        street: normalizeOptionalString(body.data.address?.street),
        city: normalizeOptionalString(body.data.address?.city),
        state: normalizeOptionalString(body.data.address?.state),
        postalCode: normalizeOptionalString(body.data.address?.postalCode),
        country: normalizeOptionalString(body.data.address?.country),
        phone: normalizeOptionalString(body.data.address?.phone),
      };
      const hasAddress = Object.values(cleanAddress).some(Boolean);
      const previousAddress = vendor.address ?? {};
      const previousCountry = normalizeOptionalString(previousAddress.country);
      const countryChanged = !areCountryValuesEquivalent(
        cleanAddress.country,
        previousCountry,
      );

      if (
        cleanAddress.country &&
        countryChanged &&
        !isCountryAllowed(
          cleanAddress.country,
          settings.general?.countryAvailability,
        )
      ) {
        throw new ValidationError({
          "address.country": ["Selected country is not available"],
        });
      }

      // Coordinates make the storefront's Directions pin land on the actual
      // address instead of wherever a text search guesses. Re-resolved only
      // when the address text genuinely changed: an unrelated save (a phone
      // edit, a new description) must not spend a network round trip, and must
      // not risk replacing good coordinates with a failed lookup.
      const previousCoordinates = resolveCoordinates(
        (previousAddress as { coordinates?: unknown }).coordinates,
      );
      let coordinates = previousCoordinates;

      if (hasAddress) {
        const addressChanged =
          addressGeocodeKey(cleanAddress) !== addressGeocodeKey(previousAddress);

        if (addressChanged || !previousCoordinates) {
          // Never throws, so a geocoder outage cannot fail the vendor's save.
          const resolved = await geocodeAddress(cleanAddress);
          // On a failed lookup for a CHANGED address the old point is dropped:
          // stale coordinates pointing at a previous shop are worse than none,
          // because the text fallback at least matches what the page displays.
          coordinates = resolved ?? (addressChanged ? undefined : previousCoordinates);
        }
      } else {
        coordinates = undefined;
      }

      const normalizedLogo = normalizeOptionalUrl(body.data.logo);
      const normalizedBanner = normalizeOptionalUrl(body.data.banner);

      const update: Record<string, unknown> = {
        description: normalizeOptionalString(body.data.description),
        logo: normalizedLogo,
        banner: normalizedBanner,
        // `geo` is `coordinates` in GeoJSON form, kept in lockstep with it so a
        // vendor becomes findable by radius the moment their address resolves —
        // and drops out of radius search the moment it stops resolving.
        address: hasAddress
          ? {
              ...cleanAddress,
              coordinates,
              geo: vendorGeoPoint({ coordinates }),
            }
          : undefined,
      };

      // Only written when the client actually sent it, so an older client that
      // omits the field cannot silently reset a vendor's published precision.
      if (body.data.storeVisibility !== undefined) {
        update.storeVisibility = resolveVendorStoreVisibility({
          ...resolveVendorStoreVisibility(vendor.storeVisibility),
          ...body.data.storeVisibility,
        });
      }

      if (nextStoreName) {
        update.storeName = nextStoreName;
      }

      if (body.data.slug !== undefined) {
        const nextSlug = normalizeSlug(body.data.slug);
        if (!nextSlug || nextSlug.length < 2) {
          throw new ValidationError({ slug: ["Store slug is required"] });
        }
        if (nextSlug === DEFAULT_VENDOR_SLUG) {
          throw new ValidationError({
            slug: ["This store slug is reserved for the default store"],
          });
        }

        const existingSlug = await Vendor.findOne({
          slug: nextSlug,
          _id: { $ne: vendor._id },
        })
          .select("_id")
          .lean();

        if (existingSlug) {
          throw new ValidationError({ slug: ["Store slug already exists"] });
        }

        update.slug = nextSlug;
      }

      const unset: Record<string, "" | 1> = {};
      if (body.data.logo !== undefined && !normalizedLogo) {
        unset.logo = "";
      }
      if (body.data.banner !== undefined && !normalizedBanner) {
        unset.banner = "";
      }

      await Vendor.findByIdAndUpdate(vendor._id, {
        $set: update,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      });

      // Branches that never had their own pin follow the store when it moves.
      // Resolved at write time, so without this a relocated merchant keeps
      // being found at their old address by every radius search.
      await syncInheritedLocationGeo(
        vendor._id,
        hasAddress ? vendorGeoPoint({ coordinates }) : undefined,
      );
    }

    if (body.section === "payment") {
      const cleanBankDetails = {
        accountName: normalizeOptionalString(body.data.bankDetails?.accountName),
        accountNumber: normalizeOptionalString(
          body.data.bankDetails?.accountNumber,
        ),
        bankName: normalizeOptionalString(body.data.bankDetails?.bankName),
        routingNumber: normalizeOptionalString(
          body.data.bankDetails?.routingNumber,
        ),
        swiftCode: normalizeOptionalString(body.data.bankDetails?.swiftCode),
      };
      const hasBankDetails = Object.values(cleanBankDetails).some(Boolean);

      await Vendor.findByIdAndUpdate(vendor._id, {
        $set: {
          bankDetails: hasBankDetails ? cleanBankDetails : undefined,
          payoutSettings: {
            ...(body.data.payoutSettings || {}),
            minimumAmount: body.data.payoutSettings?.minimumAmount ?? 0,
          },
        },
      });
    }

    if (body.section === "notifications") {
      await Vendor.findByIdAndUpdate(vendor._id, {
        $set: {
          notificationPreferences: {
            newOrders: body.data.notificationPreferences?.newOrders ?? true,
            orderUpdates: body.data.notificationPreferences?.orderUpdates ?? true,
            lowStock: body.data.notificationPreferences?.lowStock ?? true,
            marketing: body.data.notificationPreferences?.marketing ?? false,
          },
        },
      });
    }

    if (body.section === "channels") {
      const messaging = resolveVendorMessaging(body.data.messaging);
      if (
        body.data.messaging.whatsapp.enabled &&
        !normalizeWhatsAppNumber(body.data.messaging.whatsapp.phoneNumberE164)
      ) {
        throw new ValidationError({
          phoneNumberE164: [
            "Enter a valid international WhatsApp number including country code",
          ],
        });
      }
      if (
        body.data.messaging.messenger.enabled &&
        !normalizeMessengerUsername(body.data.messaging.messenger.pageUsername)
      ) {
        throw new ValidationError({
          pageUsername: ["Enter a valid Messenger page username or page link"],
        });
      }
      if (
        body.data.messaging.instagram.enabled &&
        !normalizeInstagramUsername(body.data.messaging.instagram.username)
      ) {
        throw new ValidationError({
          username: ["Enter a valid Instagram username or ig.me link"],
        });
      }
      if (
        body.data.messaging.telegram.enabled &&
        !normalizeTelegramUsername(body.data.messaging.telegram.username)
      ) {
        throw new ValidationError({
          username: ["Enter a valid Telegram bot username or t.me link"],
        });
      }
      await Vendor.findByIdAndUpdate(vendor._id, {
        $set: { messaging },
      });
    }

    if (body.section === "share") {
      const shareUpdate: Record<string, unknown> = {
        shareSettings: normalizeShareSettings(body.data.shareSettings),
      };

      // Only touched when the client actually sent it, so a client that posts
      // only shareSettings cannot wipe a vendor's published profiles.
      if (body.data.socialProfiles !== undefined) {
        const profiles = resolveSocialProfiles(body.data.socialProfiles);
        shareUpdate.socialProfiles = profiles.length > 0 ? profiles : undefined;
        // Clear the superseded fixed fields once the list is authoritative,
        // otherwise the legacy fallback would resurrect removed links.
        shareUpdate["socialLinks.facebook"] = undefined;
        shareUpdate["socialLinks.instagram"] = undefined;
        shareUpdate["socialLinks.twitter"] = undefined;
      }

      await Vendor.findByIdAndUpdate(vendor._id, { $set: shareUpdate });
    }

    if (body.section === "shipping") {
      if (!settings.shipping?.vendorShipping?.enabled) {
        throw new AuthorizationError(
          "Per-vendor shipping is not enabled by the store administrator",
        );
      }

      const countryErrors: Record<string, string[]> = {};
      body.data.shipping.zones.forEach((zone, zoneIndex) => {
        zone.countries.forEach((country, countryIndex) => {
          if (
            country.trim() &&
            !isCountryAllowed(
              country,
              settings.general?.countryAvailability,
            )
          ) {
            countryErrors[
              `shipping.zones.${zoneIndex}.countries.${countryIndex}`
            ] = ["Selected country is not available"];
          }
        });
      });
      if (Object.keys(countryErrors).length > 0) {
        throw new ValidationError(countryErrors);
      }

      // Rates are only meaningful against a zone the store still has. Dropping
      // unknown ids rather than rejecting the save is deliberate: an admin who
      // deletes a zone would otherwise lock every vendor holding rates for it
      // out of their own settings page.
      const platformZoneIds = new Set(
        (settings.shipping?.zones ?? [])
          .map((zone) => zone.id)
          .filter(Boolean),
      );
      const zoneRates = body.data.shipping.zoneRates.filter((entry) =>
        platformZoneIds.has(entry.zoneId),
      );

      // The whole `shipping` object is replaced, and the client never receives
      // the stored carrier tokens — so they are merged back explicitly or an
      // unrelated save would erase them.
      const carriers = mergeVendorCarriers(
        body.data.shipping.carriers,
        vendor.shipping?.carriers,
      );

      await Vendor.findByIdAndUpdate(vendor._id, {
        $set: {
          shipping: {
            ...body.data.shipping,
            carriers,
            zoneRates,
            // The editor prices the store's zones now, so a save retires
            // whatever geography this vendor used to carry — leaving it would
            // keep the old model rating them (see resolveVendorShippingProfile).
            zones: zoneRates.length > 0 ? [] : body.data.shipping.zones,
          },
        },
      });
    }

    if (body.section === "account") {
      const fullName = normalizeOptionalString(body.data.name);
      if (!fullName) {
        throw new ValidationError({ name: ["Name is required"] });
      }

      const normalizedImage = normalizeOptionalUrl(body.data.image);
      const accountUnset: Record<string, ""> = {};
      if (body.data.image !== undefined && !normalizedImage) {
        accountUnset.image = "";
      }

      await User.findByIdAndUpdate(session.user.id, {
        $set: {
          name: fullName,
          phone: normalizeOptionalString(body.data.phone),
          ...(normalizedImage ? { image: normalizedImage } : {}),
          updatedAt: new Date(),
        },
        ...(Object.keys(accountUnset).length
          ? { $unset: accountUnset }
          : {}),
      });
    }

    const updatedVendor = await Vendor.findById(vendor._id).lean();
    if (!updatedVendor) throw new AuthorizationError("Vendor profile not found");

    const updatedUser = await User.findById(session.user.id)
      .select("name email phone image")
      .lean();
    if (!updatedUser) throw new NotFoundError("User");

    if (
      body.section === "store" ||
      body.section === "share" ||
      body.section === "channels"
    ) {
      revalidateProductContent();
    }

    return successResponse({
      vendor: buildSettingsPayload(updatedVendor),
      user: {
        name: updatedUser.name || "",
        email: updatedUser.email || "",
        phone: updatedUser.phone || "",
        image: updatedUser.image || "",
      },
      vendorShippingEnabled: Boolean(settings.shipping?.vendorShipping?.enabled),
      carrierOverrideAllowed: Boolean(settings.shipping?.carriers?.enabled),
    });
  },
);
