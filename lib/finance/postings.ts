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
import {
  isPlatformSettled,
  PLATFORM_GATEWAY_PAYMENT_METHODS,
} from "@/lib/payments/payment-custody";
import { quantizeToCurrency } from "@/lib/intl/money";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import { feeInChargeCurrency } from "@/lib/payments/gateway-fee";
import {
  orderCreditApplied,
  type OrderStoreCredit,
} from "@/lib/store-credit/order-credit";
import {
  LEDGER_ACCOUNT,
  LEDGER_BOOK,
  type LedgerAccount,
  type LedgerBook,
} from "@/lib/finance/accounts";
import { postingKey, type LedgerPosting } from "@/lib/finance/ledger";
import { LEDGER_SOURCE_KIND } from "@/models/ledger-entry.model";
import {
  SHIPPING_REVENUE_TO,
  vendorEarnsShipping,
} from "@/lib/shipping/shipping-revenue";

interface PostingOrderItem {
  /** Which unit this was — how a restock finds the cost the sale booked for it. */
  productId?: unknown;
  variantId?: unknown;
  cost?: number | null;
  quantity?: number | null;
  /** What this line leaves to be paid later — see `decomposeOrder`. */
  preorderOutstandingAmount?: number | null;
}

export interface PostingSubOrder {
  _id?: unknown;
  vendorId?: unknown;
  subtotal?: number | null;
  commission?: number | null;
  vendorEarnings?: number | null;
  shippingCost?: number | null;
  /**
   * This consignment's slice of a coupon limited to some of the cart. Present
   * on every consignment of an order that recorded the split, absent on the
   * rest — see `decomposeOrder` for how it moves the goods between vendors.
   */
  couponDiscount?: number | null;
  /**
   * What a free-shipping coupon took off THIS parcel's delivery. Present on
   * every consignment of an order that recorded the split, absent on the rest.
   */
  shippingDiscount?: number | null;
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
  /**
   * Fulfilment state, read for one question only: was this consignment called
   * off? See the balance pair in `orderPaidPostings`.
   */
  status?: string | null;
  /** When THIS consignment's money arrived — a cash parcel paid for at the door. */
  paidAt?: Date | string | null;
  /** Who earns the delivery charge — see `lib/shipping/shipping-revenue.ts`. */
  shippingRevenueTo?: string | null;
  /** Set while a label on the store's own carrier account covers the parcel. */
  platformLabelAt?: Date | string | null;
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
  coupon?: {
    type?: string | null;
    /** Who paid for the goods discount; absent means the sellers did. */
    fundedBy?: string | null;
  } | null;
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
  /**
   * The order's own status. Read only by a refund, to tell an order handed
   * back from money returned on one that is still waiting on its balance.
   */
  status?: string | null;
  /** The part of `total` a deposit-mode pre-order has not collected yet. */
  preorderOutstandingAmount?: number | null;
  /** When that balance arrived, however it arrived. Absent while it is owed. */
  preorderBalancePaidAt?: Date | string | null;
  /** Which account it arrived in — see `balanceCashAccountFor`. */
  preorderBalancePaidFrom?: string | null;
  /**
   * The gateway's cut of the balance payment alone. `paymentFee` holds the
   * deposit's and the balance's together once the balance is in, so this is
   * what lets each be posted on the day it was charged.
   */
  preorderBalancePaymentFee?: number | null;
  channel?: string | null;
  stripePaymentIntentId?: string | null;
  paymentCustody?: string | null;
  paymentFee?: number | null;
  paymentFeeCurrency?: string | null;
  paymentFeeRate?: number | null;
  subOrders?: PostingSubOrder[] | null;
  /** Store credit that paid part of the order (R8) — see order-credit.ts. */
  storeCredit?: OrderStoreCredit | null;
}

export interface OrderPostingContext {
  /** Vendor ids that are the admin-owned store — their sales are the own book. */
  defaultVendorIds: Set<string>;
  /**
   * The balance receivable each consignment already raised, by its posting
   * key. The collection has to clear exactly what was raised, and an order
   * whose receivable was raised under an earlier split must not be collected
   * under a later one. Omitted, the current split is used for both.
   */
  raisedOutstanding?: ReadonlyMap<string, number>;
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

/** Methods whose money sits in a gateway balance until it settles to the bank. */
const GATEWAY_CASH_METHODS: ReadonlySet<string> = new Set([
  ...PLATFORM_GATEWAY_PAYMENT_METHODS,
  "stripe",
  // A pay-later pre-order still charges its shipping and tax by card.
  "pay_later",
]);

/**
 * Where a register's takings land, by how the cashier took them.
 *
 * A till is not one account. The register offers notes, card, bank transfer
 * and a method the merchant names themselves, and only the first of those ends
 * up in the drawer — see `POS_SELECTABLE_PAYMENT_METHODS`.
 *
 * `card_touch` and `card_stripe` never reach here: `validatePOSPaymentInput`
 * folds both down to `card` before the order is written, keeping the reader or
 * the intent id in `paymentMetadata.posPayment.cardSubMethod`. So this one
 * entry covers a contactless tap and a Stripe charge alike, and both are money
 * sitting with an acquirer rather than in the shop.
 */
const POS_CASH_ACCOUNTS: ReadonlyMap<string, LedgerAccount> = new Map([
  ["cash", LEDGER_ACCOUNT.CASH_ON_HAND],
  ["card", LEDGER_ACCOUNT.CASH_GATEWAY],
  ["bank", LEDGER_ACCOUNT.CASH_BANK],
  /*
   * "Manual" is a custom method the merchant names — a voucher, a wallet, a
   * cheque — and nothing on the order says which. Deliberately left in the
   * drawer, where a counter payment with no other evidence has always been
   * booked: guessing it into the bank or a gateway would put money in an
   * account whose balance someone reconciles against a statement.
   */
  ["manual", LEDGER_ACCOUNT.CASH_ON_HAND],
]);

/**
 * Which cash account this order's money landed in.
 *
 * A register's drawer is the store's own, not a gateway balance — and neither
 * is cash a courier took at the door. COD used to fall through to
 * `cash_gateway`, which claimed a gateway had processed money no gateway ever
 * saw; the notes are physical either way, so they belong in the same account
 * the POS drawer uses.
 *
 * But only the notes. Answering `pos` before looking at the method at all sent
 * every counter sale to the drawer, so a store taking card at the register had
 * "Cash in hand" grow by every card sale it ever rang up while the gateway
 * balance came up short by exactly the same amount — the very mistake the
 * paragraph above describes, arrived at from the other direction.
 *
 * Everything else that is not a gateway is money the store took itself — a
 * bank transfer, a payment recorded by hand on an order an admin created —
 * and it was booked into `cash_gateway` too, so the gateway balance on the
 * books grew by money no gateway had and the bank came up short.
 */
export function cashAccountFor(order: {
  channel?: string | null;
  paymentMethod?: string | null;
}) {
  const method = String(order.paymentMethod || "").trim().toLowerCase();
  if (String(order.channel || "").toLowerCase() === "pos") {
    // A POS row carrying no method at all predates the field and is booked as
    // it always was, in the drawer.
    return POS_CASH_ACCOUNTS.get(method) ?? LEDGER_ACCOUNT.CASH_ON_HAND;
  }
  if (method === "cod" || method === "cash") {
    return LEDGER_ACCOUNT.CASH_ON_HAND;
  }
  // No method at all is a row from before the field, booked as it always was.
  return !method || GATEWAY_CASH_METHODS.has(method)
    ? LEDGER_ACCOUNT.CASH_GATEWAY
    : LEDGER_ACCOUNT.CASH_BANK;
}

/**
 * Which account a pre-order BALANCE arrived in.
 *
 * A balance is its own payment and can land somewhere the deposit never did: a
 * deposit charged on Stripe and a balance handed over in notes are a gateway
 * balance and a till. `cashAccountFor` can only answer for the deposit, so an
 * offline balance was booked wherever the deposit had gone — and on a
 * `pay_later` order, which charges nothing at checkout, that misfiled the
 * whole total.
 *
 * Only the collection entry uses this. The sale itself was made on the day the
 * order was, out of whatever account the deposit reached; the pair that moves
 * the balance out of cash and back in is where the second account belongs, and
 * because the two halves cancel for the part that never arrived, the net is
 * exactly the deposit in one account and the balance in the other.
 */
export function balanceCashAccountFor(order: {
  channel?: string | null;
  paymentMethod?: string | null;
  preorderBalancePaidFrom?: string | null;
}) {
  switch (String(order.preorderBalancePaidFrom || "").trim().toLowerCase()) {
    case "cash":
      return LEDGER_ACCOUNT.CASH_ON_HAND;
    case "bank":
      return LEDGER_ACCOUNT.CASH_BANK;
    case "gateway":
      return LEDGER_ACCOUNT.CASH_GATEWAY;
    // Nothing recorded: a balance the gateway charged, or one recorded before
    // the field existed. Both land where the order's own money did.
    default:
      return cashAccountFor(order);
  }
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
  /** This consignment's slice of what the shopper's store credit paid (R8). */
  storeCredit: number;
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
export function decomposeOrder(
  order: Omit<PostingOrder, "_id">,
): OrderDecomposition | null {
  const currency = String(order.currency || "").toUpperCase();
  const total = money(order.total);
  const subOrders = (order.subOrders || []).filter(Boolean);
  // A zero total is a real sale when the store's own coupon paid for all of
  // it: the seller is owed their goods and charged commission on them, and
  // refusing to decompose it left the payout paying out of a payable the sale
  // never credited. Every share is then zero, which posts nothing on its own.
  if (!currency || total < 0 || subOrders.length === 0) return null;

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

  const salesWeights = subOrders.map((sub) => Math.max(0, money(sub.subtotal)));
  // What each consignment's goods actually sold for. `merchandise` is already
  // net of the order's discount, and weighting it by gross sales handed every
  // vendor a slice of every coupon — one vendor's own 20-off came 10 off a
  // vendor who never offered it. An order that recorded whose coupon it was
  // is weighted by goods after each consignment's own slice; one that did not
  // shares the discount by sales, exactly as before.
  const recordsCouponSplit = subOrders.some(
    (sub) => typeof sub.couponDiscount === "number",
  );
  const merchandiseWeights = recordsCouponSplit
    ? subOrders.map((sub) =>
        Math.max(0, money(sub.subtotal) - Math.max(0, money(sub.couponDiscount))),
      )
    : salesWeights;
  const merchandiseShares = allocate(merchandise, merchandiseWeights, currency);
  // Delivery is charged per parcel, so a free-shipping coupon that paid for
  // ONE seller's delivery must come off that parcel. Weighting the discounted
  // total by rated cost spread it over every parcel instead, and one seller's
  // coupon took the other sellers' delivery charge with it. An order that
  // recorded whose delivery was free is weighted by what each parcel actually
  // charged; one that did not shares it by rated cost, exactly as before.
  const recordsShippingSplit = subOrders.some(
    (sub) => typeof sub.shippingDiscount === "number",
  );
  const shippingWeights = subOrders.map((sub) =>
    Math.max(
      0,
      money(sub.shippingCost) -
        (recordsShippingSplit ? Math.max(0, money(sub.shippingDiscount)) : 0),
    ),
  );
  const shippingShares = allocate(shipping, shippingWeights, currency);
  const taxShares = allocate(tax, merchandiseWeights, currency);
  const dutyShares = allocate(duty, merchandiseWeights, currency);
  // The balance belongs to the pre-order lines that owe it. Shared by sales it
  // put half of one seller's pre-order balance on a seller whose in-stock goods
  // were paid in full, while the cancel refund read the lines themselves — so
  // the ledger and the refund disagreed about who was owed what. Weighted by
  // each consignment's own lines where they say; by sales where they do not
  // (an order loaded without its lines, or one from before lines carried it).
  const lineOutstanding = subOrders.map((sub) =>
    (sub.items || []).reduce(
      (sum, item) => sum + Math.max(0, money(item?.preorderOutstandingAmount)),
      0,
    ),
  );
  const outstandingWeights = lineOutstanding.some((value) => value > 0)
    ? lineOutstanding
    : salesWeights;
  const outstandingShares = allocate(outstanding, outstandingWeights, currency);
  // What the shopper's store credit paid (R8), shared by what each
  // consignment was charged: the part of each that no gateway or till took.
  const storeCredit = q(Math.min(Math.max(0, total), orderCreditApplied(order)));
  const chargeWeights = subOrders.map((_, index) =>
    Math.max(
      0,
      (merchandiseShares[index] ?? 0) +
        (shippingShares[index] ?? 0) +
        (taxShares[index] ?? 0) +
        (dutyShares[index] ?? 0),
    ),
  );
  const storeCreditShares = allocate(storeCredit, chargeWeights, currency);

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
      storeCredit: storeCreditShares[index] ?? 0,
    })),
  };
}

