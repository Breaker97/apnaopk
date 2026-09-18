import { GatewayApiError } from "@/lib/payments/gateway-api-error";
import type { PayPalDisputeLike } from "@/lib/orders/dispute-readings";

export type PayPalMode = "sandbox" | "live";

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
  mode: PayPalMode;
}

function getBaseUrl(mode: PayPalMode) {
  return mode === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function readErrorMessage(res: Response) {
  try {
    const json = await res.json();
    if (typeof json?.message === "string") return json.message;
    if (typeof json?.error_description === "string") return json.error_description;
    if (typeof json?.error === "string") return json.error;
    if (Array.isArray(json?.details) && typeof json.details?.[0]?.description === "string") {
      return json.details[0].description;
    }
    return `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function getPayPalAccessToken(creds: PayPalCredentials) {
  const baseUrl = getBaseUrl(creds.mode);
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(`PayPal auth failed: ${message}`);
  }

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("PayPal auth failed: missing access token");
  return json.access_token;
}

export async function createPayPalOrder(params: {
  creds: PayPalCredentials;
  currency: string;
  total: number;
  returnUrl: string;
  cancelUrl: string;
  referenceId: string;
}) {
  const token = await getPayPalAccessToken(params.creds);
  const baseUrl = getBaseUrl(params.creds.mode);

  const res = await fetch(`${baseUrl}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: params.referenceId,
          amount: {
            currency_code: params.currency,
            value: params.total.toFixed(2),
          },
        },
      ],
      application_context: {
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    }),
  });

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(`PayPal create order failed: ${message}`);
  }

  const json = (await res.json()) as {
    id?: string;
    links?: { rel?: string; href?: string }[];
    status?: string;
  };

  const approvalUrl = json.links?.find((l) => l.rel === "approve")?.href;
  if (!json.id || !approvalUrl) {
    throw new Error("PayPal create order failed: missing order id or approval link");
  }

  return { orderId: json.id, approvalUrl, status: json.status };
}

