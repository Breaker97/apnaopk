/**
 * The posting rules: one money event in, balanced ledger entries out.
 *
 * Pure functions, deliberately. They take already-loaded documents and return
 * entries; they read no database and write nothing. That is what makes the
 * whole accounting engine testable without a database, and what lets the
 * backfill replay history through exactly the code the live paths use — if the
 * two could drift, a reconciliation would be comparing a system against itself.
 *
 * Every rule obeys the agent/principal split (see lib/finance/accounts.ts):
 * on a marketplace sale only the commission is income and the vendor's share is
 * a liability, while the admin-owned store books full revenue and cost of
 * goods. `book` is decided per SUB-ORDER, because one order can contain both.
 */

import { Types } from "mongoose";
import { isPlatformSettled } from "@/lib/payments/payment-custody";
import { quantizeToCurrency } from "@/lib/intl/money";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import { feeInChargeCurrency } from "@/lib/payments/gateway-fee";
import {
  LEDGER_ACCOUNT,
  LEDGER_BOOK,
  type LedgerAccount,
  type LedgerBook,
} from "@/lib/finance/accounts";
import { postingKey, type LedgerPosting } from "@/lib/finance/ledger";
import { LEDGER_SOURCE_KIND } from "@/models/ledger-entry.model";

interface PostingOrderItem {
  cost?: number | null;
  quantity?: number | null;
}

export interface PostingSubOrder {
  vendorId?: unknown;
  subtotal?: number | null;
  commission?: number | null;
  vendorEarnings?: number | null;
  shippingCost?: number | null;
  items?: PostingOrderItem[] | null;
  /**
   * Who collected the cash on delivery, stamped at checkout.
   *
   * Custody on a COD sale is not a property of the payment method — it is a
   * property of who handed the goods over, and one order can be split between a
   * vendor's own van and the platform's courier. So it is read per consignment,
   * exactly as the payout query reads it.
   */
  codCollectedBy?: string | null;
  fulfillment?: { method?: string } | null;
  /**
   * Whether THIS consignment's money has arrived — see
   * `lib/order-payment-status.ts`. On a split cash order one vendor can be
   * collected while another is still out for delivery, and posting the whole
   * order on the first collection books money nobody has handed over.
   */
  paymentStatus?: string | null;
}

export interface PostingOrder {
  _id: unknown;
  orderNumber?: string | null;
  currency?: string | null;
  /**
   * True when `currency` was filled in from the store default because the order
   * itself carried none — which is the case for every order written before the
   * currency snapshot existed.
   *
   * The alternative was to skip those orders, and on a real store that meant
   * three quarters of all history missing from the accounts. Assuming the
   * store's own currency is right for the overwhelmingly common single-currency
   * install; a store that HAS changed currency needs to know which figures rest
   * on the assumption, so it is stamped on every entry rather than inferred.
   */
  currencyAssumed?: boolean;
  total?: number | null;
  tax?: number | null;
  /**
   * What shipping was rated at, BEFORE any discount — which is what the order
   * stores, while `total` is charged after it. A free-shipping coupon is the
   * gap between the two, and taking this figure at face value made the buyer's
   * free delivery come out of the merchandise the vendor is owed for.
   */
  shippingCost?: number | null;
  /** Order-level discount, in `currency`. Read only to size the shipping half. */
  discount?: number | null;
  coupon?: { type?: string | null } | null;
  /**
   * Import duty added to `total` after the totals were computed, so it is in
   * neither the tax nor the shipping figure and has to be taken out of
   * merchandise explicitly.
   */
  customs?: { dutyAmount?: number | null } | null;
  paidAt?: Date | null;
  createdAt?: Date | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  /** The part of `total` a deposit-mode pre-order has not collected yet. */
  preorderOutstandingAmount?: number | null;
  channel?: string | null;
  stripePaymentIntentId?: string | null;
  paymentFee?: number | null;
  paymentFeeCurrency?: string | null;
  paymentFeeRate?: number | null;
  subOrders?: PostingSubOrder[] | null;
}

export interface OrderPostingContext {
  /** Vendor ids that are the admin-owned store — their sales are the own book. */
  defaultVendorIds: Set<string>;
}

/** Merchandise, shipping, tax, duty — the four a refund is split into. */
const PARTS = 4;

const money = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Stamped on every entry of an order whose currency had to be assumed. */
const ASSUMED_CURRENCY_NOTE =
  "Currency assumed from the store default — the order carried none";

const assumedNote = (order: { currencyAssumed?: boolean }) =>
  order.currencyAssumed ? ASSUMED_CURRENCY_NOTE : null;

/**
 * Which cash account this order's money landed in.
 *
 * A register's drawer is the store's own, not a gateway balance — and neither
 * is cash a courier took at the door. COD used to fall through to
 * `cash_gateway`, which claimed a gateway had processed money no gateway ever
 * saw; the notes are physical either way, so they belong in the same account
 * the POS drawer uses.
 */
function cashAccountFor(order: {
  channel?: string | null;
  paymentMethod?: string | null;
}) {
  return String(order.channel || "").toLowerCase() === "pos" ||
    String(order.paymentMethod || "").toLowerCase() === "cod"
    ? LEDGER_ACCOUNT.CASH_ON_HAND
    : LEDGER_ACCOUNT.CASH_GATEWAY;
}

/**
 * Split `amount` across `weights` so the parts sum EXACTLY back to it.
 *
 * The BIGGEST share absorbs the rounding remainder. Without an absorber at all,
 * an order whose discount does not divide evenly leaves a cent unposted, the
 * trial balance stops being zero, and the alarm that is supposed to catch real
 * bugs fires on arithmetic instead. Making it the biggest rather than the last
 * matters once the weights are heterogeneous: a refund is allocated across
 * merchandise, shipping, tax and duty, and a store that charges no duty would
 * otherwise get a one-cent customs liability out of a rounding remainder
 * landing on a zero-weight part.
 */
export function allocate(
  amount: number,
  weights: number[],
  currency: string,
): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (weights.length === 0) return [];
  if (totalWeight <= 0) {
    // Nothing to weight by: give it all to the first share rather than
    // dropping it, so the money stays accounted for.
    return weights.map((_, index) => (index === 0 ? amount : 0));
  }

  const shares = weights.map((weight) =>
    quantizeToCurrency((amount * Math.max(0, weight)) / totalWeight, currency),
  );
  const assigned = shares.reduce((sum, share) => sum + share, 0);
  const remainder = quantizeToCurrency(amount - assigned, currency);
  if (remainder !== 0) {
    let absorber = 0;
    for (let index = 1; index < weights.length; index += 1) {
      if (Math.max(0, weights[index]!) > Math.max(0, weights[absorber]!)) {
        absorber = index;
      }
    }
    shares[absorber] = quantizeToCurrency(shares[absorber]! + remainder, currency);
  }
  return shares;
}