interface ConsignmentCharge {
  currency: string;
  /** Goods after every discount. */
  merchandise: number;
  /** Delivery actually charged, after a free-shipping coupon. */
  shipping: number;
  tax: number;
  duty: number;
  /** Everything the buyer pays for this consignment. */
  total: number;
  /** The part of `total` the shopper's store credit paid (R8). */
  storeCredit: number;
}

/**
 * What the buyer is charged for ONE consignment — the slice of `order.total`
 * the sale books for it.
 *
 * Read off `decomposeOrder` rather than the sub-order's face values, which are
 * undiscounted and carry no tax: a courier told to collect `subtotal +
 * shippingCost` took the goods money without the tax, over-collected on every
 * couponed order, and left the cash in hand short of what the ledger posted.
 *
 * Null when the order cannot be decomposed (no currency, nothing charged) or
 * the consignment is not on it.
 */
export function consignmentCharge(
  order: Omit<PostingOrder, "_id">,
  subOrderId: unknown,
): ConsignmentCharge | null {
  const decomposition = decomposeOrder(order);
  if (!decomposition) return null;
  const index = (order.subOrders || [])
    .filter(Boolean)
    .findIndex((sub) => String(sub._id) === String(subOrderId));
  const share = index >= 0 ? decomposition.shares[index] : undefined;
  if (!share) return null;

  const { currency } = decomposition;
  return {
    currency,
    merchandise: share.merchandise,
    shipping: share.shipping,
    tax: share.tax,
    duty: share.duty,
    total: quantizeToCurrency(
      share.merchandise + share.shipping + share.tax + share.duty,
      currency,
    ),
    storeCredit: share.storeCredit,
  };
}

/**
 * The part of each consignment's goods discount the STORE paid for, flat by
 * position — zero everywhere unless the order's coupon was store-funded.
 *
 * A store-funded coupon leaves the seller's side of the sale whole: they are
 * owed, and charged commission on, what the goods sold for before the
 * discount, and the store bears the difference as a promotion. The shopper
 * still paid the discounted price, which is what `decomposeOrder`'s cash
 * shares stay; this is the gap between those and the sale the seller made.
 *
 * Read off the consignment's recorded slice when the coupon recorded one, and
 * otherwise shared by sales, exactly as the discount itself was. A
 * free-shipping coupon discounts delivery, not goods: its funding is
 * `storeFundedShippingShares`.
 */
export function storeFundedDiscountShares(
  order: Omit<PostingOrder, "_id">,
  currency: string,
): number[] {
  const subOrders = (order.subOrders || []).filter(Boolean);
  const none = subOrders.map(() => 0);
  if (String(order.coupon?.fundedBy || "") !== "platform") return none;
  if (isFreeShippingCouponType(order.coupon?.type)) return none;
  const discount = Math.max(0, money(order.discount));
  if (discount <= 0) return none;

  if (subOrders.some((sub) => typeof sub.couponDiscount === "number")) {
    return subOrders.map((sub) =>
      quantizeToCurrency(Math.max(0, money(sub.couponDiscount)), currency),
    );
  }
  return allocate(
    discount,
    subOrders.map((sub) => Math.max(0, money(sub.subtotal))),
    currency,
  );
}

/**
 * What the STORE paid of each consignment's delivery, through a free-shipping
 * coupon it funded.
 *
 * A store-wide "free delivery this weekend" came out of the sellers who
 * delivered the parcels: they earned the discounted charge, or nothing at all,
 * for a promotion the store ran. Funded by the store, the seller earns the
 * delivery the parcel was rated at and the store bears the difference, exactly
 * as it does for a discount on goods.
 *
 * A seller's own free-shipping coupon is their promotion and funds nothing
 * here — it simply comes off what they earn, on their own parcel only.
 */
function storeFundedShippingShares(
  order: Omit<PostingOrder, "_id">,
  currency: string,
): number[] {
  const subOrders = (order.subOrders || []).filter(Boolean);
  const none = subOrders.map(() => 0);
  if (String(order.coupon?.fundedBy || "") !== "platform") return none;
  if (!isFreeShippingCouponType(order.coupon?.type)) return none;
  const discount = Math.max(0, money(order.discount));
  if (discount <= 0) return none;

  if (subOrders.some((sub) => typeof sub.shippingDiscount === "number")) {
    return subOrders.map((sub) =>
      quantizeToCurrency(Math.max(0, money(sub.shippingDiscount)), currency),
    );
  }
  // An order placed before the split was recorded: shared by what each parcel
  // was rated at, which is how it was discounted.
  return allocate(
    Math.min(discount, Math.max(0, money(order.shippingCost))),
    subOrders.map((sub) => Math.max(0, money(sub.shippingCost))),
    currency,
  );
}

/** Spelled out rather than imported, as the ledger's other literals are. */
const PENDING_STATUS = "pending";
const PARTIALLY_PAID_STATUS = "partially_paid";
const CANCELLED_STATUS = "cancelled";

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
 * receivable rather than an uncollected parcel. It is told from the cash case
 * by the deposit terms on the order, and it holds whichever way the
 * consignment reads part-paid — inheriting the order's status because it has
 * none of its own, as the capture writes it, or carrying the order's status
 * itself, as the sub-order payment backfill (`db:migrate suborder-payment`)
 * stamps it. Judged by its own `partially_paid` alone, a backfilled deposit
 * consignment read as a parcel nobody had paid for: its sale dropped out of
 * the books on a rebuild, its refund posted nothing, and the share of the
 * deposit a seller's cancellation owed the shopper came to zero.
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
  const status = own || String(order.paymentStatus || "").trim().toLowerCase();
  if (status === PARTIALLY_PAID_STATUS) {
    return money(order.preorderOutstandingAmount) > 0;
  }
  if (own) return own !== PENDING_STATUS;
  return true;
}

/**
 * What each book collected on this order — the weights a cost charged on the
 * whole payment is shared by.
 *
 * A gateway fee or a chargeback fee is charged on the payment, and one payment
 * can carry the store's own goods on one line and a vendor's on another. Only
 * consignments whose money reached the platform count: a vendor who took the
 * cash at their own door was never part of a payment the platform paid for.
 *
 * `outstanding` weighs by the pre-order balance instead, for the fee on the
 * balance payment, which paid for those lines and no others.
 */
export function bookSharesOfCharge(
  order: PostingOrder,
  context: OrderPostingContext,
  weigh: "charge" | "outstanding" = "charge",
): Record<LedgerBook, number> {
  const shares: Record<LedgerBook, number> = {
    [LEDGER_BOOK.OWN]: 0,
    [LEDGER_BOOK.MARKETPLACE]: 0,
  };
  const decomposition = decomposeOrder(order);
  if (!decomposition) return shares;
  const custody = {
    paymentMethod: order.paymentMethod,
    channel: order.channel,
    stripePaymentIntentId: order.stripePaymentIntentId,
    paymentCustody: order.paymentCustody,
  };

  (order.subOrders || []).filter(Boolean).forEach((sub, index) => {
    if (!isConsignmentCollected(order, sub)) return;
    const isOwn = context.defaultVendorIds.has(
      sub.vendorId ? String(sub.vendorId) : "",
    );
    if (!isOwn && !isPlatformSettled(custody, sub)) return;
    const share = decomposition.shares[index];
    if (!share) return;
    const weight =
      weigh === "outstanding"
        ? share.outstanding
        : share.merchandise + share.shipping + share.tax + share.duty;
    shares[isOwn ? LEDGER_BOOK.OWN : LEDGER_BOOK.MARKETPLACE] += Math.max(0, weight);
  });
  return shares;
}

/**
 * Hand the other book its part of a cost that was posted whole into one.
 *
 * A fee on a payment that carried the store's own goods beside a vendor's used
 * to land whole in the store's own book: a $20 cable beside a vendor's $1,340
 * graphics card put the entire card fee on the store, and the marketplace
 * reported a profit it had not made. The whole-cost entry keeps the book and
 * the key it always had — so every entry already written stays what it was, and
 * a replay still collides with it — and this pair moves the other book's share
 * across under keys of its own.
 *
 * The two legs name the same cash account in opposite directions, so no balance
 * moves, only which book carries the cost. Worked out from the order alone, so
 * a replay writes nothing new and an order posted before this existed gets its
 * pair the next time the daily pass reads it.
 */
