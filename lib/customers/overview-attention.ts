import { ORDER_STATUS } from "@/config/app.config";

/**
 * What the account overview's "Needs your attention" card is made of, and the
 * recent-orders list under it, as plain data.
 *
 * The overview shows exceptions, not a feed: an order whose delivery is held
 * on the shopper's address, money still owed on an order, and the newest order
 * on its way. Each kind is one row — the most urgent order of that kind, with
 * a count of the others — and an order that already has a row above never
 * appears again below it.
 *
 * Free of the database so the picking rules are testable on their own; the
 * queries that feed them are in `account-overview.ts`.
 */

type DateLike = Date | string | number | null | undefined;

/** The statuses where the shopper is still waiting on the order. */
export const IN_FLIGHT_ORDER_STATUSES: string[] = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PROCESSING,
  ORDER_STATUS.SHIPPED,
  "out_for_delivery",
];

/** An order line, only as far as the overview draws it. */
export interface OverviewLine {
  name?: string | null;
  image?: string | null;
}

/** The line an order is introduced by: its first. */
export interface OverviewProduct {
  name: string;
  image: string | null;
}

export interface AttentionOrderRef {
  orderId: string;
  orderNumber: string;
}

export interface AddressHoldAttention extends AttentionOrderRef {
  /** ISO moment the shopper has until, when the store set one. */
  deadlineAt: string | null;
  /** Other orders waiting on an address. */
  more: number;
}

export type PaymentAttentionKind = "preorder_balance" | "order_pay";

export interface PaymentAttention extends AttentionOrderRef {
  kind: PaymentAttentionKind;
  amount: number;
  /** ISO moment the unpaid amount is cancelled on, when there is one. */
  deadlineAt: string | null;
  product: OverviewProduct;
  /** Other orders that owe money. */
  more: number;
}

export interface InFlightAttention extends AttentionOrderRef {
  status: string;
  createdAt: string;
  product: OverviewProduct;
  /** Items on the order beyond the first. */
  moreItems: number;
  /** Other orders still on their way. */
  more: number;
}

export interface OverviewAttention {
  addressHold: AddressHoldAttention | null;
  payment: PaymentAttention | null;
  inFlight: InFlightAttention | null;
}

export interface OverviewOrder {
  _id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  product: OverviewProduct;
  /** Items on the order beyond the first. */
  moreItems: number;
}

export const EMPTY_ATTENTION: OverviewAttention = {
  addressHold: null,
  payment: null,
  inFlight: null,
};

function toIso(value: DateLike): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timeOf(value: DateLike): number | null {
  const iso = toIso(value);
  return iso ? Date.parse(iso) : null;
}

/** An order's first line and how many follow it. */
export function leadProduct(items: OverviewLine[] | null | undefined): {
  product: OverviewProduct;
  moreItems: number;
} {
  const lines = Array.isArray(items) ? items : [];
  const first = lines.find((line) => line?.name?.trim()) ?? lines[0];
  return {
    product: {
      name: String(first?.name ?? "").trim(),
      image: first?.image || null,
    },
    moreItems: Math.max(0, lines.length - 1),
  };
}

/**
 * Soonest deadline first, an order with none after those that have one, and
 * the older order first between equals — the shopper who has waited longest
 * is asked first.
 */
function byUrgency<T extends { deadline: number | null; placed: number | null }>(
  a: T,
  b: T,
): number {
  if (a.deadline !== null && b.deadline !== null && a.deadline !== b.deadline) {
    return a.deadline - b.deadline;
  }
  if ((a.deadline === null) !== (b.deadline === null)) {
    return a.deadline === null ? 1 : -1;
  }
  return (a.placed ?? 0) - (b.placed ?? 0);
}

export interface AddressHoldCandidate {
  _id: unknown;
  orderNumber: string;
  createdAt?: DateLike;
  addressHold?: {
    state?: string | null;
    deadlineAt?: DateLike;
    customerConfirmedAt?: DateLike;
  } | null;
}

/**
 * The order whose shipping waits on the shopper's address. One that the
 * shopper has already answered ("this address is right") is the store's move
 * now, so it asks nothing of them and gets no row.
 */
export function pickAddressHold(
  orders: AddressHoldCandidate[],
): AddressHoldAttention | null {
  const waiting = orders
    .filter(
      (order) =>
        order.addressHold?.state === "open" &&
        !order.addressHold.customerConfirmedAt,
    )
    .map((order) => ({
      order,
      deadline: timeOf(order.addressHold?.deadlineAt),
      placed: timeOf(order.createdAt),
    }))
    .sort(byUrgency);
  const first = waiting[0];
  if (!first) return null;
  return {
    orderId: String(first.order._id),
    orderNumber: first.order.orderNumber,
    deadlineAt: toIso(first.order.addressHold?.deadlineAt),
    more: waiting.length - 1,
  };
}

export interface PaymentCandidate {
  _id: unknown;
  orderNumber: string;
  kind: PaymentAttentionKind;
  createdAt?: DateLike;
  /** What is still owed, in the store currency. Zero or less is not a candidate. */
  amount: number;
  deadlineAt?: DateLike;
  items?: OverviewLine[] | null;
}

/** The order that owes the most urgent money; the rest are counted. */
export function pickPayment(
  candidates: PaymentCandidate[],
): PaymentAttention | null {
  const owing = candidates
    .filter((candidate) => Number(candidate.amount) > 0)
    .map((candidate) => ({
      candidate,
      deadline: timeOf(candidate.deadlineAt),
      placed: timeOf(candidate.createdAt),
    }))
    .sort(byUrgency);
  const first = owing[0];
  if (!first) return null;
  const { candidate } = first;
  return {
    orderId: String(candidate._id),
    orderNumber: candidate.orderNumber,
    kind: candidate.kind,
    amount: Number(candidate.amount),
    deadlineAt: toIso(candidate.deadlineAt),
    product: leadProduct(candidate.items).product,
    more: owing.length - 1,
  };
}

export interface OrderCandidate {
  _id: unknown;
  orderNumber: string;
  status: string;
  total?: number | null;
  createdAt: DateLike;
  items?: OverviewLine[] | null;
}

/** The newest order still on its way, with how many others are. */
export function toInFlight(
  newest: OrderCandidate | null | undefined,
  inFlightCount: number,
): InFlightAttention | null {
  if (!newest) return null;
  const { product, moreItems } = leadProduct(newest.items);
  return {
    orderId: String(newest._id),
    orderNumber: newest.orderNumber,
    status: newest.status,
    createdAt: toIso(newest.createdAt) ?? new Date(0).toISOString(),
    product,
    moreItems,
    more: Math.max(0, inFlightCount - 1),
  };
}

export function toOverviewOrder(order: OrderCandidate): OverviewOrder {
  const { product, moreItems } = leadProduct(order.items);
  return {
    _id: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    totalAmount: Number(order.total ?? 0),
    createdAt: toIso(order.createdAt) ?? new Date(0).toISOString(),
    product,
    moreItems,
  };
}

/** The order ids the attention card already shows, so the list below skips them. */
export function attentionOrderIds(attention: OverviewAttention): string[] {
  return [
    attention.addressHold?.orderId,
    attention.payment?.orderId,
    attention.inFlight?.orderId,
  ].filter((id): id is string => Boolean(id));
}