/** One consignment's slice of what the buyer paid. */
interface OrderShare {
  /** Goods, after every discount — the part that is split with a vendor. */
  merchandise: number;
  /** Delivery actually charged, after a free-shipping coupon. */
  shipping: number;
  tax: number;
  duty: number;
  /** This consignment's slice of a balance the shopper has not paid yet. */
  outstanding: number;
}

interface OrderDecomposition {
  currency: string;
  total: number;
  shares: OrderShare[];
  /**
   * Whether the balance in `outstanding` is still owed.
   *
   * The deposit terms stay on the order after the balance is collected —
   * nothing clears `preorderOutstandingAmount`, and it should not be cleared,
   * because it is the record of what was agreed. So "is there a balance" and
   * "is it still owed" are two questions, and the second is the order's payment
   * state. Without the split, a receivable posted at deposit time could never
   * be taken off again.
   */
  balanceStillOwed: boolean;
}

/**
 * `order.total` broken into the four things it is made of — goods, delivery,
 * tax and duty — per consignment, plus how much of it is still to be collected.
 *
 * ONE decomposition, used by the sale and by the refund, and that is the whole
 * point of it existing. The two used to compute their shares differently — the
 * sale from `total − tax − shipping`, the refund from the sub-order's face
 * value — so refunding a discounted order paid out more cash than the sale ever
 * brought in, and every entry still balanced individually. A refund can only be
 * the mirror of a sale if it is reading the same numbers.
 *
 * Two figures are not where they look:
 *
 * **Shipping** is stored on the order BEFORE a free-shipping coupon, while
 * `total` is charged after it. Taking `order.shippingCost` at face value
 * credited delivery the buyer never paid for and took it out of the vendor's
 * merchandise.
 *
 * **Duty** is added to `total` after the totals are computed, so it is inside
 * neither tax nor shipping. Left in merchandise it became a vendor's earnings
 * and the platform's commission — on a customs bill.
 *
 * Every part is allocated so the shares sum EXACTLY back to `total`: cash in
 * has to equal what was charged, whatever the rounding.
 */
export function decomposeOrder(order: PostingOrder): OrderDecomposition | null {
  const currency = String(order.currency || "").toUpperCase();
  const total = money(order.total);
  const subOrders = (order.subOrders || []).filter(Boolean);
  if (!currency || total <= 0 || subOrders.length === 0) return null;

  const q = (value: number) => quantizeToCurrency(value, currency);
  const tax = q(money(order.tax));
  const duty = q(Math.max(0, money(order.customs?.dutyAmount)));
  const ratedShipping = q(Math.max(0, money(order.shippingCost)));
  // A free-shipping coupon discounts delivery and nothing else, so the whole
  // order-level discount is the shipping half of it. Any other coupon reduces
  // the goods, which `total` already reflects and merchandise inherits below.
  const shippingDiscount = isFreeShippingCouponType(order.coupon?.type)
    ? Math.min(ratedShipping, Math.max(0, money(order.discount)))
    : 0;
  const shipping = q(ratedShipping - shippingDiscount);
  const merchandise = q(total - tax - shipping - duty);

  // A deposit-mode pre-order is a completed sale with some of the money still
  // to come. The terms stay on the order for good — they are the record of what
  // was agreed — so whether the balance is still OWED is the order's payment
  // state, not the presence of the figure.
  //
  // Only a deposit pre-order is part-paid at the ORDER level. A split cash order
  // is part-paid because one consignment is still out for delivery, which is
  // answered per sub-order by `isConsignmentCollected` rather than by a balance.
  const outstanding = q(
    Math.min(
      Math.max(0, money(order.preorderOutstandingAmount)),
      Math.max(0, total),
    ),
  );
  const balanceStillOwed =
    String(order.paymentStatus || "").trim().toLowerCase() === "partially_paid";

  const merchandiseWeights = subOrders.map((sub) =>
    Math.max(0, money(sub.subtotal)),
  );
  const merchandiseShares = allocate(merchandise, merchandiseWeights, currency);
  const shippingShares = allocate(
    shipping,
    subOrders.map((sub) => Math.max(0, money(sub.shippingCost))),
    currency,
  );
  const taxShares = allocate(tax, merchandiseWeights, currency);
  const dutyShares = allocate(duty, merchandiseWeights, currency);
  const outstandingShares = allocate(outstanding, merchandiseWeights, currency);

  return {
    currency,
    total,
    balanceStillOwed,
    shares: subOrders.map((_, index) => ({
      merchandise: merchandiseShares[index] ?? 0,
      shipping: shippingShares[index] ?? 0,
      tax: taxShares[index] ?? 0,
      duty: dutyShares[index] ?? 0,
      outstanding: outstandingShares[index] ?? 0,
    })),
  };
}

/** Payment states that mean this consignment's money has NOT arrived. */
const UNCOLLECTED_PAYMENT_STATUSES = new Set(["pending", "partially_paid"]);

/**
 * Has this consignment's money arrived?
 *
 * Asked per sub-order because collection is: on a split cash order one vendor
 * hands their parcel over while another is still out, and the order-level flag
 * sits at `partially_paid` for both. Posting the whole order on the first
 * collection books cash nobody has handed over; posting nothing until the last
 * one leaves a payout with no sale behind it.
 *
 * The deposit case is the exception that has to be named: there the ORDER is
 * part-paid, money arrived for every consignment, and the balance is a
 * receivable rather than an uncollected parcel.
 *
 * An order with no payment state at all — every order written before this, and
 * every order the backfill replays — reads as collected, which is exactly what
 * it did before.
 */
export function isConsignmentCollected(
  order: PostingOrder,
  sub: PostingSubOrder,
): boolean {
  const own = String(sub.paymentStatus || "").trim().toLowerCase();
  if (own) return !UNCOLLECTED_PAYMENT_STATUSES.has(own);

  const orderStatus = String(order.paymentStatus || "").trim().toLowerCase();
  if (orderStatus !== "partially_paid") return true;
  return money(order.preorderOutstandingAmount) > 0;
}

/**
 * A paid order, as entries.
 *
 * The cash side is what was actually collected and the income side is built to
 * match it exactly, both from the one decomposition in `decomposeOrder` — see
 * there for why sub-order face values cannot be used and where duty and a
 * free-shipping coupon hide.
 *
 * Custody decides WHICH cash account, and on a marketplace sale it decides
 * whether there is a cash entry at all: when the vendor collected the money
 * themselves, the platform's only claim is the commission, and it is a
 * receivable rather than cash in hand.
 *
 * Safe to call again as more of the order is collected. Every entry is keyed by
 * consignment, so a second call after the next vendor hands their parcel over
 * writes that consignment's entries and collides harmlessly with the rest.
 */