export function moveShareToOtherBook(
  entry: LedgerPosting,
  shares: Record<LedgerBook, number>,
): LedgerPosting[] {
  const other: LedgerBook =
    entry.book === LEDGER_BOOK.OWN ? LEDGER_BOOK.MARKETPLACE : LEDGER_BOOK.OWN;
  const total =
    Math.max(0, shares[LEDGER_BOOK.OWN]) +
    Math.max(0, shares[LEDGER_BOOK.MARKETPLACE]);
  if (total <= 0) return [];
  const moved = quantizeToCurrency(
    entry.amount * (Math.max(0, shares[other]) / total),
    entry.currency,
  );
  if (moved <= 0) return [];

  const note =
    other === LEDGER_BOOK.MARKETPLACE
      ? "The marketplace's share of a cost charged on the whole payment"
      : "The store's own share of a cost charged on the whole payment";
  return [
    {
      ...entry,
      debit: entry.credit,
      credit: entry.debit,
      amount: moved,
      key: `${entry.key}:book-share:out`,
      note,
    },
    {
      ...entry,
      book: other,
      amount: moved,
      key: `${entry.key}:book-share:in`,
      note,
    },
  ];
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

  // Dated when the money arrived, never when the order was placed: a cash
  // order placed on 30 June and paid at the door on 20 July is July's sale.
  // The order's own `paidAt` is stamped when its payment is recorded; a
  // consignment collected on its own carries its own, below.
  const orderDate = toDate(order.paidAt) || toDate(order.createdAt) || new Date();
  const subOrders = (order.subOrders || []).filter(Boolean);

  const custody = {
    paymentMethod: order.paymentMethod,
    channel: order.channel,
    stripePaymentIntentId: order.stripePaymentIntentId,
    paymentCustody: order.paymentCustody,
  };
  const cashAccount = cashAccountFor(order);

  const source = {
    kind: LEDGER_SOURCE_KIND.ORDER,
    id: order._id as Types.ObjectId,
    ref: order.orderNumber ?? null,
  };
  const entries: LedgerPosting[] = [];
  const posted: boolean[] = [];
  const storeFunded = storeFundedDiscountShares(order, currency);
  const storeFundedShipping = storeFundedShippingShares(order, currency);

  subOrders.forEach((sub, index) => {
    // Nothing has arrived for this consignment yet. Its entries are written by
    // the call that follows its collection, under these same keys.
    if (!isConsignmentCollected(order, sub)) {
      posted.push(false);
      return;
    }
    posted.push(true);
    // A consignment paid for on its own — a cash parcel handed over at the
    // door — is dated by its own collection. A pre-order's consignments are
    // stamped when the BALANCE lands, but its sale was the deposit's, so the
    // order's own date stands for them.
    const hasDepositTerms = money(order.preorderOutstandingAmount) > 0;
    const date =
      (hasDepositTerms ? toDate(order.paidAt) : null) ||
      toDate(sub.paidAt) ||
      orderDate;

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
      //
      // Split from the sale the vendor MADE, which is the goods before any
      // discount the store paid for — see `storeFundedDiscountShares`. The
      // shopper paid less by exactly that much, and the store bears it below.
      const funded = storeFunded[index] ?? 0;
      const soldFor = quantizeToCurrency(merchandiseShare + funded, currency);
      const subtotal = money(sub.subtotal);
      const commissionRatio =
        subtotal > 0 ? money(sub.commission) / subtotal : 0;
      const commission = quantizeToCurrency(
        soldFor * commissionRatio,
        currency,
      );
      const vendorShare = quantizeToCurrency(
        soldFor - commission,
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
        // The discount the store paid for: the commission and the vendor's
        // share above were drawn on the full price, and only this much less
        // arrived.
        if (funded > 0) {
          entries.push({
            date,
            book,
            debit: LEDGER_ACCOUNT.PROMOTIONS,
            credit: cashAccount,
            amount: funded,
            currency,
            source,
            vendorId: sub.vendorId as Types.ObjectId,
            key: line("promotion"),
          });
        }
      } else if (commission > 0 || funded > 0) {
        // The vendor took the money. No cash reached the platform, so the only
        // entry is the claim on them — which is precisely the figure the
        // Receivables screen exists to collect.
        if (commission > 0) {
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
        // They collected the discounted price but are owed the full one: the
        // store's side of its promotion comes off what they owe it, and can
        // leave the store owing them.
        if (funded > 0) {
          entries.push({
            date,
            book,
            debit: LEDGER_ACCOUNT.PROMOTIONS,
            credit: LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
            amount: funded,
            currency,
            source,
            vendorId: sub.vendorId as Types.ObjectId,
            note: assumedNote(order),
            key: line("promotion"),
          });
        }
      }
    }

    // Delivery is income for whoever pays to deliver. The store's own sale,
    // and a parcel the store's courier carries, keep it as shipping income; a
    // vendor delivering their own parcel earns it, so it is owed to them.
    //
    // Read off the stamp alone, never off whether a label has been bought
    // since: a label on the store's account moves the charge to the store with
    // an entry of its own (`shippingToStorePostings`), so replaying this sale
    // later cannot post the same delivery twice under two different keys.
    if (shippingShare > 0 || (storeFundedShipping[index] ?? 0) > 0) {
      const owedToVendor = !isOwn && shippingStampedToVendor(sub);
      // What the store paid of this parcel's delivery. The seller earns the
      // full rated charge; only the part the shopper paid is cash.
      const fundedShipping = owedToVendor
        ? quantizeToCurrency(storeFundedShipping[index] ?? 0, currency)
        : 0;
      if (shippingShare + fundedShipping > 0 && platformHoldsCash) {
        entries.push({
          date,
          book,
          debit: cashAccount,
          credit: owedToVendor
            ? LEDGER_ACCOUNT.VENDOR_PAYABLE
            : LEDGER_ACCOUNT.SHIPPING_INCOME,
          amount: shippingShare + fundedShipping,
          currency,
          source,
          vendorId: sub.vendorId as Types.ObjectId,
          note: assumedNote(order),
          key: line(owedToVendor ? "shipping-payable" : "shipping"),
        });
      }
      // The store's half of that delivery, as the promotion it is. Cash nets
      // back to what the shopper actually paid to have it delivered.
      if (fundedShipping > 0 && platformHoldsCash) {
        entries.push({
          date,
          book,
          debit: LEDGER_ACCOUNT.PROMOTIONS,
          credit: cashAccount,
          amount: fundedShipping,
          currency,
          source,
          vendorId: sub.vendorId as Types.ObjectId,
          note: assumedNote(order),
          key: line("shipping-promotion"),
        });
      }
      // A seller whose own van took the cash collected only what the shopper
      // paid for the delivery; the store's coupon paid the rest, and that
      // comes off what the seller owes the store — exactly as a store-funded
      // discount on the goods does above. Nothing was posted for it, while the
      // invoice and payout arithmetic credited it all the same: the receivable
      // stood permanently over by it, and the promotion never reached the P&L.
      if (fundedShipping > 0 && !platformHoldsCash) {
        entries.push({
          date,
          book,
          debit: LEDGER_ACCOUNT.PROMOTIONS,
          credit: LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
          amount: fundedShipping,
          currency,
          source,
          vendorId: sub.vendorId as Types.ObjectId,
          note: assumedNote(order),
          key: line("shipping-promotion"),
        });
      }
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
    // What was raised is what gets collected — see `raisedOutstanding`.
    const outstandingAmount =
      context.raisedOutstanding?.get(line("outstanding")) ?? share.outstanding;
    if (outstandingAmount > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE,
        credit: cashAccount,
        amount: outstandingAmount,
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
      //
      // Except for a consignment that has been CALLED OFF. Its share of the
      // balance is no longer asked for — `getPreorderBalanceDue` nets it out of
      // what the shopper owes — so when the rest of the balance arrives and the
      // order reads paid, this money did not. Posting it anyway would debit
      // cash for a payment nobody made, which is the one direction an
      // accounting error must never go.
      //
      // The receivable it raised is therefore left standing, deliberately:
      // visible and conservative, where a silent cash overstatement is neither.
      // Taking it off properly means reversing the uncollected part of that
      // consignment's SALE — a write-off, not a collection — which is the
      // payment-legs work in the deferred multi-gateway plan.
      if (!decomposition.balanceStillOwed && sub.status !== CANCELLED_STATUS) {
        entries.push({
          // The day the balance came in, not the day of the deposit.
          date: toDate(order.preorderBalancePaidAt) || date,
          book,
          // And the account it came into, which is not always the deposit's.
          debit: balanceCashAccountFor(order),
          credit: LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE,
          amount: outstandingAmount,
          currency,
          source,
          vendorId: sub.vendorId as Types.ObjectId,
          note: "Balance collected",
          key: line("outstanding-collected"),
        });
      }
    }

    // Paid with store credit (R8). The sale above took the whole consignment
    // as cash, but this part came off the shopper's credit — the store's debt
    // to them, now settled — and never reached a gateway or a till.
    if (share.storeCredit > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.STORE_CREDIT_PAYABLE,
        credit: cashAccount,
        amount: share.storeCredit,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: "Paid with store credit",
        key: line("store-credit"),
      });
    }
  });

  // The gateway's cut, where it was reported and can be stated in this
  // currency. An unconvertible foreign fee is left out rather than guessed —
  // the same rule the charge transaction follows.
  // A pre-order's balance is its own charge with its own fee, and `paymentFee`
  // holds both once it is in. Posting the sum under the one key the deposit's
  // fee already used meant the balance's fee was never posted at all; each is
  // posted now, under its own key, dated when it was charged.
  const balanceFeeRaw = Math.max(0, money(order.preorderBalancePaymentFee));
  const depositFeeRaw =
    order.paymentFee == null
      ? null
      : Math.max(0, money(order.paymentFee) - balanceFeeRaw);
  const fee = feeInChargeCurrency({
    fee: depositFeeRaw,
    feeCurrency: order.paymentFeeCurrency,
    chargeCurrency: currency,
    rate: order.paymentFeeRate,
  });
  const balanceFee =
    balanceFeeRaw > 0 && order.preorderBalancePaidAt
      ? feeInChargeCurrency({
          fee: balanceFeeRaw,
          feeCurrency: order.paymentFeeCurrency,
          chargeCurrency: currency,
          rate: order.paymentFeeRate,
        })
      : undefined;
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
  // Posted whole into one book, as it always was, and then shared out by what
  // each book collected — see `moveShareToOtherBook`.
  const anyOwn = subOrders.some(
    (sub, index) =>
      posted[index] &&
      context.defaultVendorIds.has(sub.vendorId ? String(sub.vendorId) : ""),
  );
  const chargeShares = bookSharesOfCharge(order, context);
  if (fee && fee > 0 && anyPlatformCash) {
    const feeEntry: LedgerPosting = {
      date: orderDate,
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
          ? `Converted from ${depositFeeRaw} ${order.paymentFeeCurrency}`
          : null,
    };
    entries.push(feeEntry, ...moveShareToOtherBook(feeEntry, chargeShares));
  }
  if (balanceFee && balanceFee > 0 && anyPlatformCash) {
    const balanceEntry: LedgerPosting = {
      date: toDate(order.preorderBalancePaidAt) || orderDate,
      book: anyOwn ? LEDGER_BOOK.OWN : LEDGER_BOOK.MARKETPLACE,
      debit: LEDGER_ACCOUNT.PROCESSING_FEES,
      credit: cashAccount,
      amount: quantizeToCurrency(balanceFee, currency),
      currency,
      source,
      key: postingKey(LEDGER_SOURCE_KIND.ORDER, order._id, "processing-fee-balance"),
      note: "The pre-order balance payment's fee",
    };
    // The balance paid for the pre-order lines alone, so it is shared by what
    // each book was still owed rather than by the whole order.
    const balanceShares = bookSharesOfCharge(order, context, "outstanding");
    entries.push(
      balanceEntry,
      ...moveShareToOtherBook(
        balanceEntry,
        balanceShares[LEDGER_BOOK.OWN] + balanceShares[LEDGER_BOOK.MARKETPLACE] > 0
          ? balanceShares
          : chargeShares,
      ),
    );
  }

  return entries;
}

