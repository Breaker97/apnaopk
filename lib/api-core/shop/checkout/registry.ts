import type { RouteEntry } from "@/lib/api-core/registry";
import { placeOrderRoute } from "./place-order";
import { pushStartRoute } from "./push";
import { pushVerifyRoute } from "./push-verify";
import { checkoutQuoteRoute } from "./quote";
import { redirectPaymentRoute } from "./redirect";
import { redirectVerifyRoute } from "./redirect-verify";
import { stripeConfirmRoute } from "./stripe-confirm";
import { stripeIntentRoute } from "./stripe-intent";

/**
 * Quote, place, pay.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const checkoutRoutes: readonly RouteEntry[] = [
  checkoutQuoteRoute,
  placeOrderRoute,
  stripeIntentRoute,
  stripeConfirmRoute,
  redirectPaymentRoute,
  redirectVerifyRoute,
  pushStartRoute,
  pushVerifyRoute,
];
