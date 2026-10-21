/**
 * The money a template prints (docs/INVOICE_TEMPLATE_BUILDER.md §4.7.3, D-05),
 * worked out from the order through the helpers the rest of the app already
 * trusts — never from the old invoice builder's arithmetic (§2.1 gaps):
 *
 *   - a COD consignment's cash: `cashOnDeliveryDue` (the carrier request and
 *     the label read the same figure)
 *   - a pre-order balance: `getPreorderBalanceDue`
 *   - a pending prepaid order: `amountDueNow` (what checkout still asks for)
 *   - a consignment's slice of the order: `consignmentCharge`
 *
 * `tests/invoice-template-money.test.ts` pins what each returns on the §8.3
 * fixtures, and `notes/P1.md` records where they differ from the table.
 *
 * Server-side: `cashOnDeliveryDue` lives in a server-only module. The till
 * never needs this file (`pos-context.ts` reads the sale's own totals).
 */
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import { consignmentCharge } from "@/lib/finance/postings";
import { allocateMoney, quantizeToCurrency } from "@/lib/intl/money";
import {
  SETTLED_PAYMENT_STATUSES,
  getPreorderBalanceDue,
  hasUncollectedPreorderBalance,
} from "@/lib/orders/order-payment-status";
import { amountDueNow } from "@/lib/payments/finalize-order";
import { cashOnDeliveryDue } from "@/lib/shipping/carriers/build-request";
import type { IOrder, OrderItem, SubOrder } from "@/types";

/** The order fields the formulas read. `IOrder` satisfies it. */
export type MoneyOrder = Pick<
  IOrder,
  | "paymentMethod"
  | "paymentStatus"
  | "currency"
  | "subtotal"
  | "discount"
  | "shippingCost"
  | "tax"
  | "customs"
  | "coupon"
  | "total"
  | "subOrders"
  | "storeCredit"
  | "refundedTotal"
  | "posBalanceDue"
  | "preorderOutstandingAmount"
  | "preorderBalancePaidAt"
  | "preorderBalancePaidAmount"
  | "status"
  | "items"
>;

export type MoneyLine = Pick<OrderItem, "price" | "quantity"> & {
  lineDiscount?: { amount?: number | null } | null;
};

export type MoneySubOrder = Pick<
  SubOrder,
  "_id" | "subtotal" | "shippingCost" | "shippingDiscount" | "couponDiscount" | "paymentStatus" | "items"
> &
  Partial<Pick<SubOrder, "status">>;

export interface MoneyFigures {
  currency: string;
  subtotal: number;
  discount: number;
  delivery: number;
  tax: number;
  duty: number;
  total: number;
  paid: number;
  due: number;
  cod: number;
  refunded: number;
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The payment states under which nothing is owed any more (the status prints
 * instead), with one exception: a COD parcel still out on a refunded order
 * ({@link isParcelStillOut}).
 *
 * Not `partially_refunded`: part of what was collected went back, but a COD
 * parcel still out or a pre-order balance is owed all the same.
 */
const CLOSED_PAYMENT_STATUSES: ReadonlyArray<string> = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.REFUNDED,
  PAYMENT_STATUS.EXPIRED,
];

/** The payment states under which nothing paid is kept: all of it went back, or none of it came. */
const NOTHING_KEPT_PAYMENT_STATUSES: ReadonlyArray<string> = [PAYMENT_STATUS.REFUNDED, PAYMENT_STATUS.EXPIRED];

const paymentStatusOf = (order: Pick<MoneyOrder, "paymentStatus">) =>
  String(order.paymentStatus || PAYMENT_STATUS.PENDING);

export function isCashOnDelivery(order: Pick<MoneyOrder, "paymentMethod">): boolean {
  return String(order.paymentMethod || "").toLowerCase() === "cod";
}

/** `price × quantity − lineDiscount.amount` (§4.7.3). */
export function lineTotal(line: MoneyLine, currency: string): number {
  return quantizeToCurrency(
    Math.max(0, num(line.price) * num(line.quantity) - Math.max(0, num(line.lineDiscount?.amount))),
    currency,
  );
}

/** What the lines of a scope add up to at their marked prices, before any discount. */
export function grossLines(lines: ReadonlyArray<MoneyLine>, currency: string): number {
  return quantizeToCurrency(
    lines.reduce((sum, line) => sum + num(line.price) * num(line.quantity), 0),
    currency,
  );
}

export function lineDiscounts(lines: ReadonlyArray<MoneyLine>, currency: string): number {
  return quantizeToCurrency(
    lines.reduce((sum, line) => sum + Math.max(0, num(line.lineDiscount?.amount)), 0),
    currency,
  );
}

