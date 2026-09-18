import crypto from "crypto";
import { GatewayApiError } from "@/lib/payments/gateway-api-error";
import type {
  PaystackDisputeLike,
  PaystackRefundLike,
} from "@/lib/orders/dispute-readings";

const PAYSTACK_API_BASE = "https://api.paystack.co";

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

interface PaystackCredentials {
  secretKey: string;
  publicKey?: string;
}

interface PaystackInitializeTransaction {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackTransaction {
  id: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  gateway_response?: string;
  channel?: string;
  paid_at?: string;
  paidAt?: string;
  fees?: number;
  customer?: {
    email?: string;
    customer_code?: string;
  };
  metadata?: unknown;
}

type PaystackResponse<T> = {
  status: boolean;
  message: string;
  data?: T;
};

async function readPaystackErrorMessage(res: Response) {
  try {
    const json = (await res.json()) as Partial<PaystackResponse<unknown>>;
    if (typeof json.message === "string") return json.message;
    return `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function readPaystackJson<T>(res: Response, action: string) {
  const json = (await res.json()) as PaystackResponse<T>;
  if (!json.status || !json.data) {
    throw new Error(`Paystack ${action} failed: ${json.message || "Unknown error"}`);
  }
  return json.data;
}

export function getPaystackCurrencyExponent(currency: string) {
  const normalized = currency.trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return 3;
  return 2;
}

export function toPaystackAmountSubunits(amount: number, currency: string) {
  const exponent = getPaystackCurrencyExponent(currency);
  return Math.round(Number(amount || 0) * 10 ** exponent);
}

/**
 * The inverse: a subunit figure Paystack handed BACK, in major units.
 *
 * Webhook payloads quote money in subunits, and a refund read out of one has
 * to be compared against an order that is stored in major units. Doing that
 * division at the call site is how a zero-decimal currency ends up divided by
 * a hundred.
 */
export function fromPaystackAmountSubunits(amount: number, currency: string) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  return value / 10 ** getPaystackCurrencyExponent(currency);
}

export function getPaystackCredentials(params?: {
  secretKey?: string;
  publicKey?: string;
}): PaystackCredentials {
  const secretKey = params?.secretKey || process.env.PAYSTACK_SECRET_KEY || "";
  const publicKey =
    params?.publicKey ||
    process.env.PAYSTACK_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ||
    "";

  if (!secretKey) {
    throw new Error("Paystack is not configured. Missing secret key.");
  }

  return { secretKey, publicKey };
}

export function isPaystackConfigured(secretKey?: string) {
  return Boolean(secretKey || process.env.PAYSTACK_SECRET_KEY);
}

export async function initializePaystackTransaction(params: {
  creds: PaystackCredentials;
  email: string;
  amount: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}) {
  const res = await fetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.creds.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: params.email,
      amount: String(toPaystackAmountSubunits(params.amount, params.currency)),
      currency: params.currency.toUpperCase(),
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata ? JSON.stringify(params.metadata) : undefined,
    }),
  });

  if (!res.ok) {
    const message = await readPaystackErrorMessage(res);
    throw new Error(`Paystack initialize transaction failed: ${message}`);
  }

  return readPaystackJson<PaystackInitializeTransaction>(res, "initialize");
}

export async function verifyPaystackTransaction(params: {
  creds: PaystackCredentials;
  reference: string;
}) {
  const res = await fetch(
    `${PAYSTACK_API_BASE}/transaction/verify/${encodeURIComponent(
      params.reference,
    )}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.creds.secretKey}`,
      },
    },
  );

  if (!res.ok) {
    const message = await readPaystackErrorMessage(res);
    throw new Error(`Paystack verify transaction failed: ${message}`);
  }

  return readPaystackJson<PaystackTransaction>(res, "verify");
}

export async function refundPaystackTransaction(params: {
  creds: PaystackCredentials;
  transaction: string;
  amount?: number;
  currency?: string;
  reason?: string;
}) {
  const body: Record<string, unknown> = { transaction: params.transaction };
  if (
    params.amount !== undefined &&
    params.currency &&
    Number.isFinite(params.amount) &&
    params.amount > 0
  ) {
    body.amount = toPaystackAmountSubunits(params.amount, params.currency);
  }
  if (params.reason) {
    body.merchant_note = params.reason.slice(0, 255);
  }

  const res = await fetch(`${PAYSTACK_API_BASE}/refund`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.creds.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const message = await readPaystackErrorMessage(res);
    throw new Error(`Paystack refund failed: ${message}`);
  }

  return readPaystackJson<{
    id: number;
    status: string;
    amount: number;
    transaction: { id: number; reference: string };
  }>(res, "refund");
}

/** A dispute, and a refund, as Paystack's API returns them. */
export type PaystackDispute = PaystackDisputeLike & { id: number | string };
export type PaystackRefund = PaystackRefundLike & { id: number | string };

/** A Paystack read that fails as a `GatewayApiError`, so a caller can tell an outage from a refusal. */
async function getPaystack<T>(
  creds: PaystackCredentials,
  path: string,
  action: string,
): Promise<{ data: T; meta?: { pageCount?: number } }> {
  const res = await fetch(`${PAYSTACK_API_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${creds.secretKey}` },
  });
  if (!res.ok) {
    const message = await readPaystackErrorMessage(res);
    throw new GatewayApiError(`Paystack ${action} failed: ${message}`, res.status);
  }
  const json = (await res.json()) as PaystackResponse<T> & {
    meta?: { pageCount?: number };
  };
  if (!json.status || json.data === undefined) {
    throw new GatewayApiError(
      `Paystack ${action} failed: ${json.message || "Unknown error"}`,
      422,
    );
  }
  return { data: json.data, meta: json.meta };
}

/**
 * Disputes filed on the integration, a page at a time. `from` and `to` bound
 * when the dispute was created.
 */
export async function listPaystackDisputes(params: {
  creds: PaystackCredentials;
  from?: Date;
  to?: Date;
  page?: number;
  perPage?: number;
}): Promise<{ disputes: PaystackDispute[]; pageCount: number }> {
  const query = new URLSearchParams({
    perPage: String(Math.min(100, Math.max(1, params.perPage ?? 100))),
    page: String(Math.max(1, params.page ?? 1)),
  });
  if (params.from) query.set("from", params.from.toISOString());
  if (params.to) query.set("to", params.to.toISOString());
  const { data, meta } = await getPaystack<PaystackDispute[]>(
    params.creds,
    `/dispute?${query.toString()}`,
    "list disputes",
  );
  return {
    disputes: Array.isArray(data) ? data : [],
    pageCount: Math.max(1, Number(meta?.pageCount || 1)),
  };
}

/** One dispute as it stands now — a webhook's copy may be older than the decision. */
export async function fetchPaystackDispute(params: {
  creds: PaystackCredentials;
  disputeId: string;
}): Promise<PaystackDispute> {
  const { data } = await getPaystack<PaystackDispute>(
    params.creds,
    `/dispute/${encodeURIComponent(params.disputeId)}`,
    "fetch dispute",
  );
  return data;
}

/**
 * The refunds on one transaction, as Paystack's API lists them.
 *
 * The API's refund names its transaction and — for a chargeback the store
 * accepted — its dispute, neither of which the `refund.*` webhook reliably
 * carries. Filtered here as well as asked for, because a list that ignores the
 * filter would otherwise hand back other transactions' refunds.
 */
export async function listPaystackRefunds(params: {
  creds: PaystackCredentials;
  /** The transaction's id or reference. */
  transaction: { id?: string; reference?: string };
  perPage?: number;
}): Promise<PaystackRefund[]> {
  const id = String(params.transaction.id || "");
  const reference = String(params.transaction.reference || "");
  if (!id && !reference) return [];
  const query = new URLSearchParams({
    transaction: id || reference,
    perPage: String(Math.min(100, Math.max(1, params.perPage ?? 100))),
  });
  const { data } = await getPaystack<PaystackRefund[]>(
    params.creds,
    `/refund?${query.toString()}`,
    "list refunds",
  );
  return (Array.isArray(data) ? data : []).filter((refund) => {
    const transaction = refund.transaction;
    const refundTransactionId =
      transaction && typeof transaction === "object"
        ? String(transaction.id ?? "")
        : String(transaction ?? "");
    const refundReference =
      transaction && typeof transaction === "object"
        ? String(transaction.reference || refund.transaction_reference || "")
        : String(refund.transaction_reference || "");
    return (
      (id !== "" && refundTransactionId === id) ||
      (reference !== "" && refundReference === reference)
    );
  });
}

export async function testPaystackCredentials(creds: PaystackCredentials) {
  const res = await fetch(`${PAYSTACK_API_BASE}/transaction?perPage=1`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${creds.secretKey}`,
    },
  });

  if (!res.ok) {
    const message = await readPaystackErrorMessage(res);
    throw new Error(`Paystack auth failed: ${message}`);
  }
}

export function verifyPaystackWebhookSignature(params: {
  body: string;
  signature: string;
  secretKey: string;
}) {
  const expected = crypto
    .createHmac("sha512", params.secretKey)
    .update(params.body)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected, "hex");
  const signatureBuffer = Buffer.from(params.signature, "hex");
  if (expectedBuffer.length !== signatureBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}