export function orderPaidPostings(
  order: PostingOrder,
  context: OrderPostingContext,
): LedgerPosting[] {
  const decomposition = decomposeOrder(order);
  if (!decomposition) return [];
  const { currency } = decomposition;

  const date = order.paidAt || order.createdAt || new Date();
  const subOrders = (order.subOrders || []).filter(Boolean);

  const custody = {
    paymentMethod: order.paymentMethod,
    channel: order.channel,
    stripePaymentIntentId: order.stripePaymentIntentId,
  };
  const cashAccount = cashAccountFor(order);

  const source = {
    kind: LEDGER_SOURCE_KIND.ORDER,
    id: order._id as Types.ObjectId,
    ref: order.orderNumber ?? null,
  };
  const entries: LedgerPosting[] = [];
  const posted: boolean[] = [];

  subOrders.forEach((sub, index) => {
    // Nothing has arrived for this consignment yet. Its entries are written by
    // the call that follows its collection, under these same keys.
    if (!isConsignmentCollected(order, sub)) {
      posted.push(false);
      return;
    }
    posted.push(true);

    const vendorId = sub.vendorId ? String(sub.vendorId) : "";
    const isOwn = context.defaultVendorIds.has(vendorId);
    const book: LedgerBook = isOwn ? LEDGER_BOOK.OWN : LEDGER_BOOK.MARKETPLACE;
    const share = decomposition.shares[index]!;
    const merchandiseShare = share.merchandise;
    const shippingShare = share.shipping;
    const taxShare = share.tax;
    // Asked per consignment, not once per order: on a COD sale the answer is
    // whoever handed the goods over, and a split order can have the platform's
    // courier on one line and the vendor's own van on another.
    //
    // The own-store arm is not the custody rule at all — that rule answers "did
    // the money reach the platform rather than a vendor", and on the store's own
    // sale there is no vendor for it to have reached. The shopkeeper who takes
    // the notes IS the platform. Without this arm a single-vendor store's cash
    // sale booked its revenue but neither the tax it owes onward nor the
    // shipping it charged, so the cash posted came to less than was collected.
    const platformHoldsCash = isOwn || isPlatformSettled(custody, sub);
    const line = (part: string) =>
      postingKey(LEDGER_SOURCE_KIND.ORDER, order._id, part, vendorId || index);

    if (isOwn) {
      // The store IS the seller: the whole merchandise share is revenue.
      entries.push({
        date,
        book,
        debit: cashAccount,
        credit: LEDGER_ACCOUNT.PRODUCT_REVENUE,
        amount: merchandiseShare,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(order),
        key: line("revenue"),
      });

      // Cost of goods, only where a cost was actually snapshotted. A line
      // without one contributes nothing rather than zero — the margin for that
      // line is unknown, and posting 0 would assert it was pure profit.
      const cogs = (sub.items || []).reduce((sum, item) => {
        const cost = Number(item?.cost);
        if (!Number.isFinite(cost) || cost < 0) return sum;
        return sum + cost * Math.max(0, money(item?.quantity) || 1);
      }, 0);
      if (cogs > 0) {
        entries.push({
          date,
          book,
          debit: LEDGER_ACCOUNT.COST_OF_GOODS,
          credit: LEDGER_ACCOUNT.INVENTORY,
          amount: quantizeToCurrency(cogs, currency),
          currency,
          source,
          vendorId: sub.vendorId as Types.ObjectId,
          note: assumedNote(order),
          key: line("cogs"),
        });
      }
    } else {
      // Marketplace sale: split the merchandise share into the platform's cut
      // and the vendor's, in the proportion the sub-order itself recorded, so
      // the ledger agrees with what the payout will pay.
      const subtotal = money(sub.subtotal);
      const commissionRatio =
        subtotal > 0 ? money(sub.commission) / subtotal : 0;
      const commission = quantizeToCurrency(
        merchandiseShare * commissionRatio,
        currency,
      );
      const vendorShare = quantizeToCurrency(
        merchandiseShare - commission,
        currency,
      );

      if (platformHoldsCash) {
        if (commission > 0) {
          entries.push({
            date,
            book,
            debit: cashAccount,
            credit: LEDGER_ACCOUNT.COMMISSION_INCOME,
            amount: commission,
            currency,
            source,
            vendorId: sub.vendorId as Types.ObjectId,
            key: line("commission"),
          });
        }
        if (vendorShare > 0) {
          entries.push({
            date,
            book,
            debit: cashAccount,
            credit: LEDGER_ACCOUNT.VENDOR_PAYABLE,
            amount: vendorShare,
            currency,
            source,
            vendorId: sub.vendorId as Types.ObjectId,
            key: line("payable"),
          });
        }
      } else if (commission > 0) {
        // The vendor took the money. No cash reached the platform, so the only
        // entry is the claim on them — which is precisely the figure the
        // Receivables screen exists to collect.
        entries.push({
          date,
          book,
          debit: LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
          credit: LEDGER_ACCOUNT.COMMISSION_INCOME,
          amount: commission,
          currency,
          source,
          vendorId: sub.vendorId as Types.ObjectId,
          note: assumedNote(order),
          key: line("commission-receivable"),
        });
      }
    }

    // Shipping is the platform's income in both books — `vendorEarnings` is
    // subtotal minus commission with no shipping in it, which is the business
    // decision already encoded in the payout maths.
    if (shippingShare > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: cashAccount,
        credit: LEDGER_ACCOUNT.SHIPPING_INCOME,
        amount: shippingShare,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(order),
        key: line("shipping"),
      });
    }

    if (taxShare > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: cashAccount,
        credit: LEDGER_ACCOUNT.TAX_PAYABLE,
        amount: taxShare,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(order),
        key: line("tax"),
      });
    }

    // Duty is collected on behalf of the customs authority, exactly as tax is
    // collected on behalf of the state. It is owed onward, so it is a liability
    // and never anybody's income — least of all the vendor's, which is where it
    // used to land by virtue of being inside merchandise.
    if (share.duty > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: cashAccount,
        credit: LEDGER_ACCOUNT.DUTY_PAYABLE,
        amount: share.duty,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(order),
        key: line("duty"),
      });
    }

    // The sale above posted the WHOLE consignment against cash. On a
    // deposit-mode pre-order only part of that has been handed over, so the
    // balance is moved out of cash and into what the shopper still owes. The
    // sale stays whole — which is what the payout engine already assumes, since
    // it pays out on a part-paid order — and the cash account is left holding
    // exactly the deposit.
    //
    // Posted whenever the order carries deposit terms, not only while the
    // balance is outstanding, because the pair below has to be able to cancel
    // it. Keys are per consignment and idempotent, so on an order that was
    // already settled both land in the same call and net to nothing.
    if (share.outstanding > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE,
        credit: cashAccount,
        amount: share.outstanding,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: "Balance not collected yet",
        key: line("outstanding"),
      });

      // And the balance arrived. Without this the receivable raised at deposit
      // time had no way off the books: the entry above keeps its key, so a
      // later re-post collides with it and the shopper goes on owing money they
      // have paid. What decides it is the order's payment state, since the
      // deposit terms themselves never change.
      if (!decomposition.balanceStillOwed) {
        entries.push({
          date,
          book,
          debit: cashAccount,
          credit: LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE,
          amount: share.outstanding,
          currency,
          source,
          vendorId: sub.vendorId as Types.ObjectId,
          note: "Balance collected",
          key: line("outstanding-collected"),
        });
      }
    }
  });

  // The gateway's cut, where it was reported and can be stated in this
  // currency. An unconvertible foreign fee is left out rather than guessed —
  // the same rule the charge transaction follows.
  const fee = feeInChargeCurrency({
    fee: order.paymentFee,
    feeCurrency: order.paymentFeeCurrency,
    chargeCurrency: currency,
    rate: order.paymentFeeRate,
  });
  // A gateway kept a cut of money that reached someone's account: either the
  // platform's, or the store's own on its own sale. Only over the consignments
  // that actually posted — a fee cannot have been charged on money that has not
  // been collected, and the entry would otherwise land before its own sale.
  const anyPlatformCash = subOrders.some(
    (sub, index) =>
      posted[index] &&
      (context.defaultVendorIds.has(sub.vendorId ? String(sub.vendorId) : "") ||
        isPlatformSettled(custody, sub)),
  );
  if (fee && fee > 0 && anyPlatformCash) {
    const anyOwn = subOrders.some(
      (sub, index) =>
        posted[index] &&
        context.defaultVendorIds.has(sub.vendorId ? String(sub.vendorId) : ""),
    );
    entries.push({
      date,
      book: anyOwn ? LEDGER_BOOK.OWN : LEDGER_BOOK.MARKETPLACE,
      debit: LEDGER_ACCOUNT.PROCESSING_FEES,
      credit: cashAccount,
      amount: quantizeToCurrency(fee, currency),
      currency,
      source,
      key: postingKey(LEDGER_SOURCE_KIND.ORDER, order._id, "processing-fee"),
      note:
        order.paymentFeeCurrency &&
        order.paymentFeeCurrency.toUpperCase() !== currency
          ? `Converted from ${order.paymentFee} ${order.paymentFeeCurrency}`
          : null,
    });
  }

  return entries;
}