/**
 * The cash to collect for one consignment, as the courier is told it
 * (§4.7.3 "Due, COD not yet collected"). 0 for a prepaid order, a collected
 * consignment, or one a coupon paid for in full.
 */
export function consignmentCashOnDelivery(
  order: MoneyOrder,
  subOrder: MoneySubOrder,
  currency: string,
): number {
  const cod = cashOnDeliveryDue(
    { ...order, currency } as Parameters<typeof cashOnDeliveryDue>[0],
    subOrder as Parameters<typeof cashOnDeliveryDue>[1],
    currency,
  );
  return cod ? cod.amount : 0;
}

/**
 * A consignment called off on its own (the seller's or the store's
 * cancellation, `consignment-cancel.ts`): it will never be delivered, so its
 * cash is not owed, and what it never collected was never paid either. The
 * order keeps its stored total, so the paper's Total still includes it.
 */
export function isCalledOff(subOrder: Pick<MoneySubOrder, "status">): boolean {
  return subOrder.status === ORDER_STATUS.CANCELLED;
}

/**
 * A COD parcel still on its way on a refunded order (owner, 2026-10-13). The
 * refund flow marks the whole order `refunded` once what was collected went
 * back, while another seller's parcel may still be out. Its own payment status
 * says it was not collected, and the courier still asks for its cash
 * (`cashOnDeliveryDue`), so the paper does too: a rider reading the sticker
 * must not hand it over for nothing.
 *
 * Only the consignment's **own** status counts. One without its own status
 * follows the order (refunded) and owes nothing; `cashOnDeliveryDue` would
 * read it as uncollected and ask for its whole charge.
 */
export function isParcelStillOut(
  order: Pick<MoneyOrder, "paymentMethod" | "paymentStatus">,
  subOrder: Pick<MoneySubOrder, "paymentStatus" | "status">,
): boolean {
  if (!isCashOnDelivery(order) || paymentStatusOf(order) !== PAYMENT_STATUS.REFUNDED) return false;
  const own = String(subOrder.paymentStatus || "").trim();
  return own !== "" && own !== PAYMENT_STATUS.REFUNDED && !SETTLED_PAYMENT_STATUSES.includes(own) && !isCalledOff(subOrder);
}

/** What one consignment owes on the COD row of the chain: its cash, unless called off or settled by a refund. */
function consignmentOwes(order: MoneyOrder, subOrder: MoneySubOrder, currency: string): number {
  if (isCalledOff(subOrder)) return 0;
  if (paymentStatusOf(order) === PAYMENT_STATUS.REFUNDED && !isParcelStillOut(order, subOrder)) return 0;
  return consignmentCashOnDelivery(order, subOrder, currency);
}

/** The cash the called-off consignments never collected: neither owed nor paid. */
function calledOffCash(order: MoneyOrder, subOrders: ReadonlyArray<MoneySubOrder>, currency: string): number {
  if (!isCashOnDelivery(order)) return 0;
  return quantizeToCurrency(
    subOrders.filter(isCalledOff).reduce((sum, sub) => sum + consignmentCashOnDelivery(order, sub, currency), 0),
    currency,
  );
}

/**
 * The pre-order balance a partially refunded order still owes.
 * `getPreorderBalanceDue` answers 0 for any refund state; the refund writers
 * keep such an order `partially_paid` for that reason, but an order written
 * otherwise still owes the balance that never arrived.
 */
function partiallyRefundedPreorderBalance(order: MoneyOrder): number {
  if (!hasUncollectedPreorderBalance(order)) return 0;
  return getPreorderBalanceDue({ ...order, paymentStatus: PAYMENT_STATUS.PARTIALLY_PAID });
}

/**
 * The row of the due chain (§4.7.3) an order lands on: an amount for the
 * whole order, or "each consignment's own cash on delivery".
 *
 *   refunded, a COD parcel still out → each such parcel's cash (`isParcelStillOut`)
 *   paid, refunded or expired → 0
 *   POS deposit               → `posBalanceDue`
 *   pre-order with a balance  → `getPreorderBalanceDue`
 *   cash on delivery          → each consignment's `cashOnDeliveryDue`, a called-off one 0
 *   still pending             → `amountDueNow`
 *   anything else             → 0
 *
 * A partially refunded order goes down the chain like any other: the refund
 * gave back part of what was collected, not what is still to come. Only the
 * last row is closed to it, since `amountDueNow` is blind to the payment
 * status and would ask for the whole total again.
 *
 * A COD order with no consignments at all (nothing to collect per parcel)
 * falls through to `amountDueNow`, so an old order still prints what it owes.
 */
