import { Payout } from "@/models/payout.model";
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
  LEDGER_SOURCE_KIND,
} from "@/models/ledger-entry.model";
import { LEDGER_ACCOUNT, type LedgerAccount } from "@/lib/finance/accounts";
// The constant, not `lib/multi-vendor` — that module reaches into geocoding
// and `next/cache`, which a plain script (the backfill) cannot load. The
// finance layer has no business pulling that stack in either.
import { appConfig } from "@/config/app.config";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { postLedgerEntries, postingKey } from "@/lib/finance/ledger";
import {
  adjustmentPostings,
  expensePostings,
  expenseReversalPostings,
  orderPaidPostings,
  payoutPaidPostings,
  payoutReversalPostings,
  platformPaymentPostings,
  platformPaymentRefundPostings,
  platformPaymentReversalPostings,
  accumulateRefundBacks,
  cashAccountFor,
  decomposeOrder,
  isConsignmentCollected,
  fitRefundAllocation,
  refundBacks,
  scopedRefundBacks,
  unreversedConsignmentTotals,
  refundPostings,
  refundReversalPostings,
  type RefundAllocationInput,
  shipmentLabelPostings,
  shipmentLabelReversalPostings,
  shippingToStorePostings,
  balanceWriteOffPostings,
  bookSharesOfCharge,
  chargebackLossPostings,
  moveShareToOtherBook,
  restockCostPostings,
  storeFundedCancellationPostings,
  disputeFeeInOrderCurrency,
  disputeFeePostings,
  storeCreditPostings,
  subscriptionInvoicePostings,
  testLabelCorrectionPostings,
  type OrderPostingContext,
  type PostingOrder,
} from "@/lib/finance/postings";
// Import-light by design (it is read by the Settings model), so a plain script
// such as the backfill can still load this module.
import { isTestLabel } from "@/lib/shipping/carrier-config";

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
  // one still out for delivery, and `subOrders.status` tells a consignment that
  // has been called off — whose share of a pre-order balance will never arrive
  // however the order as a whole ends up reading. See `decomposeOrder`. The
  // order's own `status` tells a refund whether the balance went with the order
  // or is still owed on it — see `refundPostings`. `subOrders.couponDiscount`
  // is whose coupon it was: without it the ledger shared a seller's own coupon
  // across every seller while the payout and the consignment charge did not,
  // and `subOrders._id` is how a refund names the consignment it belongs to.
  // `storeCredit` is the part the shopper's credit paid (R8), which never
  // reached the cash account the sale is posted to.
  "orderNumber currency total tax shippingCost discount storeCredit coupon.type coupon.fundedBy customs.dutyAmount paidAt createdAt paymentMethod paymentStatus status preorderOutstandingAmount preorderBalancePaidAt preorderBalancePaidFrom preorderBalancePaymentFee channel paymentCustody stripePaymentIntentId paymentFee paymentFeeCurrency paymentFeeRate subOrders._id subOrders.vendorId subOrders.subtotal subOrders.couponDiscount subOrders.shippingDiscount subOrders.commission subOrders.vendorEarnings subOrders.shippingCost subOrders.codCollectedBy subOrders.paymentStatus subOrders.status subOrders.fulfillment.method subOrders.items.productId subOrders.items.variantId subOrders.items.cost subOrders.items.quantity subOrders.items.preorderOutstandingAmount subOrders.shippingRevenueTo subOrders.platformLabelAt subOrders.paidAt";

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
  const loaded = await Order.findById(orderId)
    .select(ORDER_POSTING_PROJECTION)
    .lean<PostingOrder | null>();
  if (!loaded) return null;

  // When the money arrived, for an order recorded before `paidAt` was stamped:
  // its charge row was written at that moment. Without it the sale would be
  // dated when the order was placed, which for cash on delivery can be weeks
  // earlier and in another month.
  let order = loaded;
  if (!order.paidAt && order.paymentStatus && order.paymentStatus !== "pending") {
    const charge = await PaymentTransaction.findOne({
      orderId: order._id,
      type: "charge",
      status: "succeeded",
    })
      .sort({ createdAt: 1 })
      .select("createdAt")
      .lean<{ createdAt?: Date } | null>()
      .catch(() => null);
    if (charge?.createdAt) order = { ...order, paidAt: charge.createdAt };
  }

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
  const { recordOrderCollections } = await import("./collections");
  await recordOrderCollections(orderId);
  const order = await loadPostingOrder(orderId);
  if (!order) return 0;
  return postLedgerEntries(
    orderPaidPostings(order, {
      ...(await orderContext()),
      raisedOutstanding: await loadRaisedOutstanding(order),
    }),
  );
}