export async function refundPayPalCapture(params: {
  creds: PayPalCredentials;
  captureId: string;
  amount?: number;
  currency?: string;
  reason?: string;
}) {
  const token = await getPayPalAccessToken(params.creds);
  const baseUrl = getBaseUrl(params.creds.mode);

  const body: Record<string, unknown> = {};
  if (
    params.amount !== undefined &&
    params.currency &&
    Number.isFinite(params.amount) &&
    params.amount > 0
  ) {
    body.amount = {
      value: params.amount.toFixed(2),
      currency_code: params.currency.toUpperCase(),
    };
  }
  if (params.reason) {
    body.note_to_payer = params.reason.slice(0, 255);
  }

  const res = await fetch(
    `${baseUrl}/v2/payments/captures/${encodeURIComponent(params.captureId)}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
    },
  );

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(`PayPal refund failed: ${message}`);
  }

  const json = (await res.json()) as { id?: string; status?: string };
  return { refundId: json.id, status: json.status, raw: json };
}

/** The parts of PayPal's capture response the app reads. */
interface PayPalCaptureResponse {
  status?: string;
  payer?: { email_address?: string };
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { value?: string; currency_code?: string };
      }>;
      authorizations?: Array<{ id?: string }>;
    };
  }>;
  [key: string]: unknown;
}

export async function capturePayPalOrder(params: {
  creds: PayPalCredentials;
  orderId: string;
}) {
  const token = await getPayPalAccessToken(params.creds);
  const baseUrl = getBaseUrl(params.creds.mode);

  const res = await fetch(`${baseUrl}/v2/checkout/orders/${params.orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(`PayPal capture failed: ${message}`);
  }

  const json = (await res.json()) as PayPalCaptureResponse;
  const captureId =
    json?.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
    json?.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;

  return { raw: json, captureId };
}

/**
 * Capture an approved PayPal order — or, when PayPal refuses because an earlier
 * attempt already captured it, read that capture back.
 *
 * A capture that succeeded at PayPal but was never recorded here (the response
 * lost, a check that threw, the database briefly down) left the order pending
 * for good: every retry asked PayPal to capture again, PayPal answered
 * ORDER_ALREADY_CAPTURED, and the money it held was never tied to anything.
 * The order-details read answers in the same shape as a capture, so callers
 * check both the same way. Anything that is not a capture is rethrown.
 */
export async function captureOrReadPayPalOrder(params: {
  creds: PayPalCredentials;
  orderId: string;
}): Promise<{ raw: PayPalCaptureResponse; captureId?: string }> {
  try {
    return await capturePayPalOrder(params);
  } catch (err) {
    const existing = await readPayPalOrderCapture(params).catch(() => null);
    if (!existing?.captureId) throw err;
    return {
      raw: existing.raw as PayPalCaptureResponse,
      captureId: existing.captureId,
    };
  }
}

/** Headers PayPal signs a webhook delivery with. */
interface PayPalWebhookHeaders {
  authAlgo?: string | null;
  certUrl?: string | null;
  transmissionId?: string | null;
  transmissionSig?: string | null;
  transmissionTime?: string | null;
}

/**
 * Ask PayPal whether it really sent this.
 *
 * There is no shared secret to HMAC against the way Stripe and Paystack have —
 * PayPal signs with a certificate and verifies the signature for you. So this
 * is a round trip rather than a local computation, and a failure to reach
 * PayPal has to read as "not verified" rather than "probably fine": a webhook
 * that moves money on an unverified body is an open door.
 */
export async function verifyPayPalWebhookSignature(params: {
  creds: PayPalCredentials;
  webhookId: string;
  headers: PayPalWebhookHeaders;
  /** The parsed event body, exactly as delivered. */
  event: unknown;
}): Promise<boolean> {
  const { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime } =
    params.headers;
  if (
    !params.webhookId ||
    !authAlgo ||
    !certUrl ||
    !transmissionId ||
    !transmissionSig ||
    !transmissionTime
  ) {
    return false;
  }

  const baseUrl = getBaseUrl(params.creds.mode);
  const token = await getPayPalAccessToken(params.creds);

  const res = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: authAlgo,
      cert_url: certUrl,
      transmission_id: transmissionId,
      transmission_sig: transmissionSig,
      transmission_time: transmissionTime,
      webhook_id: params.webhookId,
      webhook_event: params.event,
    }),
  });

  if (!res.ok) {
    console.error(
      "PayPal webhook verification call failed:",
      await readErrorMessage(res),
    );
    return false;
  }

  const json = (await res.json()) as { verification_status?: string };
  return json.verification_status === "SUCCESS";
}

/**
 * How much of a PayPal order can still be refunded, in major units.
 *
 * Asked of PayPal rather than worked out from our own books, for the same
 * reason the Stripe refund path asks Stripe: a refund issued from the PayPal
 * dashboard never passed through this app, and a figure computed from what we
 * recorded would offer money that has already gone back.
 *
 * The ORDER is what gets asked, not the capture, because PayPal reports refunds
 * on the order (`purchase_units[].payments.refunds`) and has no call that
 * totals them for a capture. Every PayPal order this app raises carries exactly
 * one capture, so the order's refundable figure is that capture's.
 */
