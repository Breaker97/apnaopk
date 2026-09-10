import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import {
  addressGeocodeKey,
  geocodeAddress,
  resolveCoordinates,
} from "@/lib/intl/geocoding";
import { vendorGeoPoint } from "@/lib/locations/vendor-geo";
import { syncInheritedLocationGeo } from "@/lib/locations/location-geo";
import { getSettings, type ISettings } from "@/models/settings.model";
import { Product, User, Vendor } from "@/models";
import {
  appConfig,
  USER_ROLES,
  VENDOR_STATUS,
  type UserRole,
} from "@/config/app.config";

export const DEFAULT_VENDOR_SLUG = appConfig.defaultVendorSlug;

type DefaultVendorSettings = Pick<ISettings, "general" | "shipping">;

type VendorRecord = {
  _id?: unknown;
  userId?: unknown;
  isDefault?: unknown;
  storeName?: unknown;
  slug?: unknown;
  description?: unknown;
  logo?: unknown;
  status?: unknown;
  commission?: unknown;
  socialLinks?: {
    website?: unknown;
  };
  address?: {
    street?: unknown;
    city?: unknown;
    state?: unknown;
    postalCode?: unknown;
    country?: unknown;
    coordinates?: unknown;
    geo?: unknown;
  };
};

type DefaultVendorAddress = {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

type DefaultVendorGeocode = {
  lat: number;
  lng: number;
  formatted?: string;
  geocodedAt?: string;
};

type ResolvedDefaultVendorLocation = {
  address?: DefaultVendorAddress & {
    coordinates?: DefaultVendorGeocode;
    geo?: ReturnType<typeof vendorGeoPoint>;
  };
  shouldWrite: boolean;
};

type DefaultVendorSyncOptions = {
  /** Shipping origin changed, so address/geo must be rebuilt from it. */
  syncAddress?: boolean;
};

/** Convert the admin shipping-origin fields into the vendor address shape.
 * @public — reached by tests through a dynamic import, which knip cannot follow.
 */
export function defaultVendorAddressFromShippingOrigin(
  origin: unknown,
): DefaultVendorAddress | undefined {
  if (!origin || typeof origin !== "object") return undefined;

  const source = origin as Record<string, unknown>;
  const address1 = normalizeText(source.address1);
  const address2 = normalizeText(source.address2);
  const address = {
    street: [address1, address2].filter(Boolean).join(", ") || undefined,
    city: normalizeText(source.city) || undefined,
    state: normalizeText(source.state) || undefined,
    postalCode: normalizeText(source.postalCode) || undefined,
    country: normalizeText(source.country) || undefined,
  };

  return Object.values(address).some(Boolean) ? address : undefined;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Build the default vendor's location from the shipping-origin source of
 * truth. Keeping this decision pure apart from its injected geocoder makes
 * changed-address and failed-geocode behaviour testable without a database.
 * @public — reached by tests through a dynamic import, which knip cannot follow.
 */
export async function resolveDefaultVendorLocation(
  origin: unknown,
  currentAddress: VendorRecord["address"],
  geocode: (address: DefaultVendorAddress) => Promise<DefaultVendorGeocode | null> =
    geocodeAddress,
): Promise<ResolvedDefaultVendorLocation> {
  const nextAddress = defaultVendorAddressFromShippingOrigin(origin);

  if (!nextAddress) {
    return { address: undefined, shouldWrite: Boolean(currentAddress) };
  }

  const previousCoordinates = resolveCoordinates(currentAddress?.coordinates);
  const addressChanged =
    addressGeocodeKey(nextAddress) !==
    addressGeocodeKey({
      street: normalizeText(currentAddress?.street) || undefined,
      city: normalizeText(currentAddress?.city) || undefined,
      state: normalizeText(currentAddress?.state) || undefined,
      postalCode: normalizeText(currentAddress?.postalCode) || undefined,
      country: normalizeText(currentAddress?.country) || undefined,
    });
  const coordinates =
    addressChanged || !previousCoordinates
      ? await geocode(nextAddress)
      : previousCoordinates;

  return {
    address: {
      ...nextAddress,
      coordinates: coordinates ?? undefined,
      geo: vendorGeoPoint({ coordinates }),
    },
    // A missing GeoJSON point is repaired even if old coordinates survived a
    // pre-geo schema version. A changed address with a failed lookup writes the
    // new text and deliberately clears the old pin.
    shouldWrite:
      addressChanged ||
      Boolean(previousCoordinates) !== Boolean(coordinates) ||
      !previousCoordinates ||
      !currentAddress?.geo,
  };
}

function normalizeStoreName(value: unknown): string {
  return normalizeText(value) || appConfig.name;
}

function normalizeOwnerId(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "toString" in value &&
    typeof value.toString === "function"
  ) {
    const id = value.toString();
    return id === "[object Object]" ? null : id;
  }
  return null;
}

function buildDefaultVendorProfile(settings: DefaultVendorSettings) {
  const storeName = normalizeStoreName(settings.general?.storeName);
  const description =
    normalizeText(settings.general?.storeDescription) ||
    `Default store for ${storeName}`;
  const logo = normalizeText(settings.general?.logoUrl);
  const website = normalizeText(settings.general?.storeDomain);

  return {
    storeName,
    description,
    logo: logo || undefined,
    website: website || undefined,
  };
}

export function isDefaultVendorRecord(vendor: unknown): boolean {
  if (!vendor || typeof vendor !== "object") return false;
  const record = vendor as VendorRecord;
  return (
    record.isDefault === true ||
    normalizeText(record.slug).toLowerCase() === DEFAULT_VENDOR_SLUG
  );
}

export function getExternalVendorFilter(): Record<string, unknown> {
  return {
    isDefault: { $ne: true },
    slug: { $ne: DEFAULT_VENDOR_SLUG },
  };
}

/**
 * Storefront routes that exist ONLY on a marketplace. `/become-vendor`
 * redirects home and `/vendors` 404s when `multiVendorMode.enabled` is off
 * (see their page files), so a link to either on a single-vendor store is a
 * dead end a shopper can still click.
 *
 * Sections that render vendor content declare `available: isMultiVendorEnabled`
 * and the storefront skips them, but a plain promotion banner or a menu item
 * pointing at one of these paths has no such gate — which is how a seeded
 * single-vendor store ended up advertising "Become a Vendor". Content that
 * ships into a store therefore has to be checked against this list.
 */
export const MULTI_VENDOR_ONLY_PATHS = ["/become-vendor", "/vendors"] as const;

/**
 * Whether a link points at one of those routes. Tolerates an absolute URL and
 * a locale prefix (`/bn/become-vendor`), and will not mistake `/vendorships`
 * for `/vendors`.
 */
export function isMultiVendorOnlyHref(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  let pathname = value.trim();
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      return false;
    }
  }
  pathname = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  if (!pathname.startsWith("/")) return false;

  // A leading locale segment is part of every storefront link.
  const withoutLocale = pathname.replace(/^\/[a-z]{2}(?=\/|$)/i, "");
  return MULTI_VENDOR_ONLY_PATHS.some(
    (route) =>
      withoutLocale === route || withoutLocale.startsWith(`${route}/`),
  );
}

