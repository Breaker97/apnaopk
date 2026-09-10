/**
 * Orange Money Web Payment (`om-webpay`).
 *
 * A redirect gateway for Orange's mobile-money wallets across francophone West
 * and Central Africa. Checkout mints a pay token, the payer is sent to Orange's
 * hosted page, validates with an OTP they generate over USSD, and Orange
 * notifies us server-to-server.
 *
 * Orange publishes no machine-readable spec: the field names below come from
 * their merchant integration guide as reproduced by community SDKs. Everything
 * that could drift is confined to this module so a correction from the real
 * merchant PDF is a one-file change.
 */

export type OrangeMoneyMode = "sandbox" | "live";

const ORANGE_API_BASE = "https://api.orange.com";
const ORANGE_TOKEN_PATH = "/oauth/v3/token";
const ORANGE_WEBPAY_PREFIX = "/orange-money-webpay";

/** The country segment Orange routes sandbox traffic through. */
const ORANGE_MONEY_SANDBOX_COUNTRY = "dev";

/** Orange's test currency. It is not ISO 4217 and only exists in sandbox. */
const ORANGE_MONEY_SANDBOX_CURRENCY = "OUV";

export interface OrangeMoneyCredentials {
  clientId: string;
  clientSecret: string;
  merchantKey: string;
  /** URL path segment: `dev` in sandbox, an operator country code when live. */
  country: string;
  mode: OrangeMoneyMode;
}

interface OrangeMoneyPaymentResponse {
  message?: string;
  pay_token: string;
  payment_url: string;
  notif_token: string;
}

export interface OrangeMoneyTransactionStatus {
  status?: string;
  order_id?: string;
  txnid?: string;
  /** Present on the notification body; `/transactionstatus` may omit both. */
  amount?: number | string;
  currency?: string;
  message?: string;
}

type OrangeMoneyTransactionState =
  | "completed"
  | "pending"
  | "failed"
  | "invalid";

export function getOrangeMoneyApiBaseUrl() {
  return ORANGE_API_BASE;
}

/**
 * Currencies Orange Money can settle.
 *
 * Orange Money is a per-country wallet, not a global acquirer: a merchant key
 * is issued by one national operator and settles in that country's currency
 * only. Refusing anything else at checkout keeps the payer from building a
 * whole cart before the gateway rejects it — the same reasoning that gates
 * Pesapal to East Africa and ioTec to UGX.
 *
 * Being on the list is necessary, not sufficient: the merchant contract must
 * also be live in that country. Only Orange can answer that half, so it stays
 * a gateway-side error.
 */
export const ORANGE_MONEY_CURRENCIES = new Set([
  "XOF", // Côte d'Ivoire, Senegal, Mali, Guinea-Bissau
  "XAF", // Cameroon, Central African Republic
  "MGA", // Madagascar
  "GNF", // Guinea Conakry
  "SLE", // Sierra Leone
  "CDF", // DR Congo
  "BWP", // Botswana
  "LRD", // Liberia
]);

/**
 * Languages Orange's hosted payment page is known to render.
 *
 * Orange Money's footprint is francophone West/Central Africa plus a few
 * anglophone markets, and every published SDK sends `fr` or `en`. Storify
 * carries 18 storefront locales, so passing the shopper's locale straight
 * through would hand Orange codes like `bn` or `zu` that its page cannot
 * answer for. French is the fallback because it is the default in Orange's own
 * examples and the language of most of its markets.
 *
 * If the merchant integration PDF lists more, widen this set — it is the only
 * place the mapping lives.
 */
const ORANGE_MONEY_LANGS = new Set(["fr", "en"]);

export function orangeMoneyLang(locale?: string | null): string {
  const normalized = String(locale || "").trim().toLowerCase().slice(0, 2);
  return ORANGE_MONEY_LANGS.has(normalized) ? normalized : "fr";
}

export function isOrangeMoneyCurrency(currency?: string | null): boolean {
  return ORANGE_MONEY_CURRENCIES.has(
    String(currency || "").trim().toUpperCase(),
  );
}

/**
 * The currency to quote Orange for an order priced in `orderCurrency`.
 *
 * Sandbox settles exclusively in `OUV`, a placeholder Orange invented for its
 * test bench. Sending the store's real currency there is rejected; comparing
 * the order's currency against what sandbox echoes back would fail every test
 * payment. So the mode, not the order, decides — and the finalizer compares
 * against this same function rather than against `order.currency` directly.
 */