/**
 * A refund, as entries.
 *
 * Built from the SAME decomposition the sale was — see `decomposeOrder`. It
 * used to take the sub-order's face value instead, which meant a refund handed
 * back merchandise the buyer never paid for on any discounted order: goods of
 * 100 sold under a 10-off coupon took 90 in and gave 100 back, and because each
 * entry balances on its own the trial balance stayed at zero while the vendor's
 * payable went negative.
 *
 * Each part reverses where it came from, and only there:
 *
 *  - merchandise reverses as contra-income for the platform's cut and reduces
 *    the vendor's payable for theirs, so a refunded marketplace order does not
 *    leave the vendor holding money the platform has already handed back;
 *  - shipping reverses SHIPPING INCOME. It used to be lumped into merchandise
 *    and clawed out of the vendor's payable, which charged a vendor for
 *    delivery revenue they never received and left shipping income standing at
 *    full value on an order that was refunded in whole;
 *  - tax and duty reverse their liabilities, because that money was never the
 *    store's to keep.
 */
/** One consignment's slice of a refund, as the refund record stored it. */
export interface RefundAllocationInput {
  vendorId?: unknown;
  merchandise?: number | null;
  shipping?: number | null;
  tax?: number | null;
  duty?: number | null;
  /** Commission the platform kept as a refund administration fee. */
  commissionRetained?: number | null;
}

/**
 * Turn a stored allocation into the flat `backs` array the rules below index,
 * or null if it cannot be trusted — in which case the caller falls back to
 * prorating over the order.
 *
 * Three ways it earns that trust, and all three have to hold:
 *
 *  - every consignment it names is ON this order. A slice addressed to a
 *    vendor who is not here is money that would silently never be posted;
 *  - no part exceeds what the SALE posted for that part. A refund cannot
 *    reverse tax that was never collected or goods that were never sold, and
 *    an allocation claiming otherwise is corrupt rather than merely rounded;
 *  - the parts add up to the refund. A cent or two of drift is rounding and is
 *    absorbed below; more than that means this allocation belongs to a
 *    different amount, and posting it would move money the gateway did not.
 *
 * Rejecting outright rather than repairing is deliberate. The proportional
 * fallback is wrong in a known, uniform way; a half-trusted allocation is
 * wrong in a way nobody can predict or reconcile.
 */
function backsFromAllocation(params: {
  allocation: RefundAllocationInput[] | null | undefined;
  subOrders: PostingSubOrder[];
  /** What is LEFT to reverse, flat per consignment then part. */
  remaining: number[];
  amount: number;
  currency: string;
}): number[] | null {
  const { allocation, subOrders, remaining, amount, currency } = params;
  if (!allocation || allocation.length === 0) return null;

  const onOrder = new Set(
    subOrders.map((sub) => (sub.vendorId ? String(sub.vendorId) : "")),
  );
  const byVendor = new Map<string, RefundAllocationInput>();
  for (const row of allocation) {
    const vendorId = row?.vendorId ? String(row.vendorId) : "";
    if (!onOrder.has(vendorId)) return null;
    byVendor.set(vendorId, row);
  }

  const backs: number[] = [];
  let total = 0;
  let biggest = -1;

  for (const [index, sub] of subOrders.entries()) {
    const row = byVendor.get(sub.vendorId ? String(sub.vendorId) : "");
    const parts = [row?.merchandise, row?.shipping, row?.tax, row?.duty];

    for (let part = 0; part < PARTS; part += 1) {
      const raw = money(parts[part]);
      if (raw < 0) return null;
      // Capped against what is LEFT, not against the whole sale. An earlier
      // refund may already have reversed some of this part, and reversing it
      // twice is how a vendor ends up charged more than their share was worth.
      // Half a cent of slack, so a legitimately exact allocation is not
      // rejected by the sale's own rounding.
      if (raw > (remaining[index * PARTS + part] ?? 0) + 0.005) return null;
      const value = quantizeToCurrency(raw, currency);
      if (biggest < 0 || value > backs[biggest]!) biggest = backs.length;
      backs.push(value);
      total += value;
    }
  }

  const drift = quantizeToCurrency(amount - total, currency);
  if (Math.abs(drift) > 0.02) return null;
  if (drift !== 0 && biggest >= 0) {
    backs[biggest] = quantizeToCurrency(backs[biggest]! + drift, currency);
  }
  return backs;
}

/**
 * What one refund reverses, flat per consignment then part.
 *
 * The one rule, used three times: by the postings below, by the fold that works
 * out what earlier refunds already took, and by `resolveRefundAllocation` when
 * a refund is written. A second implementation of it would drift the moment
 * either was touched.
 *
 * `alreadyReversed` is what previous refunds on this order have taken out of
 * each part. A refund is prorated over what is LEFT rather than over the whole
 * sale, and that distinction is the whole point: refunding the goods in full
 * and then the delivery separately used to reverse a slice of the goods a
 * second time, because the second refund still divided by the original total.
 *
 * With every refund on an order prorated — which is every refund written
 * before allocations existed — the remainder stays proportional to the
 * original, so prorating over it gives the identical answer. History does not
 * move.
 */