function dueRow(order: MoneyOrder, currency: string): { cod: true } | { cod: false; amount: number } {
  const status = paymentStatusOf(order);
  const subOrders = (order.subOrders || []).filter(Boolean);
  if (subOrders.some((sub) => isParcelStillOut(order, sub))) return { cod: true };
  if (CLOSED_PAYMENT_STATUSES.includes(status)) return { cod: false, amount: 0 };
  const partiallyRefunded = status === PAYMENT_STATUS.PARTIALLY_REFUNDED;

  const posBalance = num(order.posBalanceDue);
  if (posBalance > 0) return { cod: false, amount: quantizeToCurrency(posBalance, currency) };

  const preorderBalance = partiallyRefunded ? partiallyRefundedPreorderBalance(order) : getPreorderBalanceDue(order);
  if (preorderBalance > 0) return { cod: false, amount: quantizeToCurrency(preorderBalance, currency) };

  if (isCashOnDelivery(order) && subOrders.length > 0) return { cod: true };

  if (partiallyRefunded) return { cod: false, amount: 0 };
  return { cod: false, amount: quantizeToCurrency(amountDueNow(order), currency) };
}

/** What the whole order still owes (§4.7.3); see {@link dueRow} for the chain. */
export function orderDue(order: MoneyOrder, currency: string): number {
  const row = dueRow(order, currency);
  if (!row.cod) return row.amount;
  return quantizeToCurrency(
    (order.subOrders || [])
      .filter(Boolean)
      .reduce((sum, sub) => sum + consignmentOwes(order, sub, currency), 0),
    currency,
  );
}

/**
 * Paid and kept: `max(0, total − refundedTotal − due)` (§4.7.3).
 *
 * Two refinements the table does not spell out:
 *
 *   - while an order is still `pending`, `due` is what is asked for NOW
 *     (`amountDueNow`), which on a deposit pre-order is the deposit alone. The
 *     balance it leaves out has not been paid either, so it comes off as
 *     well; otherwise a pre-order with nothing paid printed its balance as
 *     "Paid".
 *   - a refunded or expired order owes nothing, yet not because it was paid:
 *     the formula read every uncollected amount as paid (an expired order
 *     printed its whole total; a cancelled deposit pre-order, refunded its
 *     2,000 deposit, printed its 3,000 balance). Nothing is kept, so 0.
 *   - a called-off COD consignment owes nothing either, and its cash never
 *     arrived (`calledOff`), so it comes off too.
 */
function paidFigure(
  order: MoneyOrder,
  total: number,
  refunded: number,
  due: number,
  calledOff: number,
  currency: string,
): number {
  const status = paymentStatusOf(order);
  if (NOTHING_KEPT_PAYMENT_STATUSES.includes(status)) return 0;
  const notYetAsked = status === PAYMENT_STATUS.PENDING ? Math.max(0, num(order.preorderOutstandingAmount)) : 0;
  return quantizeToCurrency(Math.max(0, total - refunded - due - notYetAsked - calledOff), currency);
}

/** The figures of the whole order, as it stores them. */
export function orderMoney(order: MoneyOrder, currency: string): MoneyFigures {
  const q = (value: unknown) => quantizeToCurrency(num(value), currency);
  const total = q(order.total);
  const refunded = q(Math.min(Math.max(0, num(order.refundedTotal)), Math.max(0, total)));
  const due = orderDue(order, currency);
  const calledOff = calledOffCash(order, (order.subOrders || []).filter(Boolean), currency);
  return {
    currency,
    subtotal: q(order.subtotal),
    discount: q(order.discount),
    delivery: q(order.shippingCost),
    tax: q(order.tax),
    duty: q(Math.max(0, num(order.customs?.dutyAmount))),
    total,
    paid: paidFigure(order, total, refunded, due, calledOff, currency),
    due,
    cod: isCashOnDelivery(order) ? due : 0,
    refunded,
  };
}

/**
 * The figures of some of the order's consignments — one, for a sticker or a
 * vendor's invoice; several, for a staff member scoped to some sellers.
 *
 * Each consignment's share of the buyer's charge comes from
 * `consignmentCharge` (goods after every discount, delivery after a
 * free-shipping coupon, tax, duty), so a vendor's paper and the ledger agree.
 * The subtotal printed is the consignment's lines at their marked prices and
 * the discount is everything between that and the goods charged, so that
 * Subtotal − Discount + Delivery + Tax + Duty = Total holds on the paper, as
 * it does on the POS receipt (Phase 0).
 *
 * Due: the order's row of the chain decides (`dueRow`), so a closed order
 * owes nothing on any consignment (but a COD parcel still out on a refunded
 * order owes its cash). On the COD row a consignment owes its own cash, a
 * called-off one nothing; on any other the order's due is shared over all its
 * consignments by what each was charged, since it is not recorded per
 * consignment.
 *
 * A refund is not recorded per consignment either, and it can only give back
 * money that arrived: it is shared by what each consignment collected, so a
 * COD parcel still out takes none of it (else the seller's paper read
 * "Refunded" and the collected parcel's Paid too high).
 */
