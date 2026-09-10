/**
 * The bridge between what happened and what gets posted.
 *
 * The rules in `postings.ts` are pure and take documents; these functions do
 * the loading, so a call site only has to say "this order was paid" and hand
 * over an id. That split is deliberate: the live paths and the backfill both
 * arrive here, and from here on they run identical code, so a replay cannot
 * produce different entries from the original.
 *
 * Everything here is fire-and-forget by contract. A checkout, a webhook or a
 * cron tick must not fail because the ledger could not be written — the entries
 * are reproducible from the source document, the shopper's order is not.
 */

import { Types } from "mongoose";
// Direct model imports, not the `@/models` barrel: the barrel pulls in every
// model in the app, and a cycle inside it leaves `config/app.config` half
// initialized when a plain script (the backfill) loads it. Two named files
// cost nothing and keep this module loadable outside Next.
import { Order } from "@/models/order.model";
import { PaymentTransaction } from "@/models/payment-transaction.model";
import { Vendor } from "@/models/vendor.model";
import {
  LedgerEntry,
} from "@/models/ledger-entry.model";
// The constant, not `lib/multi-vendor` — that module reaches into geocoding
// and `next/cache`, which a plain script (the backfill) cannot load. The
// finance layer has no business pulling that stack in either.
import { appConfig } from "@/config/app.config";
import { postLedgerEntries } from "@/lib/finance/ledger";
import {
  adjustmentPostings,
  expensePostings,
  expenseReversalPostings,
  orderPaidPostings,
  payoutPaidPostings,
  platformPaymentPostings,
  platformPaymentReversalPostings,
  accumulateRefundBacks,
  decomposeOrder,
  refundBacks,
  refundPostings,
  refundReversalPostings,
  type RefundAllocationInput,
  shipmentLabelPostings,
  shipmentLabelReversalPostings,
  subscriptionInvoicePostings,
  type OrderPostingContext,
  type PostingOrder,
} from "@/lib/finance/postings";

/** The order fields the rules read — nothing else is loaded. */
const ORDER_POSTING_PROJECTION =
  // `codCollectedBy` and `fulfillment.method` are what decide custody on a COD
  // sale. Leaving them out of the projection does not read as missing data — it
  // reads as "the vendor took the cash", which is the wrong answer for every
  // order the platform's own courier collected.
  //
  // `discount`, `coupon.type` and `customs.dutyAmount` are the same kind of
  // trap on the other side: absent, a free-shipping coupon reads as delivery
  // the buyer paid for and a customs bill reads as goods the vendor sold. And
  // `paymentStatus` on both levels is what tells a collected consignment from
  // one still out for delivery. See `decomposeOrder`.
  "orderNumber currency total tax shippingCost discount coupon.type customs.dutyAmount paidAt createdAt paymentMethod paymentStatus preorderOutstandingAmount channel stripePaymentIntentId paymentFee paymentFeeCurrency paymentFeeRate subOrders.vendorId subOrders.subtotal subOrders.commission subOrders.vendorEarnings subOrders.shippingCost subOrders.codCollectedBy subOrders.paymentStatus subOrders.fulfillment.method subOrders.items.cost subOrders.items.quantity";

/**
 * Which vendors are the admin-owned store.
 *
 * Cached for the process: there is exactly one such vendor on a normal install
 * and its identity does not change, while the alternative is a lookup on every
 * paid order. A stale cache would misfile a sale into the wrong book, so the
 * cache is dropped whenever the set comes back empty — the only case where it
 * could be wrong is a store whose default vendor was created after boot.
 */
let defaultVendorIdCache: Set<string> | null = null;

