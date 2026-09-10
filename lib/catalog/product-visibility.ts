import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import {
  type OutOfStockDisplay,
  normalizeOutOfStockDisplay,
} from "@/lib/catalog/catalog-display";
import { mongoose } from "@/lib/db";

/**
 * Whether multi-vendor mode is enabled.
 *
 * Called on hot, anonymous storefront paths (cart GET/POST, cart-item add,
 * wishlist GET/POST). It previously loaded the *entire* ~62KB settings singleton
 * just to read one boolean. This reads only the `multiVendorMode` sub-doc as a
 * lean object and caches it, tagged `settings`, so it refreshes immediately when
 * settings are saved (`revalidateSettingsContent()` busts the tag) and otherwise
 * costs at most one tiny lookup per revalidate window.
 */
export const isStorefrontMultiVendorEnabled = unstable_cache(
  async (): Promise<boolean> => {
    const { Settings } = await import("@/models/settings.model");
    const doc = await Settings.findOne()
      .select("multiVendorMode.enabled")
      .lean<{ multiVendorMode?: { enabled?: boolean } } | null>();
    return Boolean(doc?.multiVendorMode?.enabled);
  },
  ["storefront-multi-vendor-enabled"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.settings],
  },
);

/**
 * The platform's out-of-stock display policy.
 *
 * Read on every storefront listing, so it follows `isStorefrontMultiVendorEnabled`
 * exactly: the smallest possible projection, cached, and tagged `settings` so an
 * admin save takes effect immediately instead of at the next revalidate.
 *
 * Callers read this *inside* their own cached function rather than folding it
 * into the cache key. Keying on it would double every storefront cache entry to
 * carry a value that is the same for every shopper.
 */
export const getStorefrontOutOfStockDisplay = unstable_cache(
  async (): Promise<OutOfStockDisplay> => {
    const { Settings } = await import("@/models/settings.model");
    const doc = await Settings.findOne()
      .select("catalog.outOfStockDisplay")
      .lean<{ catalog?: { outOfStockDisplay?: string } } | null>();
    return normalizeOutOfStockDisplay(doc?.catalog?.outOfStockDisplay);
  },
  ["storefront-out-of-stock-display"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.settings],
  },
);

/**
 * Cached list of approved vendor ids as hex strings.
 *
 * Previously this query ran on every storefront cache miss (i.e. on every
 * revalidation of every product/brand/collection listing). Caching it here
 * collapses that to a single lookup per refresh window.
 *
 * `unstable_cache` serializes its result to JSON, so this intentionally returns
 * strings rather than ObjectId instances — callers rebuild ObjectIds. It is
 * tagged with `products` because vendor status changes already invalidate that
 * tag via `revalidateProductContent()`, so the list refreshes immediately on
 * approve/suspend; the 60s revalidate is just a safety net.
 */
const getApprovedVendorIds = unstable_cache(
  async (): Promise<string[]> => {
    const [{ Vendor }, { VENDOR_STATUS }] = await Promise.all([
      import("@/models"),
      import("@/config/app.config"),
    ]);

    const approvedVendors = await Vendor.find({
      status: VENDOR_STATUS.APPROVED,
      // Deactivated stores (e.g. after a paid plan lapsed) are hidden from the
      // storefront even while their vendor stays `approved`. $ne:false keeps
      // legacy vendors whose field predates this flag.
      storeActive: { $ne: false },
    })
      .select("_id")
      .lean();

    return approvedVendors.map((vendor) => String(vendor._id));
  },
  ["storefront-approved-vendor-ids"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.products],
  },
);

export async function getStorefrontProductConstraint(): Promise<
  Record<string, unknown>
> {
  // Note: we intentionally keep the approved-vendor filter on in every mode
  // rather than short-circuiting it in single-vendor stores. Skipping it would
  // expose active products belonging to suspended/rejected vendors that can
  // linger after a multi-vendor -> single-vendor switch. The single-element
  // $in in single-vendor mode is cheap and selective, so the only real cost
  // (the repeated vendor lookup) is removed by the cache above.
  const ids = await getApprovedVendorIds();

  // find() would auto-cast string ids inside $in, but aggregation $match (used
  // for brand/collection product counts) does not, so cast to ObjectId here so
  // every consumer behaves identically.
  const objectIds = ids
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  return {
    vendorId: { $in: objectIds },
    // Honor the "Online store" publishing channel. `$ne: false` keeps legacy
    // products (created before the field existed, so it's missing) and any with
    // the default `true`, while excluding products explicitly toggled to
    // POS-only. Applied here so listing, detail, cards, search, filters, and
    // product counts all enforce it identically.
    "publishing.onlineStore": { $ne: false },
  };
}

export function isStorefrontProductSourceAllowed(
  productSource: unknown,
  isMultiVendorEnabled: boolean,
): boolean {
  void productSource;
  void isMultiVendorEnabled;
  return true;
}
