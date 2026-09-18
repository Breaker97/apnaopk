import { currencyMinorUnitExponent } from "@/lib/intl/money";
import { fromPaystackAmountSubunits } from "@/lib/payments/paystack";
import { fromRazorpayAmountSubunits } from "@/lib/payments/razorpay";
import { fromStripeAmount } from "@/lib/payments/stripe";
import { PAYPAL_BALANCE_REFERENCE_PREFIX } from "@/lib/payments/preorder-balance-reference";
import {
  DISPUTE_GATEWAY_LABEL,
  DISPUTE_RESPONSE_PLACE,
  type DisputeGateway,
} from "@/lib/payments/dispute-gateways";

/**
 * A dispute, as four gateways describe it, reduced to what the books need.
 *
 * Recording is shared — `applyGatewayDispute` in `order-refund-sync.ts` — so
 * what can go wrong per gateway is the reading: which field names the order,
 * how much money has actually LEFT (not how much is disputed), what counts as
 * the store winning, and which fees moved. All of it pure, for the same reason
 * the refund adapters are: none of it needs a database to be wrong in.
 *
 * One rule every reader keeps: **money is only what the gateway says moved.**
 * Opening a dispute moves nothing on Razorpay, Paystack or a PayPal claim —
 * they take the money when the store loses — and Stripe says what it took with
 * a balance transaction. When a reading cannot say what moved, `withdrawn` is
 * null and nothing is recorded or reversed on a guess: an admin is told
 * instead. A late, stale copy of a dispute must never undo a chargeback the
 * gateway really took.
 */

export type DisputeStage =
  | "opened"
  | "action_required"
  | "reminder"
  | "under_review"
  | "won"
  | "lost"
  | "closed";

export interface DisputeFeeMovement {
  /** Major units, always positive. */
  amount: number;
  currency: string;
  /** A fee given back rather than charged. */
  returned: boolean;
  /** When the gateway moved it, where it says. */
  date?: Date;
  /** What the gateway actually charged, when it was converted into the order's currency. */
  note?: string;
  /**
   * Tells two fees on one dispute apart. Absent where a gateway moves one fee
   * each way at most, which keeps the key an existing entry was posted under.
   */
  part?: string;
}

export interface GatewayDisputeReading {
  gateway: DisputeGateway;
  disputeId: string;
  /** Any one of these identifies the order. */
  locator: Record<string, unknown>;
  currency: string;
  /**
   * What the gateway has taken for this dispute and not given back, in major
   * units of the order's currency. Null when this reading does not say.
   */
  withdrawn: number | null;
  /** What it has taken over the dispute's life, returned or not. */
  taken: number | null;
  stage: DisputeStage;
  /** Human words for why, for the admin notice. */
  reason: string;
  disputedAmount: number | null;
  respondBy: Date | null;
  openedAt: Date | null;
  /** When the gateway last changed it, where it says. */
  updatedAt: Date | null;
  fees: DisputeFeeMovement[];
  /**
   * Other ids the gateway pays this dispute's money under. Paystack refunds an
   * accepted chargeback as a refund of its own, and that refund's report must
   * be recognised as this money rather than recorded a second time.
   */
  moneyIds: string[];
  /**
   * Whether a refund recorded after the dispute opened can be this dispute's
   * money. PayPal settles a claim by refunding the capture, so the refund its
   * webhook recorded and the settlement the dispute lists are one payment.
   */
  settlesThroughRefunds: boolean;
}

/** Below this, two amounts are the same money. */
export const DISPUTE_MONEY_EPSILON = 0.005;