export function refundBacks(params: {
  decomposition: OrderDecomposition;
  subOrders: PostingSubOrder[];
  amount: number;
  allocation?: RefundAllocationInput[] | null;
  alreadyReversed?: readonly number[] | null;
}): number[] {
  const { decomposition, subOrders, amount } = params;
  const currency = decomposition.currency;
  const taken = params.alreadyReversed;

  const remaining = decomposition.shares.flatMap((share, index) =>
    [share.merchandise, share.shipping, share.tax, share.duty].map(
      (value, part) =>
        Math.max(
          0,
          quantizeToCurrency(
            value - money(taken?.[index * PARTS + part]),
            currency,
          ),
        ),
    ),
  );

  return (
    backsFromAllocation({
      allocation: params.allocation,
      subOrders,
      remaining,
      amount,
      currency,
    }) ?? allocate(amount, remaining, currency)
  );
}

/**
 * What a run of refunds has reversed between them, in order.
 *
 * Folded rather than summed, because each one is measured against what the
 * ones before it left behind. Callers pass refunds oldest first — the order
 * they were written, which is the order a rebuild replays them in.
 */
export function accumulateRefundBacks(params: {
  decomposition: OrderDecomposition;
  subOrders: PostingSubOrder[];
  refunds: ReadonlyArray<{
    amount: number;
    allocation?: RefundAllocationInput[] | null;
  }>;
}): number[] {
  const total = new Array<number>(params.subOrders.length * PARTS).fill(0);

  for (const refund of params.refunds) {
    const amount = money(refund.amount);
    if (amount <= 0) continue;
    const backs = refundBacks({
      decomposition: params.decomposition,
      subOrders: params.subOrders,
      amount,
      allocation: refund.allocation,
      alreadyReversed: total,
    });
    for (let index = 0; index < total.length; index += 1) {
      total[index] = (total[index] ?? 0) + (backs[index] ?? 0);
    }
  }

  return total;
}

export function refundPostings(params: {
  order: PostingOrder;
  amount: number;
  refundId?: unknown;
  date?: Date;
  context: OrderPostingContext;
  /**
   * What earlier refunds on this order already reversed, flat per consignment
   * then part. Absent means this is the only refund, or the caller does not
   * know — either way it prorates over the whole sale, as it always did.
   */
  alreadyReversed?: readonly number[] | null;
  /**
   * What the refund was made of, per consignment, as the refund record stored
   * it. Absent on every refund written before allocations existed and on
   * order-level refunds that have no item context — those still prorate.
   */
  allocation?: RefundAllocationInput[] | null;
}): LedgerPosting[] {
  const decomposition = decomposeOrder(params.order);
  if (!decomposition) return [];
  const { currency, total } = decomposition;
  // Never more than the order: a refund larger than what was charged would
  // reverse parts that were never posted.
  const amount = Math.min(
    quantizeToCurrency(money(params.amount), currency),
    total,
  );
  if (amount <= 0) return [];

  const date = params.date || new Date();
  const subOrders = (params.order.subOrders || []).filter(Boolean);
  const source = {
    kind: LEDGER_SOURCE_KIND.REFUND,
    id: (params.refundId ?? params.order._id) as Types.ObjectId,
    ref: params.order.orderNumber ?? null,
  };
  const custody = {
    paymentMethod: params.order.paymentMethod,
    channel: params.order.channel,
    stripePaymentIntentId: params.order.stripePaymentIntentId,
  };
  const cashAccount = cashAccountFor(params.order);

  const entries: LedgerPosting[] = [];
  const keyBase = String(params.refundId ?? `${String(params.order._id)}-${amount}`);
  /** What fraction of the sale is being unwound. */
  const ratio = total > 0 ? amount / total : 0;

  // What the refund was actually made of, when the refund knows. A return is
  // scoped to particular items, so its composition is a FACT the return record
  // already holds — see lib/refund-allocation.ts.
  //
  // Failing that, the old rule: prorate the refund across the whole order.
  // Allocated across every part of every consignment at once rather than each
  // scaled by `ratio` on its own, so the pieces sum EXACTLY to the refund. Four
  // independently rounded parts drift by a cent or two, and the cash posted out
  // then disagrees with the money that actually left — the one thing a
  // per-entry-balanced ledger cannot detect on its own.
  //
  // The fallback is kept for order-level refunds, which have no item context,
  // and for every refund written before allocations existed — so a replay of
  // history reproduces exactly the entries it originally posted.
  // What the platform held back out of its own commission, per consignment.
  // Read straight off the allocation rather than recomputed, so the ledger and
  // the payout engine hold back the identical figure.
  const retainedByVendor = new Map<string, number>();
  for (const row of params.allocation || []) {
    const key = row?.vendorId ? String(row.vendorId) : "";
    retainedByVendor.set(key, Math.max(0, money(row?.commissionRetained)));
  }

  const backs = refundBacks({
    decomposition,
    subOrders,
    amount,
    allocation: params.allocation,
    alreadyReversed: params.alreadyReversed,
  });

  subOrders.forEach((sub, index) => {
    // A consignment whose money never arrived posted no sale, so there is
    // nothing of its to reverse.
    if (!isConsignmentCollected(params.order, sub)) return;

    const vendorId = sub.vendorId ? String(sub.vendorId) : "";
    const isOwn = params.context.defaultVendorIds.has(vendorId);
    const book: LedgerBook = isOwn ? LEDGER_BOOK.OWN : LEDGER_BOOK.MARKETPLACE;
    const share = decomposition.shares[index]!;
    const merchandiseBack = backs[index * PARTS] ?? 0;
    const shippingBack = backs[index * PARTS + 1] ?? 0;
    const taxBack = backs[index * PARTS + 2] ?? 0;
    const dutyBack = backs[index * PARTS + 3] ?? 0;
    const line = (part: string) =>
      postingKey(LEDGER_SOURCE_KIND.REFUND, keyBase, part, vendorId || index);
    // Per consignment, for the same reason the sale is — and it has to agree
    // with the sale, or a refund would hand back money down a path the original
    // never took. Including the own-store arm: the store refunds its own cash
    // sale out of its own drawer, tax included.
    const platformHoldsCash = isOwn || isPlatformSettled(custody, sub);

    if (taxBack > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.TAX_PAYABLE,
        credit: cashAccount,
        amount: taxBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(params.order),
        key: line("tax-back"),
      });
    }

    if (dutyBack > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.DUTY_PAYABLE,
        credit: cashAccount,
        amount: dutyBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(params.order),
        key: line("duty-back"),
      });
    }

    // Unwinding a part-paid sale unwinds the part that was never collected
    // along with it: the shopper no longer owes a balance on an order that has
    // been handed back. Without this, refunding a deposit pre-order in full
    // took the WHOLE total out of cash — including the sixty the store never
    // received — and left the receivable standing against nothing.
    //
    // Proportional, like every other part here. A partial refund is modelled as
    // unwinding that fraction of the whole sale, which is the only reading
    // consistent with the sale having posted in full.
    //
    // Only while the balance is still owed. Once it has been collected the
    // receivable is already off the books, and crediting it again would leave
    // the shopper owed money by a store they bought from.
    const outstandingBack = decomposition.balanceStillOwed
      ? quantizeToCurrency(share.outstanding * ratio, currency)
      : 0;
    if (outstandingBack > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: cashAccount,
        credit: LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE,
        amount: outstandingBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: "Balance no longer owed",
        key: line("outstanding-back"),
      });
    }

    // Delivery the platform charged for and is now handing back. Against
    // shipping income, so the shipping margin the overview reports stays the
    // difference between what was kept and what a carrier cost.
    if (shippingBack > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.SHIPPING_INCOME,
        credit: cashAccount,
        amount: shippingBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(params.order),
        key: line("shipping-back"),
      });
    }

    if (merchandiseBack <= 0) return;

    if (isOwn) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.REFUNDS,
        credit: cashAccount,
        amount: merchandiseBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(params.order),
        key: line("refund"),
      });
      return;
    }

    // The same split the sale used, applied to the same merchandise figure.
    const subtotal = money(sub.subtotal);
    const commissionRatio = subtotal > 0 ? money(sub.commission) / subtotal : 0;
    // Less whatever the platform kept as a refund administration fee. Held
    // back rather than reversed, so it stays as commission income and the
    // vendor's payable absorbs it — the shopper is refunded the same either
    // way. Zero or absent means the whole cut comes back, which is what every
    // refund did before the fee existed.
    const retained = Math.min(
      Math.max(0, money(retainedByVendor.get(vendorId))),
      merchandiseBack * commissionRatio,
    );
    const commissionBack = quantizeToCurrency(
      merchandiseBack * commissionRatio - retained,
      currency,
    );
    const vendorBack = quantizeToCurrency(
      merchandiseBack - commissionBack,
      currency,
    );

    if (commissionBack > 0) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.REFUNDS,
        credit: platformHoldsCash
          ? cashAccount
          : LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
        amount: commissionBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(params.order),
        key: line("commission-back"),
      });
    }
    if (vendorBack > 0 && platformHoldsCash) {
      // The vendor's share never became the platform's income, so handing it
      // back reduces what they are owed rather than the platform's revenue.
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.VENDOR_PAYABLE,
        credit: cashAccount,
        amount: vendorBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: assumedNote(params.order),
        key: line("payable-back"),
      });
    }
  });

  return entries;
}