export async function isMultiVendorEnabled(): Promise<boolean> {
  await connectDB();
  const settings = await getSettings();
  return Boolean(settings.multiVendorMode?.enabled);
}

async function resolveDefaultVendorOwnerId(
  preferredUserId?: string,
): Promise<string | null> {
  if (preferredUserId) {
    const preferredUser = await User.findById(preferredUserId)
      .select("_id role roles")
      .lean<{ _id: unknown; role?: UserRole; roles?: UserRole[] } | null>();

    if (
      preferredUser?.role === USER_ROLES.ADMIN ||
      preferredUser?.roles?.includes(USER_ROLES.ADMIN)
    ) {
      return String(preferredUser._id);
    }
  }

  const adminUser = await User.findOne({
    $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
  })
    .select("_id")
    .sort({ createdAt: 1 })
    .lean<{ _id: unknown } | null>();

  return adminUser ? String(adminUser._id) : preferredUserId || null;
}

async function findDefaultVendorCandidate(preferredUserId?: string) {
  const byFlag = await Vendor.findOne({ isDefault: true });
  if (byFlag) return byFlag;

  const bySlug = await Vendor.findOne({ slug: DEFAULT_VENDOR_SLUG });
  if (bySlug) return bySlug;

  const adminProductVendorIds = await Product.distinct("vendorId", {
    productSource: "admin",
  });
  const uniqueAdminVendorIds = adminProductVendorIds
    .map((id) => normalizeOwnerId(id))
    .filter((id): id is string => Boolean(id));

  if (uniqueAdminVendorIds.length === 1) {
    const byAdminProducts = await Vendor.findById(uniqueAdminVendorIds[0]);
    if (byAdminProducts) return byAdminProducts;
  }

  if (preferredUserId) {
    return Vendor.findOne({ userId: preferredUserId });
  }

  return null;
}

