import crypto from "crypto";
import { GatewayApiError } from "@/lib/payments/gateway-api-error";
import type { RazorpayDisputeLike } from "@/lib/orders/dispute-readings";

const RAZORPAY_API_BASE = "https://api.razorpay.com/v1";

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

interface RazorpayOrder {
  id: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt?: string;
  status: "created" | "attempted" | "paid" | string;
  attempts: number;
  created_at: number;
}

export interface RazorpayPayment {
  id: string;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed" | string;
  order_id?: string | null;
  captured?: boolean;
  email?: string | null;
  contact?: string | null;
  method?: string | null;
  /**
   * Razorpay's cut, in subunits — the total it keeps, GST included. `tax` is
   * the portion of `fee` that is tax, so adding the two double-counts it.
   * Present on a captured payment; absent while merely authorized.
   */
  fee?: number | null;
  tax?: number | null;
}

function getAuthHeader(creds: RazorpayCredentials) {
  return `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}`;
}

async function readRazorpayErrorMessage(res: Response) {
  try {
    const json = await res.json();
    if (typeof json?.error?.description === "string") {
      return json.error.description;
    }
    if (typeof json?.error?.reason === "string") return json.error.reason;
    if (typeof json?.message === "string") return json.message;
    return `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function timingSafeEqualHex(a: string, b: string) {
  const aBuffer = Buffer.from(a, "hex");
  const bBuffer = Buffer.from(b, "hex");
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function getRazorpayCurrencyExponent(currency: string) {
  const normalized = currency.trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return 3;
  return 2;
}

export function toRazorpayAmountSubunits(amount: number, currency: string) {
  const exponent = getRazorpayCurrencyExponent(currency);
  return Math.round(Number(amount || 0) * 10 ** exponent);
}

/**
 * The inverse: a subunit figure Razorpay handed BACK, in major units.
 *
 * Webhook payloads quote money in subunits, and a refund read out of one has
 * to be compared against an order that is stored in major units. Doing that
 * division at the call site is how a zero-decimal currency ends up divided by
 * a hundred.
 */
export function fromRazorpayAmountSubunits(amount: number, currency: string) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  return value / 10 ** getRazorpayCurrencyExponent(currency);
}

export function isRazorpayConfigured(keyId?: string, keySecret?: string) {
  return Boolean(
    (keyId ||
      process.env.RAZORPAY_KEY_ID ||
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID) &&
      (keySecret || process.env.RAZORPAY_KEY_SECRET),
  );
}

function getRazorpayKeyId(keyId?: string) {
  return (
    keyId ||
    process.env.RAZORPAY_KEY_ID ||
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ||
    ""
  );
}

export function getRazorpayCredentials(params?: {
  keyId?: string;
  keySecret?: string;
}): RazorpayCredentials {
  const keyId = getRazorpayKeyId(params?.keyId);
  const keySecret = params?.keySecret || process.env.RAZORPAY_KEY_SECRET || "";

  if (!keyId || !keySecret) {
    throw new Error("Razorpay is not configured. Missing key id or key secret.");
  }

  return { keyId, keySecret };
}

export async function createRazorpayOrder(params: {
  creds: RazorpayCredentials;
  amount: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}) {
  const res = await fetch(`${RAZORPAY_API_BASE}/orders`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(params.creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: toRazorpayAmountSubunits(params.amount, params.currency),
      currency: params.currency.toUpperCase(),
      receipt: params.receipt.slice(0, 40),
      notes: params.notes,
    }),
  });

  if (!res.ok) {
    const message = await readRazorpayErrorMessage(res);
    throw new Error(`Razorpay create order failed: ${message}`);
  }

  return (await res.json()) as RazorpayOrder;
}

export async function fetchRazorpayPayment(params: {
  creds: RazorpayCredentials;
  paymentId: string;
}) {
  const res = await fetch(
    `${RAZORPAY_API_BASE}/payments/${encodeURIComponent(params.paymentId)}`,
    {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(params.creds),
      },
    },
  );

  if (!res.ok) {
    const message = await readRazorpayErrorMessage(res);
    throw new Error(`Razorpay fetch payment failed: ${message}`);
  }

  return (await res.json()) as RazorpayPayment;
}

async function captureRazorpayPayment(params: {
  creds: RazorpayCredentials;
  paymentId: string;
  amount: number;
  currency: string;
}) {
  const res = await fetch(
    `${RAZORPAY_API_BASE}/payments/${encodeURIComponent(params.paymentId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(params.creds),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: toRazorpayAmountSubunits(params.amount, params.currency),
        currency: params.currency.toUpperCase(),
      }),
    },
  );

  if (!res.ok) {
    const message = await readRazorpayErrorMessage(res);
    throw new Error(`Razorpay capture payment failed: ${message}`);
  }

  return (await res.json()) as RazorpayPayment;
}