/**
 * A refund the gateway took back.
 *
 * A card refund is accepted first and settled later, and it can fail after —
 * a closed account, a bank that rejects it. Storify recorded it as succeeded
 * the moment the gateway accepted it, so until this existed a failed refund
 * left the books saying money went back that never did: revenue reversed, the
 * vendor's payable clawed, and a shopper still out of pocket.
 *
 * The same entries the refund posted, flipped, under their own keys — the
 * pattern `platformPaymentReversalPostings` uses. Reversing rather than
 * deleting is deliberate: the refund DID happen as far as the books are
 * concerned on the day it was made, and an accounting record that quietly
 * loses a day is worse than one that shows the mistake and its correction.
 */
export function refundReversalPostings(params: {
  order: PostingOrder;
  amount: number;
  refundId?: unknown;
  date?: Date;
  context: OrderPostingContext;
  allocation?: RefundAllocationInput[] | null;
  alreadyReversed?: readonly number[] | null;
}): LedgerPosting[] {
  return refundPostings(params).map((entry) => ({
    ...entry,
    date: params.date || new Date(),
    debit: entry.credit,
    credit: entry.debit,
    key: `${entry.key}:reversal`,
    note: "Refund failed at the gateway",
  }));
}

/** A payout clearing: a liability settled, never an expense. */
export function payoutPaidPostings(payout: {
  _id: unknown;
  payoutNumber?: string | null;
  vendorId?: unknown;
  netAmount?: number | null;
  currency?: string | null;
  paidAt?: Date | null;
}): LedgerPosting[] {
  const currency = String(payout.currency || "").toUpperCase();
  const amount = money(payout.netAmount);
  if (!currency || amount <= 0) return [];

  return [
    {
      date: payout.paidAt || new Date(),
      book: LEDGER_BOOK.MARKETPLACE,
      debit: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      credit: LEDGER_ACCOUNT.CASH_BANK,
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.PAYOUT,
        id: payout._id as Types.ObjectId,
        ref: payout.payoutNumber ?? null,
      },
      vendorId: payout.vendorId as Types.ObjectId,
      key: postingKey(LEDGER_SOURCE_KIND.PAYOUT, payout._id, "paid"),
    },
  ];
}

/** A vendor paying the platform for a boost or a subscription. */
export function platformPaymentPostings(payment: {
  _id: unknown;
  kind?: string | null;
  reference?: string | null;
  vendorId?: unknown;
  amount?: number | null;
  currency?: string | null;
  paidAt?: Date | null;
}): LedgerPosting[] {
  const currency = String(payment.currency || "").toUpperCase();
  const amount = money(payment.amount);
  if (!currency || amount <= 0) return [];

  // Collecting commission is NOT income. The income was recognised the moment
  // the sale happened — that is what put it in `commission_receivable` — so
  // crediting an income account here would book the same earning twice and
  // inflate every profit figure by the amount actually collected. What the
  // payment does is settle the debt.
  const credit =
    payment.kind === "commission"
      ? LEDGER_ACCOUNT.COMMISSION_RECEIVABLE
      : payment.kind === "subscription"
        ? LEDGER_ACCOUNT.SUBSCRIPTION_INCOME
        : LEDGER_ACCOUNT.BOOST_INCOME;

  return [
    {
      date: payment.paidAt || new Date(),
      // Always the marketplace book: a single-vendor store has no vendors to
      // sell boosts or plans to, so these never appear in the own book.
      book: LEDGER_BOOK.MARKETPLACE,
      debit: LEDGER_ACCOUNT.CASH_GATEWAY,
      credit,
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.PLATFORM_PAYMENT,
        id: payment._id as Types.ObjectId,
        ref: payment.reference ?? null,
      },
      vendorId: payment.vendorId as Types.ObjectId,
      key: postingKey(LEDGER_SOURCE_KIND.PLATFORM_PAYMENT, payment._id, "paid"),
    },
  ];
}

/**
 * The gateway took a platform payment back — a refund, or a chargeback.
 *
 * The mirror of the payment, dated when the reversal happened rather than when
 * the money first arrived, so a month already closed does not move. The benefit
 * side already unwinds (a boost campaign is cancelled, a commission invoice
 * hands its claim back); without this the income stayed on the books, so a
 * marketplace that refunded every boost it ever sold still reported the revenue.
 *
 * On a commission payment the mirror re-establishes the receivable, which is
 * exactly what `releaseCommissionInvoice` does to the sales behind it.
 */