export function consignmentsMoney(
  order: MoneyOrder,
  subOrderIds: ReadonlyArray<string>,
  currency: string,
): MoneyFigures {
  const q = (value: number) => quantizeToCurrency(value, currency);
  const all = (order.subOrders || []).filter(Boolean);
  const wanted = new Set(subOrderIds.map(String));
  const chosen = all.filter((sub) => wanted.has(String(sub._id)));

  const charges = all.map((sub) => consignmentCharge({ ...order, currency }, sub._id));
  const chargeTotal = (index: number) => {
    const charge = charges[index];
    if (charge) return charge.total;
    // An order the decomposition cannot place (no currency, nothing charged):
    // the consignment's face value, as the label does.
    const sub = all[index]!;
    return q(num(sub.subtotal) + num(sub.shippingCost));
  };

  const orderTotal = q(num(order.total));
  const orderRefunded = q(Math.min(Math.max(0, num(order.refundedTotal)), Math.max(0, orderTotal)));
  const cod = isCashOnDelivery(order);
  const weights = all.map((_, index) => Math.max(0, chargeTotal(index)));
  // Each consignment's cash still out, whatever the order's state says.
  const uncollected = cod ? all.map((sub) => consignmentCashOnDelivery(order, sub, currency)) : undefined;
  const row = dueRow(order, currency);
  const dueShares = row.cod
    ? all.map((sub) => consignmentOwes(order, sub, currency))
    : allocateMoney(row.amount, weights, currency);
  const collected = uncollected ? weights.map((weight, index) => Math.max(0, weight - uncollected[index]!)) : weights;
  const refundShares = allocateMoney(
    orderRefunded,
    collected.some((weight) => weight > 0) ? collected : weights,
    currency,
  );

  let subtotal = 0;
  let discount = 0;
  let delivery = 0;
  let tax = 0;
  let duty = 0;
  let total = 0;
  let due = 0;
  let refunded = 0;
  for (const sub of chosen) {
    const index = all.indexOf(sub);
    const charge = charges[index];
    const lines = (sub.items || []) as MoneyLine[];
    const gross = grossLines(lines, currency);
    const merchandise = charge ? charge.merchandise : q(num(sub.subtotal));
    const shipping = charge
      ? charge.shipping
      : q(Math.max(0, num(sub.shippingCost) - Math.max(0, num(sub.shippingDiscount))));
    subtotal += gross;
    discount += Math.max(0, gross - merchandise);
    delivery += shipping;
    tax += charge ? charge.tax : 0;
    duty += charge ? charge.duty : 0;
    total += chargeTotal(index);
    due += dueShares[index] ?? 0;
    refunded += refundShares[index] ?? 0;
  }

  const figures = {
    currency,
    subtotal: q(subtotal),
    discount: q(discount),
    delivery: q(delivery),
    tax: q(tax),
    duty: q(duty),
    total: q(total),
    due: q(due),
    refunded: q(refunded),
  };
  // The balance a pending pre-order has not been asked for yet, this scope's share.
  const outstandingShares = allocateMoney(
    quantizeToCurrency(Math.max(0, num(order.preorderOutstandingAmount)), currency),
    weights,
    currency,
  );
  const scopeOutstanding = chosen.reduce((sum, sub) => sum + (outstandingShares[all.indexOf(sub)] ?? 0), 0);
  const scopedOrder: MoneyOrder = { ...order, preorderOutstandingAmount: q(scopeOutstanding) };
  return {
    ...figures,
    paid: paidFigure(
      scopedOrder,
      figures.total,
      figures.refunded,
      figures.due,
      calledOffCash(order, chosen, currency),
      currency,
    ),
    cod: cod ? figures.due : 0,
  };
}

/**
 * The figures for a scope: the whole order when every consignment is in it
 * (or it has none), otherwise the chosen consignments.
 */
export function scopedMoney(
  order: MoneyOrder,
  subOrderIds: ReadonlyArray<string> | undefined,
  currency: string,
): MoneyFigures {
  const all = (order.subOrders || []).filter(Boolean);
  if (!subOrderIds || all.length === 0) return orderMoney(order, currency);
  const wanted = new Set(subOrderIds.map(String));
  const whole = all.every((sub) => wanted.has(String(sub._id)));
  return whole ? orderMoney(order, currency) : consignmentsMoney(order, subOrderIds, currency);
}