/**
 * The balance receivables this order has already raised, by posting key, so
 * the collection clears what was raised rather than what today's split says.
 */
async function loadRaisedOutstanding(order: {
  _id?: unknown;
  preorderOutstandingAmount?: number | null;
}): Promise<Map<string, number> | undefined> {
  if (!(Number(order.preorderOutstandingAmount || 0) > 0)) return undefined;
  const raised = await LedgerEntry.find({
    "source.kind": "order",
    "source.id": new Types.ObjectId(String(order._id)),
    debit: "customer_receivable",
    key: { $regex: ":outstanding:" },
  })
    .select("key amount")
    .lean<Array<{ key: string; amount: number }>>();
  return new Map(raised.map((entry) => [entry.key, Number(entry.amount || 0)]));
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
/**
 * The stored split of a refund row, and whether it went to store credit
 * (R8) — which the ledger books as credit owed rather than cash paid out.
 */
async function loadRefundRow(refundId: unknown): Promise<{
  allocation: RefundAllocationInput[] | null;
  storeCredit: boolean;
}> {
  if (!refundId || !Types.ObjectId.isValid(String(refundId))) {
    return { allocation: null, storeCredit: false };
  }
  const refund = await PaymentTransaction.findById(refundId)
    .select("refundAllocation metadata.storeCredit")
    .lean<{
      refundAllocation?: RefundAllocationInput[] | null;
      metadata?: { storeCredit?: boolean };
    } | null>();
  const allocation = refund?.refundAllocation;
  return {
    allocation: allocation && allocation.length > 0 ? allocation : null,
    storeCredit: refund?.metadata?.storeCredit === true,
  };
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
  /**
   * The consignments this refund belongs to, when it is one or more of them
   * being called off rather than money back on the order as a whole. Ignored
   * when `supplied` says more.
   */
  consignmentIds?: ReadonlyArray<unknown> | null;
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

  const supplied =
    params.supplied && params.supplied.length > 0 ? params.supplied : null;

  // Nobody itemised this refund, but that does not always mean "some of
  // everything". A cancelled consignment's refund is that consignment's; and
  // on a split cash order, money handed back can only be money that was
  // handed over — never a share of a parcel still out for delivery.
  let scoped: number[] | null = null;
  if (!supplied) {
    const named = params.consignmentIds?.length
      ? new Set(params.consignmentIds.map(String))
      : null;
    const include = subOrders.map((sub) =>
      named ? named.has(String(sub._id)) : isConsignmentCollected(order, sub),
    );
    if (include.some(Boolean) && include.some((value) => !value)) {
      scoped = scopedRefundBacks({
        decomposition,
        amount,
        include,
        alreadyReversed,
      });
    }
  }

  const backs =
    scoped ??
    refundBacks({
      decomposition,
      subOrders,
      amount,
      // Fitted to what each consignment has left before it is trusted, so a
      // return quoting more delivery or tax than its own parcel carried moves
      // that overflow alone rather than spreading the goods over every seller.
      allocation:
        fitRefundAllocation({
          decomposition,
          subOrders,
          amount,
          allocation: supplied,
          alreadyReversed,
        }) ?? supplied,
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

/**
 * How much of each named consignment no refund has handed back yet, keyed by
 * sub-order id — read from the same decomposition and refund history the
 * ledger posts from, so a cancellation can never give back more of a
 * consignment than the books still hold for it.
 *
 * Consignments the order cannot be decomposed for are simply absent; a caller
 * treats absence as "no ceiling known".
 */
export async function loadUnreversedConsignmentTotals(
  orderId: unknown,
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  const order = await loadPostingOrder(orderId);
  if (!order) return totals;
  const decomposition = decomposeOrder(order);
  const subOrders = (order.subOrders || []).filter(Boolean);
  if (!decomposition || subOrders.length === 0) return totals;

  const alreadyReversed = accumulateRefundBacks({
    decomposition,
    subOrders,
    refunds: await loadPriorRefunds(orderId),
  });
  const unreversed = unreversedConsignmentTotals(decomposition, alreadyReversed);
  subOrders.forEach((sub, index) => {
    if (sub._id) totals.set(String(sub._id), unreversed[index] ?? 0);
  });
  return totals;
}

/**
 * Move a consignment's delivery charge between the vendor and the store, for a
 * label on the store's carrier account being bought (or voided and refunded).
 *
 * The amount is whatever of that consignment's delivery no refund has handed
 * back yet, from the same decomposition the sale posted — a refund of the
 * delivery before the label already took its part out of the vendor's payable.
 *
 * WHICH WAY it moves is worked out here, from the order, and is deliberately
 * not a parameter. The two directions carry different keys — `shipping-billed`
 * when the vendor took the shopper's cash and is billed for the delivery,
 * `shipping-to-store` when the charge comes out of a payable the store is
 * holding — so a caller that omitted the flag did not post nothing, it posted
 * a SECOND entry the unique index could not recognise as a duplicate. The
 * daily reconcile omitted it, and every pass re-billed the same delivery: the
 * charge counted twice as shipping income and the vendor's payable driven
 * negative by it, which is the impossible balance the overview warns about.
 *
 * Safe to derive rather than remember because custody never moves: none of the
 * fields `isPlatformSettled` reads change once the order is placed, and in
 * particular it does not read `platformLabelAt` — so this gives the same
 * answer before the stamp, after it, and on a reversal months later.
 */
export async function postShippingToStore(params: {
  orderId: unknown;
  subOrderId: unknown;
  shipmentId: unknown;
  bookingSequence?: number | null;
  date?: Date;
  reversal?: boolean;
}): Promise<number> {
  const order = await loadPostingOrder(params.orderId);
  if (!order) return 0;
  const decomposition = decomposeOrder(order);
  const subOrders = (order.subOrders || []).filter(Boolean);
  const index = subOrders.findIndex(
    (sub) => String(sub._id) === String(params.subOrderId),
  );
  if (!decomposition || index < 0) return 0;

  const alreadyReversed = accumulateRefundBacks({
    decomposition,
    subOrders,
    refunds: await loadPriorRefunds(params.orderId),
  });
  const shipping = decomposition.shares[index]?.shipping ?? 0;
  const remaining = shipping - Number(alreadyReversed[index * 4 + 1] || 0);

  // The vendor took the shopper's money at the door, so there is no payable to
  // take the delivery out of: the store bills them for the parcel it carried,
  // alongside the commission they already owe.
  const billToVendor = !isPlatformSettled(
    {
      paymentMethod: order.paymentMethod,
      channel: order.channel,
      stripePaymentIntentId: order.stripePaymentIntentId,
      paymentCustody: order.paymentCustody,
    },
    subOrders[index]!,
  );

  return postLedgerEntries(
    shippingToStorePostings({
      orderId: order._id,
      orderNumber: order.orderNumber,
      vendorId: subOrders[index]!.vendorId,
      shipmentId: params.shipmentId,
      bookingSequence: params.bookingSequence,
      amount: remaining,
      currency: decomposition.currency,
      date: params.date || new Date(),
      reversal: params.reversal,
      billToVendor,
    }),
  );
}

/**
 * Take a called-off pre-order's unpaid balance off the books — see
 * `balanceWriteOffPostings`. Safe to call from every cancellation path, as
 * often as they like: it writes each consignment's part once.
 */
/**
 * A cancelled consignment that took no money — the store's own coupon had paid
 * for all of it. See `storeFundedCancellationPostings`.
 */
export async function postStoreFundedCancellation(
  orderId: unknown,
  options?: { cancelledSubOrderIds?: ReadonlyArray<unknown> | null; date?: Date },
): Promise<number> {
  const order = await loadPostingOrder(orderId);
  if (!order) return 0;
  return postLedgerEntries(
    storeFundedCancellationPostings({
      order,
      context: await orderContext(),
      cancelledSubOrderIds: options?.cancelledSubOrderIds ?? null,
      date: options?.date,
    }),
  );
}

export function postStoreFundedCancellationSafely(
  orderId: unknown,
  options?: { cancelledSubOrderIds?: ReadonlyArray<unknown> | null },
): void {
  void postStoreFundedCancellation(orderId, options).catch((error) => {
    console.error(
      "Ledger: failed to write off a cancelled store-funded sale",
      orderId,
      error,
    );
  });
}

export async function postBalanceWriteOff(orderId: unknown): Promise<number> {
  const order = await loadPostingOrder(orderId);
  if (!order) return 0;
  const decomposition = decomposeOrder(order);
  const subOrders = (order.subOrders || []).filter(Boolean);
  if (!decomposition || subOrders.length === 0) return 0;

  const alreadyReversed = accumulateRefundBacks({
    decomposition,
    subOrders,
    refunds: await loadPriorRefunds(orderId),
  });

  // What the books still say the shopper owes on this order, per vendor. The
  // balance may have been collected for a consignment before it was called
  // off, or written off by an earlier call; either way there is less, or
  // nothing, left to take off.
  const owed = await LedgerEntry.aggregate<{ _id: unknown; balance: number }>([
    {
      $match: {
        "source.kind": "order",
        "source.id": new Types.ObjectId(String(order._id)),
        $or: [
          { debit: "customer_receivable" },
          { credit: "customer_receivable" },
        ],
      },
    },
    {
      $group: {
        _id: "$vendorId",
        balance: {
          $sum: {
            $cond: [
              { $eq: ["$debit", "customer_receivable"] },
              "$amount",
              { $multiply: ["$amount", -1] },
            ],
          },
        },
      },
    },
  ]);
  const receivableByVendor = new Map(
    owed.map((row) => [row._id ? String(row._id) : "", Number(row.balance || 0)]),
  );

  return postLedgerEntries(
    balanceWriteOffPostings({
      order,
      context: await orderContext(),
      alreadyReversed,
      date: new Date(),
      receivableByVendor,
    }),
  );
}

/**
 * A chargeback's fee, or its return when the store won — see
 * `disputeFeePostings`. Filed in the store's own book when the order carries
 * the store's own goods, as the processing fee is.
 */
export async function postDisputeFee(params: {
  disputeId: string;
  orderId: unknown;
  amount: number;
  currency: string;
  date?: Date;
  returned?: boolean;
  /** Which of several fees on one dispute — see `disputeFeePostings`. */
  part?: string;
  note?: string;
}): Promise<number> {
  const order = await loadPostingOrder(params.orderId);
  if (!order) return 0;
  const defaults = await getDefaultVendorIds();
  const anyOwn = (order.subOrders || []).some((sub) =>
    defaults.has(sub?.vendorId ? String(sub.vendorId) : ""),
  );
  const shares = bookSharesOfCharge(order, { defaultVendorIds: defaults });
  const fee = disputeFeeInOrderCurrency(order, params);
  return postLedgerEntries(
    disputeFeePostings({
      disputeId: params.disputeId,
      orderId: order._id,
      orderNumber: order.orderNumber,
      amount: fee.amount,
      currency: fee.currency,
      date: params.date || new Date(),
      book: anyOwn ? "own" : "marketplace",
      returned: params.returned,
      part: params.part,
      note: fee.note,
    }).flatMap((entry) => [entry, ...moveShareToOtherBook(entry, shares)]),
  );
}


/**
 * Bring what the books hold as a dispute's loss beyond the sale in line with
 * `target` — what the gateway is holding for the dispute that no refund row
 * could take. Reads the entries already posted for it and writes the
 * difference, so reading the same dispute again writes nothing.
 */
export async function postChargebackLoss(params: {
  disputeId: string;
  orderId: unknown;
  target: number;
  currency: string;
  date?: Date;
}): Promise<number> {
  const order = await loadPostingOrder(params.orderId);
  if (!order) return 0;
  const prefix = postingKey("order", order._id, "dispute", params.disputeId, "beyond-sale");
  const existing = (
    await LedgerEntry.find({
      "source.kind": "order",
      "source.id": new Types.ObjectId(String(order._id)),
      key: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:` },
    })
      .select("debit amount key")
      .lean<Array<{ debit?: string; amount?: number; key?: string }>>()
  )
    // A share moved to the other book is not a change to the loss, and must
    // not count as a part: its two legs cancel on the account anyway.
    .filter((entry) => !String(entry.key || "").includes(":book-share:"));
  const booked = existing.reduce(
    (sum, entry) =>
      sum + (entry.debit === "chargeback_losses" ? 1 : -1) * Number(entry.amount || 0),
    0,
  );
  const target = Math.max(0, Number(params.target) || 0);
  const change = Math.round((target - booked) * 1000) / 1000;
  if (Math.abs(change) < 0.005) return 0;

  const defaults = await getDefaultVendorIds();
  const anyOwn = (order.subOrders || []).some((sub) =>
    defaults.has(sub?.vendorId ? String(sub.vendorId) : ""),
  );
  const shares = bookSharesOfCharge(order, { defaultVendorIds: defaults });
  return postLedgerEntries(
    chargebackLossPostings({
      disputeId: params.disputeId,
      orderId: order._id,
      orderNumber: order.orderNumber,
      amount: Math.abs(change),
      currency: params.currency,
      date: params.date || new Date(),
      book: anyOwn ? "own" : "marketplace",
      returned: change < 0,
      part: existing.length + 1,
    }).flatMap((entry) => [entry, ...moveShareToOtherBook(entry, shares)]),
  );
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

  const row = await loadRefundRow(params.refundId);
  return postLedgerEntries(
    refundPostings({
      order,
      amount: params.amount,
      refundId: params.refundId,
      date: params.date,
      allocation: row.allocation,
      alreadyReversed,
      context: await orderContext(),
      // A refund to store credit sends nothing: the shopper is owed it (R8).
      ...(row.storeCredit ? { against: "store_credit" as const } : {}),
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
  /** Why it is reversed, for the entries' note. */
  note?: string;
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

  // Against what the refund came out of: a refund to store credit (R8) is put
  // back on the credit owed, not on a cash account it never touched.
  const row = await loadRefundRow(params.refundId);
  return postLedgerEntries(
    refundReversalPostings({
      order,
      amount: params.amount,
      refundId: params.refundId,
      date: params.date,
      allocation: row.allocation,
      alreadyReversed,
      context: await orderContext(),
      ...(row.storeCredit ? { against: "store_credit" as const } : {}),
      ...(params.note ? { note: params.note } : {}),
    }),
  );
}

export async function postPayoutPaid(payout: {
  _id: unknown;
  payoutNumber?: string | null;
  vendorId?: unknown;
  netAmount?: number | null;
  commissionOffset?: number | null;
  commissionCredit?: number | null;
  paidFrom?: string | null;
  currency?: string | null;
  paidAt?: Date | null;
}): Promise<number> {
  const stored = await Payout.findById(payout._id).lean();
  if (!stored?.paidAt) return 0;
  const { FinanceOperation } = await import("@/models/finance-operation.model");
  const { finishFinanceOperation } = await import("./operations");
  const pending = await FinanceOperation.find({ sourceId: String(payout._id), state: "pending" }).select("_id").lean();
  for (const operation of pending) await finishFinanceOperation(operation._id);
  const entries = stored.settlementPostings?.length ? stored.settlementPostings : payoutPaidPostings({ ...stored, paidFrom: stored.settlementSnapshot?.paidFrom || stored.paidFrom });
  if (!stored.settlementPostings?.length && !stored.paidFrom) throw new Error("Historical payout account is unknown; review transfer evidence");
  return postLedgerEntries(entries);

}

/** A paid payout the bank sent back: its entries, flipped. */
export async function postPayoutReversed(
  payout: Parameters<typeof payoutReversalPostings>[0],
): Promise<number> {
  const stored = await Payout.findById(payout._id).lean();
  if (!stored?.reversedAt) return 0;
  await postPayoutPaid(stored);
  const original = stored.settlementPostings?.length ? stored.settlementPostings : await LedgerEntry.find({ "source.kind": "payout", "source.id": stored._id, key: { $not: /:reversal$/ } }).lean();
  if (!original.length) throw new Error("Historical payout settlement evidence is missing");
  return postLedgerEntries(original.map((entry: import("./ledger").LedgerPosting) => ({ ...entry, date: stored.reversedAt, debit: entry.credit, credit: entry.debit, key: `${entry.key}:reversal`, note: "Payout returned" })));

}

export async function postPlatformPayment(payment: {
  _id: unknown;
  kind?: string | null;
  reference?: string | null;
  vendorId?: unknown;
  amount?: number | null;
  currency?: string | null;
  paidAt?: Date | null;
  provider?: string | null;
}): Promise<number> {
  const { replayPlatformPayment } = await import("./payment-ledger");
  return replayPlatformPayment(payment._id);
}

export async function postPlatformPaymentReversed(
  payment: Parameters<typeof platformPaymentReversalPostings>[0],
): Promise<number> {
  return postLedgerEntries(platformPaymentReversalPostings(payment));
}

/** One step of a platform payment being refunded — see the posting rule. */
export async function postPlatformPaymentRefund(
  payment: Parameters<typeof platformPaymentRefundPostings>[0],
): Promise<number> {
  return postLedgerEntries(platformPaymentRefundPostings(payment));
}

/** A vendor's plan invoice, billed by the provider's own subscription engine. */
export async function postSubscriptionInvoice(
  payment: Parameters<typeof subscriptionInvoicePostings>[0],
): Promise<number> {
  const { replaySubscriptionInvoice } = await import("./payment-ledger");
  await replaySubscriptionInvoice(payment._id);
  return 0;
}

/**
 * An expense, and the reversal of whatever it said before.
 *
 * Both go in one call because they are one accounting act: the correction is
 * only true if the thing it corrects is undone in the same breath.
 *
 * `strict` from the admin routes, where the entry is the whole point of the
 * record and a failed write has to be reported — see `postLedgerEntries`.
 */
export async function postExpense(
  expense: Parameters<typeof expensePostings>[0],
  previous?: Parameters<typeof expenseReversalPostings>[0] | null,
  options: { strict?: boolean } = {},
): Promise<number> {
  const entries = [
    ...(previous ? expenseReversalPostings(previous) : []),
    ...expensePostings(expense),
  ];
  return postLedgerEntries(entries, options);
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
  options: { strict?: boolean } = {},
): Promise<number> {
  return postLedgerEntries(expenseReversalPostings(expense), options);
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
  /**
   * `test` for a label bought on the carrier's test environment, which costs
   * nothing — see `isTestLabel`. Every path that books a label has to read it:
   * the purchase always did, and the daily pass and the backfill did not.
   */
  providerMode?: string | null;
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
  const posting = {
    ...shipment,
    isOwnStore: shipment.vendorId
      ? defaults.has(String(shipment.vendorId))
      : true,
  };
  // A test label books nothing — and one an earlier pass booked anyway has
  // its cost taken back off.
  if (isTestLabel({ providerMode: shipment.providerMode })) {
    return correctTestLabelCost(posting);
  }
  return postLedgerEntries(shipmentLabelPostings(posting));
}

/**
 * Take a test label's cost back off, if one was ever booked.
 *
 * Nothing when it never was — the case for every test label the purchase path
 * handled — and nothing when a void has already reversed it, which would
 * otherwise be taken off twice.
 */
async function correctTestLabelCost(
  posting: Parameters<typeof shipmentLabelPostings>[0],
): Promise<number> {
  const [cost] = shipmentLabelPostings(posting);
  if (!cost) return 0;
  const booked = await LedgerEntry.findOne({ key: cost.key })
    .select("date")
    .lean<{ date?: Date } | null>();
  if (!booked) return 0;
  const voided = await LedgerEntry.exists({ key: `${cost.key}:void` });
  if (voided) return 0;
  return postLedgerEntries(
    testLabelCorrectionPostings({ ...posting, bookedAt: booked.date ?? null }),
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
  const posting = {
    ...shipment,
    isOwnStore: shipment.vendorId
      ? defaults.has(String(shipment.vendorId))
      : true,
  };
  // A test label is never reversed as a refund, because it never cost
  // anything. If an earlier pass booked it anyway, the one correction for that
  // is the test-label one — under its own key, so the void and the daily pass
  // cannot both take it off.
  if (isTestLabel({ providerMode: shipment.providerMode })) {
    return correctTestLabelCost(posting);
  }
  // Only a cost that was booked comes back off. The reversal's key carries the
  // booking number, which moves on every void, so the unique index cannot stop
  // a second reversal of the same label on its own — and a label that never
  // posted a cost (a test label, or one bought before costs were booked)
  // would otherwise be "refunded" into a negative shipping expense.
  const originalKeys = shipmentLabelPostings(posting).map((entry) => entry.key);
  if (originalKeys.length === 0) return 0;
  const booked = await LedgerEntry.exists({ key: { $in: originalKeys } });
  if (!booked) return 0;
  return postLedgerEntries(shipmentLabelReversalPostings(posting));
}

/**
 * Units of the store's own goods back on the shelf — see `restockCostPostings`.
 *
 * Reads what the books still carry as this order's cost of goods, per seller,
 * and never reverses more: an order whose units were never costed, or were
 * never booked at all (an unpaid order called off), posts nothing.
 */
export async function postRestockedCost(params: {
  orderId: unknown;
  restocked: Parameters<typeof restockCostPostings>[0]["restocked"];
  /** `restock` for a cancellation, `return-<id>` for a return. */
  eventKey: string;
  date?: Date;
}): Promise<number> {
  if (params.restocked.length === 0) return 0;
  const order = await loadPostingOrder(params.orderId);
  if (!order) return 0;
  // Most stores record no cost at all; they need no ledger read.
  const costed = (order.subOrders || []).some((sub) =>
    (sub?.items || []).some((item) => Number.isFinite(Number(item?.cost))),
  );
  if (!costed) return 0;

  const standing = await LedgerEntry.aggregate<{ _id: unknown; balance: number }>([
    {
      $match: {
        "source.kind": "order",
        "source.id": new Types.ObjectId(String(order._id)),
        $or: [{ debit: "cost_of_goods" }, { credit: "cost_of_goods" }],
      },
    },
    {
      $group: {
        _id: "$vendorId",
        balance: {
          $sum: {
            $cond: [
              { $eq: ["$debit", "cost_of_goods"] },
              "$amount",
              { $multiply: ["$amount", -1] },
            ],
          },
        },
      },
    },
  ]);
  const standingByVendor = new Map(
    standing.map((row) => [row._id ? String(row._id) : "", Number(row.balance || 0)]),
  );
  if (![...standingByVendor.values()].some((balance) => balance > 0)) return 0;

  return postLedgerEntries(
    restockCostPostings({
      order,
      context: await orderContext(),
      restocked: params.restocked,
      standingByVendor,
      eventKey: params.eventKey,
      date: params.date || new Date(),
    }),
  );
}

export function postRestockedCostSafely(
  params: Parameters<typeof postRestockedCost>[0],
): void {
  void postRestockedCost(params).catch((error) => {
    console.error("Ledger: failed to take restocked units out of cost of goods", params.orderId, error);
  });
}

// ---------------------------------------------------------------------------
// Fire-and-forget wrappers — what the live paths call.

/**
 * Store credit given as goodwill, or expired unspent (R8) — see
 * `storeCreditPostings`. Any other credit row posts nothing here: a refund's
 * credit is the refund's, and a spend is the sale's.
 */
export async function postStoreCreditEvent(row: {
  _id: unknown;
  type?: string;
  source?: string;
  amount?: number;
  currency?: string;
  createdAt?: Date;
}): Promise<number> {
  const kind =
    row.type === "issue" && row.source === "goodwill"
      ? ("goodwill" as const)
      : row.type === "expire"
        ? ("expiry" as const)
        : null;
  if (!kind) return 0;
  return postLedgerEntries(
    storeCreditPostings({
      kind,
      id: row._id,
      amount: Number(row.amount || 0),
      currency: String(row.currency || ""),
      date: row.createdAt ? new Date(row.createdAt) : new Date(),
    }),
  );
}

export function postStoreCreditEventSafely(
  row: Parameters<typeof postStoreCreditEvent>[0],
): void {
  postStoreCreditEvent(row).catch((error) =>
    console.error("Failed to post a store credit event to the ledger:", error),
  );
}

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

/**
 * The cash account a refund recorded as SENT actually left from, read off
 * the method it was recorded under — or null when the words do not say.
 *
 * Mobile money and wallets are deliberately not guessed at, for the reason a
 * register's "manual" takings are not: a balance someone reconciles against a
 * statement must not receive money it never held.
 */
function cashAccountForSettlement(
  method: string | null | undefined,
): LedgerAccount | null {
  const text = ` ${String(method || "")
    .toLowerCase()
    .replace(/[_\-/]+/g, " ")} `;
  if (!text.trim()) return null;
  if (/\s(bank|transfer|wire|iban|swift|ach|neft|rtgs|cheque|check)\s/.test(text)) {
    return LEDGER_ACCOUNT.CASH_BANK;
  }
  if (/\s(cash|counter|drawer|till)\s/.test(text)) return LEDGER_ACCOUNT.CASH_ON_HAND;
  if (/\s(stripe|paypal|razorpay|paystack|pesapal|gateway|card)\s/.test(text)) {
    return LEDGER_ACCOUNT.CASH_GATEWAY;
  }
  return null;
}

/**
 * Move a hand refund to the account it was actually sent from.
 *
 * A refund is booked out of the account the ORDER's money came into — a
 * courier's cash for a cash-on-delivery order — the day it is recorded, before
 * anyone has decided how to send it. Sent by bank transfer, it drew the drawer
 * down all the same, and a drawer already banked went negative and was flagged
 * as missing cash. Recorded as sent, the amount it drew from that account is
 * put back and taken from the one the money really left. Keyed on the refund
 * and the account, so recording the same thing twice moves nothing.
 */
export async function postRefundSettlementReclass(params: {
  refundId: unknown;
  method: string;
  date?: Date;
}): Promise<number> {
  const to = cashAccountForSettlement(params.method);
  if (!to) return 0;
  const refund = await PaymentTransaction.findById(params.refundId)
    .select("orderId")
    .lean<{ _id: Types.ObjectId; orderId?: unknown } | null>();
  if (!refund?.orderId) return 0;
  const order = await loadPostingOrder(refund.orderId);
  if (!order) return 0;
  const from = cashAccountFor(order);
  if (from === to) return 0;

  const entries = await LedgerEntry.find({
    "source.kind": LEDGER_SOURCE_KIND.REFUND,
    "source.id": refund._id,
    $or: [{ debit: from }, { credit: from }],
  })
    .select("book currency debit credit amount")
    .lean<
      Array<{ book: string; currency: string; debit: string; credit: string; amount: number }>
    >();
  // What the refund drew from that account, per book and currency.
  const drawn = new Map<string, { book: string; currency: string; amount: number }>();
  for (const entry of entries) {
    const key = `${entry.book}:${entry.currency}`;
    const current = drawn.get(key) ?? { book: entry.book, currency: entry.currency, amount: 0 };
    current.amount += entry.credit === from ? entry.amount : -entry.amount;
    drawn.set(key, current);
  }

  return postLedgerEntries(
    [...drawn.values()]
      .filter((share) => share.amount > 0.000001)
      .map((share) => ({
        date: params.date || new Date(),
        book: share.book as never,
        // Back into the account the refund was booked out of, and out of the
        // one it really left.
        debit: from,
        credit: to,
        amount: share.amount,
        currency: share.currency,
        source: {
          kind: LEDGER_SOURCE_KIND.REFUND,
          id: refund._id,
          ref: order.orderNumber ?? null,
        },
        key: postingKey(LEDGER_SOURCE_KIND.REFUND, refund._id, "sent-from", to, share.book, share.currency),
        note: `Refund sent by ${params.method}`,
      })),
  );
}

export function postRefundSettlementReclassSafely(
  params: Parameters<typeof postRefundSettlementReclass>[0],
): void {
  void postRefundSettlementReclass(params).catch((error) => {
    console.error("Ledger: failed to move a refund to where it was sent from", params.refundId, error);
  });
}

export function postRefundReversalSafely(
  params: Parameters<typeof postRefundReversal>[0],
): void {
  void postRefundReversal(params).catch((error) => {
    console.error("Ledger: failed to reverse refund", params.orderId, error);
  });
}

export function postBalanceWriteOffSafely(orderId: unknown): void {
  void postBalanceWriteOff(orderId).catch((error) => {
    console.error("Ledger: failed to write off a pre-order balance", orderId, error);
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

export function postPlatformPaymentRefundSafely(
  payment: Parameters<typeof postPlatformPaymentRefund>[0],
): void {
  void postPlatformPaymentRefund(payment).catch((error) => {
    console.error(
      "Ledger: failed to post a platform payment refund",
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
  // An adjustment is a new id, so nothing it writes can be a duplicate: zero
  // rows means the entry was refused, and the admin must not be told it was
  // posted — or have an audit record claim so.
  const written = await postLedgerEntries(entries);
  if (written === 0) {
    throw new Error("The adjustment could not be written to the ledger");
  }
  return written;
}