export function platformPaymentReversalPostings(payment: {
  _id: unknown;
  kind?: string | null;
  reference?: string | null;
  vendorId?: unknown;
  amount?: number | null;
  currency?: string | null;
  paidAt?: Date | null;
  reversedAt?: Date | null;
}): LedgerPosting[] {
  return platformPaymentPostings(payment).map((entry) => ({
    ...entry,
    date: payment.reversedAt || new Date(),
    debit: entry.credit,
    credit: entry.debit,
    key: `${entry.key}:reversal`,
    note: "Reversed by the gateway",
  }));
}

/**
 * A vendor's subscription invoice, as entries.
 *
 * Separate from `platformPaymentPostings` because a plan billed through
 * Stripe's own subscription engine never becomes a `PlatformPayment`: the
 * renewal arrives as an `invoice.paid` webhook and lands in
 * `VendorSubscriptionPayment`. Only the hosted-checkout providers go through
 * the platform-payment rail, so a marketplace using Stripe Billing — the
 * default for plans — had every penny of plan revenue missing from its profit
 * and loss while the vendor list showed the subscription as active.
 *
 * Keyed on the payment row, which the sync upserts on `provider` +
 * `providerInvoiceId`, so a re-delivered webhook posts nothing extra.
 *
 * A refund is reversed only once the invoice reaches `refunded`. A partial
 * refund leaves it `paid`, and reversing a running total under one key would
 * either lose the increment or double-count it — so the honest rule is the
 * terminal one, and a partial refund of a plan is settled off-ledger.
 */
export function subscriptionInvoicePostings(payment: {
  _id: unknown;
  vendorId?: unknown;
  providerInvoiceId?: string | null;
  status?: string | null;
  amountPaid?: number | null;
  amountRefunded?: number | null;
  currency?: string | null;
  paidAt?: Date | null;
  providerCreatedAt?: Date | null;
}): LedgerPosting[] {
  const currency = String(payment.currency || "").toUpperCase();
  const paid = money(payment.amountPaid);
  const status = String(payment.status || "").toLowerCase();
  if (!currency || paid <= 0) return [];
  if (status !== "paid" && status !== "refunded") return [];

  const date = payment.paidAt || payment.providerCreatedAt || new Date();
  const source = {
    kind: LEDGER_SOURCE_KIND.PLATFORM_PAYMENT,
    id: payment._id as Types.ObjectId,
    ref: payment.providerInvoiceId ?? null,
  };
  const entries: LedgerPosting[] = [
    {
      date,
      // Always the marketplace book: a single-vendor store has no vendors to
      // sell plans to.
      book: LEDGER_BOOK.MARKETPLACE,
      debit: LEDGER_ACCOUNT.CASH_GATEWAY,
      credit: LEDGER_ACCOUNT.SUBSCRIPTION_INCOME,
      amount: quantizeToCurrency(paid, currency),
      currency,
      source,
      vendorId: payment.vendorId as Types.ObjectId,
      key: postingKey(
        LEDGER_SOURCE_KIND.PLATFORM_PAYMENT,
        payment._id,
        "subscription",
      ),
    },
  ];

  const refunded = money(payment.amountRefunded);
  if (status === "refunded" && refunded > 0) {
    entries.push({
      ...entries[0]!,
      debit: LEDGER_ACCOUNT.SUBSCRIPTION_INCOME,
      credit: LEDGER_ACCOUNT.CASH_GATEWAY,
      amount: quantizeToCurrency(refunded, currency),
      key: postingKey(
        LEDGER_SOURCE_KIND.PLATFORM_PAYMENT,
        payment._id,
        "subscription-refund",
      ),
      note: "Subscription invoice refunded",
    });
  }

  return entries;
}

/**
 * A hand-entered expense.
 *
 * `revision` is what keeps the ledger append-only while the expense itself
 * stays editable: it rides in the key, so correcting an expense posts a fresh
 * pair under a new key instead of rewriting the old one, and the reversal below
 * cancels the previous revision. Both versions remain visible, which is the
 * whole point of not editing entries.
 *
 * An unpaid expense credits accounts payable rather than cash — recording a
 * bill that has been received is not the same as money leaving.
 */
export function expensePostings(expense: {
  _id: unknown;
  date?: Date | null;
  book?: LedgerBook | null;
  category?: string | null;
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
  paidFrom?: string | null;
  vendorId?: unknown;
  revision?: number;
  /** Decided when the expense was written; absent on rows that predate it. */
  debitAccount?: string | null;
}): LedgerPosting[] {
  const currency = String(expense.currency || "").toUpperCase();
  const amount = money(expense.amount);
  if (!currency || amount <= 0) return [];

  const credit =
    expense.paidFrom === "cash"
      ? LEDGER_ACCOUNT.CASH_ON_HAND
      : expense.paidFrom === "gateway"
        ? LEDGER_ACCOUNT.CASH_GATEWAY
        : expense.paidFrom === "unpaid"
          ? // A bill received, not a seller's share of their own sales. This
            // used to credit `vendor_payable`, which raised what the
            // marketplace appeared to owe its vendors — and when the expense
            // named one, put the store's rent on that vendor's statement as a
            // line they had earned.
            LEDGER_ACCOUNT.ACCOUNTS_PAYABLE
          : LEDGER_ACCOUNT.CASH_BANK;

  return [
    {
      date: expense.date || new Date(),
      book: expense.book || LEDGER_BOOK.OWN,
      // Almost every category lands in the one operating-expense account, so
      // the chart does not grow a line per bucket. Stock is the exception and
      // debits `inventory` instead — an asset, not a cost, until it is sold.
      //
      // Read off the row rather than re-derived from the category, so the
      // reversal of an older expense cancels the account it actually posted to.
      // A row with nothing stored predates the split and was operating expense.
      debit: (expense.debitAccount as LedgerAccount) ||
        LEDGER_ACCOUNT.OPERATING_EXPENSE,
      credit,
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.EXPENSE,
        id: expense._id as Types.ObjectId,
        ref: expense.category ?? null,
      },
      vendorId: expense.vendorId as Types.ObjectId,
      key: postingKey(
        LEDGER_SOURCE_KIND.EXPENSE,
        expense._id,
        "v",
        expense.revision ?? 0,
      ),
      note: expense.description ?? null,
    },
  ];
}

/**
 * Undo an expense revision, by posting its mirror image.
 *
 * Deleting the original entry would be simpler and is exactly what an
 * append-only ledger forbids: a report run last week must still produce last
 * week's answer. The reversal is a new entry with the accounts swapped.
 */
export function expenseReversalPostings(expense: {
  _id: unknown;
  date?: Date | null;
  book?: LedgerBook | null;
  category?: string | null;
  amount?: number | null;
  currency?: string | null;
  paidFrom?: string | null;
  vendorId?: unknown;
  revision?: number;
  reversedAt?: Date | null;
  /** The account the ORIGINAL debited — see `expensePostings`. */
  debitAccount?: string | null;
}): LedgerPosting[] {
  return expensePostings(expense).map((entry) => ({
    ...entry,
    // Dated when the correction was made, not when the original was: a closed
    // period must not move because someone fixed a typo today.
    date: expense.reversedAt || new Date(),
    debit: entry.credit,
    credit: entry.debit,
    key: `${entry.key}:reversal`,
    note: "Reversal of a corrected or deleted expense",
  }));
}