/** A date from a stored value, or null for nothing usable. */
function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
  const remaining = remainingParts(decomposition, params.alreadyReversed);

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
 * Fit an itemised refund inside what each consignment still has to reverse.
 *
 * A return estimate sizes its delivery and tax as the ORDER's figure times the
 * returned goods' share of the order, while the sale booked them per
 * consignment — delivery by each parcel's own charge, tax after each seller's
 * own coupon. On a split order the two rarely agree: seller A returning
 * everything on a 100 + 5 delivery / 100 + 15 delivery order is quoted 10 of
 * delivery, but A's parcel only ever carried 5. `backsFromAllocation` rightly
 * refuses to reverse more than a part holds, and used to throw the whole split
 * away for it — prorating the refund over the order, so seller B lost 45 of
 * goods payable and A kept half the commission reversal, for a return B had
 * nothing to do with.
 *
 * So the itemised goods stay exactly where the return put them, and only the
 * overflow moves: first into the same part of the consignments the refund
 * named, then into the same part of the rest (the delivery or tax really was
 * refunded, and it has to come out of delivery or tax somewhere), and only
 * then into whatever the named consignments have left. Goods never leave the
 * seller whose goods came back unless nothing else can hold the money.
 *
 * Null — and the caller prorates as before — when the allocation names a
 * consignment not on the order, does not add up to the refund, or the order
 * has too little left to hold it at all.
 */
export function fitRefundAllocation(params: {
  decomposition: OrderDecomposition;
  subOrders: PostingSubOrder[];
  amount: number;
  allocation: RefundAllocationInput[] | null | undefined;
  alreadyReversed?: readonly number[] | null;
}): RefundAllocationInput[] | null {
  const { decomposition, subOrders, allocation } = params;
  if (!allocation || allocation.length === 0) return null;
  const currency = decomposition.currency;
  const amount = quantizeToCurrency(Math.max(0, money(params.amount)), currency);
  if (amount <= 0) return null;

  const indexByVendor = new Map<string, number>();
  subOrders.forEach((sub, index) => {
    indexByVendor.set(sub.vendorId ? String(sub.vendorId) : "", index);
  });

  const remaining = remainingParts(decomposition, params.alreadyReversed);
  const want = remaining.map(() => 0);
  const named = new Set<number>();
  const retainedByIndex = new Map<number, number>();
  for (const row of allocation) {
    const index = indexByVendor.get(row?.vendorId ? String(row.vendorId) : "");
    if (index === undefined) return null;
    named.add(index);
    const parts = [row.merchandise, row.shipping, row.tax, row.duty];
    for (let part = 0; part < PARTS; part += 1) {
      const value = money(parts[part]);
      if (value < 0) return null;
      want[index * PARTS + part] = value;
    }
    const retained = money(row.commissionRetained);
    if (retained > 0) retainedByIndex.set(index, retained);
  }
  const wanted = want.reduce((sum, value) => sum + value, 0);
  if (Math.abs(quantizeToCurrency(amount - wanted, currency)) > 0.02) {
    return null;
  }

  const fitted = want.map((value, flat) =>
    Math.min(value, remaining[flat] ?? 0),
  );
  // Spread `overflow` over the given slots in proportion to their headroom,
  // returning what would not fit.
  const pour = (overflow: number, slots: number[]): number => {
    if (overflow <= 0) return 0;
    const room = slots.map((flat) =>
      Math.max(0, (remaining[flat] ?? 0) - fitted[flat]!),
    );
    const total = room.reduce((sum, value) => sum + value, 0);
    if (total <= 0) return overflow;
    const poured = Math.min(overflow, total);
    slots.forEach((flat, slot) => {
      fitted[flat] = fitted[flat]! + (poured * room[slot]!) / total;
    });
    return overflow - poured;
  };

  const flats = (indices: number[], parts: number[]) =>
    indices.flatMap((index) => parts.map((part) => index * PARTS + part));
  const all = subOrders.map((_, index) => index);
  const namedIndices = all.filter((index) => named.has(index));
  const otherIndices = all.filter((index) => !named.has(index));

  let leftover = 0;
  for (let part = 0; part < PARTS; part += 1) {
    let overflow = 0;
    for (const index of all) {
      const flat = index * PARTS + part;
      overflow += Math.max(0, want[flat]! - (remaining[flat] ?? 0));
    }
    overflow = pour(overflow, flats(namedIndices, [part]));
    overflow = pour(overflow, flats(otherIndices, [part]));
    leftover += overflow;
  }
  leftover = pour(leftover, flats(namedIndices, [0, 1, 2, 3]));
  leftover = pour(leftover, flats(otherIndices, [0, 1, 2, 3]));
  if (quantizeToCurrency(leftover, currency) > 0.02) return null;

  // Quantized part by part, never rescaled: a part filled to exactly what it
  // has left must stay there, or the half-cent check would reject it. The
  // cent or two of rounding is absorbed where the split is applied.
  const quantized = fitted.map((value) => quantizeToCurrency(value, currency));
  // Many parts each rounded half a cent can still add up to more drift than
  // `backsFromAllocation` absorbs, so the difference lands here: a shortfall
  // on the slot with the most room left, an excess on the biggest slot.
  const drift = quantizeToCurrency(
    amount - quantized.reduce((sum, value) => sum + value, 0),
    currency,
  );
  if (drift !== 0) {
    let target = 0;
    const score = (flat: number) =>
      drift > 0 ? (remaining[flat] ?? 0) - quantized[flat]! : quantized[flat]!;
    for (let flat = 1; flat < quantized.length; flat += 1) {
      if (score(flat) > score(target)) target = flat;
    }
    quantized[target] = quantizeToCurrency(quantized[target]! + drift, currency);
  }
  return subOrders.flatMap((sub, index) => {
    const parts = quantized.slice(index * PARTS, index * PARTS + PARTS);
    if (parts.every((value) => value <= 0) && !named.has(index)) return [];
    const retained = retainedByIndex.get(index);
    return [
      {
        vendorId: sub.vendorId ?? null,
        merchandise: parts[0] ?? 0,
        shipping: parts[1] ?? 0,
        tax: parts[2] ?? 0,
        duty: parts[3] ?? 0,
        ...(retained ? { commissionRetained: retained } : {}),
      },
    ];
  });
}

/**
 * What the sale booked for each part of each consignment, less what earlier
 * refunds already reversed — flat per consignment then part, never negative.
 */
function remainingParts(
  decomposition: OrderDecomposition,
  alreadyReversed?: readonly number[] | null,
): number[] {
  const currency = decomposition.currency;
  return decomposition.shares.flatMap((share, index) =>
    [share.merchandise, share.shipping, share.tax, share.duty].map(
      (value, part) =>
        Math.max(
          0,
          quantizeToCurrency(
            value - money(alreadyReversed?.[index * PARTS + part]),
            currency,
          ),
        ),
    ),
  );
}

/**
 * How much of each consignment's charge no refund has reversed yet.
 *
 * The ceiling on what calling one consignment off can still give back: an
 * earlier refund that already took part of it — a goodwill credit spread over
 * the order, say — has handed that part back once, and refunding the whole
 * consignment again would hand it back twice.
 */
export function unreversedConsignmentTotals(
  decomposition: OrderDecomposition,
  alreadyReversed?: readonly number[] | null,
): number[] {
  const remaining = remainingParts(decomposition, alreadyReversed);
  return decomposition.shares.map((_, index) =>
    quantizeToCurrency(
      remaining
        .slice(index * PARTS, index * PARTS + PARTS)
        .reduce((sum, value) => sum + value, 0),
      decomposition.currency,
    ),
  );
}

/**
 * What a refund reverses when it belongs to some consignments and not others.
 *
 * `refundBacks` prorates a refund nobody itemised over what is left of the
 * WHOLE order. That is right for "some money back on this order" and wrong for
 * "this seller's parcel was called off": the refund was spread over every
 * seller, so a vendor who had delivered lost a share of their payable to
 * somebody else's cancellation, and the cancelled consignment kept payable
 * that no sale would ever back. The same happens to a split cash order refunded
 * while one parcel is still out: part of the refund landed on a consignment
 * whose money never arrived, where no entry could post it.
 *
 * `include` names, by position, the consignments the refund belongs to. The
 * refund is prorated over what is left of those alone — their own goods,
 * delivery, tax and duty, in the proportion the sale booked them. If they have
 * less left than the refund, the rest is spread over the others rather than
 * dropped, so the parts still add up to the money that moved.
 *
 * Null when nothing included has anything left to reverse; the caller then
 * prorates across the order as before.
 */
