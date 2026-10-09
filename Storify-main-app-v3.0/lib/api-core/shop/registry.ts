import type { RouteEntry } from "@/lib/api-core/registry";
import { addressesRoutes } from "./addresses/registry";
import { cartRoutes } from "./cart/registry";
import { catalogRoutes } from "./catalog/registry";
import { chatRoutes } from "./chat/registry";
import { checkoutRoutes } from "./checkout/registry";
import { configRoutes } from "./config/registry";
import { contentRoutes } from "./content/registry";
import { couponsRoutes } from "./coupons/registry";
import { devicesRoutes } from "./devices/registry";
import { homeRoutes } from "./home/registry";
import { meRoutes } from "./me/registry";
import { notificationsRoutes } from "./notifications/registry";
import { ordersRoutes } from "./orders/registry";
import { quotesRoutes } from "./quotes/registry";
import { returnsRoutes } from "./returns/registry";
import { reviewsRoutes } from "./reviews/registry";
import { searchRoutes } from "./search/registry";
import { storeCreditRoutes } from "./store-credit/registry";
import { uploadsRoutes } from "./uploads/registry";
import { wishlistRoutes } from "./wishlist/registry";

/**
 * Every endpoint of `/api/mobile/shop/v1/{locale}`, for the tests that hold
 * the policy (tests/mobile-api/registry-policy.test.ts) and for anything
 * that lists the API. Route files never import this: each imports its own
 * entry, so a route's bundle carries its own handler and no other.
 */
export const SHOP_V1_ROUTES: readonly RouteEntry[] = [
  ...configRoutes,
  ...catalogRoutes,
  ...homeRoutes,
  ...cartRoutes,
  ...wishlistRoutes,
  ...addressesRoutes,
  ...meRoutes,
  ...ordersRoutes,
  ...checkoutRoutes,
  ...notificationsRoutes,
  ...devicesRoutes,
  ...chatRoutes,
  ...couponsRoutes,
  ...searchRoutes,
  ...uploadsRoutes,
  ...reviewsRoutes,
  ...returnsRoutes,
  ...quotesRoutes,
  ...storeCreditRoutes,
  ...contentRoutes,
];