/**
 * A carrier label, as an expense.
 *
 * Booked against whoever's account was billed, and NOT recharged to the vendor
 * when they ship on the platform's account.
 *
 * That is a decision, not an omission. The platform already keeps every penny
 * of buyer-paid shipping — `vendorEarnings` is subtotal minus commission with
 * no shipping in it — so charging the vendor for the label as well would have
 * them bear the cost of a service whose revenue they never see. Income and cost
 * belong on the same side, and together they are the shipping margin the
 * overview reports.
 *
 * A marketplace that decides to pass shipping revenue through to vendors would
 * have to change `vendorEarnings` first; the recharge entry would follow that,
 * not lead it.
 *
 * The amount is in the CARRIER's currency, which is why `baseCurrency` travels
 * with it: no rate is available, so nothing may convert it, and a report shows
 * it as its own currency rather than pretending.
 */
export function shipmentLabelPostings(shipment: {
  _id: unknown;
  vendorId?: unknown;
  orderId?: unknown;
  rate?: {
    amount?: number | null;
    currency?: string | null;
    baseCurrency?: string | null;
  } | null;
  purchasedAt?: Date | null;
  isOwnStore?: boolean;
  /**
   * Which booking of this parcel this label is.
   *
   * A voided shipment is reset and re-bought on the SAME document, so without
   * this every label after the first collides with the first one's key and its
   * cost is silently dropped by the very index that makes replay safe. The
   * first booking deliberately keeps the bare key, so entries written before
   * this existed are still recognised as their own.
   */
  bookingSequence?: number | null;
}): LedgerPosting[] {
  const currency = String(shipment.rate?.currency || "").toUpperCase();
  const amount = money(shipment.rate?.amount);
  if (!currency || amount <= 0) return [];

  return [
    {
      date: shipment.purchasedAt || new Date(),
      book: shipment.isOwnStore ? LEDGER_BOOK.OWN : LEDGER_BOOK.MARKETPLACE,
      debit: LEDGER_ACCOUNT.SHIPPING_COST,
      credit: LEDGER_ACCOUNT.CASH_BANK,
      amount,
      currency,
      baseCurrency: shipment.rate?.baseCurrency ?? null,
      source: {
        kind: LEDGER_SOURCE_KIND.SHIPMENT,
        id: shipment._id as Types.ObjectId,
      },
      vendorId: shipment.vendorId as Types.ObjectId,
      key: labelKey(shipment._id, shipment.bookingSequence),
    },
  ];
}

/** The first booking keeps the bare key; every re-ship gets its own. */
function labelKey(id: unknown, bookingSequence?: number | null): string {
  const sequence = Number(bookingSequence) || 0;
  return postingKey(
    LEDGER_SOURCE_KIND.SHIPMENT,
    id,
    "label",
    sequence > 0 ? sequence : undefined,
  );
}

/**
 * A voided label, when the carrier actually gives the money back.
 *
 * Only then. A void the carrier refuses to refund still cost what it cost, and
 * reversing it would credit the store money nobody returned — which is why
 * `refunded` is a parameter rather than an assumption. Shippo refunds a label
 * that never entered the mail stream; a parcel already scanned is generally
 * not refunded at all.
 *
 * The mirror of the purchase, not a deletion of it: both bookings stay visible,
 * and a report run before the void still produces the answer it gave then.
 */
export function shipmentLabelReversalPostings(shipment: {
  _id: unknown;
  vendorId?: unknown;
  rate?: {
    amount?: number | null;
    currency?: string | null;
    baseCurrency?: string | null;
  } | null;
  isOwnStore?: boolean;
  bookingSequence?: number | null;
  voidedAt?: Date | null;
}): LedgerPosting[] {
  return shipmentLabelPostings({ ...shipment, purchasedAt: null }).map(
    (entry) => ({
      ...entry,
      // Dated when the refund happened, not when the label was bought: a month
      // already closed must not move because a parcel was cancelled today.
      date: shipment.voidedAt || new Date(),
      debit: entry.credit,
      credit: entry.debit,
      key: `${labelKey(shipment._id, shipment.bookingSequence)}:void`,
      note: "Label voided and refunded by the carrier",
    }),
  );
}

/**
 * A correction or a transfer, entered by hand.
 *
 * The one rule with no source document behind it, and it exists because two
 * money events in this system have no other way in.
 *
 * **Money the platform moved between its own accounts.** Nothing else debits
 * `cash_bank`: a payout and a carrier label credit it, but no rule ever funded
 * it, because settling a gateway balance into a bank account happens at the
 * bank and no webhook here hears about it. So the account could only fall, and
 * "In the bank" on the overview was a number that started at zero and went
 * negative by exactly what had been paid out of it.
 *
 * **A balance that has gone impossible.** A liability below zero says the
 * platform handed over more than it ever owed — the ledger recording, in the
 * only way it can, that something upstream was wrong. Those entries are facts
 * and stay; what the ledger lacked was the answer to "and then what", which in
 * double entry is another entry, not an edit.
 *
 * Deliberately unrestricted in which two accounts it names. A journal entry
 * that could not reach the account that has gone wrong would not be able to fix
 * the cases this was written for. What guards it instead is that it is
 * append-only like everything else, carries a required reason, and is audited —
 * so an adjustment is as visible afterwards as the imbalance it corrected.
 */
export function adjustmentPostings(adjustment: {
  _id: unknown;
  date?: Date | null;
  book?: LedgerBook | null;
  debit: LedgerAccount;
  credit: LedgerAccount;
  amount?: number | null;
  currency?: string | null;
  vendorId?: unknown;
  reason?: string | null;
}): LedgerPosting[] {
  const currency = String(adjustment.currency || "").toUpperCase();
  const amount = money(adjustment.amount);
  if (!currency || amount <= 0) return [];
  // `postLedgerEntries` drops a self-cancelling entry anyway; refusing it here
  // keeps the rule honest when it is called directly, as the tests do.
  if (adjustment.debit === adjustment.credit) return [];

  return [
    {
      date: adjustment.date || new Date(),
      book: adjustment.book || LEDGER_BOOK.OWN,
      debit: adjustment.debit,
      credit: adjustment.credit,
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.ADJUSTMENT,
        id: adjustment._id as Types.ObjectId,
        ref: null,
      },
      // Set when the adjustment is about one vendor's balance, so it lands on
      // their statement beside the entries it corrects rather than floating
      // free of the only figure it changes.
      vendorId: adjustment.vendorId as Types.ObjectId,
      key: postingKey(LEDGER_SOURCE_KIND.ADJUSTMENT, adjustment._id),
      note: adjustment.reason ?? null,
    },
  ];
}