export function scopedRefundBacks(params: {
  decomposition: OrderDecomposition;
  amount: number;
  include: ReadonlyArray<boolean>;
  alreadyReversed?: readonly number[] | null;
}): number[] | null {
  const { decomposition, include } = params;
  const currency = decomposition.currency;
  const amount = quantizeToCurrency(Math.max(0, money(params.amount)), currency);
  if (amount <= 0) return null;

  const remaining = remainingParts(decomposition, params.alreadyReversed);
  const inScope = remaining.map((value, flat) =>
    include[Math.floor(flat / PARTS)] ? value : 0,
  );
  const scopeTotal = quantizeToCurrency(
    inScope.reduce((sum, value) => sum + value, 0),
    currency,
  );
  if (scopeTotal <= 0) return null;

  const fromScope = Math.min(amount, scopeTotal);
  const backs = allocate(fromScope, inScope, currency);

  const excess = quantizeToCurrency(amount - fromScope, currency);
  if (excess > 0) {
    const outOfScope = remaining.map((value, flat) =>
      include[Math.floor(flat / PARTS)] ? 0 : value,
    );
    const spill = allocate(
      excess,
      outOfScope.some((value) => value > 0) ? outOfScope : inScope,
      currency,
    );
    spill.forEach((value, index) => {
      backs[index] = quantizeToCurrency((backs[index] ?? 0) + value, currency);
    });
  }

  return backs;
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
  /**
   * What the reversed sale is taken out of. `cash` for a refund — money going
   * back. `receivable` for the part of a called-off pre-order's sale whose
   * balance never arrived: nothing is paid back for it, the shopper simply no
   * longer owes it. See `balanceWriteOffPostings`. `store_credit` for a refund
   * to store credit (R8): nothing leaves, and the shopper is owed it as credit.
   */
  against?: "cash" | "receivable" | "store_credit";
  /** Key and source overrides, for the write-off, which is not a refund. */
  keyBase?: string;
  sourceKind?: (typeof LEDGER_SOURCE_KIND)[keyof typeof LEDGER_SOURCE_KIND];
  note?: string;
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
  const sourceKind = params.sourceKind ?? LEDGER_SOURCE_KIND.REFUND;
  const source = {
    kind: sourceKind,
    id: (params.refundId ?? params.order._id) as Types.ObjectId,
    ref: params.order.orderNumber ?? null,
  };
  const custody = {
    paymentMethod: params.order.paymentMethod,
    channel: params.order.channel,
    stripePaymentIntentId: params.order.stripePaymentIntentId,
    paymentCustody: params.order.paymentCustody,
  };
  // What the reversal comes out of — see `against`.
  const cashAccount =
    params.against === "receivable"
      ? LEDGER_ACCOUNT.CUSTOMER_RECEIVABLE
      : params.against === "store_credit"
        ? LEDGER_ACCOUNT.STORE_CREDIT_PAYABLE
        : cashAccountFor(params.order);
  const noteFor = (order: PostingOrder) => params.note ?? assumedNote(order);

  const entries: LedgerPosting[] = [];
  const keyBase =
    params.keyBase ??
    String(params.refundId ?? `${String(params.order._id)}-${amount}`);

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
  const storeFunded = storeFundedDiscountShares(params.order, currency);
  const storeFundedShipping = storeFundedShippingShares(params.order, currency);
  // A refund that did not say what it was made of is a slice of the whole
  // sale, and the payout engine reads it as exactly that (`payableRatioFor`).
  // One that did names what came back, and what it does not name stays sold.
  const prorated = !params.allocation || params.allocation.length === 0;
  const orderCalledOff =
    String(params.order.status || "").trim().toLowerCase() === CANCELLED_STATUS;

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
      postingKey(sourceKind, keyBase, part, vendorId || index);
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
        note: noteFor(params.order),
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
        note: noteFor(params.order),
        key: line("duty-back"),
      });
    }

    // A called-off pre-order's balance that never arrived is not refunded —
    // nobody paid it. Its part of the sale comes off against what the shopper
    // owed instead, once, in `balanceWriteOffPostings`, however many refunds
    // the cancellation took. Unwinding a share of it here with every refund
    // undid only that refund's fraction of a balance the shopper will now
    // never be asked for, and left the rest standing as a debt and a sale.

    // Delivery handed back, out of wherever the charge sits now: shipping
    // income for the store's own delivery, so the shipping margin the overview
    // reports stays the difference between what was kept and what a carrier
    // cost; the vendor's payable when the vendor earned it.
    const vendorEarnedShipping = !isOwn && vendorEarnsShipping(sub);
    // The store's half of a delivery it paid for through a free-shipping
    // coupon. The sale credited the vendor the whole rated charge, so the
    // whole rated charge is what comes off them again — but only for a
    // consignment CALLED OFF, where nobody delivered anything, and in the same
    // proportion as the delivery going back (a delivery the store paid for in
    // full charged the shopper nothing, so the consignment's own refund ratio
    // stands in). A delivery that was made stays earned whatever is refunded
    // afterwards: the shopper never paid the store's part of it, so no refund
    // of the shopper's money carries it back. Taken back on a return, the
    // books said the seller was owed nothing for a parcel they delivered while
    // the payout engine paid them for it (`sumVendorPayable` keeps it too).
    const fundedShipping = vendorEarnedShipping
      ? (storeFundedShipping[index] ?? 0)
      : 0;
    const chargedHere = share.merchandise + share.shipping + share.tax + share.duty;
    const backHere = merchandiseBack + shippingBack + taxBack + dutyBack;
    const calledOff = orderCalledOff || sub.status === CANCELLED_STATUS;
    const shippingBackRatio = !calledOff
      ? 0
      : share.shipping > 0
        ? shippingBack / share.shipping
        : chargedHere > 0
          ? Math.min(1, backHere / chargedHere)
          : 0;
    const shippingPromotionBack =
      fundedShipping > 0 && shippingBackRatio > 0
        ? quantizeToCurrency(fundedShipping * shippingBackRatio, currency)
        : 0;
    // The mirror of the sale's promotion for a seller who took the cash: the
    // store's share of the delivery stops being owed to them.
    if (shippingPromotionBack > 0 && !platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
        credit: LEDGER_ACCOUNT.PROMOTIONS,
        amount: shippingPromotionBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: noteFor(params.order),
        key: line("shipping-promotion-back"),
      });
    }
    // A parcel the store's own label carried, on a sale the seller took the
    // cash for: the store billed them the delivery (`shippingToStorePostings`),
    // and that bill falls with the delivery handed back — the seller paid it
    // back to the shopper out of the cash they hold. Left standing, the books
    // went on billing a delivery the commission invoice had stopped billing,
    // or not, depending only on which of the two happened first. Only for a
    // label bought before the refund: one bought after billed what was left
    // of the delivery then, refund already taken off.
    if (
      shippingBack > 0 &&
      !platformHoldsCash &&
      !isOwn &&
      !vendorEarnedShipping &&
      sub.platformLabelAt &&
      new Date(sub.platformLabelAt).getTime() <= date.getTime()
    ) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.SHIPPING_INCOME,
        credit: LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
        amount: shippingBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: noteFor(params.order),
        key: line("shipping-billed-back"),
      });
    }
    if (shippingBack + shippingPromotionBack > 0 && platformHoldsCash) {
      entries.push({
        date,
        book,
        debit: vendorEarnedShipping
          ? LEDGER_ACCOUNT.VENDOR_PAYABLE
          : LEDGER_ACCOUNT.SHIPPING_INCOME,
        credit: cashAccount,
        amount: shippingBack + shippingPromotionBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: noteFor(params.order),
        key: line("shipping-back"),
      });
      if (shippingPromotionBack > 0) {
        entries.push({
          date,
          book,
          debit: cashAccount,
          credit: LEDGER_ACCOUNT.PROMOTIONS,
          amount: shippingPromotionBack,
          currency,
          source,
          vendorId: sub.vendorId as Types.ObjectId,
          note: noteFor(params.order),
          key: line("shipping-promotion-back"),
        });
      }
    }

    if (isOwn) {
      if (merchandiseBack <= 0) return;
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.REFUNDS,
        credit: cashAccount,
        amount: merchandiseBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: noteFor(params.order),
        key: line("refund"),
      });
      return;
    }

    // The same split the sale used, applied to the same merchandise figure.
    const subtotal = money(sub.subtotal);
    const commissionRatio = subtotal > 0 ? money(sub.commission) / subtotal : 0;
    // A store-funded discount goes back with the goods, in proportion: the
    // sale being unwound was made at the full price, and the store's share of
    // it stops being a cost. Measured against the sale's own cash share, so
    // several refunds together take back exactly what the sale posted.
    const funded = storeFunded[index] ?? 0;
    // Goods the store paid for charged the shopper nothing, so there is no
    // cash share to measure the reversal against — the consignment's own
    // refund ratio stands in, for a consignment called off and for a refund
    // that named nothing (read as a slice of the whole sale, goods included,
    // by the payout engine too). Left at zero, a 100%-off order refunded for
    // its delivery kept the seller's payable and the store's promotion
    // standing for goods nobody received. Not for a refund that named what it
    // was: one that handed back only the delivery took the goods' promotion
    // out of the seller's payable while the payout engine paid them for the
    // goods they had delivered.
    const merchandiseBackRatio =
      share.merchandise > 0
        ? merchandiseBack / share.merchandise
        : (calledOff || prorated) && chargedHere > 0
          ? Math.min(1, backHere / chargedHere)
          : 0;
    const promotionBack =
      funded > 0 && merchandiseBackRatio > 0
        ? quantizeToCurrency(funded * merchandiseBackRatio, currency)
        : 0;

    // Nothing of this consignment's sale is coming back: neither the shopper's
    // money nor the store's own promotion on it.
    if (merchandiseBack + promotionBack <= 0) return;

    const soldForBack = quantizeToCurrency(merchandiseBack + promotionBack, currency);
    // Less whatever the platform kept as a refund administration fee. Held
    // back rather than reversed, so it stays as commission income and the
    // vendor's payable absorbs it — the shopper is refunded the same either
    // way. Zero or absent means the whole cut comes back, which is what every
    // refund did before the fee existed.
    const retained = Math.min(
      Math.max(0, money(retainedByVendor.get(vendorId))),
      soldForBack * commissionRatio,
    );
    const commissionBack = quantizeToCurrency(
      soldForBack * commissionRatio - retained,
      currency,
    );
    const vendorBack = quantizeToCurrency(
      soldForBack - commissionBack,
      currency,
    );

    if (promotionBack > 0) {
      entries.push({
        date,
        book,
        debit: platformHoldsCash
          ? cashAccount
          : LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
        credit: LEDGER_ACCOUNT.PROMOTIONS,
        amount: promotionBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: noteFor(params.order),
        key: line("promotion-back"),
      });
    }

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
        note: noteFor(params.order),
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
        note: noteFor(params.order),
        key: line("payable-back"),
      });
    }
  });

  return entries;
}

/**
 * The part of a called-off pre-order's sale whose balance never arrived.
 *
 * A deposit pre-order posts its WHOLE sale when the deposit lands, with the
 * balance sitting in `customer_receivable` until it arrives. Called off before
 * it did, only the deposit goes back to the shopper, so a refund can only ever
 * unwind the deposit's part — and the rest stayed on the books for good: a
 * debt the shopper will never be asked for, commission income on goods that
 * never shipped, and a vendor payable no sale backs. On a 100 order with a 40
 * deposit, cancelling left 60 owed, 6 of commission and 54 owed to the vendor.
 *
 * This takes that part off against the receivable, per consignment that was
 * called off (or all of them, when the order itself was), in the proportions
 * the sale booked it. It is never more than the consignment's balance, nor
 * more than refunds have left of its sale, so it is the same whether it runs
 * before the deposit refund or after it. Keyed per consignment, so however
 * many times a cancellation path asks, it is written once.
 *
 * Nothing at all once the balance arrived: then the whole sale was paid for,
 * and refunding it is what unwinds it.
 */
/**
 * A cancelled consignment the shopper never paid a penny for.
 *
 * An order the store's own coupon paid for in full is a real sale: the seller
 * is owed their goods and charged commission on them, and the store carries
 * the discount as a promotion. Called off, none of that is true any more — and
 * no refund can unwind it, because there is no money to send back, so nothing
 * ever did: the seller kept a payable for goods nobody received and the store
 * kept the cost of a promotion that bought nothing.
 *
 * Only consignments whose whole charge was zero are written off here. Anything
 * the shopper actually paid for comes back through the refund that returns it,
 * which reverses the store's share of it in the same proportion.
 */
export function storeFundedCancellationPostings(params: {
  order: PostingOrder;
  context: OrderPostingContext;
  /** Consignments called off; omitted means every cancelled one on the order. */
  cancelledSubOrderIds?: ReadonlyArray<unknown> | null;
  date?: Date;
}): LedgerPosting[] {
  const { order } = params;
  const decomposition = decomposeOrder(order);
  if (!decomposition) return [];
  const { currency } = decomposition;
  const subOrders = (order.subOrders || []).filter(Boolean);
  const funded = storeFundedDiscountShares(order, currency);
  const orderCalledOff =
    String(order.status || "").trim().toLowerCase() === CANCELLED_STATUS;
  const named = params.cancelledSubOrderIds?.length
    ? new Set(params.cancelledSubOrderIds.map((id) => String(id)))
    : null;
  const date = params.date || new Date();
  const source = {
    kind: LEDGER_SOURCE_KIND.ORDER,
    id: order._id as Types.ObjectId,
    ref: order.orderNumber ?? null,
  };

  const entries: LedgerPosting[] = [];
  subOrders.forEach((sub, index) => {
    const cancelled = named
      ? named.has(String(sub._id))
      : orderCalledOff || sub.status === CANCELLED_STATUS;
    if (!cancelled) return;
    if (!isConsignmentCollected(order, sub)) return;

    const vendorId = sub.vendorId ? String(sub.vendorId) : "";
    if (params.context.defaultVendorIds.has(vendorId)) return;

    const share = decomposition.shares[index]!;
    const charged = share.merchandise + share.shipping + share.tax + share.duty;
    // The shopper paid something for this one, so the refund unwinds it.
    if (charged > 0) return;

    const gift = quantizeToCurrency(funded[index] ?? 0, currency);
    if (gift <= 0) return;

    const subtotal = money(sub.subtotal);
    const commissionRatio = subtotal > 0 ? money(sub.commission) / subtotal : 0;
    const commissionBack = quantizeToCurrency(gift * commissionRatio, currency);
    const vendorBack = quantizeToCurrency(gift - commissionBack, currency);
    const line = (part: string) =>
      postingKey(LEDGER_SOURCE_KIND.ORDER, order._id, part, vendorId || index);
    const book: LedgerBook = LEDGER_BOOK.MARKETPLACE;

    if (vendorBack > 0) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.VENDOR_PAYABLE,
        credit: LEDGER_ACCOUNT.PROMOTIONS,
        amount: vendorBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: "Cancelled — the store's own discount paid for this sale",
        key: line("cancel-payable-back"),
      });
    }
    if (commissionBack > 0) {
      entries.push({
        date,
        book,
        debit: LEDGER_ACCOUNT.COMMISSION_INCOME,
        credit: LEDGER_ACCOUNT.PROMOTIONS,
        amount: commissionBack,
        currency,
        source,
        vendorId: sub.vendorId as Types.ObjectId,
        note: "Cancelled — the store's own discount paid for this sale",
        key: line("cancel-commission-back"),
      });
    }
  });

  return entries;
}