async function canUseDefaultSlug(vendorId: unknown) {
  const existing = await Vendor.findOne({
    slug: DEFAULT_VENDOR_SLUG,
    _id: { $ne: vendorId },
  })
    .select("_id")
    .lean();

  return !existing;
}

async function syncVendorDocument(
  vendor: VendorRecord & {
    save?: () => Promise<unknown>;
    set?: (path: string, value: unknown) => void;
  },
  settings: DefaultVendorSettings,
  ownerId?: string | null,
  options: DefaultVendorSyncOptions = {},
) {
  const profile = buildDefaultVendorProfile(settings);
  let changed = false;

  const set = (path: string, value: unknown, current: unknown) => {
    if (current === value) return;
    if (typeof vendor.set === "function") vendor.set(path, value);
    else (vendor as Record<string, unknown>)[path] = value;
    changed = true;
  };

  set("isDefault", true, vendor.isDefault);
  set("storeName", profile.storeName, vendor.storeName);
  set("description", profile.description, vendor.description);
  set("status", VENDOR_STATUS.APPROVED, vendor.status);
  set("commission", 0, vendor.commission);

  if (profile.logo) {
    set("logo", profile.logo, vendor.logo);
  } else if (vendor.logo) {
    set("logo", undefined, vendor.logo);
  }

  const currentWebsite = vendor.socialLinks?.website;
  if (profile.website) {
    set("socialLinks.website", profile.website, currentWebsite);
  } else if (currentWebsite) {
    set("socialLinks.website", undefined, currentWebsite);
  }

  const currentSlug = normalizeText(vendor.slug).toLowerCase();
  if (currentSlug !== DEFAULT_VENDOR_SLUG && (await canUseDefaultSlug(vendor._id))) {
    set("slug", DEFAULT_VENDOR_SLUG, vendor.slug);
  }

  if (!vendor.userId && ownerId) {
    set("userId", ownerId, vendor.userId);
  }

  // The point the house store's own branches should inherit, held only when
  // this pass actually rewrote the address. `undefined` where nothing changed
  // is indistinguishable from "the address stopped resolving", so the two are
  // tracked apart.
  let writtenGeo: ReturnType<typeof vendorGeoPoint> | undefined;
  let addressWritten = false;
  if (options.syncAddress) {
    const location = await resolveDefaultVendorLocation(
      settings.shipping?.origin,
      vendor.address,
    );
    if (location.shouldWrite) {
      set("address", location.address, vendor.address);
      addressWritten = true;
      writtenGeo = location.address?.geo;
    }
  }

  if (changed && typeof vendor.save === "function") {
    await vendor.save();

    // The house store's own branches follow its shipping origin. Without this,
    // an admin who moves the warehouse keeps being found at the old one — and
    // in single-vendor mode that is the entire marketplace.
    if (addressWritten) {
      await syncInheritedLocationGeo(vendor._id, writtenGeo);
    }
  }

  return vendor;
}

