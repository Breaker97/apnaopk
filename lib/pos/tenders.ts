import { quantizeToCurrency } from "@/lib/intl/money";

/**
 * How a counter sale was paid, tender by tender.
 *
 * A sale used to carry one method and one amount: cash, or card, never both.
 * A shopper paying part in notes and part on a card, or with store credit and
 * the rest in cash, could not be rung up at all. A sale now carries a list of
 * tenders, and — when the store allows it — may be paid only in part, as a
 * deposit, with the balance collected later at the till.
 *
 * No imports beyond money rounding: the till computes "what is left to pay"
 * with the same rules the server checks it by, and a client component cannot
 * pull in the server's data layer (see `lib/pos/page-size.ts`).
 */

export const POS_TENDER_METHODS = [
  "cash",
  "card",
  "bank",
  "manual",
  "store_credit",
] as const;
export type POSTenderMethod = (typeof POS_TENDER_METHODS)[number];

export const POS_CARD_SUB_METHODS = ["card_touch", "card_stripe"] as const;
export type POSCardSubMethod = (typeof POS_CARD_SUB_METHODS)[number];

/** One tender as the till sends it. */
export interface POSTenderInput {
  method: POSTenderMethod;
  /** What this tender pays of the sale. */
  amount: number;
  /** Cash only: the notes handed over, when more than `amount`. */
  tendered?: number;
  reference?: string;
  /** Card only: a reader tap or the Stripe form. */
  cardSubMethod?: POSCardSubMethod;
  /** Card via the Stripe form: the intent that took it. */
  stripePaymentIntentId?: string;
}

/** One tender as the order stores it. */
export interface POSTender extends POSTenderInput {
  /** Cash only: handed back. */
  change?: number;
  /** "sale" at the counter; "balance" for a deposit sale's later payment. */
  kind?: "sale" | "balance";
  collectedAt?: Date | string;
  collectedBy?: string;
}

export function isPOSTenderMethod(value: unknown): value is POSTenderMethod {
  return POS_TENDER_METHODS.includes(value as POSTenderMethod);
}

/** What the tenders pay of the sale (change is not payment). */
export function sumTenders(
  tenders: ReadonlyArray<Pick<POSTenderInput, "amount">>,
  currency: string,
): number {
  return quantizeToCurrency(
    tenders.reduce((sum, tender) => sum + (Number(tender.amount) || 0), 0),
    currency,
  );
}

/** What is left to pay after these tenders; never below zero. */
export function remainingAfterTenders(
  total: number,
  tenders: ReadonlyArray<Pick<POSTenderInput, "amount">>,
  currency: string,
): number {
  return Math.max(0, quantizeToCurrency(total - sumTenders(tenders, currency), currency));
}

/**
 * The method the ORDER is filed under: the largest tender that is money.
 *
 * Every reader of `Order.paymentMethod` — custody, refunds, reports — knows a
 * single method, and on a split sale the largest part is the honest single
 * answer. Store credit is not money taken at the till, so it only names the
 * sale when it paid all of it. Ties go to the earlier tender.
 */
export function primaryTenderMethod<M extends string>(
  tenders: ReadonlyArray<{ method: M; amount: number }>,
): M | "cash" {
  const money = tenders.filter((tender) => tender.method !== "store_credit");
  const pool = money.length > 0 ? money : tenders;
  let best = pool[0];
  for (const tender of pool) {
    if ((Number(tender.amount) || 0) > (Number(best?.amount) || 0)) best = tender;
  }
  return best?.method ?? "cash";
}

export type POSTenderCheck =
  | { ok: true; tenders: POSTender[]; paid: number; balanceDue: number; change: number }
  | { ok: false; message: string };

/**
 * The server's check of a sale's tenders. The till runs it too, to say what
 * is left — but the server's answer is the one written down.
 *
 * - every tender is a method the store has switched on, for a positive amount;
 * - cash may be handed over in excess (the excess is change), nothing else;
 * - the tenders pay the sale exactly, or — a deposit, where allowed — less;
 * - at most one tender came off the Stripe form, and it pays the rest (a card
 *   charged for part of a sale that is then abandoned would be money with no
 *   sale behind it).
 */
