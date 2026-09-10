export type PesapalMode = "sandbox" | "live";

const PESAPAL_API_BASE: Record<PesapalMode, string> = {
  sandbox: "https://cybqa.pesapal.com/pesapalv3",
  live: "https://pay.pesapal.com/v3",
};

export interface PesapalCredentials {
  consumerKey: string;
  consumerSecret: string;
  mode: PesapalMode;
  ipnId?: string;
}

type PesapalError = {
  error_type?: string | null;
  code?: string | null;
  message?: string | null;
};

type PesapalResponseBase = {
  status?: string | number;
  message?: string;
  error?: PesapalError | string | null;
};

interface PesapalSubmitOrderResponse extends PesapalResponseBase {
  order_tracking_id: string;
  merchant_reference: string;
  redirect_url: string;
}

export interface PesapalTransactionStatus extends PesapalResponseBase {
  payment_method?: string;
  amount: number;
  created_date?: string;
  confirmation_code?: string;
  payment_status_description?: string;
  description?: string;
  payment_account?: string;
  call_back_url?: string;
  status_code?: number;
  merchant_reference: string;
  payment_status_code?: string;
  currency: string;
}

type PesapalTransactionState =
  | "completed"
  | "pending"
  | "failed"
  | "reversed"
  | "invalid";

interface PesapalBillingAddress {
  email_address?: string;
  phone_number?: string;
  country_code?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  line_1?: string;
  line_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  zip_code?: string;
}

export function getPesapalApiBaseUrl(mode: PesapalMode) {
  return PESAPAL_API_BASE[mode];
}

/**
 * Currencies Pesapal can settle.
 *
 * Pesapal is an East African acquirer, not a global one: everything outside
 * this list is refused at SubmitOrderRequest. Without the check the gateway is
 * offered under any store currency and the payer only finds out at the last
 * step — after a boost has already reserved its days, or after a shopper has
 * built a whole cart. The same reasoning already gates ioTec to UGX.
 *
 * Being on the list is necessary, not sufficient: the merchant account itself
 * must be enabled for the currency (a Kenyan account is unlikely to hold MWK).
 * That half only Pesapal can answer, so it stays a gateway-side error.
 */
export const PESAPAL_CURRENCIES = new Set([
  "KES",
  "TZS",
  "UGX",
  "RWF",
  "ZMW",
  "MWK",
  "USD",
  "GBP",
  "EUR",
]);

export function isPesapalCurrency(currency?: string | null): boolean {
  return PESAPAL_CURRENCIES.has(String(currency || "").trim().toUpperCase());
}

const PESAPAL_COUNTRY_CODES: Record<string, string> = {
  uganda: "UG",
  kenya: "KE",
  tanzania: "TZ",
  rwanda: "RW",
  zambia: "ZM",
  malawi: "MW",
  nigeria: "NG",
  "south africa": "ZA",
  bangladesh: "BD",
  india: "IN",
  "united kingdom": "GB",
  "united states": "US",
};

export function normalizePesapalCountryCode(country?: string) {
  const normalized = String(country || "").trim();
  if (/^[a-z]{2}$/i.test(normalized)) return normalized.toUpperCase();
  return PESAPAL_COUNTRY_CODES[normalized.toLowerCase()];
}

export function getPesapalCredentials(params?: {
  consumerKey?: string;
  consumerSecret?: string;
  mode?: PesapalMode;
  ipnId?: string;
}): PesapalCredentials {
  const consumerKey = params?.consumerKey || process.env.PESAPAL_CONSUMER_KEY || "";
  const consumerSecret =
    params?.consumerSecret || process.env.PESAPAL_CONSUMER_SECRET || "";
  const configuredMode = params?.mode || process.env.PESAPAL_MODE;
  const mode: PesapalMode = configuredMode === "live" ? "live" : "sandbox";
  const ipnId = params?.ipnId || process.env.PESAPAL_IPN_ID || undefined;

  if (!consumerKey || !consumerSecret) {
    throw new Error(
      "Pesapal is not configured. Missing consumer key or consumer secret.",
    );
  }

  return { consumerKey, consumerSecret, mode, ipnId };
}

function getPesapalErrorMessage(
  data: PesapalResponseBase | undefined,
  fallback: string,
) {
  if (typeof data?.error === "string" && data.error.trim()) return data.error;
  if (
    data?.error &&
    typeof data.error === "object" &&
    typeof data.error.message === "string" &&
    data.error.message.trim()
  ) {
    return data.error.message;
  }
  if (typeof data?.message === "string" && data.message.trim()) {
    return data.message;
  }
  return fallback;
}

async function readPesapalJson<T extends PesapalResponseBase>(
  response: Response,
  action: string,
) {
  let data: T;
  try {
    data = (await response.json()) as T;
  } catch {
    throw new Error(`Pesapal ${action} failed: HTTP ${response.status}`);
  }

  const status = data.status === undefined ? undefined : String(data.status);
  const hasError =
    typeof data.error === "string"
      ? Boolean(data.error.trim())
      : Boolean(data.error && data.error.message);

  if (!response.ok || hasError || (status && status !== "200")) {
    throw new Error(
      `Pesapal ${action} failed: ${getPesapalErrorMessage(
        data,
        `HTTP ${response.status}`,
      )}`,
    );
  }

  return data;
}