export function balanceWriteOffPostings(params: {
  order: PostingOrder;
  context: OrderPostingContext;
  /** What refunds already reversed, flat per consignment then part. */
  alreadyReversed?: readonly number[] | null;
  date?: Date;
  /**
   * What the books still hold as owed by the shopper, per vendor, for this
   * order — the ceiling on what can be written off. The caller reads it from
   * the ledger, which is the only place that knows whether a consignment's
   * balance was already collected, or already written off, before it was
   * called off. Without it the order's own balance date is the best guess.
   */
  receivableByVendor?: ReadonlyMap<string, number> | null;
}): LedgerPosting[] {
  const { order } = params;
  const receivable = params.receivableByVendor ?? null;
  if (!receivable && toDate(order.preorderBalancePaidAt)) return [];
  const decomposition = decomposeOrder(order);
  if (!decomposition) return [];
  const subOrders = (order.subOrders || []).filter(Boolean);
  const orderCalledOff =
    String(order.status || "").trim().toLowerCase() === CANCELLED_STATUS;
  const unreversed = unreversedConsignmentTotals(
    decomposition,
    params.alreadyReversed,
  );
  const custody = {
    paymentMethod: order.paymentMethod,
    channel: order.channel,
    stripePaymentIntentId: order.stripePaymentIntentId,
    paymentCustody: order.paymentCustody,
  };

  const entries: LedgerPosting[] = [];
  subOrders.forEach((sub, index) => {
    if (!orderCalledOff && sub.status !== CANCELLED_STATUS) return;
    if (!isConsignmentCollected(order, sub)) return;
    const vendorId = sub.vendorId ? String(sub.vendorId) : "";
    const isOwn = params.context.defaultVendorIds.has(vendorId);
    // The balance was only ever raised as a receivable where the store holds
    // the money — see the outstanding pair in `orderPaidPostings`.
    if (!isOwn && !isPlatformSettled(custody, sub)) return;

    const outstanding = decomposition.shares[index]?.outstanding ?? 0;
    const stillOwed = receivable
      ? Math.max(0, receivable.get(vendorId) ?? 0)
      : Number.POSITIVE_INFINITY;
    const writeOff = quantizeToCurrency(
      Math.min(outstanding, unreversed[index] ?? 0, stillOwed),
      decomposition.currency,
    );
    if (writeOff <= 0) return;

    const backs = scopedRefundBacks({
      decomposition,
      amount: writeOff,
      include: subOrders.map((_, position) => position === index),
      alreadyReversed: params.alreadyReversed,
    });
    if (!backs) return;

    entries.push(
      ...refundPostings({
        order,
        amount: writeOff,
        refundId: order._id,
        date: params.date,
        context: params.context,
        alreadyReversed: params.alreadyReversed,
        allocation: [
          {
            vendorId: sub.vendorId,
            merchandise: backs[index * PARTS] ?? 0,
            shipping: backs[index * PARTS + 1] ?? 0,
            tax: backs[index * PARTS + 2] ?? 0,
            duty: backs[index * PARTS + 3] ?? 0,
          },
        ],
        against: "receivable",
        keyBase: `${String(order._id)}:balance-write-off`,
        sourceKind: LEDGER_SOURCE_KIND.ORDER,
        note: "Pre-order balance no longer owed — it was called off before it arrived",
      }),
    );
  });
  return entries;
}

/**
 * The store's own goods back on the shelf, taken back out of cost of goods.
 *
 * The sale moved what its units cost out of stock and into cost of goods. A
 * cancellation that put them back, or a return that restocked them, left that
 * cost standing, so a cancelled order read as a loss of what its goods cost
 * and stock on hand came up short by exactly the units sitting on the shelf.
 *
 * Only units actually restocked count. A refund on its own moves no goods, and
 * a return too damaged to resell is a real loss that stays where it is. Each
 * unit is priced at the cost the SALE snapshotted, never today's, and the
 * total is capped at what the books still carry for that seller on this order
 * — so a cost that was never booked (an unpaid order called off, a product
 * with no cost) is never reversed, however the event is replayed.
 *
 * `eventKey` names what put the units back — `restock` for a cancellation,
 * `return-<id>` for a return — and rides in the key with the seller, so each
 * event reverses its units once.
 */
export function restockCostPostings(params: {
  order: PostingOrder;
  context: OrderPostingContext;
  restocked: ReadonlyArray<{
    /** The consignment the units came from, when the caller knows it. */
    subOrderId?: unknown;
    productId?: unknown;
    variantId?: unknown;
    quantity?: number | null;
  }>;
  /** Cost of goods the books still carry per vendor on this order. */
  standingByVendor: ReadonlyMap<string, number>;
  eventKey: string;
  date?: Date;
}): LedgerPosting[] {
  const { order } = params;
  const currency = String(order.currency || "").toUpperCase();
  if (!currency || !params.eventKey) return [];
  const subOrders = (order.subOrders || []).filter(Boolean);
  const unitKey = (productId: unknown, variantId: unknown) =>
    `${String(productId ?? "")}:${variantId ? String(variantId) : ""}`;

  // Each own consignment's lines, with how many units each can still give back
  // in this call — a restocked line never takes more than the sale sold.
  const pools = subOrders.map((sub) =>
    params.context.defaultVendorIds.has(sub.vendorId ? String(sub.vendorId) : "")
      ? (sub.items || []).map((item) => ({
          key: unitKey(item?.productId, item?.variantId),
          cost: Number(item?.cost),
          left: Math.max(0, money(item?.quantity)),
        }))
      : null,
  );

  const costByVendor = new Map<string, number>();
  for (const line of params.restocked) {
    let wanted = Math.max(0, money(line.quantity));
    const key = unitKey(line.productId, line.variantId);
    for (const [index, sub] of subOrders.entries()) {
      if (wanted <= 0) break;
      const pool = pools[index];
      if (!pool) continue;
      if (line.subOrderId && String(sub._id) !== String(line.subOrderId)) continue;
      for (const item of pool) {
        if (wanted <= 0) break;
        if (item.key !== key || item.left <= 0) continue;
        const take = Math.min(wanted, item.left);
        item.left -= take;
        wanted -= take;
        // A unit with no recorded cost posted nothing at the sale, so it has
        // nothing to give back.
        if (!Number.isFinite(item.cost) || item.cost < 0) continue;
        const vendorId = String(sub.vendorId);
        costByVendor.set(vendorId, (costByVendor.get(vendorId) ?? 0) + item.cost * take);
      }
    }
  }

  const entries: LedgerPosting[] = [];
  for (const [vendorId, cost] of costByVendor) {
    const amount = quantizeToCurrency(
      Math.min(cost, Math.max(0, params.standingByVendor.get(vendorId) ?? 0)),
      currency,
    );
    if (amount <= 0) continue;
    entries.push({
      date: params.date || new Date(),
      book: LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.INVENTORY,
      credit: LEDGER_ACCOUNT.COST_OF_GOODS,
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.ORDER,
        id: order._id as Types.ObjectId,
        ref: order.orderNumber ?? null,
      },
      vendorId,
      note: "Back in stock — what these units cost comes off cost of goods",
      key: postingKey(
        LEDGER_SOURCE_KIND.ORDER,
        order._id,
        "cogs-back",
        params.eventKey,
        vendorId,
      ),
    });
  }
  return entries;
}

/**
 * A chargeback fee in the order's own currency, where the order says how.
 *
 * A gateway takes the fee from its balance, which is in the ACCOUNT's
 * settlement currency — a Stripe account settling in euros charges a €20
 * dispute fee on a dollar sale. Posted as charged, it opened a euro set of
 * books holding nothing but that fee: a negative euro gateway balance the
 * overview rightly called impossible, on a store that never sold in euros.
 *
 * The order already records the rate between the two, from the same account,
 * for its processing fee — and that fee is converted with it. The dispute fee
 * is converted the same way; a fee in any other currency, or on an order with
 * no rate, still posts as it was charged.
 */
export function disputeFeeInOrderCurrency(
  order: Pick<PostingOrder, "currency" | "paymentFeeCurrency" | "paymentFeeRate">,
  params: { amount: number; currency: string; note?: string },
): { amount: number; currency: string; note?: string } {
  const orderCurrency = String(order.currency || "").toUpperCase();
  const feeCurrency = String(params.currency || "").toUpperCase();
  if (
    !orderCurrency ||
    feeCurrency === orderCurrency ||
    String(order.paymentFeeCurrency || "").toUpperCase() !== feeCurrency
  ) {
    return params;
  }
  const converted = feeInChargeCurrency({
    fee: params.amount,
    feeCurrency,
    chargeCurrency: orderCurrency,
    rate: order.paymentFeeRate,
  });
  if (!converted || converted <= 0) return params;
  return {
    amount: converted,
    currency: orderCurrency,
    note: [
      params.note,
      `converted from ${params.amount} ${feeCurrency} at the order's own rate`,
    ]
      .filter(Boolean)
      .join("; "),
  };
}

/**
 * What a card network charged the store for a chargeback.
 *
 * A cost of taking card payments, like the processing fee, dated when the
 * gateway took it. Given back — in part or whole — when the store wins the
 * dispute, which is the `returned` mirror under its own key. Posted in the
 * currency it is handed: the order's own where the order records a rate for
 * the gateway's currency (see `disputeFeeInOrderCurrency`), and otherwise the
 * one the gateway charged it in — inventing a rate would be worse than a
 * report that names the currency.
 *
 * The disputed money itself is not here. It is recorded as a refund — the
 * shopper's bank handed it back — so the sale, the vendor's payable and the
 * payout's clawback all unwind through the one path every refund takes.
 */