async function repairDefaultVendorOwnerRole(ownerId?: string | null) {
  if (!ownerId) return;

  const owner = await User.findById(ownerId)
    .select("role roles")
    .lean<{ role?: UserRole; roles?: UserRole[] } | null>();
  if (!owner) return;

  const roles = Array.isArray(owner.roles) ? owner.roles : [];
  const shouldBeAdmin =
    owner.role === USER_ROLES.ADMIN || roles.includes(USER_ROLES.ADMIN);
  if (!shouldBeAdmin) return;

  const rolesAlreadySynced =
    owner.role === USER_ROLES.ADMIN &&
    roles.length === 1 &&
    roles[0] === USER_ROLES.ADMIN;
  if (rolesAlreadySynced) return;

  await User.updateOne(
    { _id: ownerId },
    {
      $set: {
        role: USER_ROLES.ADMIN,
        roles: [USER_ROLES.ADMIN],
        updatedAt: new Date(),
      },
    },
  );
}

/**
 * Synchronize the internal default vendor with application store settings.
 *
 * Store settings are the source of truth. The default vendor exists only so
 * product/order records can keep a stable vendorId in single-vendor mode.
 */
export async function syncDefaultVendorWithSettings(
  preferredOwnerId?: string,
  providedSettings?: DefaultVendorSettings,
  options: DefaultVendorSyncOptions = {},
) {
  await connectDB();

  const settings = providedSettings || (await getSettings());
  const ownerId = await resolveDefaultVendorOwnerId(preferredOwnerId);
  let vendor = await findDefaultVendorCandidate(ownerId || preferredOwnerId);

  let created = false;
  if (!vendor) {
    if (!ownerId) {
      throw new Error("Unable to resolve an admin owner for the default vendor");
    }

    const profile = buildDefaultVendorProfile(settings);

    try {
      vendor = await Vendor.create({
        userId: ownerId,
        isDefault: true,
        storeName: profile.storeName,
        slug: DEFAULT_VENDOR_SLUG,
        description: profile.description,
        logo: profile.logo,
        socialLinks: profile.website ? { website: profile.website } : undefined,
        status: VENDOR_STATUS.APPROVED,
        commission: 0,
      });
      created = true;
    } catch (err: unknown) {
      const maybeError = err as { code?: number };
      if (maybeError.code !== 11000) throw err;

      vendor = await findDefaultVendorCandidate(ownerId);
      if (!vendor) throw err;
    }
  }

  const syncedVendor = await syncVendorDocument(
    vendor as VendorRecord,
    settings,
    ownerId,
    { syncAddress: options.syncAddress || created },
  );
  await repairDefaultVendorOwnerRole(
    ownerId || normalizeOwnerId((syncedVendor as VendorRecord).userId),
  );

  return syncedVendor;
}

/**
 * Get or create the default vendor for single-vendor/admin-owned products.
 */
export async function getOrCreateDefaultVendor(ownerUserId?: string) {
  return syncDefaultVendorWithSettings(ownerUserId);
}

// Cached read of just the default vendor's id. The default vendor is a stable
// singleton, so its id effectively never changes; a short revalidate window is
// enough to pick up a rare recreation. Tagged `settings` because the one action
// that can recreate it — saving general/multi-vendor settings, which runs
// `syncDefaultVendorWithSettings` — already busts that tag, so the id refreshes
// immediately instead of after the revalidate window.
const getCachedDefaultVendorId = unstable_cache(
  async (): Promise<string | null> => {
    await connectDB();
    const vendor = await Vendor.findOne({ isDefault: true })
      .select("_id")
      .lean<{ _id: unknown } | null>();
    return vendor?._id ? String(vendor._id) : null;
  },
  ["default-vendor-id"],
  { revalidate: 300, tags: [CACHE_TAGS.settings] },
);