export function orangeMoneyChargeCurrency(
  mode: OrangeMoneyMode,
  orderCurrency?: string | null,
): string {
  if (mode === "sandbox") return ORANGE_MONEY_SANDBOX_CURRENCY;
  return String(orderCurrency || "").trim().toUpperCase();
}

/**
 * The `{country}` path segment for the webpay endpoints.
 *
 * Sandbox is always `dev` whatever the setting says — a sandbox call routed at
 * a live country code is a 404 with no explanation. Live refuses to fall back
 * to `dev`, because posting production traffic at the test bench would look
 * like success and settle nothing.
 */
export function orangeMoneyCountrySegment(
  mode: OrangeMoneyMode,
  country?: string | null,
): string {
  if (mode === "sandbox") return ORANGE_MONEY_SANDBOX_COUNTRY;
  const normalized = String(country || "").trim().toLowerCase();
  if (!/^[a-z]{2,4}$/.test(normalized)) {
    throw new Error(
      "Orange Money is not configured. Live mode needs the country code issued with your merchant key.",
    );
  }
  return normalized;
}

export function getOrangeMoneyCredentials(params?: {
  clientId?: string;
  clientSecret?: string;
  merchantKey?: string;
  country?: string;
  mode?: OrangeMoneyMode;
}): OrangeMoneyCredentials {
  const clientId = params?.clientId || process.env.ORANGE_MONEY_CLIENT_ID || "";
  const clientSecret =
    params?.clientSecret || process.env.ORANGE_MONEY_CLIENT_SECRET || "";
  const merchantKey =
    params?.merchantKey || process.env.ORANGE_MONEY_MERCHANT_KEY || "";
  const configuredMode = params?.mode || process.env.ORANGE_MONEY_MODE;
  const mode: OrangeMoneyMode = configuredMode === "live" ? "live" : "sandbox";
  const country =
    params?.country || process.env.ORANGE_MONEY_COUNTRY || "";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Orange Money is not configured. Missing client ID or client secret.",
    );
  }
  if (!merchantKey) {
    throw new Error("Orange Money is not configured. Missing merchant key.");
  }

  // Throws when live mode has no country, so a misconfiguration surfaces here
  // rather than as a 404 halfway through a checkout.
  const resolvedCountry = orangeMoneyCountrySegment(mode, country);

  return {
    clientId,
    clientSecret,
    merchantKey,
    country: resolvedCountry,
    mode,
  };
}

async function readOrangeMoneyJson<T>(
  response: Response,
  action: string,
): Promise<T> {
  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON body; fall through to the HTTP-status error below.
    }
  }

  const readString = (key: string) => {
    if (!data || typeof data !== "object") return undefined;
    const value = (data as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  };

  if (!response.ok) {
    const message =
      readString("description") ||
      readString("error_description") ||
      readString("message") ||
      readString("error") ||
      `HTTP ${response.status}`;
    throw new Error(`Orange Money ${action} failed: ${message}`);
  }

  return (data ?? {}) as T;
}

// Orange's client-credentials tokens are long-lived (~90 days), so the cache
// spares every checkout an authentication round trip. The skew stops us using
// one that is about to expire; the fallback only applies if Orange omits
// `expires_in` entirely.
const ORANGE_TOKEN_SKEW_MS = 60_000;
const ORANGE_TOKEN_FALLBACK_TTL_MS = 30 * 60_000;
const orangeMoneyTokenCache = new Map<
  string,
  { token: string; expiresAt: number }
>();

function orangeMoneyTokenCacheKey(creds: OrangeMoneyCredentials) {
  return `${creds.mode}:${creds.clientId}:${creds.clientSecret}`;
}

/** Drops every cached token. Exported for tests. */
export function resetOrangeMoneyTokenCache() {
  orangeMoneyTokenCache.clear();
}

/**
 * Requests an OAuth2 access token via the client-credentials grant, reusing a
 * cached one while it is still valid.
 *
 * Orange authenticates with HTTP Basic over the client id and secret rather
 * than carrying them in the form body.
 */