export function disputeFeePostings(params: {
  disputeId: string;
  orderId: unknown;
  orderNumber?: string | null;
  amount: number;
  currency: string;
  date: Date;
  book: LedgerBook;
  returned?: boolean;
  /**
   * Which of several fees on one dispute this is. PayPal lists each fee it
   * moves — a dispute fee, a chargeback fee, a transaction fee it gives back —
   * and one key per dispute would post only the first. Left out, the key is
   * the one a single fee each way was always posted under.
   */
  part?: string;
  /** Added to the entry's note — what the gateway actually charged, when converted. */
  note?: string;
}): LedgerPosting[] {
  const currency = String(params.currency || "").toUpperCase();
  const amount = quantizeToCurrency(money(params.amount), currency);
  if (!currency || amount <= 0 || !params.disputeId) return [];
  return [
    {
      date: params.date,
      book: params.book,
      debit: params.returned
        ? LEDGER_ACCOUNT.CASH_GATEWAY
        : LEDGER_ACCOUNT.PROCESSING_FEES,
      credit: params.returned
        ? LEDGER_ACCOUNT.PROCESSING_FEES
        : LEDGER_ACCOUNT.CASH_GATEWAY,
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.ORDER,
        id: params.orderId as Types.ObjectId,
        ref: params.orderNumber ?? null,
      },
      note: `${
        params.returned
          ? `Chargeback fee returned — dispute ${params.disputeId} won`
          : `Chargeback fee — dispute ${params.disputeId}`
      }${params.note ? ` (${params.note})` : ""}`,
      key: postingKey(
        LEDGER_SOURCE_KIND.ORDER,
        params.orderId,
        "dispute",
        params.disputeId,
        params.returned ? "fee-returned" : "fee",
        params.part || undefined,
      ),
    },
  ];
}

/**
 * What a chargeback took beyond the sale, moved to the books.
 *
 * `amount` is a change, not a balance: a loss booked (`returned` false) or
 * given back when the store wins the money back (`returned` true). Each change
 * is its own entry under its own `part`, so the loss can grow, shrink and
 * return across several reads of one dispute and the entries always add up to
 * what the gateway is still holding beyond the sale.
 */
export function chargebackLossPostings(params: {
  disputeId: string;
  orderId: unknown;
  orderNumber?: string | null;
  amount: number;
  currency: string;
  date: Date;
  book: LedgerBook;
  returned?: boolean;
  part: number;
}): LedgerPosting[] {
  const currency = String(params.currency || "").toUpperCase();
  const amount = quantizeToCurrency(money(params.amount), currency);
  if (!currency || amount <= 0 || !params.disputeId) return [];
  return [
    {
      date: params.date,
      book: params.book,
      debit: params.returned
        ? LEDGER_ACCOUNT.CASH_GATEWAY
        : LEDGER_ACCOUNT.CHARGEBACK_LOSSES,
      credit: params.returned
        ? LEDGER_ACCOUNT.CHARGEBACK_LOSSES
        : LEDGER_ACCOUNT.CASH_GATEWAY,
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.ORDER,
        id: params.orderId as Types.ObjectId,
        ref: params.orderNumber ?? null,
      },
      note: params.returned
        ? `Chargeback beyond the sale returned — dispute ${params.disputeId}`
        : `Chargeback beyond what was left of the sale — dispute ${params.disputeId}`,
      key: postingKey(
        LEDGER_SOURCE_KIND.ORDER,
        params.orderId,
        "dispute",
        params.disputeId,
        "beyond-sale",
        params.part,
      ),
    },
  ];
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
  /**
   * What the refund was booked against, which the reversal puts back: a
   * refund to store credit (R8) came out of the credit owed, not cash.
   */
  against?: "store_credit";
  /** Why it is reversed; a gateway's failure unless said otherwise. */
  note?: string;
}): LedgerPosting[] {
  const { note, ...refund } = params;
  return refundPostings(refund).map((entry) => ({
    ...entry,
    date: params.date || new Date(),
    debit: entry.credit,
    credit: entry.debit,
    key: `${entry.key}:reversal`,
    note: note || "Refund failed at the gateway",
  }));
}

/** A payout clearing: a liability settled, never an expense. */
/** Whether checkout said the vendor earns this consignment's delivery. */
function shippingStampedToVendor(sub: PostingSubOrder): boolean {
  return String(sub.shippingRevenueTo || "") === SHIPPING_REVENUE_TO.VENDOR;
}

/**
 * A label bought on the store's own carrier account for a parcel whose
 * delivery the vendor was going to earn: the store paid to deliver it after
 * all, so the delivery charge the sale owed the vendor becomes the store's.
 *
 * Keyed by the label booking rather than the consignment, so a label voided
 * and bought again moves the charge once per booking, each reversed by its own
 * void — and a replay of the same booking posts nothing new. `amount` is what
 * of the consignment's delivery is still unrefunded; the caller works it out
 * from the same decomposition the sale posted.
 */
export function shippingToStorePostings(params: {
  orderId: unknown;
  orderNumber?: string | null;
  vendorId?: unknown;
  shipmentId: unknown;
  bookingSequence?: number | null;
  amount: number;
  currency: string;
  date: Date;
  /** Hand the charge back to the vendor — the label was voided and refunded. */
  reversal?: boolean;
  /**
   * The vendor took the shopper's money at the door, so there is no payable to
   * take the charge out of: the store delivered a parcel it was never paid for
   * and bills them for it, alongside the commission they already owe.
   */
  billToVendor?: boolean;
}): LedgerPosting[] {
  const currency = String(params.currency || "").toUpperCase();
  const amount = quantizeToCurrency(money(params.amount), currency);
  if (!currency || amount <= 0) return [];
  const booking = labelKey(params.shipmentId, params.bookingSequence);
  const owed = params.billToVendor
    ? LEDGER_ACCOUNT.COMMISSION_RECEIVABLE
    : LEDGER_ACCOUNT.VENDOR_PAYABLE;
  return [
    {
      date: params.date,
      book: LEDGER_BOOK.MARKETPLACE,
      debit: params.reversal ? LEDGER_ACCOUNT.SHIPPING_INCOME : owed,
      credit: params.reversal ? owed : LEDGER_ACCOUNT.SHIPPING_INCOME,
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.ORDER,
        id: params.orderId as Types.ObjectId,
        ref: params.orderNumber ?? null,
      },
      vendorId: params.vendorId as Types.ObjectId,
      note: params.reversal
        ? params.billToVendor
          ? "Delivery no longer billed to the vendor — the store's label was voided"
          : "Delivery charge back to the vendor — the store's label was voided"
        : params.billToVendor
          ? "Delivery billed to the vendor — the store's courier carried a parcel they took the cash for"
          : "Delivery charge to the store — delivered on the store's carrier account",
      key: `${booking}:${params.billToVendor ? "shipping-billed" : "shipping-to-store"}${params.reversal ? ":reversal" : ""}`,
    },
  ];
}

export function payoutPaidPostings(payout: {
  _id: unknown;
  payoutNumber?: string | null;
  vendorId?: unknown;
  netAmount?: number | null;
  /** Commission owed on the vendor's cash sales, deducted from this payout. */
  commissionOffset?: number | null;
  /** What the store owed on balance on those sales, paid in this payout. */
  commissionCredit?: number | null;
  /** How the money left — the account it left from. Absent means the bank. */
  paidFrom?: string | null;
  currency?: string | null;
  paidAt?: Date | null;
}): LedgerPosting[] {
  const currency = String(payout.currency || "").toUpperCase();
  const amount = money(payout.netAmount);
  const offset = money(payout.commissionOffset);
  const credit = money(payout.commissionCredit);
  if (!currency || (amount <= 0 && offset <= 0 && credit <= 0)) return [];

  const date = payout.paidAt || new Date();
  const source = {
    kind: LEDGER_SOURCE_KIND.PAYOUT,
    id: payout._id as Types.ObjectId,
    ref: payout.payoutNumber ?? null,
  };
  const entries: LedgerPosting[] = [];

  if (amount > 0) {
    entries.push({
      date,
      book: LEDGER_BOOK.MARKETPLACE,
      debit: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      // The account it actually left from. A payout handed over in cash was
      // credited to the bank, leaving the bank short and the till long.
      credit:
        payout.paidFrom === "cash"
          ? LEDGER_ACCOUNT.CASH_ON_HAND
          : payout.paidFrom === "gateway"
            ? LEDGER_ACCOUNT.CASH_GATEWAY
            : LEDGER_ACCOUNT.CASH_BANK,
      amount,
      currency,
      source,
      vendorId: payout.vendorId as Types.ObjectId,
      key: postingKey(LEDGER_SOURCE_KIND.PAYOUT, payout._id, "paid"),
    });
  }

  // The commission the vendor owed on sales they took the cash for, settled by
  // not sending that much of what they are owed. No money moves, so no cash
  // account is touched: what the platform owes the vendor and what the vendor
  // owes the platform simply come down together. Posted as income nowhere —
  // the commission was income when the sale happened, which is what raised
  // the receivable this clears.
  if (offset > 0) {
    entries.push({
      date,
      book: LEDGER_BOOK.MARKETPLACE,
      debit: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      credit: LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
      amount: offset,
      currency,
      source,
      vendorId: payout.vendorId as Types.ObjectId,
      key: postingKey(LEDGER_SOURCE_KIND.PAYOUT, payout._id, "commission-offset"),
    });
  }

  // The reverse: the store's promotions on those sales left it owing the
  // vendor, which the receivable carried as a negative. Moved to what the
  // vendor is owed, so the payout's cash entry above settles it.
  if (credit > 0) {
    entries.push({
      date,
      book: LEDGER_BOOK.MARKETPLACE,
      debit: LEDGER_ACCOUNT.COMMISSION_RECEIVABLE,
      credit: LEDGER_ACCOUNT.VENDOR_PAYABLE,
      amount: credit,
      currency,
      source,
      vendorId: payout.vendorId as Types.ObjectId,
      key: postingKey(LEDGER_SOURCE_KIND.PAYOUT, payout._id, "commission-credit"),
    });
  }

  return entries;
}

/**
 * A payout the money came back from.
 *
 * A bank transfer can bounce days after it left — a closed account, a wrong
 * IBAN — and the store is then holding money its books say it handed over.
 * The payout's own entries, flipped, under their own keys: the vendor is owed
 * it again, the cash is back in the account it left from, and the commission
 * the payout deducted is owed again.
 *
 * Reversing rather than deleting, as a failed refund is: the payment did
 * happen on the day it happened, and a ledger that quietly loses a day is
 * worse than one that shows the mistake and its correction.
 */
export function payoutReversalPostings(
  payout: Parameters<typeof payoutPaidPostings>[0] & { reversedAt?: Date | null },
): LedgerPosting[] {
  const date = payout.reversedAt || new Date();
  return payoutPaidPostings(payout).map((entry) => ({
    ...entry,
    date,
    debit: entry.credit,
    credit: entry.debit,
    key: `${entry.key}:reversal`,
    note: "Payout returned — the money came back",
  }));
}

/**
 * Where a platform payment's money landed, by the rail that carried it.
 *
 * Every provider but one is a gateway holding the money until it settles. The
 * exception is `manual`: an admin recording that a vendor handed over cash or
 * sent a bank transfer, with no gateway anywhere in it. Booked into the bank
 * for the same reason `cashAccountFor` books a hand-recorded order payment
 * there — it is money the store took itself — and booking it as a gateway
 * balance grew an account by money no gateway ever held.
 */
