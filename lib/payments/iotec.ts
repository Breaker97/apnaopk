export type IotecMode = "sandbox" | "live";

// ioTec Pay uses a single hosted API for both sandbox and live; the mode is
// distinguished by the credentials (and wallet) issued in the ioTec portal.
const IOTEC_API_BASE: Record<IotecMode, string> = {
  sandbox: "https://pay.iotec.io",
  live: "https://pay.iotec.io",
};

// Identity server issuing the OAuth2 client-credentials access token.
const IOTEC_TOKEN_URL = "https://id.iotec.io/connect/token";

// ioTec Pay settles Ugandan mobile money and cards in shillings only.
export const IOTEC_CURRENCY = "UGX";

// ioTec collections require a minimum amount (documented as 500 UGX).
export const IOTEC_MIN_AMOUNT = 500;

export interface IotecCredentials {
  clientId: string;
  clientSecret: string;
  walletId: string;
  mode: IotecMode;
}

type IotecPaymentCategory = "MobileMoney" | "Card";

export interface IotecCollectionResponse {
  id: string;
  status?: string;
  statusCode?: string;
  statusMessage?: string;
  amount?: number;
  currency?: string;
  createdAt?: string;
  // Present only for card collections.
  cardRedirectUrl?: string;
}

export interface IotecTransactionStatus {
  id: string;
  status?: string;
  statusCode?: string;
  statusMessage?: string;
  amount?: number;
  currency?: string;
  payer?: string;
  externalId?: string;
  processedAt?: string;
}

// Normalized transaction outcome used across the app.
type IotecTransactionState =
  | "completed"
  | "pending"
  | "failed"
  | "invalid";

export function getIotecApiBaseUrl(mode: IotecMode) {
  return IOTEC_API_BASE[mode];
}

/**
 * Converts a local Ugandan number into the MSISDN format ioTec expects
 * (country code + subscriber number, no plus sign), e.g.
 *   "0772123456"    -> "256772123456"
 *   "+256772123456" -> "256772123456"
 *   "256772123456"  -> "256772123456"
 *   "772123456"     -> "256772123456"
 * Returns an empty string when the input cannot be normalized.
 */
export function normalizeUgandaMsisdn(phone?: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("256")) {
    return digits.length === 12 ? digits : "";
  }
  if (digits.startsWith("0")) {
    const rest = digits.slice(1);
    return rest.length === 9 ? `256${rest}` : "";
  }
  // Bare 9-digit subscriber number (e.g. "772123456").
  if (digits.length === 9) {
    return `256${digits}`;
  }
  return "";
}

export function getIotecCredentials(params?: {
  clientId?: string;
  clientSecret?: string;
  walletId?: string;
  mode?: IotecMode;
}): IotecCredentials {
  const clientId = params?.clientId || process.env.IOTEC_CLIENT_ID || "";
  const clientSecret =
    params?.clientSecret || process.env.IOTEC_CLIENT_SECRET || "";
  const walletId = params?.walletId || process.env.IOTEC_WALLET_ID || "";
  const configuredMode = params?.mode || process.env.IOTEC_MODE;
  const mode: IotecMode = configuredMode === "live" ? "live" : "sandbox";

  if (!clientId || !clientSecret) {
    throw new Error(
      "ioTec Pay is not configured. Missing client ID or client secret.",
    );
  }

  return { clientId, clientSecret, walletId, mode };
}

async function readIotecJson<T>(response: Response, action: string): Promise<T> {
  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON body; fall through to the HTTP-status error below.
    }
  }

  if (!response.ok) {
    const message =
      (data &&
        typeof data === "object" &&
        (("statusMessage" in data &&
          typeof (data as { statusMessage?: unknown }).statusMessage ===
            "string" &&
          (data as { statusMessage?: string }).statusMessage) ||
          ("error_description" in data &&
            typeof (data as { error_description?: unknown })
              .error_description === "string" &&
            (data as { error_description?: string }).error_description) ||
          ("error" in data &&
            typeof (data as { error?: unknown }).error === "string" &&
            (data as { error?: string }).error) ||
          ("message" in data &&
            typeof (data as { message?: unknown }).message === "string" &&
            (data as { message?: string }).message))) ||
      `HTTP ${response.status}`;
    throw new Error(`ioTec ${action} failed: ${message}`);
  }

  return (data ?? {}) as T;
}

// Tokens live ~300s. Caching them keeps a collection to one round trip instead
// of two; the skew stops us using a token that is about to expire.
const IOTEC_TOKEN_SKEW_MS = 30_000;
const IOTEC_TOKEN_FALLBACK_TTL_MS = 4 * 60_000;
const iotecTokenCache = new Map<string, { token: string; expiresAt: number }>();

function iotecTokenCacheKey(creds: IotecCredentials) {
  return `${creds.mode}:${creds.clientId}:${creds.clientSecret}`;
}

/** Drops every cached token. Exported for tests. */
export function resetIotecTokenCache() {
  iotecTokenCache.clear();
}