function roundMoney(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function lower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function upper(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/** `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` → `merchandise or service not received`. */
function humanize(value: unknown): string {
  return lower(value).replace(/[_-]+/g, " ").trim();
}

function dateFrom(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function compactLocator(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => Boolean(value)));
}

// ---------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------

interface StripeBalanceTransactionLike {
  amount?: number | null;
  fee?: number | null;
  currency?: string | null;
}

export interface StripeDisputeLike {
  id?: string;
  amount?: number | null;
  currency?: string | null;
  reason?: string | null;
  status?: string | null;
  payment_intent?: string | { id?: string } | null;
  balance_transactions?: StripeBalanceTransactionLike[] | null;
  evidence_details?: { due_by?: number | null } | null;
  created?: number | null;
}

const STRIPE_STAGES: Record<string, DisputeStage> = {
  warning_needs_response: "opened",
  needs_response: "opened",
  warning_under_review: "under_review",
  under_review: "under_review",
  won: "won",
  lost: "lost",
  warning_closed: "closed",
  charge_refunded: "closed",
  prevented: "closed",
};

interface DisputeFeeAmount {
  amount: number;
  currency: string;
  note?: string;
}

function roundToCurrency(amount: number, currency: string): number {
  const factor = 10 ** currencyMinorUnitExponent(currency);
  return Math.round(amount * factor) / factor;
}

/**
 * What a Stripe dispute's balance transactions charged in fees, and what they
 * gave back, in major units. Stripe charges the fee on the withdrawal and,
 * where it returns it, credits it on the reinstatement as a negative fee.
 *
 * A balance transaction is in the account's settlement currency, which is not
 * always the order's: a store selling in USD on an account that settles in EUR
 * was charged "20 EUR", and that fee went into the books in euros beside a
 * sale in dollars. When the dispute says what the same withdrawal was in the
 * order's currency, the fee is converted at that withdrawal's own rate — the
 * rate Stripe used, not one assumed here — and the charged figure kept in the
 * note. Without both amounts it stays in the currency it was charged in.
 */
export function disputeFees(dispute: {
  amount?: number | null;
  currency?: string | null;
  balance_transactions?: StripeBalanceTransactionLike[] | null;
}): {
  charged: DisputeFeeAmount | null;
  returned: DisputeFeeAmount | null;
} {
  const disputeCurrency = lower(dispute.currency);
  const disputeMajor = disputeCurrency
    ? fromStripeAmount(Math.abs(Number(dispute.amount || 0)), disputeCurrency)
    : 0;
  const totals = {
    charged: { amount: 0, currency: "", original: 0, originalCurrency: "" },
    returned: { amount: 0, currency: "", original: 0, originalCurrency: "" },
  };

  for (const transaction of dispute.balance_transactions || []) {
    const fee = Number(transaction?.fee || 0);
    if (!Number.isFinite(fee) || fee === 0) continue;
    const feeCurrency = lower(transaction?.currency);
    if (!feeCurrency) continue;
    const feeMajor = fromStripeAmount(Math.abs(fee), feeCurrency);
    const movedMajor = fromStripeAmount(Math.abs(Number(transaction?.amount || 0)), feeCurrency);
    const convert =
      disputeCurrency && feeCurrency !== disputeCurrency && disputeMajor > 0 && movedMajor > 0;
    const amount = convert ? feeMajor * (disputeMajor / movedMajor) : feeMajor;
    const currency = convert ? disputeCurrency : feeCurrency;

    const bucket = fee > 0 ? totals.charged : totals.returned;
    bucket.currency = bucket.currency || currency;
    if (bucket.currency !== currency) continue;
    bucket.amount += amount;
    if (convert) {
      bucket.originalCurrency = bucket.originalCurrency || feeCurrency;
      if (bucket.originalCurrency === feeCurrency) bucket.original += feeMajor;
    }
  }

  const finish = (bucket: typeof totals.charged): DisputeFeeAmount | null => {
    if (bucket.amount <= 0 || !bucket.currency) return null;
    const code = bucket.currency.toUpperCase();
    return {
      amount: roundToCurrency(bucket.amount, code),
      currency: code,
      ...(bucket.original > 0
        ? {
            note: `charged ${roundToCurrency(bucket.original, bucket.originalCurrency).toFixed(
              currencyMinorUnitExponent(bucket.originalCurrency),
            )} ${bucket.originalCurrency.toUpperCase()} at the gateway`,
          }
        : {}),
    };
  };
  return { charged: finish(totals.charged), returned: finish(totals.returned) };
}

/**
 * Stripe: an order found by the payment intent, and money read off the
 * dispute's balance transactions — a withdrawal when the chargeback lands, a
 * reinstatement if the store wins. An inquiry has neither and moves nothing.
 */
export function readStripeDispute(
  dispute: StripeDisputeLike,
): GatewayDisputeReading | null {
  const intentId =
    typeof dispute?.payment_intent === "string"
      ? dispute.payment_intent
      : dispute?.payment_intent?.id;
  if (!dispute?.id || !intentId) return null;

  const currency = upper(dispute.currency || "usd");
  const amount = fromStripeAmount(Number(dispute.amount || 0), currency);
  // Stripe lists zero, one or two: the withdrawal, then the reinstatement. A
  // copy of the dispute without the list at all says nothing either way.
  const transactions = Array.isArray(dispute.balance_transactions)
    ? dispute.balance_transactions
    : null;
  const withdrawals = (transactions || []).filter((t) => Number(t?.amount) < 0).length;
  const reinstatements = (transactions || []).filter((t) => Number(t?.amount) > 0).length;
  const fees = disputeFees(dispute);

  return {
    gateway: "stripe",
    disputeId: dispute.id,
    // Either charge can be disputed: a deposit-mode pre-order's balance is its
    // own payment intent.
    locator: {
      stripePaymentIntentId: intentId,
      preorderBalancePaymentIntentId: intentId,
    },
    currency,
    withdrawn: transactions ? (withdrawals > reinstatements ? amount : 0) : null,
    taken: transactions ? (withdrawals > 0 ? amount : 0) : null,
    stage: STRIPE_STAGES[lower(dispute.status)] ?? "opened",
    reason: humanize(dispute.reason),
    disputedAmount: amount,
    respondBy: dateFrom(dispute.evidence_details?.due_by),
    openedAt: dateFrom(dispute.created),
    updatedAt: null,
    fees: [
      ...(fees.charged ? [{ ...fees.charged, returned: false }] : []),
      ...(fees.returned ? [{ ...fees.returned, returned: true }] : []),
    ],
    moneyIds: [],
    settlesThroughRefunds: false,
  };
}

// ---------------------------------------------------------------------------
// Razorpay
// ---------------------------------------------------------------------------

export interface RazorpayDisputeLike {
  id?: string | null;
  payment_id?: string | null;
  amount?: number | null;
  currency?: string | null;
  amount_deducted?: number | null;
  reason_code?: string | null;
  respond_by?: number | null;
  status?: string | null;
  phase?: string | null;
  created_at?: number | null;
}

const RAZORPAY_STAGES: Record<string, DisputeStage> = {
  open: "opened",
  action_required: "action_required",
  under_review: "under_review",
  won: "won",
  lost: "lost",
  closed: "closed",
};

/**
 * Razorpay: paise, an order found by the payment, and money read off
 * `amount_deducted` — "the amount deducted from your Razorpay balance when
 * dispute is lost; otherwise 0". A lost dispute does not raise a refund of its
 * own, so its deduction is never reported twice.
 */
export function readRazorpayDispute(
  dispute: RazorpayDisputeLike,
): GatewayDisputeReading | null {
  const id = String(dispute?.id || "");
  const paymentId = String(dispute?.payment_id || "");
  if (!id || !paymentId) return null;

  const currency = upper(dispute.currency || "INR");
  const status = lower(dispute.status);
  const reported =
    dispute.amount_deducted === null || dispute.amount_deducted === undefined
      ? null
      : fromRazorpayAmountSubunits(Number(dispute.amount_deducted || 0), currency);
  const disputed = fromRazorpayAmountSubunits(Number(dispute.amount || 0), currency);

  let withdrawn: number | null;
  if (status === "won") {
    withdrawn = 0;
  } else if (status === "lost") {
    // A payload from before the field existed: a loss takes the disputed sum.
    withdrawn = reported ?? disputed;
  } else if (status === "closed") {
    withdrawn = reported ?? 0;
  } else {
    // Still open. Money only moves on a decision, so an open copy that shows no
    // deduction says nothing — it may simply be older than the decision.
    withdrawn = reported && reported > 0 ? reported : null;
  }

  return {
    gateway: "razorpay",
    disputeId: id,
    locator: { razorpayPaymentId: paymentId, paymentId },
    currency,
    withdrawn,
    taken: withdrawn,
    stage: RAZORPAY_STAGES[status] ?? "opened",
    reason: [
      humanize(dispute.reason_code),
      dispute.phase ? `${humanize(dispute.phase)} phase` : "",
    ]
      .filter(Boolean)
      .join(", "),
    disputedAmount: disputed || null,
    respondBy: dateFrom(dispute.respond_by),
    openedAt: dateFrom(dispute.created_at),
    updatedAt: null,
    fees: [],
    moneyIds: [],
    settlesThroughRefunds: false,
  };
}

// ---------------------------------------------------------------------------
// Paystack
// ---------------------------------------------------------------------------

export interface PaystackDisputeLike {
  id?: number | string | null;
  refund_amount?: number | string | null;
  currency?: string | null;
  status?: string | null;
  resolution?: string | null;
  transaction?:
    | {
        id?: number | string | null;
        reference?: string | null;
        amount?: number | string | null;
        currency?: string | null;
      }
    | number
    | string
    | null;
  transaction_reference?: string | null;
  category?: string | null;
  dueAt?: string | null;
  resolvedAt?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
}

/** A Paystack refund as its API lists it — which, unlike its webhook, names the dispute. */
export interface PaystackRefundLike {
  id?: number | string | null;
  amount?: number | string | null;
  currency?: string | null;
  status?: string | null;
  dispute?: number | string | { id?: number | string | null } | null;
  transaction?: number | string | { id?: number | string | null; reference?: string | null } | null;
  transaction_reference?: string | null;
}

/** Paystack refund states in which the money is leaving, or has left. */
export const PAYSTACK_LIVE_REFUND_STATUSES = new Set(["processed", "pending", "processing"]);

/** The dispute a Paystack refund was raised to pay, or "". */
export function paystackRefundDisputeId(refund: PaystackRefundLike): string {
  const dispute = refund?.dispute;
  if (dispute === null || dispute === undefined || dispute === "") return "";
  if (typeof dispute === "object") return dispute.id ? String(dispute.id) : "";
  return String(dispute);
}

/** The transaction a Paystack dispute or refund belongs to: its id and its reference. */
export function paystackTransactionOf(record: {
  transaction?: PaystackDisputeLike["transaction"] | PaystackRefundLike["transaction"];
  transaction_reference?: string | null;
}): { id: string; reference: string } {
  const transaction = record?.transaction;
  if (transaction && typeof transaction === "object") {
    return {
      id: transaction.id ? String(transaction.id) : "",
      reference: String(transaction.reference || record.transaction_reference || ""),
    };
  }
  return {
    id: transaction === null || transaction === undefined ? "" : String(transaction),
    reference: String(record?.transaction_reference || ""),
  };
}

/**
 * Paystack: kobo, an order found by the transaction, and a decision read off
 * `resolution`. Accepting — by the merchant, or automatically when the due date
 * passes — refunds the shopper and takes it out of the next payout; declining
 * keeps the money.
 *
 * Paystack pays an accepted chargeback as a REFUND carrying the dispute's id.
 * When those refunds are known (listed from its API) they are the money, live
 * ones counted and failed ones not; without them the accepted amount is.
 */
export function readPaystackDispute(
  dispute: PaystackDisputeLike,
  options: { event?: string; refunds?: PaystackRefundLike[] | null } = {},
): GatewayDisputeReading | null {
  const id =
    dispute?.id === null || dispute?.id === undefined ? "" : String(dispute.id);
  if (!id) return null;

  const transaction = paystackTransactionOf(dispute);
  const locator = compactLocator({
    paystackTransactionId: transaction.id,
    paymentId: transaction.id,
    paystackReference: transaction.reference,
  });
  if (Object.keys(locator).length === 0) return null;

  const transactionObject =
    dispute.transaction && typeof dispute.transaction === "object"
      ? dispute.transaction
      : null;
  const currency = upper(dispute.currency || transactionObject?.currency || "NGN");
  const status = lower(dispute.status);
  const resolution = lower(dispute.resolution);
  const resolved = status === "resolved" || options.event === "charge.dispute.resolve";
  const accepted = resolved && resolution.includes("accept");
  const declined = resolved && resolution.includes("declin");

  const linked = (options.refunds || []).filter(
    (refund) => paystackRefundDisputeId(refund) === id,
  );
  const liveTotal = linked
    .filter((refund) => PAYSTACK_LIVE_REFUND_STATUSES.has(lower(refund.status)))
    .reduce(
      (sum, refund) =>
        sum +
        fromPaystackAmountSubunits(Number(refund.amount || 0), upper(refund.currency || currency)),
      0,
    );
  const acceptedAmount = fromPaystackAmountSubunits(
    Number(dispute.refund_amount ?? transactionObject?.amount ?? 0),
    currency,
  );

  let withdrawn: number | null;
  if (linked.length > 0) withdrawn = roundMoney(liveTotal);
  else if (accepted) withdrawn = acceptedAmount;
  else if (declined) withdrawn = 0;
  // Unresolved, or resolved some way this does not know: nothing has moved
  // that it can name.
  else withdrawn = null;

  const stage: DisputeStage =
    options.event === "charge.dispute.remind"
      ? "reminder"
      : accepted
        ? "lost"
        : declined
          ? "won"
          : resolved || status === "archived"
            ? "closed"
            : status === "awaiting-bank-feedback"
              ? "under_review"
              : "opened";

  return {
    gateway: "paystack",
    disputeId: id,
    locator,
    currency,
    withdrawn,
    taken: withdrawn,
    stage,
    reason: humanize(dispute.category) || "chargeback",
    disputedAmount: acceptedAmount || null,
    respondBy: dateFrom(dispute.dueAt),
    openedAt: dateFrom(dispute.createdAt || dispute.created_at),
    updatedAt: dateFrom(dispute.updatedAt || dispute.updated_at || dispute.resolvedAt),
    fees: [],
    moneyIds: linked
      .map((refund) => String(refund.id ?? ""))
      .filter(Boolean),
    settlesThroughRefunds: false,
  };
}

// ---------------------------------------------------------------------------
// PayPal
// ---------------------------------------------------------------------------

interface PayPalMoneyLike {
  value?: string | number | null;
  currency_code?: string | null;
}

export interface PayPalFundMovementLike {
  party?: string | null;
  /** The deprecated `money_movements` name for `party`. */
  affected_party?: string | null;
  type?: string | null;
  reason?: string | null;
  amount?: PayPalMoneyLike | null;
  initiated_time?: string | null;
}

export interface PayPalDisputeLike {
  dispute_id?: string | null;
  create_time?: string | null;
  update_time?: string | null;
  reason?: string | null;
  status?: string | null;
  dispute_amount?: PayPalMoneyLike | null;
  dispute_outcome?: { outcome_code?: string | null } | null;
  disputed_transactions?: Array<{ seller_transaction_id?: string | null }> | null;
  fund_movements?: PayPalFundMovementLike[] | null;
  money_movements?: PayPalFundMovementLike[] | null;
  dispute_life_cycle_stage?: string | null;
  dispute_channel?: string | null;
  seller_response_due_date?: string | null;
}

const PAYPAL_FEE_REASONS = new Set([
  "DISPUTE_FEE",
  "CHARGEBACK_FEE",
  "REVERSED_TRANSACTION_FEE",
  "DISPUTE_SETTLEMENT_FEE",
]);

const PAYPAL_WON_OUTCOMES = new Set(["RESOLVED_SELLER_FAVOUR", "CANCELED_BY_BUYER", "DENIED"]);
const PAYPAL_LOST_OUTCOMES = new Set(["RESOLVED_BUYER_FAVOUR", "ACCEPTED"]);

/**
 * PayPal: an order found by the disputed capture, and money read off the
 * dispute's fund movements — the seller's settlement debits and credits, and
 * every fee, one entry each.
 *
 * `movementsTrusted` is for a copy fetched from PayPal's dispute API. A webhook
 * resource is not guaranteed to carry the movements, and an empty list read as
 * "nothing was taken" would reverse a chargeback PayPal really took.
 */
export function readPayPalDispute(
  dispute: PayPalDisputeLike,
  options: { movementsTrusted?: boolean } = {},
): GatewayDisputeReading | null {
  const id = String(dispute?.dispute_id || "");
  const captureId =
    (dispute?.disputed_transactions || [])
      .map((transaction) => String(transaction?.seller_transaction_id || ""))
      .find(Boolean) || "";
  if (!id || !captureId) return null;

  const currency = upper(dispute.dispute_amount?.currency_code || "USD");
  const movements = !options.movementsTrusted
    ? null
    : Array.isArray(dispute.fund_movements)
      ? dispute.fund_movements
      : Array.isArray(dispute.money_movements)
        ? dispute.money_movements
        : null;
  const seller = (movements || []).filter(
    (movement) => upper(movement?.party || movement?.affected_party) === "SELLER",
  );

  const settlements = seller.filter(
    (movement) =>
      upper(movement.reason) === "DISPUTE_SETTLEMENT" &&
      upper(movement.amount?.currency_code || currency) === currency,
  );
  const settled = (type: "DEBIT" | "CREDIT") =>
    settlements
      .filter((movement) => upper(movement.type) === type)
      .reduce((sum, movement) => sum + Number(movement.amount?.value || 0), 0);
  const debit = settled("DEBIT");
  const credit = settled("CREDIT");
  // A credit with no debit listed still means money came back — the reversal
  // that took it was its own transaction.
  const known = settlements.length > 0;

  const fees: DisputeFeeMovement[] = seller
    .filter((movement) => PAYPAL_FEE_REASONS.has(upper(movement.reason)))
    .map((movement, index) => ({
      amount: roundMoney(Number(movement.amount?.value || 0)),
      currency: upper(movement.amount?.currency_code || currency),
      returned: upper(movement.type) === "CREDIT",
      date: dateFrom(movement.initiated_time) ?? undefined,
      part: [lower(movement.reason), lower(movement.type), movement.initiated_time || String(index)]
        .join("-")
        .replace(/[^a-z0-9_.-]+/gi, "")
        .toLowerCase(),
    }))
    .filter((fee) => Number.isFinite(fee.amount) && fee.amount > 0);

  const status = upper(dispute.status);
  const outcome = upper(dispute.dispute_outcome?.outcome_code);
  const stage: DisputeStage =
    status === "RESOLVED"
      ? PAYPAL_WON_OUTCOMES.has(outcome)
        ? "won"
        : PAYPAL_LOST_OUTCOMES.has(outcome)
          ? "lost"
          : "closed"
      : status === "WAITING_FOR_SELLER_RESPONSE"
        ? "action_required"
        : status === "UNDER_REVIEW"
          ? "under_review"
          : "opened";

  const disputed = Number(dispute.dispute_amount?.value || 0);
  return {
    gateway: "paypal",
    disputeId: id,
    // A balance paid with PayPal is its own capture, kept as the balance reference.
    locator: {
      paypalCaptureId: captureId,
      preorderBalancePaymentIntentId: `${PAYPAL_BALANCE_REFERENCE_PREFIX}${captureId}`,
    },
    currency,
    withdrawn: known ? roundMoney(Math.max(0, debit - credit)) : null,
    taken: known ? roundMoney(Math.max(debit, credit)) : null,
    stage,
    reason: [
      humanize(dispute.reason),
      upper(dispute.dispute_channel) === "EXTERNAL" ? "card chargeback" : "",
    ]
      .filter(Boolean)
      .join(", "),
    disputedAmount: Number.isFinite(disputed) && disputed > 0 ? disputed : null,
    respondBy: dateFrom(dispute.seller_response_due_date),
    openedAt: dateFrom(dispute.create_time),
    updatedAt: dateFrom(dispute.update_time),
    fees,
    moneyIds: [],
    settlesThroughRefunds: true,
  };
}

// ---------------------------------------------------------------------------
// What to do about it
// ---------------------------------------------------------------------------

/** A refund row, as far as settling a dispute needs to see it. */
export interface DisputeMoneyRow {
  id: string;
  amount: number;
  /** Still counts as refunded (not reversed). */
  standing: boolean;
  /** Epoch milliseconds; newer rows are reversed first. */
  at: number;
  /**
   * A candidate that is only this dispute's money if it is ALL of it — a
   * refund that merely happened after the dispute opened. A smaller one is a
   * different refund, and taking it would leave the chargeback unrecorded.
   */
  exact?: boolean;
}

export interface DisputeSettlementPlan {
  /** Rows recorded under other ids that are this dispute's money. */
  adopt: string[];
  /** Taken and not recorded anywhere: a new chargeback row for this much. */
  record: number;
  /** Rows the gateway has given the money back for. */
  reverse: string[];
  /** Given back, but matching no whole row — left for an admin. */
  unreturned: number;
  /**
   * Part of one row given back: reverse that row whole and record what is
   * still held as a row of its own. Rows stay whole — the ledger, the payout
   * engine and the history replay all read one row as one refund — and the
   * books end up holding exactly what the gateway still has.
   */
  split: { row: string; keep: number } | null;
}

/**
 * Bring what the books hold for a dispute in line with what the gateway says.
 *
 * `linked` is every row already recorded for the dispute, reversed or not;
 * `candidates` are rows recorded under other ids that may be its money, best
 * first. A candidate is adopted only while the gateway reports more money than
 * the dispute's rows account for, and only if it fits inside that gap — so a
 * refund of a different amount is never mistaken for it.
 *
 * Rows are recorded and reversed whole: the ledger, the payout engine and the
 * history replay all read one row as one refund. When the gateway gives back
 * only part of a row, that row is reversed and what is still held recorded
 * again as a row of its own — see `split`. That used to be left for an admin
 * to book by hand, and until they did the order counted the whole row as
 * refunded and the seller stayed short the part that came back.
 */
export function planDisputeSettlement(input: {
  withdrawn: number | null;
  taken: number | null;
  linked: DisputeMoneyRow[];
  candidates: DisputeMoneyRow[];
}): DisputeSettlementPlan {
  const plan: DisputeSettlementPlan = {
    adopt: [],
    record: 0,
    reverse: [],
    unreturned: 0,
    split: null,
  };
  if (input.withdrawn === null || !Number.isFinite(input.withdrawn)) return plan;

  const withdrawn = Math.max(0, input.withdrawn);
  const taken = Math.max(withdrawn, Number(input.taken ?? withdrawn) || 0);
  let accounted = input.linked.reduce((sum, row) => sum + row.amount, 0);
  let standing = input.linked
    .filter((row) => row.standing)
    .reduce((sum, row) => sum + row.amount, 0);

  const adopted: DisputeMoneyRow[] = [];
  for (const candidate of input.candidates) {
    if (!candidate.standing) continue;
    const gap = Math.max(taken - accounted, withdrawn - standing);
    if (gap <= DISPUTE_MONEY_EPSILON) break;
    const fits = candidate.exact
      ? Math.abs(candidate.amount - gap) <= DISPUTE_MONEY_EPSILON
      : candidate.amount <= gap + DISPUTE_MONEY_EPSILON;
    if (!fits) continue;
    adopted.push(candidate);
    plan.adopt.push(candidate.id);
    accounted += candidate.amount;
    standing += candidate.amount;
  }

  if (withdrawn > standing + DISPUTE_MONEY_EPSILON) {
    plan.record = roundMoney(withdrawn - standing);
    return plan;
  }

  let excess = standing - withdrawn;
  if (excess > DISPUTE_MONEY_EPSILON) {
    const reversible = [...input.linked.filter((row) => row.standing), ...adopted].sort(
      (a, b) => b.at - a.at,
    );
    for (const row of reversible) {
      if (excess <= DISPUTE_MONEY_EPSILON) break;
      if (row.amount > excess + DISPUTE_MONEY_EPSILON) continue;
      plan.reverse.push(row.id);
      excess -= row.amount;
    }
    if (excess > DISPUTE_MONEY_EPSILON) {
      // What is left came back from a row larger than it: the newest one it
      // fits inside is replaced by the part still held.
      const partly = reversible.find(
        (row) => !plan.reverse.includes(row.id) && row.amount > excess + DISPUTE_MONEY_EPSILON,
      );
      if (partly) {
        plan.split = { row: partly.id, keep: roundMoney(partly.amount - excess) };
      } else {
        plan.unreturned = roundMoney(excess);
      }
    }
  }
  return plan;
}

export interface DisputeNotice {
  title: string;
  message: string;
  /** The same notice is sent once, however many times the dispute is read. */
  dedupeKey: string;
}

/**
 * What to tell an admin about a dispute, once it has been applied.
 *
 * Each notice is keyed by what it says, so a webhook delivered twice, the
 * hourly sync reading the same dispute again, and a webhook and the sync both
 * seeing one change all send it once — and a later, different event on the
 * same dispute is still news.
 */
export function disputeNotices(params: {
  reading: GatewayDisputeReading;
  orderNumber: string;
  /** Newly recorded as a chargeback just now. */
  recorded: number;
  /** Newly reversed just now. */
  reversed: number;
  unreturned: number;
  /** Part of a recorded chargeback given back, and the chargeback reduced to match. */
  partReturned?: number;
  /** Taken beyond what the order had left to refund. */
  beyondSale: number;
  /** What the books hold for this dispute afterwards. */
  standing: number;
  /**
   * Read by the sync rather than delivered as it happened. The sync reads four
   * months of disputes, and on its first run every one of them is new to it:
   * a deadline that has passed, or a decision made weeks ago that changed
   * nothing, is not news. Anything that changes the books is always said.
   */
  quietHistory?: boolean;
  now?: Date;
  /** The order's status afterwards, to say whether it may still be shipped. */
  orderStatus?: string;
  /** Whether the chargeback left nothing of the order paid. */
  orderFullyRefunded?: boolean;
}): DisputeNotice[] {
  const { reading } = params;
  const now = (params.now ?? new Date()).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const deadlineMissed = Boolean(
    params.quietHistory &&
      reading.respondBy &&
      reading.respondBy.getTime() < now - DAY_MS,
  );
  const lastChanged = reading.updatedAt ?? reading.openedAt;
  const oldNews = Boolean(
    params.quietHistory && (!lastChanged || lastChanged.getTime() < now - 30 * DAY_MS),
  );
  const label = DISPUTE_GATEWAY_LABEL[reading.gateway];
  const place = DISPUTE_RESPONSE_PLACE[reading.gateway];
  const key = `dispute:${reading.gateway}:${reading.disputeId}`;
  const order = `Order #${params.orderNumber}`;
  const exponent = currencyMinorUnitExponent(reading.currency);
  const figure = (amount: number) => Math.max(0, amount).toFixed(exponent);
  const money = (amount: number) => `${figure(amount)} ${reading.currency}`;
  const day = reading.respondBy ? reading.respondBy.toISOString().slice(0, 10) : "";
  const by = day ? ` by ${day}` : "";
  const why = reading.reason ? ` (${reading.reason})` : "";
  const notices: DisputeNotice[] = [];

  if (deadlineMissed) {
    // Nothing left to answer.
  } else if (reading.stage === "opened") {
    notices.push({
      title: "A payment is being disputed",
      message: `${order}: ${label} opened dispute ${reading.disputeId}${why}${
        reading.disputedAmount ? ` for ${money(reading.disputedAmount)}` : ""
      }. Respond with evidence in ${place}${by}.`,
      dedupeKey: `${key}:opened`,
    });
  } else if (reading.stage === "action_required") {
    notices.push({
      title: "A dispute needs your response",
      message: `${order}: ${label} needs more from the store on dispute ${reading.disputeId}${why}. Add the evidence in ${place}${by}, or the store loses it.`,
      dedupeKey: `${key}:action-required:${day}`,
    });
  } else if (reading.stage === "reminder") {
    notices.push({
      title: "A dispute is still waiting for your response",
      message: `${order}: dispute ${reading.disputeId}${why} has not been answered. Respond in ${place}${by}, or it is accepted and the money goes back to the shopper.`,
      dedupeKey: `${key}:reminder:${day}`,
    });
  }

  const decided = reading.stage === "lost" || reading.stage === "closed";
  const notDispatched = !["shipped", "delivered", "cancelled"].includes(
    String(params.orderStatus || ""),
  );
  const holdShipment =
    params.orderStatus !== undefined && notDispatched && params.orderFullyRefunded
      ? " Hold the shipment: the order no longer counts as paid, so it cannot be fulfilled unless the store wins the money back."
      : "";
  const shipAgain =
    params.orderStatus !== undefined && notDispatched
      ? " The order can be fulfilled again."
      : "";
  let moneyNews = false;
  if (params.recorded > DISPUTE_MONEY_EPSILON) {
    moneyNews = true;
    notices.push({
      title: "A shopper's bank took a payment back",
      message: `${order}: ${label} took ${money(params.recorded)} back for dispute ${reading.disputeId}${why}. It is recorded as a refund, so each seller's share comes back out of their next payout.${holdShipment}${
        decided ? "" : ` Respond in ${place}${by} to win it back.`
      }`,
      // Keyed as the loss itself once the dispute is lost, so a later read of
      // the same loss does not announce it a second time in other words.
      dedupeKey:
        reading.stage === "lost" ? `${key}:lost` : `${key}:taken:${figure(params.standing)}`,
    });
  }
  if (params.reversed > DISPUTE_MONEY_EPSILON) {
    moneyNews = true;
    notices.push({
      title: "A chargeback was won",
      message: `${order}: ${label} gave back ${money(params.reversed)} on dispute ${reading.disputeId}, so it no longer counts as a refund and each seller's share is owed to them again.${shipAgain}`,
      dedupeKey:
        reading.stage === "won" ? `${key}:won` : `${key}:returned:${figure(params.standing)}`,
    });
  }
  if ((params.partReturned ?? 0) > DISPUTE_MONEY_EPSILON) {
    moneyNews = true;
    notices.push({
      title: "Part of a chargeback came back",
      message: `${order}: ${label} gave back ${money(params.partReturned ?? 0)} on dispute ${reading.disputeId}. The chargeback now stands at ${money(params.standing)}, and each seller's share of what came back is owed to them again.${shipAgain}`,
      dedupeKey: `${key}:part-returned:${figure(params.standing)}`,
    });
  }
  if (params.unreturned > DISPUTE_MONEY_EPSILON) {
    moneyNews = true;
    notices.push({
      title: "Part of a chargeback came back",
      message: `${order}: ${label} gave back ${money(params.unreturned)} on dispute ${reading.disputeId}. That does not match a whole recorded chargeback, so the order still counts it as refunded — record the part that came back as a ledger adjustment.`,
      dedupeKey: `${key}:unreturned:${figure(params.unreturned)}`,
    });
  }
  if (params.beyondSale > DISPUTE_MONEY_EPSILON) {
    moneyNews = true;
    notices.push({
      title: "A chargeback took more than was left on the order",
      message: `${order}: ${label} took ${money(params.beyondSale)} more on dispute ${reading.disputeId} than the order had left to refund, because earlier refunds already gave that back. It is a loss on top of the sale: it is booked as a chargeback loss, not a refund, and comes off again if the store wins it back.`,
      dedupeKey: `${key}:beyond-sale:${figure(params.beyondSale)}`,
    });
  }
  if (moneyNews || oldNews) return notices;

  if (reading.stage === "won") {
    notices.push(
      reading.withdrawn === null
        ? {
            title: "A dispute was decided in the store's favour",
            message: `${order}: ${label} decided dispute ${reading.disputeId} for the store but did not say what money moved, so the books were left as they are. If a chargeback was recorded for it and the money came back, record the return as a ledger adjustment.`,
            dedupeKey: `${key}:won:unreported`,
          }
        : {
            title: "A dispute was decided in the store's favour",
            message: `${order}: ${label} closed dispute ${reading.disputeId} in the store's favour.${
              params.standing > DISPUTE_MONEY_EPSILON
                ? ""
                : " No money was taken, so nothing changes."
            }`,
            dedupeKey: `${key}:won`,
          },
    );
  } else if (reading.stage === "lost") {
    notices.push(
      reading.withdrawn === null
        ? {
            title: "A dispute was lost",
            message: `${order}: ${label} decided dispute ${reading.disputeId} against the store but did not say what it took, so nothing was recorded. If money was taken, record it on the order as a chargeback.`,
            dedupeKey: `${key}:lost:unreported`,
          }
        : params.standing > DISPUTE_MONEY_EPSILON
          ? {
              title: "A dispute was lost",
              message: `${order}: ${label} decided dispute ${reading.disputeId} against the store. The ${money(params.standing)} it took is already recorded as a refund.`,
              dedupeKey: `${key}:lost`,
            }
          : {
              title: "A dispute was lost",
              message: `${order}: ${label} decided dispute ${reading.disputeId} against the store without taking any money for it, so nothing changes in the books.`,
              dedupeKey: `${key}:lost:nothing-taken`,
            },
    );
  }
  return notices;
}