export async function getPayPalOrderRefundable(params: {
  creds: PayPalCredentials;
  orderId: string;
}): Promise<{ refundable: number; currency?: string }> {
  const token = await getPayPalAccessToken(params.creds);
  const baseUrl = getBaseUrl(params.creds.mode);

  const res = await fetch(
    `${baseUrl}/v2/checkout/orders/${encodeURIComponent(params.orderId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(`PayPal order lookup failed: ${message}`);
  }

  const json = (await res.json()) as {
    purchase_units?: Array<{
      payments?: {
        captures?: Array<{
          status?: string;
          amount?: { value?: string; currency_code?: string };
        }>;
        refunds?: Array<{
          status?: string;
          amount?: { value?: string; currency_code?: string };
        }>;
      };
    }>;
  };

  // Hundredths throughout, so no float drift can offer a cent that is not
  // there. Whole-unit currencies quote "100" rather than "100.00", which the
  // same arithmetic carries through unchanged.
  const toHundredths = (value?: string) => {
    const parsed = Math.round(Number(value || 0) * 100);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  let captured = 0;
  let refunded = 0;
  let currency: string | undefined;
  for (const unit of json.purchase_units || []) {
    for (const capture of unit.payments?.captures || []) {
      // A capture PayPal has since refunded in part or in full still holds its
      // original amount; the refunds below are what take it back down.
      if (
        ["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(
          String(capture.status || "").toUpperCase(),
        )
      ) {
        captured += toHundredths(capture.amount?.value);
        currency = currency || capture.amount?.currency_code;
      }
    }
    for (const refund of unit.payments?.refunds || []) {
      // Pending money is spoken for. Offering it again would let a second
      // refund past before the first has even settled.
      if (
        ["COMPLETED", "PENDING"].includes(
          String(refund.status || "").toUpperCase(),
        )
      ) {
        refunded += toHundredths(refund.amount?.value);
      }
    }
  }

  return { refundable: Math.max(0, captured - refunded) / 100, currency };
}

/**
 * The capture already standing on a PayPal order, if there is one.
 *
 * For the case a capture call cannot answer twice: PayPal took the money, and
 * this app crashed — or timed out — before writing it down. Asking PayPal to
 * capture again is refused as already captured, so a retry that only knew how
 * to capture would never record money that has certainly moved. Reading the
 * order back recovers the capture instead.
 */
export async function readPayPalOrderCapture(params: {
  creds: PayPalCredentials;
  orderId: string;
}): Promise<{
  captureId?: string;
  status?: string;
  amount?: string;
  currency?: string;
  raw: unknown;
}> {
  const token = await getPayPalAccessToken(params.creds);
  const baseUrl = getBaseUrl(params.creds.mode);

  const res = await fetch(
    `${baseUrl}/v2/checkout/orders/${encodeURIComponent(params.orderId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new Error(`PayPal order lookup failed: ${message}`);
  }

  const json = (await res.json()) as PayPalCaptureResponse;
  const capture = json?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    captureId: capture?.id,
    status: capture?.status,
    amount: capture?.amount?.value,
    currency: capture?.amount?.currency_code,
    raw: json,
  };
}

/** A dispute's summary, as PayPal's dispute list returns it. */
export interface PayPalDisputeSummary {
  dispute_id?: string;
  update_time?: string;
  status?: string;
}

/**
 * Disputes on the account updated since a moment, a page at a time.
 *
 * The list carries summaries only — no fund movements — so a caller fetches
 * each dispute it acts on. Needs the REST app to have the Disputes feature;
 * without it PayPal answers 403, which is a refusal, not an outage.
 *
 * `next` is the link PayPal handed back for the following page. It is only
 * followed on PayPal's own API host, so the access token is never sent
 * anywhere a malformed response points.
 */
export async function listPayPalDisputes(params: {
  creds: PayPalCredentials;
  updatedAfter?: Date;
  next?: string;
  token?: string;
}): Promise<{ items: PayPalDisputeSummary[]; next?: string; token: string }> {
  const token = params.token || (await getPayPalAccessToken(params.creds));
  const baseUrl = getBaseUrl(params.creds.mode);

  let url: string;
  if (params.next) {
    if (!params.next.startsWith(`${baseUrl}/`)) {
      throw new GatewayApiError("PayPal list disputes failed: unexpected next page link", 400);
    }
    url = params.next;
  } else {
    const query = new URLSearchParams({ page_size: "50" });
    if (params.updatedAfter) {
      query.set("update_time_after", params.updatedAfter.toISOString());
    }
    url = `${baseUrl}/v1/customer/disputes?${query.toString()}`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new GatewayApiError(`PayPal list disputes failed: ${message}`, res.status);
  }
  const json = (await res.json()) as {
    items?: PayPalDisputeSummary[];
    links?: Array<{ rel?: string; href?: string }>;
  };
  return {
    items: Array.isArray(json.items) ? json.items : [],
    next: json.links?.find((link) => link.rel === "next")?.href,
    token,
  };
}

/** One dispute in full, fund movements included. */
export async function fetchPayPalDispute(params: {
  creds: PayPalCredentials;
  disputeId: string;
  token?: string;
}): Promise<PayPalDisputeLike> {
  const token = params.token || (await getPayPalAccessToken(params.creds));
  const baseUrl = getBaseUrl(params.creds.mode);
  const res = await fetch(
    `${baseUrl}/v1/customer/disputes/${encodeURIComponent(params.disputeId)}`,
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
  );
  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new GatewayApiError(`PayPal fetch dispute failed: ${message}`, res.status);
  }
  return (await res.json()) as PayPalDisputeLike;
}
