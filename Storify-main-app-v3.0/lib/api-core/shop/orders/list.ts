import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { OrderList, OrderListQuery } from "@/contracts/mobile/shop/v1/orders";
import { defineRoute } from "@/lib/api-core/registry";
import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { connectDB } from "@/lib/db";
import { sanitizeOrdersForCustomer } from "@/lib/orders/order-customer-view";
import { getPreorderBalanceDue, placedOrderMatch } from "@/lib/orders/order-payment-status";
import { getReturnCopy } from "@/lib/returns/return-copy";
import { Order } from "@/models";
import { getSettings, getSettingsLean } from "@/models/settings.model";
import { isDelivered, ordersReturnability } from "../returns/returnability";
import { afterTimeCursor, encodeTimeCursor } from "../time-cursor";
import { toOrderSummary, type CustomerOrder } from "./dto";

type ReturnableOrders = Parameters<typeof ordersReturnability>[0];

/**
 * Which orders of a page can be returned now, by id: the order page's own
 * rule (`orderReturnability`), with its reads made once for the page. Only
 * an order something of which was delivered can be; only those are read in
 * full, in one query.
 */
async function returnableOrders(
  page: ReadonlyArray<{ _id: unknown; status?: unknown; subOrders?: unknown }>,
  userId: string,
  locale: string,
): Promise<Set<string>> {
  const ids = page.filter((row) => isDelivered(row as never)).map((row) => row._id);
  if (ids.length === 0) return new Set();
  const [full, settings, copy] = await Promise.all([
    Order.find({ _id: { $in: ids }, customerId: userId }).lean(),
    getSettings(),
    getReturnCopy(locale),
  ]);
  const answers = await ordersReturnability(full as unknown as ReturnableOrders, settings, copy);
  return new Set([...answers].filter(([, answer]) => answer?.canReturn).map(([id]) => id));
}

/**
 * What a list row reads, and what the sanitizer needs to name each seller of
 * a split order. Nothing else of the order leaves the database, but for the
 * delivered orders whether they can be returned is read (`returnableOrders`).
 */
const SUMMARY_FIELDS = [
  "orderNumber",
  "status",
  "paymentStatus",
  "currency",
  "total",
  "createdAt",
  "hasPreorder",
  "preorderStatus",
  "preorderReleaseDate",
  // What a pre-order still owes (`getPreorderBalanceDue`).
  "paymentMethod",
  "preorderOutstandingAmount",
  "subOrders.items.preorderOutstandingAmount",
  "items.quantity",
  "items.vendorId",
  "items.purchaseType",
  "items.preorderStatus",
  "items.preorderReleaseDate",
  "subOrders.vendorId",
  "subOrders.status",
  "subOrders.paymentStatus",
].join(" ");

/** GET /orders: the shopper's placed orders, newest first. */
export const orderListRoute = defineRoute({
  id: "orders.list",
  method: "GET",
  path: "/orders",
  auth: "user",
  cache: { kind: "private" },
  etag: true,
  input: OrderListQuery,
  output: OrderList,
  handler: async ({ input, session, locale }) => {
    const limit = input.limit ?? LIST_DEFAULT_LIMIT;
    await connectDB();

    // An abandoned gateway checkout is not part of anyone's history: the web's
    // order list leaves it out the same way.
    const conditions: Record<string, unknown>[] = [
      { customerId: session.user.id },
      placedOrderMatch(),
    ];
    if (input.preOrders === true) conditions.push({ hasPreorder: true });
    if (input.preOrders === false) conditions.push({ hasPreorder: { $ne: true } });
    if (input.cursor) conditions.push(afterTimeCursor(input.cursor));

    const rows = await Order.find({ $and: conditions })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .select(SUMMARY_FIELDS)
      .lean();
    const page = rows.slice(0, limit);
    // What each pre-order still owes, off the stored row: the sanitizer
    // strips the consignments' lines it reads.
    const balances = new Map(
      page
        .filter((row) => row.hasPreorder)
        .map((row) => [String(row._id), getPreorderBalanceDue(row as never)] as const),
    );
    // Every order keeps the currency it was charged in; only one from before
    // that was stored needs the store's.
    const [orders, storeCurrency, returnable] = await Promise.all([
      sanitizeOrdersForCustomer(page),
      page.every((order) => order.currency)
        ? DEFAULT_CURRENCY
        : getSettingsLean().then((settings) => settings.general?.defaultCurrency || DEFAULT_CURRENCY),
      returnableOrders(page, session.user.id, locale),
    ]);

    return {
      items: orders.map((order) => ({
        ...toOrderSummary(
          order as unknown as CustomerOrder,
          storeCurrency,
          balances.get(String(order._id)),
        ),
        canReturn: returnable.has(String(order._id)),
      })),
      nextCursor: rows.length > limit ? encodeTimeCursor(page[page.length - 1]) : null,
    };
  },
});