function platformPaymentCashAccount(provider?: string | null): LedgerAccount {
  return String(provider || "").trim().toLowerCase() === "manual"
    ? LEDGER_ACCOUNT.CASH_BANK
    : LEDGER_ACCOUNT.CASH_GATEWAY;
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
  /** Which rail carried it — see `platformPaymentCashAccount`. */
  provider?: string | null;
  benefitGrantedAt?: Date | null;
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

  const entries: LedgerPosting[] = [
    {
      date: payment.paidAt || new Date(),
      // Always the marketplace book: a single-vendor store has no vendors to
      // sell boosts or plans to, so these never appear in the own book.
      book: LEDGER_BOOK.MARKETPLACE,
      debit: platformPaymentCashAccount(payment.provider),
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
  if (payment.benefitGrantedAt !== undefined) {
    entries[0]!.credit = LEDGER_ACCOUNT.UNAPPLIED_PAYMENT_PAYABLE;
    if (payment.benefitGrantedAt) entries.push({ ...entries[0]!, date: payment.benefitGrantedAt, debit: LEDGER_ACCOUNT.UNAPPLIED_PAYMENT_PAYABLE, credit, key: `platform_payment:${payment._id}:application` });
  }
  return entries;
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
 *
 * Only the part no partial refund has already handed back. A boost refunded a
 * day at a time and then cancelled outright would otherwise be reversed twice
 * over — once in increments by `platformPaymentRefundPostings`, and again in
 * full here — and the income would end up negative by whatever the partials
 * had taken.
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
  provider?: string | null;
  /** What partial refunds already took back, cumulative. */
  alreadyRefunded?: number | null;
}): LedgerPosting[] {
  const currency = String(payment.currency || "").toUpperCase();
  const left = quantizeToCurrency(
    money(payment.amount) - Math.max(0, money(payment.alreadyRefunded)),
    currency,
  );
  return platformPaymentPostings({ ...payment, amount: left }).map((entry) => ({
    ...entry,
    date: payment.reversedAt || new Date(),
    debit: entry.credit,
    credit: entry.debit,
    key: `${entry.key}:reversal`,
    note: "Reversed by the gateway",
  }));
}

/**
 * A platform payment the gateway gave PART of back.
 *
 * Stripe reports `amount_refunded` as a running total, replayed and sometimes
 * out of order, so the only safe thing to post is the step from what had
 * already been given back to what has now — and to key it on the new total,
 * which is the one value that identifies the step uniquely. Three goodwill
 * refunds of 5 on a 30 booking post 5, 5 and 5 under three keys, and a
 * re-delivered webhook for any of them collides with its own.
 *
 * Deliberately not the same key as the full reversal, which stays the terminal
 * event and nets these out — see `platformPaymentReversalPostings`.
 *
 * Nothing at all for a step of zero: a refund too small to change the
 * quantized total is a webhook that tells us nothing new.
 */
export function platformPaymentRefundPostings(payment: {
  _id: unknown;
  kind?: string | null;
  reference?: string | null;
  vendorId?: unknown;
  currency?: string | null;
  provider?: string | null;
  /** The cumulative total given back, AFTER this refund. */
  refundedTotal?: number | null;
  /** The cumulative total before it — the entry is the difference. */
  previouslyRefunded?: number | null;
  refundedAt?: Date | null;
}): LedgerPosting[] {
  const currency = String(payment.currency || "").toUpperCase();
  if (!currency) return [];
  const total = quantizeToCurrency(
    Math.max(0, money(payment.refundedTotal)),
    currency,
  );
  const before = quantizeToCurrency(
    Math.max(0, money(payment.previouslyRefunded)),
    currency,
  );
  const step = quantizeToCurrency(total - before, currency);
  if (step <= 0) return [];

  return platformPaymentPostings({ ...payment, amount: step }).map((entry) => ({
    ...entry,
    date: payment.refundedAt || new Date(),
    debit: entry.credit,
    credit: entry.debit,
    key: postingKey(
      LEDGER_SOURCE_KIND.PLATFORM_PAYMENT,
      payment._id,
      "refunded",
      String(total),
    ),
    note: `Refunded by the gateway — ${total} ${currency} given back in total`,
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
  refundedAt?: Date | null;
  providerStateUpdatedAt?: Date | null;
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
  if (refunded > 0) {
    entries.push({
      ...entries[0]!,
      date: payment.refundedAt || payment.providerStateUpdatedAt || new Date(),
      debit: LEDGER_ACCOUNT.SUBSCRIPTION_INCOME,
      credit: LEDGER_ACCOUNT.CASH_GATEWAY,
      amount: quantizeToCurrency(refunded, currency),
      key: postingKey(
        LEDGER_SOURCE_KIND.PLATFORM_PAYMENT,
        payment._id,
        "subscription-refund",
        String(refunded),
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
    expense.paidFrom === "unpaid"
      ? // A bill received, not a seller's share of their own sales. This
        // used to credit `vendor_payable`, which raised what the marketplace
        // appeared to owe its vendors — and when the expense named one, put
        // the store's rent on that vendor's statement as a line they had
        // earned.
        LEDGER_ACCOUNT.ACCOUNTS_PAYABLE
      : expenseCashAccount(expense.paidFrom);

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
 * append-only ledger forbids: a closed month must still produce the answer it
 * was closed on. The reversal is a new entry with the accounts swapped.
 *
 * Dated with the revision it cancels, never with the day of the correction.
 * It used to be "today", while the corrected revision went back to the
 * expense's own date — so fixing a September bill in October charged September
 * twice and gave October a negative cost. A closed month is still safe:
 * `applyPeriodClose` books this entry, and the correction beside it, after the
 * close.
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
  /** The account the ORIGINAL debited — see `expensePostings`. */
  debitAccount?: string | null;
}): LedgerPosting[] {
  return expensePostings(expense).map((entry) => ({
    ...entry,
    debit: entry.credit,
    credit: entry.debit,
    key: `${entry.key}:reversal`,
    note: "Reversal of a corrected or deleted expense",
  }));
}

/** The asset an expense's money left: bank unless it says cash or gateway. */
function expenseCashAccount(paidFrom?: string | null): LedgerAccount {
  return paidFrom === "cash"
    ? LEDGER_ACCOUNT.CASH_ON_HAND
    : paidFrom === "gateway"
      ? LEDGER_ACCOUNT.CASH_GATEWAY
      : LEDGER_ACCOUNT.CASH_BANK;
}

/**
 * Paying a bill that was recorded as not yet paid.
 *
 * Its own dated event, and not a correction of the bill: the cost belonged to
 * the day of the invoice and stays there, the payable it raised is cleared on
 * the day the money actually left, and the bank balance moves then too. Doing
 * it by editing "Paid from" moved the money out on the invoice date instead.
 *
 * `sequence` rides in the key, so a payment undone and recorded again is a new
 * entry rather than a collision with the first one.
 */
export function expenseSettlementPostings(expense: {
  _id: unknown;
  book?: LedgerBook | null;
  amount?: number | null;
  currency?: string | null;
  description?: string | null;
  vendorId?: unknown;
  settlement: {
    paidAt: Date;
    paidFrom: string;
    sequence: number;
  };
}): LedgerPosting[] {
  const currency = String(expense.currency || "").toUpperCase();
  const amount = money(expense.amount);
  if (!currency || amount <= 0) return [];

  return [
    {
      date: expense.settlement.paidAt,
      book: expense.book || LEDGER_BOOK.OWN,
      debit: LEDGER_ACCOUNT.ACCOUNTS_PAYABLE,
      credit: expenseCashAccount(expense.settlement.paidFrom),
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.EXPENSE,
        id: expense._id as Types.ObjectId,
        ref: "settlement",
      },
      vendorId: expense.vendorId as Types.ObjectId,
      key: postingKey(
        LEDGER_SOURCE_KIND.EXPENSE,
        expense._id,
        "settle",
        expense.settlement.sequence,
      ),
      note: expense.description ? `Paid: ${expense.description}` : "Bill paid",
    },
  ];
}

/**
 * A recorded payment taken back — marked paid by mistake, or the transfer
 * bounced. Dated with the payment it cancels, like an expense reversal.
 */
export function expenseSettlementReversalPostings(
  expense: Parameters<typeof expenseSettlementPostings>[0],
): LedgerPosting[] {
  return expenseSettlementPostings(expense).map((entry) => ({
    ...entry,
    debit: entry.credit,
    credit: entry.debit,
    key: `${entry.key}:reversal`,
    note: "Reversal of a recorded bill payment",
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
 * A test label's cost, taken back off the books.
 *
 * A label bought on a carrier's test environment costs nothing — see
 * `isTestLabel` — and the purchase path never books one. The daily pass and the
 * backfill did: neither read the mode, so every label a merchant tried in test
 * mode paid a real shipping cost out of the bank and cut the shipping margin by
 * it. This is the mirror of that entry, dated with it, so the period it
 * distorted is the period corrected.
 */
export function testLabelCorrectionPostings(
  shipment: Parameters<typeof shipmentLabelPostings>[0] & {
    /** When the cost was booked — the correction lands on the same day. */
    bookedAt?: Date | null;
  },
): LedgerPosting[] {
  return shipmentLabelPostings(shipment).map((entry) => ({
    ...entry,
    date: shipment.bookedAt || entry.date,
    debit: entry.credit,
    credit: entry.debit,
    key: `${entry.key}:test-label`,
    note: "A test label costs nothing — the cost booked for it comes back off",
  }));
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

/**
 * Store credit that moves without a sale (R8): given by the store as goodwill,
 * or expired unspent.
 *
 * Goodwill is a cost of the store's own promotion — `promotions` — owed to the
 * shopper as credit until they spend it. Credit that expires is a debt the
 * store no longer has, taken back off the same promotion. Credit given on a
 * refund is posted by the refund (`refundPostings`, `against: "store_credit"`),
 * and credit spent by the sale it paid for (`orderPaidPostings`).
 *
 * In the store's own book, which is the store's own business: a marketplace
 * sale paid with it posts the spend in the marketplace book, so each book's
 * balance on the account can drift while the two together always equal what
 * the shoppers hold.
 */
export function storeCreditPostings(event: {
  kind: "goodwill" | "expiry";
  /** The lot given, or the expiry row. */
  id: unknown;
  amount: number;
  currency: string;
  date: Date;
  /** Shown beside the entry — the customer's name or email. */
  ref?: string | null;
}): LedgerPosting[] {
  const currency = String(event.currency || "").toUpperCase();
  const amount = quantizeToCurrency(money(event.amount), currency);
  if (!currency || !(amount > 0)) return [];
  const goodwill = event.kind === "goodwill";
  return [
    {
      date: event.date,
      book: LEDGER_BOOK.OWN,
      debit: goodwill ? LEDGER_ACCOUNT.PROMOTIONS : LEDGER_ACCOUNT.STORE_CREDIT_PAYABLE,
      credit: goodwill ? LEDGER_ACCOUNT.STORE_CREDIT_PAYABLE : LEDGER_ACCOUNT.PROMOTIONS,
      amount,
      currency,
      source: {
        kind: LEDGER_SOURCE_KIND.STORE_CREDIT,
        id: event.id as Types.ObjectId,
        ref: event.ref ?? null,
      },
      note: goodwill ? "Store credit given" : "Store credit expired unspent",
      key: postingKey(LEDGER_SOURCE_KIND.STORE_CREDIT, event.id, event.kind),
    },
  ];
}