export async function requestOrangeMoneyToken(
  creds: OrangeMoneyCredentials,
  options?: { forceRefresh?: boolean },
): Promise<string> {
  const cacheKey = orangeMoneyTokenCacheKey(creds);
  if (!options?.forceRefresh) {
    const cached = orangeMoneyTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
  }

  const basic = Buffer.from(
    `${creds.clientId}:${creds.clientSecret}`,
    "utf8",
  ).toString("base64");

  const response = await fetch(`${ORANGE_API_BASE}${ORANGE_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
  });

  const data = await readOrangeMoneyJson<{
    access_token?: string;
    expires_in?: number;
  }>(response, "authentication");
  if (!data.access_token) {
    throw new Error(
      "Orange Money authentication failed: token was not returned",
    );
  }

  const ttlMs =
    Number(data.expires_in) > 0
      ? Number(data.expires_in) * 1000
      : ORANGE_TOKEN_FALLBACK_TTL_MS;
  orangeMoneyTokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + ttlMs - ORANGE_TOKEN_SKEW_MS,
  });

  return data.access_token;
}

async function orangeMoneyAuthorizedRequest<T>(
  creds: OrangeMoneyCredentials,
  path: string,
  init: RequestInit,
  action: string,
): Promise<T> {
  const send = async (forceRefresh: boolean) => {
    const token = await requestOrangeMoneyToken(creds, { forceRefresh });
    return fetch(`${ORANGE_API_BASE}${path}`, {
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
  // call until it expired — drop it and retry once with a fresh one. Orange's
  // tokens last months, so a stale cache entry would be long-lived.
  if (response.status === 401) {
    response = await send(true);
  }
  return readOrangeMoneyJson<T>(response, action);
}

function webpayPath(creds: OrangeMoneyCredentials, endpoint: string) {
  return `${ORANGE_WEBPAY_PREFIX}/${creds.country}/v1/${endpoint}`;
}

/**
 * Creates a web payment and returns the hosted page to send the payer to.
 *
 * This mints a pay token; it moves no money and puts no prompt on anyone's
 * phone, so an abandoned one costs nothing.
 */
export async function submitOrangeMoneyPayment(params: {
  creds: OrangeMoneyCredentials;
  orderId: string;
  amount: number;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
  notifUrl: string;
  lang?: string;
  reference?: string;
}): Promise<OrangeMoneyPaymentResponse> {
  const data = await orangeMoneyAuthorizedRequest<OrangeMoneyPaymentResponse>(
    params.creds,
    webpayPath(params.creds, "webpayment"),
    {
      method: "POST",
      body: JSON.stringify({
        merchant_key: params.creds.merchantKey,
        currency: params.currency.toUpperCase(),
        order_id: params.orderId,
        amount: params.amount,
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        notif_url: params.notifUrl,
        lang: params.lang || "fr",
        ...(params.reference ? { reference: params.reference } : {}),
      }),
    },
    "web payment",
  );

  if (!data.pay_token || !data.payment_url || !data.notif_token) {
    throw new Error(
      "Orange Money web payment failed: the payment session was incomplete",
    );
  }

  return data;
}

/**
 * The authoritative status of a payment.
 *
 * Requires the `pay_token` from the original web payment, which is why the
 * callback cannot verify anything until that token has been persisted.
 */
export async function getOrangeMoneyTransactionStatus(params: {
  creds: OrangeMoneyCredentials;
  orderId: string;
  amount: number;
  payToken: string;
}): Promise<OrangeMoneyTransactionStatus> {
  return orangeMoneyAuthorizedRequest<OrangeMoneyTransactionStatus>(
    params.creds,
    webpayPath(params.creds, "transactionstatus"),
    {
      method: "POST",
      body: JSON.stringify({
        order_id: params.orderId,
        amount: params.amount,
        pay_token: params.payToken,
      }),
    },
    "transaction status",
  );
}

export function getOrangeMoneyTransactionState(
  transaction: Pick<OrangeMoneyTransactionStatus, "status">,
): OrangeMoneyTransactionState {
  const status = String(transaction.status || "").trim().toUpperCase();

  if (status === "SUCCESS" || status === "SUCCESSFUL") return "completed";
  // EXPIRED is terminal: the payer never validated and the token is dead.
  if (status === "FAILED" || status === "EXPIRED") return "failed";
  if (status === "INITIATED" || status === "PENDING") return "pending";
  if (status === "INVALID") return "invalid";
  return "pending";
}