export async function getDefaultVendorIds(): Promise<Set<string>> {
  if (defaultVendorIdCache && defaultVendorIdCache.size > 0) {
    return defaultVendorIdCache;
  }
  const vendors = await Vendor.find({
    $or: [{ isDefault: true }, { slug: appConfig.defaultVendorSlug }],
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  const ids = new Set(vendors.map((vendor) => String(vendor._id)));
  defaultVendorIdCache = ids;
  return ids;
}

async function orderContext(): Promise<OrderPostingContext> {
  return { defaultVendorIds: await getDefaultVendorIds() };
}

/**
 * The store's book currency, for orders that carry none.
 *
 * `Order.currency` was added later, so most historical rows have no currency at
 * all. Skipping them was the first behaviour and it put three quarters of a
 * real store's history outside the accounts — a finance module that reports a
 * quarter of the business is worse than useless. So the store default fills in,
 * and every entry built that way says so.
 */
let storeCurrencyCache: string | null = null;

/**
 * Forget the cached book currency. Called from the settings save, because this
 * was filled once per process and never invalidated — change the store default
 * and the ledger kept posting historical orders in the old currency until
 * something restarted. Small blast radius, but finance is the module where a
 * silently stale number matters most.
 */
export function clearStoreCurrencyCache(): void {
  storeCurrencyCache = null;
}

async function storeCurrency(): Promise<string> {
  if (storeCurrencyCache) return storeCurrencyCache;
  const { Settings } = await import("@/models/settings.model");
  const doc = await Settings.findOne()
    .select("general.defaultCurrency")
    .lean<{ general?: { defaultCurrency?: string } } | null>();
  storeCurrencyCache = (doc?.general?.defaultCurrency || "USD").toUpperCase();
  return storeCurrencyCache;
}

async function loadPostingOrder(
  orderId: unknown,
): Promise<PostingOrder | null> {
  const order = await Order.findById(orderId)
    .select(ORDER_POSTING_PROJECTION)
    .lean<PostingOrder | null>();
  if (!order) return null;
  if (order.currency) return order;
  return {
    ...order,
    currency: await storeCurrency(),
    currencyAssumed: true,
  };
}

/**
 * Post a paid order.
 *
 * Returns the number of entries written so the backfill can report progress;
 * the live paths ignore it and use the `…Safely` wrappers below.
 */
export async function postOrderPaid(orderId: unknown): Promise<number> {
  const order = await loadPostingOrder(orderId);
  if (!order) return 0;
  return postLedgerEntries(orderPaidPostings(order, await orderContext()));
}

/**
 * What the refund itself says it was made of.
 *
 * Read off the refund row rather than passed in, so there is ONE stored fact
 * about a refund's composition and the live path and the backfill cannot post
 * different splits for the same money. A refund with nothing recorded — every
 * order-level refund, and everything written before allocations existed —
 * yields null, and the rules fall back to prorating across the order.
 */
async function loadRefundAllocation(
  refundId: unknown,
): Promise<RefundAllocationInput[] | null> {
  if (!refundId || !Types.ObjectId.isValid(String(refundId))) return null;
  const refund = await PaymentTransaction.findById(refundId)
    .select("refundAllocation")
    .lean<{ refundAllocation?: RefundAllocationInput[] | null } | null>();
  const allocation = refund?.refundAllocation;
  return allocation && allocation.length > 0 ? allocation : null;
}

/**
 * What this refund actually reverses, worked out before it is written.
 *
 * Every refund records its own split now, not just the ones raised against a
 * return. A refund that names no items still has to be prorated, but over what
 * EARLIER refunds left behind rather than over the whole sale — otherwise
 * refunding the goods and then the delivery reverses a slice of the goods
 * twice, and the vendor is charged more than their share was ever worth.
 *
 * Resolving it once, at write time, is what keeps the two money engines in
 * step: the ledger and the payout arithmetic both read the stored figure
 * rather than each re-deriving it, and a rebuild replays exactly what was
 * posted the first time.
 *
 * Returns null when the order cannot be decomposed at all, and the caller then
 * stores nothing — which reads, as it always has, as "prorate this one".
 */
/**
 * Refunds already written against this order, oldest first.
 *
 * `before` excludes the refund being worked on and everything after it, so
 * both the live path — where the row already exists — and a rebuild walking
 * the same rows in `_id` order see the same history. Ids are monotonic, which
 * is what makes that ordering reproducible.
 */
async function loadPriorRefunds(
  orderId: unknown,
  before?: unknown,
): Promise<Array<{ amount: number; allocation: RefundAllocationInput[] | null }>> {
  const filter: Record<string, unknown> = {
    orderId: new Types.ObjectId(String(orderId)),
    type: "refund",
    status: "succeeded",
  };
  if (before && Types.ObjectId.isValid(String(before))) {
    filter._id = { $lt: new Types.ObjectId(String(before)) };
  }

  const rows = await PaymentTransaction.find(filter)
    .sort({ _id: 1 })
    .select("grossAmount refundAllocation")
    .lean<
      Array<{
        grossAmount?: number;
        refundAllocation?: RefundAllocationInput[] | null;
      }>
    >();

  return rows.map((row) => ({
    amount: Number(row.grossAmount || 0),
    allocation:
      Array.isArray(row.refundAllocation) && row.refundAllocation.length > 0
        ? row.refundAllocation
        : null,
  }));
}

export async function resolveRefundAllocation(params: {
  orderId: unknown;
  amount: number;
  /** What the caller knows, when a return told it. Clamped to what is left. */
  supplied?: RefundAllocationInput[] | null;
}): Promise<RefundAllocationInput[] | null> {
  const amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const order = await loadPostingOrder(params.orderId);
  if (!order) return null;
  const decomposition = decomposeOrder(order);
  if (!decomposition) return null;
  const subOrders = (order.subOrders || []).filter(Boolean);
  if (subOrders.length === 0) return null;

  // This refund is not among them: it has not been created yet.
  const alreadyReversed = accumulateRefundBacks({
    decomposition,
    subOrders,
    refunds: await loadPriorRefunds(params.orderId),
  });

  const backs = refundBacks({
    decomposition,
    subOrders,
    amount,
    allocation:
      params.supplied && params.supplied.length > 0 ? params.supplied : null,
    alreadyReversed,
  });

  // Whatever the platform said it was holding back out of its commission
  // travels with the consignment it belongs to.
  const retainedByVendor = new Map<string, number>();
  for (const row of params.supplied || []) {
    const key = row?.vendorId ? String(row.vendorId) : "";
    const retained = Number(row?.commissionRetained || 0);
    if (retained > 0) retainedByVendor.set(key, retained);
  }

  const shares = subOrders.map((sub, index) => {
    const vendorId = sub.vendorId ? String(sub.vendorId) : "";
    const retained = retainedByVendor.get(vendorId);
    return {
      vendorId: sub.vendorId ?? null,
      merchandise: backs[index * 4] ?? 0,
      shipping: backs[index * 4 + 1] ?? 0,
      tax: backs[index * 4 + 2] ?? 0,
      duty: backs[index * 4 + 3] ?? 0,
      ...(retained ? { commissionRetained: retained } : {}),
    };
  });

  // A consignment this refund did not touch carries nothing, and an all-zero
  // allocation says nothing worth storing.
  const meaningful = shares.filter(
    (share) =>
      share.merchandise > 0 ||
      share.shipping > 0 ||
      share.tax > 0 ||
      share.duty > 0,
  );
  return meaningful.length > 0 ? meaningful : null;
}

export async function postRefund(params: {
  orderId: unknown;
  amount: number;
  refundId?: unknown;
  date?: Date;
}): Promise<number> {
  const order = await loadPostingOrder(params.orderId);
  if (!order) return 0;

  // What the refunds before this one already reversed. A refund that recorded
  // its own split does not need it — the split is already exact — but one that
  // recorded none is prorated, and prorating over the WHOLE sale after an
  // earlier refund has taken part of it reverses that part twice. Loaded here
  // rather than assumed, so a rebuild of an order refunded in several steps
  // reproduces what should have been posted rather than what was.
  const decomposition = decomposeOrder(order);
  const subOrders = (order.subOrders || []).filter(Boolean);
  const alreadyReversed =
    decomposition && subOrders.length > 0
      ? accumulateRefundBacks({
          decomposition,
          subOrders,
          refunds: await loadPriorRefunds(params.orderId, params.refundId),
        })
      : null;

  return postLedgerEntries(
    refundPostings({
      order,
      amount: params.amount,
      refundId: params.refundId,
      date: params.date,
      allocation: await loadRefundAllocation(params.refundId),
      alreadyReversed,
      context: await orderContext(),
    }),
  );
}

/**
 * Unwind a refund the gateway later rejected.
 *
 * Rebuilt from the SAME inputs the refund posted under — its stored split and
 * what the refunds before it had already reversed — because a reversal that
 * is computed any other way does not cancel anything, it just posts a second
 * wrong number on top of a first.
 *
 * `alreadyReversed` matters here for exactly one shape, and it is not a rare
 * one: a refund carrying no split of its own, posted after one that did. The
 * original prorated it over what was LEFT; a reversal prorating over the whole
 * sale would hand back 26.37 of goods and 2.64 of tax that the refund never
 * touched, and leave 29.01 of the delivery it did touch standing. Those are
 * the same figures the whole allocation effort existed to get rid of, and they
 * would have come back through the one path nobody looks at.
 */
export async function postRefundReversal(params: {
  orderId: unknown;
  amount: number;
  refundId?: unknown;
  date?: Date;
}): Promise<number> {
  const order = await loadPostingOrder(params.orderId);
  if (!order) return 0;

  const decomposition = decomposeOrder(order);
  const subOrders = (order.subOrders || []).filter(Boolean);
  const alreadyReversed =
    decomposition && subOrders.length > 0
      ? accumulateRefundBacks({
          decomposition,
          subOrders,
          refunds: await loadPriorRefunds(params.orderId, params.refundId),
        })
      : null;

  return postLedgerEntries(
    refundReversalPostings({
      order,
      amount: params.amount,
      refundId: params.refundId,
      date: params.date,
      allocation: await loadRefundAllocation(params.refundId),
      alreadyReversed,
      context: await orderContext(),
    }),
  );
}

export async function postPayoutPaid(payout: {
  _id: unknown;
  payoutNumber?: string | null;
  vendorId?: unknown;
  netAmount?: number | null;
  currency?: string | null;
  paidAt?: Date | null;
}): Promise<number> {
  return postLedgerEntries(payoutPaidPostings(payout));
}

export async function postPlatformPayment(payment: {
  _id: unknown;
  kind?: string | null;
  reference?: string | null;
  vendorId?: unknown;
  amount?: number | null;
  currency?: string | null;
  paidAt?: Date | null;
}): Promise<number> {
  return postLedgerEntries(platformPaymentPostings(payment));
}

export async function postPlatformPaymentReversed(
  payment: Parameters<typeof platformPaymentReversalPostings>[0],
): Promise<number> {
  return postLedgerEntries(platformPaymentReversalPostings(payment));
}

/** A vendor's plan invoice, billed by the provider's own subscription engine. */
export async function postSubscriptionInvoice(
  payment: Parameters<typeof subscriptionInvoicePostings>[0],
): Promise<number> {
  return postLedgerEntries(subscriptionInvoicePostings(payment));
}

/**
 * An expense, and the reversal of whatever it said before.
 *
 * Both go in one call because they are one accounting act: the correction is
 * only true if the thing it corrects is undone in the same breath.
 */
export async function postExpense(
  expense: Parameters<typeof expensePostings>[0],
  previous?: Parameters<typeof expenseReversalPostings>[0] | null,
): Promise<number> {
  const entries = [
    ...(previous ? expenseReversalPostings(previous) : []),
    ...expensePostings(expense),
  ];
  return postLedgerEntries(entries);
}

/**
 * The highest revision any of these keys refers to.
 *
 * Pure, and exported for its test: `expense:<id>:v:2` and its `:reversal` twin
 * both name revision 2, and reading the number back out of the key is what
 * lets a row written before the counter existed still be corrected safely.
 */
export function highestRevisionInKeys(keys: string[]): number {
  let highest = 0;
  for (const key of keys) {
    const match = /:v:(\d+)(?::reversal)?$/.exec(key);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

/**
 * Which revision an expense's live ledger entry is under.
 *
 * The stored counter, when there is one. Rows created before it existed carry
 * none, and guessing zero for those would re-post a key that is already on the
 * books — the exact silent no-op the counter was introduced to fix — so the
 * answer is recovered from the entries themselves instead.
 */
export async function currentExpenseRevision(expense: {
  _id: unknown;
  revision?: number | null;
}): Promise<number> {
  if (typeof expense.revision === "number") return expense.revision;
  const rows = await LedgerEntry.find({
    "source.kind": "expense",
    "source.id": expense._id as Types.ObjectId,
  })
    .select("key")
    .lean<Array<{ key: string }>>();
  return highestRevisionInKeys(rows.map((row) => row.key));
}

/** Deleting an expense reverses it; the original entry stays on the books. */
export async function reverseExpense(
  expense: Parameters<typeof expenseReversalPostings>[0],
): Promise<number> {
  return postLedgerEntries(expenseReversalPostings(expense));
}

/** The shipment fields both label rules read. */
type PostingShipment = {
  _id: unknown;
  vendorId?: unknown;
  orderId?: unknown;
  rate?: {
    amount?: number | null;
    currency?: string | null;
    baseCurrency?: string | null;
  } | null;
  purchasedAt?: Date | null;
  bookingSequence?: number | null;
  /**
   * Whose carrier account the label was charged to.
   *
   * A vendor shipping on their own Shippo token spends their own money; the
   * platform's books must not carry a cost it never paid. Absent means the
   * platform, which is right for every shipment bought before vendor accounts
   * existed and for every store that never configures one.
   */
  billedTo?: string | null;
};

/** True when the platform's own carrier account was charged for this label. */
function platformPaidForLabel(shipment: PostingShipment): boolean {
  return String(shipment.billedTo || "platform") !== "vendor";
}

export async function postShipmentLabel(
  shipment: PostingShipment,
): Promise<number> {
  if (!platformPaidForLabel(shipment)) return 0;
  const defaults = await getDefaultVendorIds();
  return postLedgerEntries(
    shipmentLabelPostings({
      ...shipment,
      isOwnStore: shipment.vendorId
        ? defaults.has(String(shipment.vendorId))
        : true,
    }),
  );
}

/**
 * Take a voided label's cost back off the books.
 *
 * Called only when the carrier refunded it — see the rule. A label the carrier
 * keeps the money for is a cost the store really bore, and nothing is reversed.
 */
export async function postShipmentLabelVoid(
  shipment: PostingShipment & { voidedAt?: Date | null },
): Promise<number> {
  if (!platformPaidForLabel(shipment)) return 0;
  const defaults = await getDefaultVendorIds();
  return postLedgerEntries(
    shipmentLabelReversalPostings({
      ...shipment,
      isOwnStore: shipment.vendorId
        ? defaults.has(String(shipment.vendorId))
        : true,
    }),
  );
}

// ---------------------------------------------------------------------------
// Fire-and-forget wrappers — what the live paths call.

export function postOrderPaidSafely(orderId: unknown): void {
  void postOrderPaid(orderId).catch((error) => {
    console.error("Ledger: failed to post paid order", orderId, error);
  });
}

export function postRefundSafely(params: {
  orderId: unknown;
  amount: number;
  refundId?: unknown;
  date?: Date;
}): void {
  void postRefund(params).catch((error) => {
    console.error("Ledger: failed to post refund", params.orderId, error);
  });
}

export function postRefundReversalSafely(
  params: Parameters<typeof postRefundReversal>[0],
): void {
  void postRefundReversal(params).catch((error) => {
    console.error("Ledger: failed to reverse refund", params.orderId, error);
  });
}

export function postPayoutPaidSafely(payout: Parameters<typeof postPayoutPaid>[0]): void {
  void postPayoutPaid(payout).catch((error) => {
    console.error("Ledger: failed to post payout", payout?._id, error);
  });
}

export function postPlatformPaymentSafely(
  payment: Parameters<typeof postPlatformPayment>[0],
): void {
  void postPlatformPayment(payment).catch((error) => {
    console.error("Ledger: failed to post platform payment", payment?._id, error);
  });
}

export function postPlatformPaymentReversedSafely(
  payment: Parameters<typeof postPlatformPaymentReversed>[0],
): void {
  void postPlatformPaymentReversed(payment).catch((error) => {
    console.error(
      "Ledger: failed to reverse platform payment",
      payment?._id,
      error,
    );
  });
}

export function postSubscriptionInvoiceSafely(
  payment: Parameters<typeof postSubscriptionInvoice>[0],
): void {
  void postSubscriptionInvoice(payment).catch((error) => {
    console.error(
      "Ledger: failed to post subscription invoice",
      payment?._id,
      error,
    );
  });
}

export function postShipmentLabelSafely(
  shipment: Parameters<typeof postShipmentLabel>[0],
): void {
  void postShipmentLabel(shipment).catch((error) => {
    console.error("Ledger: failed to post shipment label", shipment?._id, error);
  });
}

export function postShipmentLabelVoidSafely(
  shipment: Parameters<typeof postShipmentLabelVoid>[0],
): void {
  void postShipmentLabelVoid(shipment).catch((error) => {
    console.error("Ledger: failed to reverse shipment label", shipment?._id, error);
  });
}

/**
 * A hand-entered correction or transfer.
 *
 * Throws on a bad pair rather than returning zero, unlike every other poster in
 * this module. The order paths are fire-and-forget because an order must
 * survive a ledger failure; here the entry IS the whole act — there is no
 * source document that still means something if the posting is dropped — so a
 * silent no-op would tell an admin their correction had been made when the
 * balance behind it had not moved at all.
 */
export async function postAdjustment(
  adjustment: Parameters<typeof adjustmentPostings>[0],
): Promise<number> {
  const entries = adjustmentPostings(adjustment);
  if (entries.length === 0) {
    throw new Error(
      "An adjustment needs a positive amount, a currency, and two different accounts",
    );
  }
  return postLedgerEntries(entries);
}
