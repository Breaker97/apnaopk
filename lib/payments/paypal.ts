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
