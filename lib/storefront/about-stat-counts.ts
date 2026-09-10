import { unstable_cache } from "next/cache";
import {
  ORDER_STATUS,
  PRODUCT_STATUS,
  USER_ROLES,
  VENDOR_STATUS,
} from "@/config/app.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { connectDB } from "@/lib/db";
import type { AboutStatCounts } from "@/lib/storefront/about-stats";
import {
  getExternalVendorFilter,
  isMultiVendorEnabled,
} from "@/lib/vendors/multi-vendor";
import { Order, Product, User, Vendor } from "@/models";

const EMPTY_COUNTS: AboutStatCounts = {
  sellers: 0,
  products: 0,
  orders: 0,
  customers: 0,
};

/**
 * The live figures the About page's numbers strip can show. Every count
 * reuses the visibility rule its own storefront listing applies (the vendor
 * directory's seller filter, the catalogue's product constraint), so the page
 * never claims a seller or product a shopper could not actually find.
 *
 * Time-based revalidation only, like the testimonials strip: the numbers are
 * a credibility signal, not a ledger, and a five-minute lag is invisible.
 * Any failure yields zeros, which the resolver hides — a database hiccup must
 * never take the whole page down.
 */
export const getAboutStatCounts = unstable_cache(
  async (): Promise<AboutStatCounts> => {
    try {
      await connectDB();
      const [multiVendorEnabled, productConstraint] = await Promise.all([
        isMultiVendorEnabled(),
        getStorefrontProductConstraint(),
      ]);

      const [sellers, products, orders, customers] = await Promise.all([
        multiVendorEnabled
          ? Vendor.countDocuments({
              ...getExternalVendorFilter(),
              status: VENDOR_STATUS.APPROVED,
              storeActive: { $ne: false },
            })
          : Promise.resolve(0),
        Product.countDocuments({
          ...productConstraint,
          status: PRODUCT_STATUS.ACTIVE,
        }),
        Order.countDocuments({ status: ORDER_STATUS.DELIVERED }),
        User.countDocuments({ role: USER_ROLES.CUSTOMER }),
      ]);

      return { sellers, products, orders, customers };
    } catch {
      return EMPTY_COUNTS;
    }
  },
  ["about-stat-counts"],
  { revalidate: 300, tags: [CACHE_TAGS.products, CACHE_TAGS.settings] },
);