/**
 * Resolve just the default vendor's id for the order-creation hot path.
 *
 * `syncDefaultVendorWithSettings` (via `getOrCreateDefaultVendor`) ran ~3-4
 * uncached queries plus a possible save on *every* single-vendor order, even
 * though it only re-derives display fields that the admin settings/vendor save
 * paths already keep in sync. Order creation only needs the vendorId, so this
 * returns it from a cache and only falls through to the full get-or-create when
 * the default vendor doesn't exist yet (first order on a fresh store, or right
 * after a rare recreation) — which also seeds/repairs it exactly once.
 */
export async function resolveDefaultVendorId(
  ownerUserId?: string,
): Promise<string | null> {
  const cachedId = await getCachedDefaultVendorId();
  if (cachedId) return cachedId;

  const vendor = await getOrCreateDefaultVendor(ownerUserId);
  return vendor?._id ? String(vendor._id) : null;
}

/**
 * The default vendor's id, **without ever creating or repairing one**.
 *
 * `resolveDefaultVendorId` falls through to `getOrCreateDefaultVendor`, which
 * writes: it re-syncs the vendor document and can rewrite the owner's roles. On
 * a settings save that is the point. On a read path it is not — and inventory
 * location scoping runs on every product form load, every inventory list and
 * every POS keystroke, where a store whose house vendor lacks the `isDefault`
 * flag would take a database write per request.
 *
 * The `slug` fallback mirrors `findDefaultVendorCandidate`, so an install whose
 * flag was never set still resolves rather than silently scoping to nothing.
 */
export async function findDefaultVendorIdReadOnly(): Promise<string | null> {
  await connectDB();

  // Slug before flag, deliberately. `isDefault` is not enforced unique and real
  // stores are found carrying it on more than one vendor, in which case a
  // `findOne({ isDefault: true })` answers whichever document Mongo happens to
  // return first — a scope that changes between requests. The canonical slug is
  // the one identifier only the house store can hold.
  const bySlug = await Vendor.findOne({ slug: DEFAULT_VENDOR_SLUG })
    .select("_id")
    .lean<{ _id: unknown } | null>();
  if (bySlug?._id) return String(bySlug._id);

  // No canonical slug: fall back to the flag, oldest first so repeated calls at
  // least agree with each other.
  const byFlag = await Vendor.findOne({ isDefault: true })
    .select("_id")
    .sort({ _id: 1 })
    .lean<{ _id: unknown } | null>();

  return byFlag?._id ? String(byFlag._id) : null;
}

/**
 * Migrate all products to the default vendor when switching
 * from multi-vendor to single-vendor mode.
 *
 * - Preserves product ownership provenance using `productSource`
 * - Keeps active vendor-origin products visible to customers
 * - Does NOT change user roles (vendor users lose access because
 *   vendor routes check settings.multiVendorMode.enabled)
 * - Idempotent: safe to run multiple times
 *
 * @param adminUserId - The admin user who triggered the toggle
 * @returns Migration summary
 */
export async function migrateToSingleVendor(
  adminUserId: string,
): Promise<{
  productsReassigned: number;
  productsHidden: number;
  sourceBackfilled: number;
}> {
  await connectDB();

  const defaultVendor = await getOrCreateDefaultVendor(adminUserId);

  // Backfill provenance for legacy products that don't have productSource.
  // Heuristic: default vendor => admin-origin, non-default vendor => vendor-origin.
  const [adminBackfill, vendorBackfill] = await Promise.all([
    Product.updateMany(
      { productSource: { $exists: false }, vendorId: defaultVendor._id },
      { $set: { productSource: "admin" } },
    ),
    Product.updateMany(
      { productSource: { $exists: false }, vendorId: { $ne: defaultVendor._id } },
      { $set: { productSource: "vendor" } },
    ),
  ]);

  return {
    // Kept for backward compatibility with existing callers/telemetry.
    productsReassigned: 0,
    productsHidden: 0,
    sourceBackfilled:
      (adminBackfill.modifiedCount ?? 0) + (vendorBackfill.modifiedCount ?? 0),
  };
}