// Pesapal tokens live ~5 minutes. Caching them keeps a checkout to one round
// trip instead of two; the skew stops us using a token about to expire.
const PESAPAL_TOKEN_SKEW_MS = 30_000;
const PESAPAL_TOKEN_FALLBACK_TTL_MS = 4 * 60_000;
const pesapalTokenCache = new Map<string, { token: string; expiresAt: number }>();

function pesapalTokenCacheKey(creds: PesapalCredentials) {
  return `${creds.mode}:${creds.consumerKey}:${creds.consumerSecret}`;
}

/** Drops every cached token. Exported for tests. */
export function resetPesapalTokenCache() {
  pesapalTokenCache.clear();
}

export async function requestPesapalToken(
  creds: PesapalCredentials,
  options?: { forceRefresh?: boolean },
) {
  const cacheKey = pesapalTokenCacheKey(creds);
  if (!options?.forceRefresh) {
    const cached = pesapalTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
  }

  const response = await fetch(
    `${getPesapalApiBaseUrl(creds.mode)}/api/Auth/RequestToken`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        consumer_key: creds.consumerKey,
        consumer_secret: creds.consumerSecret,
      }),
    },
  );

  const data = await readPesapalJson<
    PesapalResponseBase & { token?: string; expiryDate?: string }
  >(response, "authentication");
  if (!data.token) {
    throw new Error("Pesapal authentication failed: token was not returned");
  }

  const parsedExpiry = data.expiryDate ? Date.parse(data.expiryDate) : NaN;
  const expiresAt =
    (Number.isFinite(parsedExpiry)
      ? parsedExpiry
      : Date.now() + PESAPAL_TOKEN_FALLBACK_TTL_MS) - PESAPAL_TOKEN_SKEW_MS;
  pesapalTokenCache.set(cacheKey, { token: data.token, expiresAt });

  return data.token;
}

async function pesapalAuthorizedRequest<T extends PesapalResponseBase>(
  creds: PesapalCredentials,
  path: string,
  init: RequestInit,
  action: string,
) {
  const send = async (forceRefresh: boolean) => {
    const token = await requestPesapalToken(creds, { forceRefresh });
    return fetch(`${getPesapalApiBaseUrl(creds.mode)}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  };

  let response = await send(false);
  // A cached token that was revoked or rotated early would otherwise fail every
  // call until it expired — drop it and retry once with a fresh one.
  if (response.status === 401) {
    response = await send(true);
  }
  return readPesapalJson<T>(response, action);
}

export async function registerPesapalIpn(params: {
  creds: PesapalCredentials;
  url: string;
  notificationType?: "GET" | "POST";
}) {
  return pesapalAuthorizedRequest<
    PesapalResponseBase & {
      url: string;
      created_date?: string;
      ipn_id: string;
      ipn_notification_type_description?: string;
      ipn_status?: number;
    }
  >(
    params.creds,
    "/api/URLSetup/RegisterIPN",
    {
      method: "POST",
      body: JSON.stringify({
        url: params.url,
        ipn_notification_type: params.notificationType || "POST",
      }),
    },
    "IPN registration",
  );
}

export async function submitPesapalOrder(params: {
  creds: PesapalCredentials;
  merchantReference: string;
  currency: string;
  amount: number;
  description: string;
  callbackUrl: string;
  cancellationUrl?: string;
  notificationId: string;
  billingAddress: PesapalBillingAddress;
}) {
  return pesapalAuthorizedRequest<PesapalSubmitOrderResponse>(
    params.creds,
    "/api/Transactions/SubmitOrderRequest",
    {
      method: "POST",
      body: JSON.stringify({
        id: params.merchantReference,
        currency: params.currency.toUpperCase(),
        amount: params.amount,
        description: params.description,
        callback_url: params.callbackUrl,
        cancellation_url: params.cancellationUrl,
        notification_id: params.notificationId,
        billing_address: params.billingAddress,
      }),
    },
    "submit order",
  );
}

export async function getPesapalTransactionStatus(params: {
  creds: PesapalCredentials;
  orderTrackingId: string;
}) {
  return pesapalAuthorizedRequest<PesapalTransactionStatus>(
    params.creds,
    `/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(
      params.orderTrackingId,
    )}`,
    { method: "GET" },
    "transaction status",
  );
}

export function getPesapalTransactionState(
  transaction: Pick<
    PesapalTransactionStatus,
    "payment_status_description" | "status_code"
  >,
): PesapalTransactionState {
  const description = String(
    transaction.payment_status_description || "",
  ).toUpperCase();

  if (description === "COMPLETED") return "completed";
  if (description === "PENDING") return "pending";
  if (description === "FAILED") return "failed";
  if (description === "REVERSED") return "reversed";
  if (description === "INVALID") return "invalid";

  const statusCode = Number(transaction.status_code);
  if (statusCode === 1) return "completed";
  if (statusCode === 2) return "failed";
  if (statusCode === 3) return "reversed";
  if (statusCode === 0) return "invalid";
  return "pending";
}

export async function refundPesapalTransaction(params: {
  creds: PesapalCredentials;
  confirmationCode: string;
  amount: number;
  username: string;
  remarks: string;
}) {
  return pesapalAuthorizedRequest<PesapalResponseBase & { status: string }>(
    params.creds,
    "/api/Transactions/RefundRequest",
    {
      method: "POST",
      body: JSON.stringify({
        confirmation_code: params.confirmationCode,
        amount: params.amount.toFixed(2),
        username: params.username,
        remarks: params.remarks,
      }),
    },
    "refund request",
  );
}