/**
 * Captures a payment Razorpay has only authorized, and returns the payment as
 * it stands afterwards; any other payment comes back untouched.
 *
 * An account on automatic capture captures by itself, often before the payer is
 * back, and a capture that loses that race is refused as "already captured".
 * The payment is read again before that refusal counts, so the race never fails
 * a payment that went through.
 *
 * `amount` is in major units, in `currency`.
 */
export async function captureAuthorizedRazorpayPayment(params: {
  creds: RazorpayCredentials;
  payment: RazorpayPayment;
  amount: number;
  currency: string;
}): Promise<RazorpayPayment> {
  const { creds, payment } = params;
  if (payment.status !== "authorized" || payment.captured === true) {
    return payment;
  }

  try {
    return await captureRazorpayPayment({
      creds,
      paymentId: payment.id,
      amount: params.amount,
      currency: params.currency,
    });
  } catch (error) {
    const current = await fetchRazorpayPayment({
      creds,
      paymentId: payment.id,
    });
    if (current.status === "captured" || current.captured === true) {
      return current;
    }
    throw error;
  }
}

export async function refundRazorpayPayment(params: {
  creds: RazorpayCredentials;
  paymentId: string;
  amount?: number;
  currency?: string;
  notes?: Record<string, string>;
}) {
  const body: Record<string, unknown> = {};
  if (
    params.amount !== undefined &&
    params.currency &&
    Number.isFinite(params.amount) &&
    params.amount > 0
  ) {
    body.amount = toRazorpayAmountSubunits(params.amount, params.currency);
  }
  if (params.notes) {
    body.notes = params.notes;
  }

  const res = await fetch(
    `${RAZORPAY_API_BASE}/payments/${encodeURIComponent(params.paymentId)}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(params.creds),
        "Content-Type": "application/json",
      },
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    },
  );

  if (!res.ok) {
    const message = await readRazorpayErrorMessage(res);
    throw new Error(`Razorpay refund failed: ${message}`);
  }

  return (await res.json()) as {
    id: string;
    status: string;
    amount: number;
    payment_id: string;
  };
}

/** A dispute, as Razorpay's API returns it. */
export type RazorpayDispute = RazorpayDisputeLike & { id: string };

/**
 * Disputes raised on the account, newest first, one page at a time.
 *
 * `from` and `to` bound when a dispute was CREATED, in unix seconds — and a
 * dispute decided today can be months old, so a caller looking for decisions
 * has to look back that far. Razorpay offers the Disputes API in India,
 * Malaysia, Singapore and the US; an account elsewhere is refused.
 */
export async function listRazorpayDisputes(params: {
  creds: RazorpayCredentials;
  from?: number;
  to?: number;
  count?: number;
  skip?: number;
}): Promise<RazorpayDispute[]> {
  const query = new URLSearchParams({
    count: String(Math.min(100, Math.max(1, params.count ?? 100))),
    skip: String(Math.max(0, params.skip ?? 0)),
  });
  if (params.from) query.set("from", String(Math.floor(params.from)));
  if (params.to) query.set("to", String(Math.floor(params.to)));

  const res = await fetch(`${RAZORPAY_API_BASE}/disputes?${query.toString()}`, {
    method: "GET",
    headers: { Authorization: getAuthHeader(params.creds) },
  });
  if (!res.ok) {
    const message = await readRazorpayErrorMessage(res);
    throw new GatewayApiError(`Razorpay list disputes failed: ${message}`, res.status);
  }
  const json = (await res.json()) as { items?: RazorpayDispute[] };
  return Array.isArray(json.items) ? json.items : [];
}

/** One dispute as it stands now — a webhook's copy may be older than the decision. */
export async function fetchRazorpayDispute(params: {
  creds: RazorpayCredentials;
  disputeId: string;
}): Promise<RazorpayDispute> {
  const res = await fetch(
    `${RAZORPAY_API_BASE}/disputes/${encodeURIComponent(params.disputeId)}`,
    { method: "GET", headers: { Authorization: getAuthHeader(params.creds) } },
  );
  if (!res.ok) {
    const message = await readRazorpayErrorMessage(res);
    throw new GatewayApiError(`Razorpay fetch dispute failed: ${message}`, res.status);
  }
  return (await res.json()) as RazorpayDispute;
}

export async function testRazorpayCredentials(creds: RazorpayCredentials) {
  const res = await fetch(`${RAZORPAY_API_BASE}/orders?count=1`, {
    method: "GET",
    headers: {
      Authorization: getAuthHeader(creds),
    },
  });

  if (!res.ok) {
    const message = await readRazorpayErrorMessage(res);
    throw new Error(`Razorpay auth failed: ${message}`);
  }
}

export function verifyRazorpayPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}) {
  const expected = crypto
    .createHmac("sha256", params.keySecret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest("hex");

  return timingSafeEqualHex(expected, params.signature);
}

export function verifyRazorpayWebhookSignature(params: {
  body: string;
  signature: string;
  webhookSecret: string;
}) {
  const expected = crypto
    .createHmac("sha256", params.webhookSecret)
    .update(params.body)
    .digest("hex");

  return timingSafeEqualHex(expected, params.signature);
}