/**
 * Requests an OAuth2 access token via the client-credentials grant, reusing a
 * cached one while it is still valid.
 */
export async function requestIotecToken(
  creds: IotecCredentials,
  options?: { forceRefresh?: boolean },
): Promise<string> {
  const cacheKey = iotecTokenCacheKey(creds);
  if (!options?.forceRefresh) {
    const cached = iotecTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const response = await fetch(IOTEC_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const data = await readIotecJson<{
    access_token?: string;
    expires_in?: number;
  }>(response, "authentication");
  if (!data.access_token) {
    throw new Error("ioTec authentication failed: token was not returned");
  }

  const ttlMs =
    Number(data.expires_in) > 0
      ? Number(data.expires_in) * 1000
      : IOTEC_TOKEN_FALLBACK_TTL_MS;
  iotecTokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + ttlMs - IOTEC_TOKEN_SKEW_MS,
  });

  return data.access_token;
}

async function iotecAuthorizedRequest<T>(
  creds: IotecCredentials,
  path: string,
  init: RequestInit,
  action: string,
): Promise<T> {
  const send = async (forceRefresh: boolean) => {
    const token = await requestIotecToken(creds, { forceRefresh });
    return fetch(`${getIotecApiBaseUrl(creds.mode)}${path}`, {
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
  return readIotecJson<T>(response, action);
}

/**
 * Initiates a mobile-money collection. This triggers a PIN prompt on the
 * payer's phone (MTN MoMo / Airtel Money); the transaction resolves
 * asynchronously and must be polled (or received via portal callback).
 */
export async function submitIotecCollection(params: {
  creds: IotecCredentials;
  externalId: string;
  currency: string;
  amount: number;
  payer: string;
  payerName?: string;
  payerNote?: string;
  payeeNote?: string;
}): Promise<IotecCollectionResponse> {
  return iotecAuthorizedRequest<IotecCollectionResponse>(
    params.creds,
    "/api/collections/collect",
    {
      method: "POST",
      body: JSON.stringify({
        category: "MobileMoney" satisfies IotecPaymentCategory,
        currency: params.currency.toUpperCase(),
        walletId: params.creds.walletId,
        externalId: params.externalId,
        payer: params.payer,
        amount: params.amount,
        payerName: params.payerName,
        payerNote: params.payerNote,
        payeeNote: params.payeeNote,
      }),
    },
    "collection request",
  );
}

/**
 * Initiates a card collection. Returns a `cardRedirectUrl` the payer is sent to
 * in order to complete the card payment on ioTec's hosted page.
 */
export async function submitIotecCardCollection(params: {
  creds: IotecCredentials;
  externalId: string;
  currency: string;
  amount: number;
  payer: string; // customer email for card payments
  redirectUrl: string;
  payerName?: string;
  payerNote?: string;
  payeeNote?: string;
}): Promise<IotecCollectionResponse> {
  return iotecAuthorizedRequest<IotecCollectionResponse>(
    params.creds,
    "/api/collections/collect/card",
    {
      method: "POST",
      body: JSON.stringify({
        category: "Card" satisfies IotecPaymentCategory,
        currency: params.currency.toUpperCase(),
        walletId: params.creds.walletId,
        externalId: params.externalId,
        payer: params.payer,
        amount: params.amount,
        redirectUrl: params.redirectUrl,
        payerName: params.payerName,
        payerNote: params.payerNote,
        payeeNote: params.payeeNote,
      }),
    },
    "card collection request",
  );
}

export async function getIotecTransactionStatus(params: {
  creds: IotecCredentials;
  transactionId: string;
}): Promise<IotecTransactionStatus> {
  return iotecAuthorizedRequest<IotecTransactionStatus>(
    params.creds,
    `/api/collections/status/${encodeURIComponent(params.transactionId)}`,
    { method: "GET" },
    "transaction status",
  );
}

export async function getIotecTransactionStatusByExternalId(params: {
  creds: IotecCredentials;
  externalId: string;
}): Promise<IotecTransactionStatus> {
  return iotecAuthorizedRequest<IotecTransactionStatus>(
    params.creds,
    `/api/collections/external-id/${encodeURIComponent(params.externalId)}`,
    { method: "GET" },
    "transaction status",
  );
}

/**
 * Maps ioTec's status values (`Success`, `Failed`, `Pending`, `SentToVendor`)
 * to the normalized outcome used by the finalizer. `SentToVendor` means the
 * request was accepted by the mobile-money vendor but not yet confirmed, so it
 * is treated as pending.
 */
export function getIotecTransactionState(
  transaction: Pick<IotecTransactionStatus, "status" | "statusCode">,
): IotecTransactionState {
  const status = String(
    transaction.status || transaction.statusCode || "",
  ).toUpperCase();

  if (status === "SUCCESS" || status === "SUCCEEDED" || status === "COMPLETED")
    return "completed";
  if (status === "FAILED" || status === "FAILURE") return "failed";
  if (status === "PENDING" || status === "SENTTOVENDOR" || status === "SENT")
    return "pending";
  if (status === "INVALID") return "invalid";
  return "pending";
}
