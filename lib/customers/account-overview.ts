import "server-only";

import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import {
  getPreorderBalanceDeadline,
  getPreorderBalanceDue,
  owesPreorderBalanceMatch,
  placedOrderMatch,
} from "@/lib/orders/order-payment-status";
import { getOrderPayAmountDue } from "@/lib/payments/order-pay";
import {
  IN_FLIGHT_ORDER_STATUSES,
  attentionOrderIds,
  pickAddressHold,
  pickPayment,
  toInFlight,
  toOverviewOrder,
  type OverviewAttention,
  type OverviewOrder,
  type PaymentCandidate,
} from "./overview-attention";

/**
 * The account overview's order-shaped data: what needs the shopper (see
 * `overview-attention.ts`) and the three most recent orders besides.
 *
 * Every read goes through `placedOrderMatch`, the filter the shopper's own
 * order history uses: an abandoned gateway checkout is not an order they
 * placed, and the overview used to count and list those as "Pending" while
 * the history page hid them.
 */

/** Rows read per kind. A shopper with more than this many orders owing is not the case this card is for. */
const CANDIDATE_LIMIT = 20;
/** Recent orders shown below the attention card. */
const RECENT_ORDERS = 3;

const LINE_FIELDS = "items.name items.image";
/** What `getPreorderBalanceDue` and `getPreorderBalanceDeadline` read. */
const PREORDER_BALANCE_FIELDS =
  "status paymentStatus paymentMethod total preorderOutstandingAmount preorderReleaseDate preorderBalanceRequestedAt preorderCollection subOrders.status subOrders.items.preorderOutstandingAmount";
/** What `getOrderPayAmountDue` reads. */
const ORDER_PAY_FIELDS =
  "status paymentStatus paymentMethod channel total preorderOutstandingAmount storeCredit";

/**
 * An attention row is a prompt, not the page: if its read fails the overview
 * renders without it, as it does without the review prompt.
 */
async function promptRead<T>(label: string, read: () => Promise<T[]>): Promise<T[]> {
  try {
    return await read();
  } catch (error) {
    console.error(`Failed to load ${label} for the account overview:`, error);
    return [];
  }
}

export async function getAccountOverview(userId: string): Promise<{
  attention: OverviewAttention;
  recentOrders: OverviewOrder[];
}> {
  await connectDB();

  const mine = { customerId: userId, ...placedOrderMatch() };

  const [holds, preorders, payable] = await Promise.all([
    promptRead("address holds", () =>
      Order.find({
        ...mine,
        status: { $ne: ORDER_STATUS.CANCELLED },
        "addressHold.state": "open",
      })
        .select("orderNumber createdAt addressHold")
        .limit(CANDIDATE_LIMIT)
        .lean(),
    ),
    // A pre-order is asked for its balance only once the store has asked: the
    // order page offers "pay now" from the day of the deposit, but a Pay
    // button on the overview for a release months away would only nag.
    promptRead("pre-order balances", () =>
      Order.find({
        ...mine,
        hasPreorder: true,
        status: { $ne: ORDER_STATUS.CANCELLED },
        ...owesPreorderBalanceMatch(),
        $or: [
          { preorderStatus: "payment_due" },
          { "items.preorderStatus": "payment_due" },
        ],
      })
        .select(`orderNumber createdAt ${LINE_FIELDS} ${PREORDER_BALANCE_FIELDS}`)
        .limit(CANDIDATE_LIMIT)
        .lean(),
    ),
    promptRead("unpaid orders", () =>
      Order.find({
        ...mine,
        status: { $ne: ORDER_STATUS.CANCELLED },
        paymentStatus: { $in: [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.EXPIRED] },
        channel: { $ne: "pos" },
        // Cash on delivery and pay-later are `pending` by design — without
        // this, a shopper's COD orders would fill the read before any
        // payable one. `getOrderPayAmountDue` below stays the final word.
        paymentMethod: { $nin: ["cod", "cash_on_delivery", "pay_later"] },
      })
        .select(`orderNumber createdAt ${LINE_FIELDS} ${ORDER_PAY_FIELDS}`)
        .limit(CANDIDATE_LIMIT)
        .lean(),
    ),
  ]);

  const graceDays = preorders.length
    ? resolvePreorderPolicy((await getSettings()).preorder).expiryGraceDays
    : 0;

  const candidates: PaymentCandidate[] = [
    ...preorders.map((order) => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      kind: "preorder_balance" as const,
      createdAt: order.createdAt,
      amount: getPreorderBalanceDue(order),
      deadlineAt: getPreorderBalanceDeadline(order, graceDays),
      items: order.items,
    })),
    ...payable.map((order) => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      kind: "order_pay" as const,
      createdAt: order.createdAt,
      // The rule the pay link itself applies: unpaid, not cash on delivery.
      amount: getOrderPayAmountDue(order),
      deadlineAt: null,
      items: order.items,
    })),
  ];

  const addressHold = pickAddressHold(holds);
  const payment = pickPayment(candidates);

  // One order, one row: what is already above is not asked about again.
  const claimed = attentionOrderIds({ addressHold, payment, inFlight: null });
  const inFlightFilter = {
    ...mine,
    status: { $in: IN_FLIGHT_ORDER_STATUSES },
    ...(claimed.length ? { _id: { $nin: claimed } } : {}),
  };
  const [newestInFlight, inFlightCount] = await Promise.all([
    Order.findOne(inFlightFilter)
      .sort({ createdAt: -1 })
      .select(`orderNumber status createdAt ${LINE_FIELDS}`)
      .lean(),
    Order.countDocuments(inFlightFilter),
  ]);

  const attention: OverviewAttention = {
    addressHold,
    payment,
    inFlight: toInFlight(newestInFlight, inFlightCount),
  };

  const shown = attentionOrderIds(attention);
  const recent = await Order.find({
    ...mine,
    ...(shown.length ? { _id: { $nin: shown } } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(RECENT_ORDERS)
    .select(`orderNumber status total createdAt ${LINE_FIELDS}`)
    .lean();

  return { attention, recentOrders: recent.map(toOverviewOrder) };
}
