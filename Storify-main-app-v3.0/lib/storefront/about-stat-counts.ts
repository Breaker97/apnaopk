import { unstable_cache } from "next/cache";
import {
  ORDER_STATUS,
  PRODUCT_STATUS,
  USER_ROLES,
  VENDOR_STATUS,
} from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import {
  getStorefrontProductConstraint,
  isStorefrontMultiVendorEnabled,
} from "@/lib/catalog/product-visibility";
import { connectDB } from "@/lib/db";
import type {
  AboutCountKey,
  AboutStatCounts,
} from "@/lib/storefront/about-stats";
import { getExternalVendorFilter } from "@/lib/vendors/multi-vendor";
import { Order, Product, User, Vendor } from "@/models";
import { withFallback } from "@/lib/storefront/cached-read";

const COUNTERS: Record<AboutCountKey, () => Promise<number>> = {
  sellers: async () =>
    (await isStorefrontMultiVendorEnabled())
      ? Vendor.countDocuments({
          ...getExternalVendorFilter(),
          status: VENDOR_STATUS.APPROVED,
          storeActive: { $ne: false },
        })
      : 0,
  products: async () =>
    Product.countDocuments({
      ...(await getStorefrontProductConstraint()),
      status: PRODUCT_STATUS.ACTIVE,
    }),
  orders: () => Order.countDocuments({ status: ORDER_STATUS.DELIVERED }),
  customers: () => User.countDocuments({ role: USER_ROLES.CUSTOMER }),
};

/**
 * The live figures the About page's numbers strip shows — `keys`, from
 * `liveAboutStatKeys`, so a row that is off or shows the merchant's own
 * figure costs no query (the default rows never show customers, so a default
 * page no longer counts every customer account). Every count reuses
 * the visibility rule its own storefront listing applies (the vendor
 * directory's seller filter, the catalogue's product constraint), so the page
 * never claims a seller or product a shopper could not actually find.
 *
 * Time-based revalidation, like the testimonials strip: the numbers are a
 * credibility signal, not a ledger, and a five-minute lag is invisible. So no
 * catalogue tag — it sent the next About visitor through all four counts
 * after every product edit. Only the settings tag, so turning multi-vendor
 * mode off drops the sellers figure at once. Any failure yields no counts,
 * which the resolver hides — a database hiccup must never take the whole page
 * down.
 */
export const getAboutStatCounts = withFallback(
  unstable_cache(
    async (keys: AboutCountKey[]): Promise<Partial<AboutStatCounts>> => {
      await connectDB();
      const counts = await Promise.all(
        keys.map(async (key) => [key, await COUNTERS[key]()] as const),
      );
      return Object.fromEntries(counts);
    },
    ["about-stat-counts"],
    { revalidate: 300, tags: [CACHE_TAGS.settings] },
  ),
  () => ({}),
);
