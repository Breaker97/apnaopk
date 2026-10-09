import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/biz/v1/common";
import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { OrderList, OrderListQuery } from "@/contracts/mobile/biz/v1/orders";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
import { afterTimeCursor, encodeTimeCursor } from "@/lib/api-core/shop/time-cursor";
import { customerListFilter } from "@/lib/customers/business-customers";
import { connectDB } from "@/lib/db";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import { escapeRegExp } from "@/lib/strings";
import { Order, User } from "@/models";
import { toSellerOrderListItem, toStoreOrderListItem, type RawOrder } from "./dto";
import { orderTabFilter } from "./tabs";

/**
 * What a row of the store's list reads. A seller's rows read the whole
 * document: what the shopper pays for their consignment is the ledger's share
 * of the order (`consignmentCharge`), which needs its money fields.
 */
const STORE_ROW_FIELDS = [
  "orderNumber",
  "status",
  "paymentStatus",
  "currency",
  "total",
  "channel",
  "staffId",
  "customerId",
  "hasPreorder",
  "createdAt",
  "items.quantity",
  "shippingAddress.fullName",
  "shippingAddress.firstName",
  "shippingAddress.lastName",
].join(" ");

/** At most this many accounts' orders are searched for one term. */
const SEARCH_CUSTOMER_LIMIT = 200;

/**
 * The orders a search term finds: by number, by a registered customer's name,
 * email or phone, or by a guest's email. Each arm is index-backed on orders
 * (the number, the customer, the guest email); a guest's name is on the
 * address only, which no index covers, so it is not searched.
 */
async function orderSearchFilter(term: string): Promise<Record<string, unknown>> {
  const pattern = new RegExp(escapeRegExp(term), "i");
  const customers = await User.find({ $or: [{ name: pattern }, { email: pattern }, { phone: pattern }] })
    .select("_id")
    .limit(SEARCH_CUSTOMER_LIMIT)
    .lean<Array<{ _id: unknown }>>();
  return {
    $or: [
      { orderNumber: pattern },
      { guestEmail: pattern },
      ...(customers.length > 0 ? [{ customerId: { $in: customers.map((customer) => customer._id) } }] : []),
    ],
  };
}

/**
 * GET /orders: the orders in the operator's reach, newest first, by tab,
 * search and customer. A seller's are their consignments. The cursor continues after the
 * last row, so paging never repeats one while orders come in; the ETag is
 * the page's own (orders keep no index that would date the newest change
 * cheaply), which spares the transfer of an unchanged page.
 */
export const orderListRoute = defineBizRoute({
  id: "orders.list",
  method: "GET",
  path: "/orders",
  auth: "user",
  ...BIZ_ACCESS.VIEW_ORDERS,
  cache: { kind: "private" },
  etag: true,
  input: OrderListQuery,
  output: OrderList,
  handler: async ({ input, scope }) => {
    const limit = input.limit ?? LIST_DEFAULT_LIMIT;
    const tabFilter = orderTabFilter(input.tab ?? "all", scope);
    if (!tabFilter) return { items: [], nextCursor: null };

    await connectDB();
    const conditions: Record<string, unknown>[] = [tabFilter];
    if (input.search) conditions.push(await orderSearchFilter(input.search));
    if (input.customerId) {
      // One customer's: their account's, or their guest record's email. The
      // tab keeps the scope, so a customer out of reach has nothing here.
      const customer = await customerListFilter(input.customerId, "orders");
      if (!customer) return { items: [], nextCursor: null };
      conditions.push(customer);
    }
    if (input.cursor) conditions.push(afterTimeCursor(input.cursor));

    const query = Order.find({ $and: conditions })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate("customerId", "name");
    if (scope.kind !== "vendor") query.select(STORE_ROW_FIELDS);
    const rows = await query.lean<Array<RawOrder & { createdAt?: Date }>>();
    const page = rows.slice(0, limit);
    // Every order keeps the currency it was charged in; only one from before
    // that was stored needs the store's.
    const storeCurrency = page.every((order) => order.currency)
      ? DEFAULT_CURRENCY
      : await getStoreCurrency();

    return {
      items: page.map((order) =>
        scope.kind === "vendor"
          ? toSellerOrderListItem(order, scope.vendorId, storeCurrency)
          : toStoreOrderListItem(order, storeCurrency),
      ),
      nextCursor:
        rows.length > limit
          ? encodeTimeCursor(page[page.length - 1] as { createdAt?: Date; _id: unknown })
          : null,
    };
  },
});
