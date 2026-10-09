import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import {
  addressGeocodeKey,
  geocodeAddress,
  resolveCoordinates,
} from "@/lib/intl/geocoding";
import { vendorGeoPoint } from "@/lib/locations/vendor-geo";
import { storefrontRouteOf } from "@/lib/vendors/vendor-signup-links";
import { syncInheritedLocationGeo } from "@/lib/locations/location-geo";
import { withFallback } from "@/lib/storefront/cached-read";
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

/**
 * The Vendor schema's own limits. The settings accept more (a 120-character
 * store name, a description of any length), and a profile built from them
 * must still save — the house profile is required, and its sync failing on a
 * long name would leave the store without one.
 */
const VENDOR_STORE_NAME_MAX = 100;
const VENDOR_DESCRIPTION_MAX = 1000;

/** At most `max` UTF-16 units, never ending inside a surrogate pair. */
function clipText(value: string, max: number): string {
  if (value.length <= max) return value;
  const lastUnit = value.charCodeAt(max - 1);
  const end = lastUnit >= 0xd800 && lastUnit <= 0xdbff ? max - 1 : max;
  return value.slice(0, end).trimEnd();
}

function buildDefaultVendorProfile(settings: DefaultVendorSettings) {
  const storeName = clipText(
    normalizeStoreName(settings.general?.storeName),
    VENDOR_STORE_NAME_MAX,
  );
  const description = clipText(
    normalizeText(settings.general?.storeDescription) ||
      `Default store for ${storeName}`,
    VENDOR_DESCRIPTION_MAX,
  );
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
const MULTI_VENDOR_ONLY_PATHS = ["/become-vendor", "/vendors"] as const;

/**
 * Whether a link points at one of those routes. Tolerates an absolute URL and
 * a locale prefix (`/bn/become-vendor`), and will not mistake `/vendorships`
 * for `/vendors`.
 */
export function isMultiVendorOnlyHref(value: unknown): boolean {
  const route = storefrontRouteOf(value);
  if (!route) return false;
  return MULTI_VENDOR_ONLY_PATHS.some(
    (path) => route === path || route.startsWith(`${path}/`),
  );
}

export async function isMultiVendorEnabled(): Promise<boolean> {
  await connectDB();
  const settings = await getSettings();
  return Boolean(settings.multiVendorMode?.enabled);
}

/**
 * Why a house profile could not be found or made. `no_owner`: every admin
 * already owns a store, and `Vendor.userId` is unique. `needs_review`: an
 * admin-owned vendor without the flag holds the admin catalog — most likely
 * the house of a store older than the flag — and only a person may say so
 * (`pnpm db:migrate house-profile -- --adopt <id>`). `error`: anything else.
 */
export type DefaultVendorProblem = "no_owner" | "needs_review" | "error";

export type EnsuredDefaultVendor =
  | { vendorId: string; problem?: undefined }
  | { vendorId: null; problem: DefaultVendorProblem };

/** Thrown by the settings-side sync when it may not make the house profile. */
export class DefaultVendorUnavailableError extends Error {
  readonly problem: DefaultVendorProblem;

  constructor(problem: DefaultVendorProblem) {
    super(
      problem === "no_owner"
        ? "No admin is free to own the store profile: every admin already owns a store"
        : problem === "needs_review"
          ? "An older store profile may already exist; review it with `pnpm db:migrate house-profile --dry-run`"
          : "The store profile could not be created",
    );
    this.name = "DefaultVendorUnavailableError";
    this.problem = problem;
  }
}

const ADMIN_FILTER = {
  $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
};

/**
 * The one rule that says which vendor is the house: the canonical slug, then
 * the oldest vendor carrying the flag. `isDefault` is not unique and real
 * stores carry it on more than one vendor, while the slug is reserved for the
 * house alone. Sorted even on the slug, so a store whose unique index was
 * never built still gets the same answer every time.
 */
async function findDefaultVendorRow(): Promise<{
  _id: unknown;
  isDefault?: boolean;
} | null> {
  const bySlug = await Vendor.findOne({ slug: DEFAULT_VENDOR_SLUG })
    .select("_id isDefault")
    .sort({ _id: 1 })
    .lean<{ _id: unknown; isDefault?: boolean } | null>();
  if (bySlug?._id) return bySlug;

  return Vendor.findOne({ isDefault: true })
    .select("_id isDefault")
    .sort({ _id: 1 })
    .lean<{ _id: unknown; isDefault?: boolean } | null>();
}

/** The house profile as a document, by the same rule, for the settings sync. */
async function findDefaultVendorDocument() {
  const row = await findDefaultVendorRow();
  return row?._id ? Vendor.findById(row._id) : null;
}

/**
 * The admin-owned, unflagged vendor holding admin-made products, if any. A
 * store from before the flag existed kept its house under the admin's own
 * account; making a second, empty house beside it would split the catalog
 * and move its sales to the other book. `productSource` missing counts as
 * admin: the field is younger than those stores.
 */
async function findLegacyHouseCandidate(): Promise<string | null> {
  const admins = await User.find(ADMIN_FILTER)
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  if (admins.length === 0) return null;

  const adminVendors = await Vendor.find({
    userId: { $in: admins.map((admin) => admin._id) },
    isDefault: { $ne: true },
    slug: { $ne: DEFAULT_VENDOR_SLUG },
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  if (adminVendors.length === 0) return null;

  const product = await Product.findOne({
    vendorId: { $in: adminVendors.map((vendor) => vendor._id) },
    $or: [
      { productSource: "admin" },
      { productSource: { $exists: false } },
      { productSource: null },
    ],
  })
    .select("vendorId")
    .lean<{ vendorId?: unknown } | null>();

  return product?.vendorId ? String(product.vendorId) : null;
}

/**
 * Who owns a new house profile: the admin acting, if they own no store yet,
 * else the longest-standing admin who owns none. Never an admin with a store
 * of their own — `Vendor.userId` is unique, and taking over that store is
 * exactly the adoption this replaced.
 */
async function pickDefaultVendorOwnerId(
  preferredUserId?: string,
  skip: readonly string[] = [],
): Promise<string | null> {
  const admins = await User.find(ADMIN_FILTER)
    .select("_id")
    .sort({ createdAt: 1, _id: 1 })
    .lean<Array<{ _id: unknown }>>();
  const adminIds = admins.map((admin) => String(admin._id));
  const ordered =
    preferredUserId && adminIds.includes(preferredUserId)
      ? [preferredUserId, ...adminIds.filter((id) => id !== preferredUserId)]
      : adminIds;
  const candidates = ordered.filter((id) => !skip.includes(id));
  if (candidates.length === 0) return null;

  const owning = await Vendor.find({ userId: { $in: candidates } })
    .select("userId")
    .lean<Array<{ userId?: unknown }>>();
  const taken = new Set(owning.map((vendor) => String(vendor.userId)));

  return candidates.find((id) => !taken.has(id)) ?? null;
}

function duplicateKeyField(error: unknown): string | null {
  const e = error as { code?: number; keyPattern?: Record<string, unknown> };
  if (e?.code !== 11000) return null;
  return Object.keys(e.keyPattern ?? {})[0] ?? "unknown";
}

/**
 * Insert a fresh house profile — never an existing vendor taken over. The
 * address is written as text only: geocoding is a network call with retries,
 * and this runs inside page renders. The next settings save places the pin.
 *
 * Returns the house that exists afterwards (this insert, or a concurrent one
 * that won the slug), or the reason there is none.
 */
async function insertDefaultVendor(
  settings: DefaultVendorSettings,
  preferredOwnerId?: string,
): Promise<EnsuredDefaultVendor> {
  const skip: string[] = [];
  const profile = buildDefaultVendorProfile(settings);
  const address = defaultVendorAddressFromShippingOrigin(
    settings.shipping?.origin,
  );

  // One retry: an owner picked a moment ago may have just been given a store
  // of their own, which the unique `userId` index reports.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ownerId = await pickDefaultVendorOwnerId(preferredOwnerId, skip);
    if (!ownerId) return { vendorId: null, problem: "no_owner" };

    try {
      const vendor = await Vendor.create({
        userId: ownerId,
        isDefault: true,
        storeName: profile.storeName,
        slug: DEFAULT_VENDOR_SLUG,
        description: profile.description,
        logo: profile.logo,
        socialLinks: profile.website ? { website: profile.website } : undefined,
        address,
        status: VENDOR_STATUS.APPROVED,
        commission: 0,
      });
      return { vendorId: String(vendor._id) };
    } catch (error) {
      const field = duplicateKeyField(error);
      if (!field) throw error;
      const winner = await findDefaultVendorRow();
      if (winner?._id) return { vendorId: String(winner._id) };
      if (field !== "userId") throw error;
      skip.push(ownerId);
    }
  }

  return { vendorId: null, problem: "no_owner" };
}

/**
 * Concurrent first requests in one process share one creation: the POS page
 * alone resolves the scope three times in parallel. Across processes the
 * unique slug index decides, and the loser reads the winner back.
 */
let defaultVendorCreation: Promise<EnsuredDefaultVendor> | null = null;

async function createMissingDefaultVendor(
  preferredOwnerId?: string,
): Promise<EnsuredDefaultVendor> {
  try {
    if (await findLegacyHouseCandidate()) {
      return { vendorId: null, problem: "needs_review" };
    }
    return await insertDefaultVendor(await getSettings(), preferredOwnerId);
  } catch (error) {
    console.error("[house-profile] The store profile could not be created:", error);
    return { vendorId: null, problem: "error" };
  }
}

/**
 * What is wrong with the house profile, read only — for the settings screen,
 * which explains it rather than repairing it: `null` when it is there,
 * otherwise the reason the next attempt would give (`missing` = it would be
 * made).
 */
export async function diagnoseDefaultVendor(): Promise<
  "missing" | "no_owner" | "needs_review" | null
> {
  await connectDB();
  if (await findDefaultVendorRow()) return null;
  if (await findLegacyHouseCandidate()) return "needs_review";
  if (!(await pickDefaultVendorOwnerId())) return "no_owner";
  return "missing";
}

/**
 * The house profile's id, made once on first need.
 *
 * Read paths call this (the product form, inventory, POS, locations,
 * transfers, order creation), so it writes only when something is missing:
 * no profile at all (a 2.4.0 store installed without demo data), or a slug
 * holder that lost its flag while no other vendor carries one. It never
 * geocodes, never touches a user's roles and never revalidates a cache — a
 * page render may be the caller. When it may not make one, it says why and
 * writes nothing.
 */
export async function ensureDefaultVendorId(
  options: { preferredOwnerId?: string } = {},
): Promise<EnsuredDefaultVendor> {
  await connectDB();

  const existing = await findDefaultVendorRow();
  if (existing?._id) {
    if (existing.isDefault !== true) {
      // The slug holder without its flag. Flag-only readers (finance,
      // commission, conversations) would take it for a seller; the per-request
      // syncs used to put the flag back. With a second vendor flagged it is a
      // person's call, which the house-profile migration reports.
      const otherFlagged = await Vendor.exists({
        isDefault: true,
        _id: { $ne: existing._id },
      });
      if (!otherFlagged) {
        await Vendor.updateOne(
          { _id: existing._id, isDefault: { $ne: true } },
          { $set: { isDefault: true } },
        );
      }
    }
    return { vendorId: String(existing._id) };
  }

  defaultVendorCreation ??= createMissingDefaultVendor(
    options.preferredOwnerId,
  ).finally(() => {
    defaultVendorCreation = null;
  });
  return defaultVendorCreation;
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
  let vendor = await findDefaultVendorDocument();

  // Missing: made the way `ensureDefaultVendorId` makes it — a new document,
  // owned by an admin with no store of their own, never an existing vendor
  // taken over. The owner is picked here only: a healthy single-admin store,
  // whose one admin already owns the house, must not read as "no owner".
  let created = false;
  if (!vendor) {
    if (await findLegacyHouseCandidate()) {
      throw new DefaultVendorUnavailableError("needs_review");
    }
    const inserted = await insertDefaultVendor(settings, preferredOwnerId);
    if (inserted.vendorId === null) {
      throw new DefaultVendorUnavailableError(inserted.problem);
    }
    vendor = await Vendor.findById(inserted.vendorId);
    if (!vendor) throw new DefaultVendorUnavailableError("error");
    created = true;
  }

  // A settings save may take its time: the address is geocoded here, and the
  // house's own branches follow its pin.
  const syncedVendor = await syncVendorDocument(
    vendor as VendorRecord,
    settings,
    null,
    { syncAddress: options.syncAddress || created },
  );
  await repairDefaultVendorOwnerRole(
    normalizeOwnerId((syncedVendor as VendorRecord).userId),
  );

  return syncedVendor;
}

/**
 * Get or create the default vendor for single-vendor/admin-owned products.
 */
export async function getOrCreateDefaultVendor(ownerUserId?: string) {
  return syncDefaultVendorWithSettings(ownerUserId);
}

// Thrown inside the cached reader when there is no house yet, so the absence is
// never stored: a cached `null` outlived the creation that followed it, and
// every order for five minutes took the slow path.
const NO_DEFAULT_VENDOR_YET = "no-default-vendor-yet";

// Cached read of just the default vendor's id. The default vendor is a stable
// singleton, so its id effectively never changes; a short revalidate window is
// enough to pick up a rare recreation. Tagged `settings` because the one action
// that can recreate it — saving general/multi-vendor settings, which runs
// `syncDefaultVendorWithSettings` — already busts that tag, so the id refreshes
// immediately instead of after the revalidate window.
const getCachedDefaultVendorId = withFallback(
  unstable_cache(
    async (): Promise<string> => {
      const id = await findDefaultVendorIdReadOnly();
      if (!id) throw new Error(NO_DEFAULT_VENDOR_YET);
      return id;
    },
    ["default-vendor-id", "canonical"],
    { revalidate: 300, tags: [CACHE_TAGS.settings] },
  ),
  () => null,
);

/**
 * Resolve just the default vendor's id for the order-creation hot path.
 *
 * Order creation only needs the vendorId, so this returns it from a cache and
 * only falls through to `ensureDefaultVendorId` when the default vendor does
 * not exist yet (first order on a profile-less store) — which makes it once.
 * `null` means it may not be made; order creation answers `STORE_NOT_READY`.
 */
export async function resolveDefaultVendorId(
  ownerUserId?: string,
): Promise<string | null> {
  const cachedId = await getCachedDefaultVendorId();
  if (cachedId) return cachedId;

  return (await ensureDefaultVendorId({ preferredOwnerId: ownerUserId }))
    .vendorId;
}

/**
 * The default vendor's id, **without ever creating or repairing one**, by the
 * one rule (`findDefaultVendorRow`): the canonical slug, then the oldest flag.
 * For reads that only report — the settings notice, returns — and for the
 * cached lookup above.
 */
export async function findDefaultVendorIdReadOnly(): Promise<string | null> {
  await connectDB();
  const row = await findDefaultVendorRow();
  return row?._id ? String(row._id) : null;
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
