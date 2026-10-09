import { ManualOrderFormOptions, ManualOrderDraftRequest, ManualOrderQuoteRequest, ManualOrderQuote, OrderProductSelectorQuery,
  OrderProductSelectors, OrderCustomerSelectorQuery, OrderCustomerSelectors, MANUAL_ORDER_REASONS } from "@/contracts/mobile/biz/v1/order-creation";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute, type BizRouteEntry } from "@/lib/api-core/registry";
import { loadCreationOptions } from "./options";
import { listCreationProducts } from "./products";
import { listCreationCustomers } from "./customers";
import { quoteManualOrder } from "./quote";
import { manualOrderCreateRoute } from "./create";
import { orderContactCreateRoute } from "./contacts";

export const manualOrderOptionsRoute = defineBizRoute({
  id: "orders.creation.options", method: "GET", path: "/orders/creation/options", auth: "user",
  ...BIZ_ACCESS.CREATE_ORDERS, cache: { kind: "private" }, output: ManualOrderFormOptions,
  handler: async ({ workspace, scope, session, locale }) => (await loadCreationOptions({ workspace, scope, actorId: session.user.id, locale })).options,
});
export const manualOrderProductsRoute = defineBizRoute({
  id: "orders.creation.products", method: "GET", path: "/orders/creation/products", auth: "user",
  ...BIZ_ACCESS.CREATE_ORDERS, cache: { kind: "private" }, input: OrderProductSelectorQuery, output: OrderProductSelectors,
  handler: async ({ input, workspace, scope, session, locale }) => listCreationProducts({ workspace, scope, actorId: session.user.id, locale }, input),
});
export const manualOrderCustomersRoute = defineBizRoute({
  id: "orders.creation.customers", method: "GET", path: "/orders/creation/customers", auth: "user",
  ...BIZ_ACCESS.VIEW_ORDER_CUSTOMERS, cache: { kind: "private" }, input: OrderCustomerSelectorQuery, output: OrderCustomerSelectors,
  handler: async ({ input, workspace, scope, session, locale }) => listCreationCustomers({ workspace, scope, actorId: session.user.id, locale }, input),
});
export const manualOrderDraftRoute = defineBizRoute({
  id: "orders.creation.draft", method: "POST", path: "/orders/creation/draft", auth: "user",
  ...BIZ_ACCESS.CREATE_ORDERS, cache: { kind: "private" }, rateLimit: { bucket: "biz:orders:draft", preset: "moderate" }, demo: "default",
  input: ManualOrderDraftRequest, output: ManualOrderQuote, reasons: { values: MANUAL_ORDER_REASONS },
  handler: async ({ input, workspace, scope, session, locale }) => quoteManualOrder({ workspace, scope, actorId: session.user.id, locale }, input),
});
export const manualOrderQuoteRoute = defineBizRoute({
  id: "orders.creation.quote", method: "POST", path: "/orders/creation/quote", auth: "user",
  ...BIZ_ACCESS.CREATE_ORDERS, cache: { kind: "private" }, rateLimit: { bucket: "biz:orders:quote", preset: "moderate" }, demo: "default",
  input: ManualOrderQuoteRequest, output: ManualOrderQuote, reasons: { values: MANUAL_ORDER_REASONS },
  handler: async ({ input, workspace, scope, session, locale }) => quoteManualOrder({ workspace, scope, actorId: session.user.id, locale }, input),
});
export const orderCreationRoutes: readonly BizRouteEntry[] = [manualOrderOptionsRoute, manualOrderProductsRoute,
  manualOrderCustomersRoute, orderContactCreateRoute, manualOrderDraftRoute, manualOrderQuoteRoute, manualOrderCreateRoute];
