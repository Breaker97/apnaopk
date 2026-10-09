import type { RouteEntry } from "@/lib/api-core/registry";
import { orderCancelRoute } from "./cancel";
import { orderDetailRoute } from "./detail";
import { orderInvoiceRoute } from "./invoice";
import { orderListRoute } from "./list";
import { orderTrackInvoiceRoute } from "./track-invoice";
import { orderTrackRoute } from "./track";
import { orderPayRoute } from "./pay";
import { orderPayVerifyRoute } from "./pay-verify";

/**
 * The shopper's orders.
 *
 * One module per endpoint in this folder, each exporting its `defineRoute`
 * entry; the route file imports the entry from that module, and it is listed
 * here for the registry.
 */
export const ordersRoutes: readonly RouteEntry[] = [
  orderListRoute,
  orderDetailRoute,
  orderCancelRoute,
  orderInvoiceRoute,
  orderTrackRoute,
  orderTrackInvoiceRoute,
  orderPayRoute,
  orderPayVerifyRoute,
];