export function checkPOSTenders(params: {
  tenders: ReadonlyArray<POSTenderInput>;
  total: number;
  currency: string;
  /** The methods the store switched on (store credit is always allowed here). */
  enabledMethods: ReadonlyArray<string>;
  /** Paying less than the total leaves a balance due. */
  allowPartial: boolean;
}): POSTenderCheck {
  const { currency } = params;
  const total = quantizeToCurrency(Math.max(0, Number(params.total) || 0), currency);
  if (params.tenders.length === 0) return { ok: false, message: "Payment method is required" };
  if (params.tenders.length > 10) return { ok: false, message: "A sale can be paid in at most 10 parts" };

  const out: POSTender[] = [];
  let stripeCount = 0;
  for (const raw of params.tenders) {
    if (!isPOSTenderMethod(raw.method)) return { ok: false, message: "Payment method is required" };
    if (raw.method !== "store_credit" && !params.enabledMethods.includes(raw.method)) {
      return { ok: false, message: "Payment method is not enabled for POS" };
    }
    const amount = quantizeToCurrency(Number(raw.amount), currency);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: "Each payment must be more than zero" };
    }
    const tender: POSTender = { method: raw.method, amount, kind: "sale" };
    if (raw.method === "cash") {
      const tendered =
        raw.tendered === undefined || raw.tendered === null
          ? amount
          : quantizeToCurrency(Number(raw.tendered), currency);
      if (!Number.isFinite(tendered) || tendered < amount) {
        return { ok: false, message: "Cash tendered must cover the order total" };
      }
      tender.tendered = tendered;
      tender.change = quantizeToCurrency(tendered - amount, currency);
    } else if (raw.tendered !== undefined && raw.tendered !== null && Number(raw.tendered) !== amount) {
      return { ok: false, message: "Only cash can be handed over in excess" };
    }
    if (raw.method === "card") {
      const sub = raw.cardSubMethod;
      if (sub && !POS_CARD_SUB_METHODS.includes(sub)) {
        return { ok: false, message: "Payment method is required" };
      }
      tender.cardSubMethod = sub ?? "card_touch";
      if (tender.cardSubMethod === "card_stripe") {
        stripeCount += 1;
        const intent = String(raw.stripePaymentIntentId || raw.reference || "").trim();
        if (!intent) return { ok: false, message: "Stripe payment intent is required" };
        tender.stripePaymentIntentId = intent.slice(0, 200);
      }
    }
    const reference = String(raw.reference || "").trim();
    if (reference) tender.reference = reference.slice(0, 120);
    out.push(tender);
  }
  if (stripeCount > 1) return { ok: false, message: "Only one card payment can be taken on the Stripe form" };

  const paid = sumTenders(out, currency);
  if (paid > total) {
    return { ok: false, message: "The payments come to more than the sale" };
  }
  const balanceDue = quantizeToCurrency(total - paid, currency);
  if (balanceDue > 0 && !params.allowPartial) {
    return { ok: false, message: "Cash tendered must cover the order total" };
  }
  if (stripeCount === 1 && out[out.length - 1]?.cardSubMethod !== "card_stripe") {
    return { ok: false, message: "A Stripe card payment must be the last payment" };
  }
  if (stripeCount === 1 && balanceDue > 0) {
    return { ok: false, message: "A Stripe card payment must pay the rest of the sale" };
  }
  const change = quantizeToCurrency(
    out.reduce((sum, tender) => sum + (tender.change || 0), 0),
    currency,
  );
  return { ok: true, tenders: out, paid, balanceDue, change };
}

/**
 * The tenders a sale from before split payments carried, as one tender —
 * a sale queued offline by an older till still replays.
 */
export function legacyTender(params: {
  paymentMethod?: string;
  total: number;
  cashTendered?: number | string;
  paymentReference?: string;
  stripePaymentIntentId?: string;
}): POSTenderInput | null {
  const raw = String(params.paymentMethod || "").trim().toLowerCase();
  if (!raw) return null;
  const tendered =
    params.cashTendered === undefined || params.cashTendered === null || params.cashTendered === ""
      ? undefined
      : Number(params.cashTendered);
  if (raw === "card_touch" || raw === "card_stripe") {
    return {
      method: "card",
      amount: params.total,
      cardSubMethod: raw,
      reference: params.paymentReference,
      stripePaymentIntentId: raw === "card_stripe" ? params.stripePaymentIntentId || params.paymentReference : undefined,
    };
  }
  if (!isPOSTenderMethod(raw)) return { method: raw as POSTenderMethod, amount: params.total };
  return {
    method: raw,
    amount: params.total,
    ...(raw === "cash" ? { tendered } : {}),
    reference: params.paymentReference,
  };
}
