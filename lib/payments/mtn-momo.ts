/**
 * MTN MoMo Open API — Collections (`requesttopay`).
 *
 * A push gateway: the payer stays on the store, we send `requesttopay`, and the
 * wallet platform puts a PIN prompt on their phone (USSD push / MoMo app). The
 * 202 means "queued", nothing more — the outcome is read back by polling the
 * status endpoint under the X-Reference-Id UUID *we* generated, and optionally
 * announced once (unsigned, no retry) to X-Callback-Url.
 *
 * MTN's docs are served behind a JS portal with no machine-readable spec, so
 * header names, enums and the sandbox test numbers below are corroborated from
 * the portal, MTN's Postman collection, community answers and SDK sources —
 * see docs/MTN_MOMO_PAYMENT_GATEWAY.md. Everything that could drift is
 * confined to this module so a correction is a one-file change.
 */

export type MtnMomoMode = "sandbox" | "live";

const MTN_MOMO_API_BASE: Record<MtnMomoMode, string> = {
  sandbox: "https://sandbox.momodeveloper.mtn.com",
  live: "https://proxy.momoapi.mtn.com",
};

/** The X-Target-Environment sandbox traffic must carry. */
const MTN_MOMO_SANDBOX_TARGET = "sandbox";

/**
 * Sandbox settles exclusively in EUR (`INVALID_CURRENCY` otherwise) — MTN's
 * equivalent of Orange's `OUV` test bench, except EUR is a real ISO code that
 * no MoMo market actually settles, so it is likewise never a valid *store*
 * currency here.
 */
const MTN_MOMO_SANDBOX_CURRENCY = "EUR";

export interface MtnMomoCredentials {
  /** Ocp-Apim-Subscription-Key — sent on every request, token call included. */
  subscriptionKey: string;
  /** The API user UUID (Basic auth username). */
  apiUser: string;
  /** The API key paired with the user (Basic auth password). */
  apiKey: string;
  /**
   * X-Target-Environment: `sandbox`, or the per-OpCo value issued at
   * onboarding (`mtnuganda`, `mtnghana`, …) when live.
   */
  targetEnvironment: string;
  /**
   * The host registered with MTN as `providerCallbackHost`.
   *
   * MTN validates `X-Callback-Url` against it and rejects the whole
   * `requesttopay` with `INVALID_CALLBACK_URL_HOST` when they differ — so a
   * callback URL built from the request's own origin fails on every
   * deployment whose host is not the registered one, localhost included.
   * Left blank, no callback is requested at all and the payment is confirmed
   * by polling and the reconcile sweep, which are the authority regardless.
   */
  callbackHost?: string;
  mode: MtnMomoMode;
}

export interface MtnMomoRequestToPayStatus {
  financialTransactionId?: string;
  externalId?: string;
  amount?: string;
  currency?: string;
  payer?: { partyIdType?: string; partyId?: string };
  payerMessage?: string;
  payeeNote?: string;
  status?: string;
  /** String in some doc versions, `{ code, message }` in others. */
  reason?: string | { code?: string; message?: string };
}

type MtnMomoTransactionState = "completed" | "pending" | "failed";

/**
 * Typed API failure so callers can tell a transient shape (404 right after the
 * 202, throttling) from a real one without parsing message strings.
 */
export class MtnMomoApiError extends Error {
  readonly httpStatus: number;
  readonly code?: string;

  constructor(action: string, httpStatus: number, message: string, code?: string) {
    super(`MTN MoMo ${action} failed: ${message}`);
    this.name = "MtnMomoApiError";
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export function getMtnMomoApiBaseUrl(mode: MtnMomoMode) {
  return MTN_MOMO_API_BASE[mode];
}

/**
 * Currencies MTN MoMo can settle, i.e. the wallet currencies of its OpCos.
 *
 * Like Orange Money, MoMo is a per-country wallet: production credentials are
 * issued by one national OpCo and settle that country's currency only.
 * Refusing anything else at checkout keeps the shopper from building a whole
 * cart before the gateway rejects it. Being listed is necessary, not
 * sufficient — the merchant contract must be live in that country, and only
 * MTN can answer that half.
 */
export const MTN_MOMO_CURRENCIES = new Set([
  "UGX", // Uganda
  "GHS", // Ghana
  "XOF", // Côte d'Ivoire, Benin
  "XAF", // Cameroon, Congo-Brazzaville
  "ZMW", // Zambia
  "RWF", // Rwanda
  "SZL", // Eswatini
  "GNF", // Guinea-Conakry
  "LRD", // Liberia
  "ZAR", // South Africa
]);

export function isMtnMomoCurrency(currency?: string | null): boolean {
  return MTN_MOMO_CURRENCIES.has(String(currency || "").trim().toUpperCase());
}

/**
 * The currency to quote MTN for an order priced in `orderCurrency`. The mode,
 * not the order, decides — and the finalizer compares against this same
 * function rather than against `order.currency` directly, so both sides of
 * the sandbox EUR substitution read one rule.
 */
export function mtnMomoChargeCurrency(
  mode: MtnMomoMode,
  orderCurrency?: string | null,
): string {
  if (mode === "sandbox") return MTN_MOMO_SANDBOX_CURRENCY;
  return String(orderCurrency || "").trim().toUpperCase();
}

/**
 * The X-Target-Environment for a call.
 *
 * Sandbox is always `sandbox` whatever the setting says — sandbox traffic
 * aimed at an OpCo value fails with NOT_ALLOWED_TARGET_ENVIRONMENT. Live
 * refuses to fall back, because production traffic aimed at the test bench
 * would look like success and settle nothing (the same reasoning as Orange's
 * `dev` segment).
 */
export function mtnMomoTargetEnvironment(
  mode: MtnMomoMode,
  targetEnvironment?: string | null,
): string {
  if (mode === "sandbox") return MTN_MOMO_SANDBOX_TARGET;
  const normalized = String(targetEnvironment || "").trim().toLowerCase();
  // OpCo values observed so far are `mtn` + country (mtnuganda, mtnghana…);
  // validated loosely because the exact string is issued at onboarding and a
  // fixed enum would lock out a market we never enumerated.
  if (!/^[a-z][a-z0-9]{2,31}$/.test(normalized) || normalized === MTN_MOMO_SANDBOX_TARGET) {
    throw new Error(
      "MTN MoMo is not configured. Live mode needs the target environment issued by your MTN OpCo (e.g. mtnuganda).",
    );
  }
  return normalized;
}

/**
 * Country calling code per OpCo target environment, for normalizing a locally
 * formatted number ("0772 123 456") into the MSISDN `requesttopay` expects
 * (country code + subscriber number, no plus).
 *
 * Unknown target environments are absent on purpose: for those the shopper's
 * number is accepted only in international format, rather than guessed at.
 */
const MTN_MOMO_CALLING_CODES: Record<string, string> = {
  mtnuganda: "256",
  mtnghana: "233",
  mtnivorycoast: "225",
  mtnbenin: "229",
  mtncameroon: "237",
  mtncongo: "242",
  mtnzambia: "260",
  mtnrwanda: "250",
  mtnswaziland: "268",
  mtnguineaconakry: "224",
  mtnliberia: "231",
  mtnsouthafrica: "27",
};

/**
 * Example wallet number per OpCo, shown as the wallet-number placeholder at
 * checkout and in vendor payments, in the international format every OpCo
 * accepts. Liberia is the fallback: it is
 * the market the storefront launched in, and an unset target environment only
 * happens before onboarding.
 */
const MTN_MOMO_EXAMPLE_NUMBERS: Record<string, string> = {
  mtnliberia: "231881234567",
  mtnuganda: "256772123456",
};

export function mtnMomoPhoneExample(targetEnvironment?: string | null): string {
  const normalized = String(targetEnvironment || "").trim().toLowerCase();
  return MTN_MOMO_EXAMPLE_NUMBERS[normalized] || MTN_MOMO_EXAMPLE_NUMBERS.mtnliberia;
}

/**
 * Converts a shopper-typed number into the MSISDN MoMo expects, e.g. for
 * `mtnuganda`:
 *   "0772 123 456"  -> "256772123456"
 *   "+256772123456" -> "256772123456"
 *   "256772123456"  -> "256772123456"
 * Sandbox numbers (the magic test MSISDNs) pass through untouched. Returns an
 * empty string when the input cannot be normalized into something plausible.
 */
export function normalizeMtnMomoMsisdn(
  phone: string | undefined | null,
  targetEnvironment: string,
): string {
  let digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  // "00" international prefix — the "+" was already dropped with the non-digits.
  if (digits.startsWith("00")) digits = digits.slice(2);

  const code = MTN_MOMO_CALLING_CODES[targetEnvironment];
  if (code) {
    if (digits.startsWith(code)) {
      // Already international. Sanity-bound instead of exact-length because
      // subscriber-number length varies by market.
      return digits.length >= code.length + 7 && digits.length <= 15 ? digits : "";
    }
    if (digits.startsWith("0")) digits = digits.slice(1);
    const msisdn = `${code}${digits}`;
    return msisdn.length >= code.length + 7 && msisdn.length <= 15 ? msisdn : "";
  }

  // Sandbox, or an OpCo we have no calling code for: accept international
  // format only. 8 is the shortest of the sandbox magic numbers' length class.
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

/**
 * The `amount` field is a string (a numeric literal is a 400), stated in major
 * units at the currency's own precision.
 */
export function formatMtnMomoAmount(amount: number, currency: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return "0";
  const upper = String(currency || "").trim().toUpperCase();
  // Whole units for zero-decimal wallet currencies (UGX, XOF, RWF…), two
  // decimals otherwise — mirrors currencyPriceScale without importing it, so
  // this module stays dependency-free like the other gateway clients.
  const zeroDecimal = new Set([
    "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
    "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
  ]).has(upper);
  return zeroDecimal ? String(Math.round(value)) : value.toFixed(2);
}

/**
 * The callback URL to hand MTN, or `undefined` when none should be requested.
 *
 * Built from the *registered* host rather than the request's own origin: MTN
 * compares the two and fails the payment outright when they differ, so a URL
 * derived from wherever the app happens to be running would break checkout on
 * localhost and on any deployment host the merchant did not register.
 * Omitting the header is safe — it only forgoes an optimistic notification
 * that is never trusted on its own anyway.
 */
export function mtnMomoCallbackUrl(
  creds: MtnMomoCredentials,
  path = "/api/payments/mtn-momo/callback",
): string | undefined {
  const host = String(creds.callbackHost || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  if (!host) return undefined;
  return `https://${host}${path}`;
}

export function getMtnMomoCredentials(params?: {
  subscriptionKey?: string;
  apiUser?: string;
  apiKey?: string;
  targetEnvironment?: string;
  callbackHost?: string;
  mode?: MtnMomoMode;
}): MtnMomoCredentials {
  const subscriptionKey =
    params?.subscriptionKey || process.env.MTN_MOMO_SUBSCRIPTION_KEY || "";
  const apiUser = params?.apiUser || process.env.MTN_MOMO_API_USER || "";
  const apiKey = params?.apiKey || process.env.MTN_MOMO_API_KEY || "";
  const configuredMode = params?.mode || process.env.MTN_MOMO_MODE;
  const mode: MtnMomoMode = configuredMode === "live" ? "live" : "sandbox";
  const configuredTarget =
    params?.targetEnvironment || process.env.MTN_MOMO_TARGET_ENVIRONMENT || "";

  if (!subscriptionKey) {
    throw new Error("MTN MoMo is not configured. Missing subscription key.");
  }
  if (!apiUser || !apiKey) {
    throw new Error("MTN MoMo is not configured. Missing API user or API key.");
  }

  // Throws when live mode has no OpCo target, so a misconfiguration surfaces
  // here rather than as NOT_ALLOWED_TARGET_ENVIRONMENT mid-checkout.
  const targetEnvironment = mtnMomoTargetEnvironment(mode, configuredTarget);

  return {
    subscriptionKey,
    apiUser,
    apiKey,
    targetEnvironment,
    callbackHost:
      params?.callbackHost || process.env.MTN_MOMO_CALLBACK_HOST || "",
    mode,
  };
}

function readReasonCode(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code : undefined;
}

async function readMtnMomoJson<T>(
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

  if (!response.ok) {
    const readString = (key: string) => {
      if (!data || typeof data !== "object") return undefined;
      const value = (data as Record<string, unknown>)[key];
      return typeof value === "string" && value.trim() ? value : undefined;
    };
    const message =
      readString("message") ||
      readString("error_description") ||
      readString("error") ||
      `HTTP ${response.status}`;
    throw new MtnMomoApiError(
      action,
      response.status,
      message,
      readReasonCode(data),
    );
  }

  // A successful requesttopay is a bare 202 with an empty body.
  return (data ?? {}) as T;
}

// Collections tokens live 3600s with no refresh grant — the cache keeps a
// checkout to one round trip and the skew stops us using one about to expire.
const MTN_MOMO_TOKEN_SKEW_MS = 60_000;
const MTN_MOMO_TOKEN_FALLBACK_TTL_MS = 30 * 60_000;
const mtnMomoTokenCache = new Map<string, { token: string; expiresAt: number }>();

function mtnMomoTokenCacheKey(creds: MtnMomoCredentials) {
  return `${creds.mode}:${creds.apiUser}:${creds.apiKey}:${creds.subscriptionKey}`;
}

/** Drops every cached token. Exported for tests. */
export function resetMtnMomoTokenCache() {
  mtnMomoTokenCache.clear();
}

/**
 * Requests a Collections access token, reusing a cached one while valid.
 *
 * MoMo authenticates the token call with HTTP Basic over apiUser:apiKey; the
 * subscription key rides along as on every other call.
 */
export async function requestMtnMomoToken(
  creds: MtnMomoCredentials,
  options?: { forceRefresh?: boolean },
): Promise<string> {
  const cacheKey = mtnMomoTokenCacheKey(creds);
  if (!options?.forceRefresh) {
    const cached = mtnMomoTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
  }

  const basic = Buffer.from(
    `${creds.apiUser}:${creds.apiKey}`,
    "utf8",
  ).toString("base64");

  const response = await fetch(
    `${getMtnMomoApiBaseUrl(creds.mode)}/collection/token/`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${basic}`,
        "Ocp-Apim-Subscription-Key": creds.subscriptionKey,
      },
    },
  );

  const data = await readMtnMomoJson<{
    access_token?: string;
    expires_in?: number;
  }>(response, "authentication");
  if (!data.access_token) {
    throw new Error("MTN MoMo authentication failed: token was not returned");
  }

  const ttlMs =
    Number(data.expires_in) > 0
      ? Number(data.expires_in) * 1000
      : MTN_MOMO_TOKEN_FALLBACK_TTL_MS;
  mtnMomoTokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + ttlMs - MTN_MOMO_TOKEN_SKEW_MS,
  });

  return data.access_token;
}

async function mtnMomoAuthorizedRequest<T>(
  creds: MtnMomoCredentials,
  path: string,
  init: RequestInit & { headers?: Record<string, string> },
  action: string,
): Promise<T> {
  const send = async (forceRefresh: boolean) => {
    const token = await requestMtnMomoToken(creds, { forceRefresh });
    return fetch(`${getMtnMomoApiBaseUrl(creds.mode)}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Ocp-Apim-Subscription-Key": creds.subscriptionKey,
        "X-Target-Environment": creds.targetEnvironment,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  };

  let response = await send(false);
  // A cached token that was revoked or rotated early would otherwise fail
  // every call until it expired — drop it and retry once with a fresh one.
  if (response.status === 401) {
    response = await send(true);
  }
  return readMtnMomoJson<T>(response, action);
}

/**
 * Sends `requesttopay`, which prompts the payer's phone for their PIN.
 *
 * `referenceId` is the caller's UUID v4 and the only handle the transaction
 * will ever have — the 202 returns nothing. Persist it before or atomically
 * with this call (this is the ioTec ordering, not the Orange one: this call
 * moves the prompt onto a phone, so a stored reference must never be the thing
 * that arrives second).
 *
 * A 409 (`RESOURCE_ALREADY_EXIST`) means this referenceId was already
 * submitted. That is the built-in idempotency guard doing its job — for a
 * retry of the same attempt the request is already in flight, so it is
 * treated as accepted rather than as a failure that would strand a live
 * prompt.
 */
export async function requestMtnMomoPayment(params: {
  creds: MtnMomoCredentials;
  referenceId: string;
  amount: number;
  currency: string;
  externalId: string;
  /** MSISDN in international format without "+", already normalized. */
  payerMsisdn: string;
  payerMessage?: string;
  payeeNote?: string;
  callbackUrl?: string;
}): Promise<void> {
  try {
    await mtnMomoAuthorizedRequest<Record<string, unknown>>(
      params.creds,
      "/collection/v1_0/requesttopay",
      {
        method: "POST",
        headers: {
          "X-Reference-Id": params.referenceId,
          ...(params.callbackUrl ? { "X-Callback-Url": params.callbackUrl } : {}),
        },
        body: JSON.stringify({
          amount: formatMtnMomoAmount(params.amount, params.currency),
          currency: params.currency.toUpperCase(),
          // No spaces allowed; the checkout references are already space-free.
          externalId: params.externalId,
          payer: {
            partyIdType: "MSISDN",
            partyId: params.payerMsisdn,
          },
          ...(params.payerMessage ? { payerMessage: params.payerMessage } : {}),
          ...(params.payeeNote ? { payeeNote: params.payeeNote } : {}),
        }),
      },
      "payment request",
    );
  } catch (error) {
    if (error instanceof MtnMomoApiError && error.httpStatus === 409) return;
    throw error;
  }
}

/**
 * The authoritative status of a `requesttopay`, under the same referenceId the
 * request was sent with.
 *
 * A 404 can occur briefly right after the 202 while the platform registers the
 * request — callers on a polling path should treat it as still pending rather
 * than failed (`error.httpStatus === 404`).
 */
export async function getMtnMomoRequestToPayStatus(params: {
  creds: MtnMomoCredentials;
  referenceId: string;
}): Promise<MtnMomoRequestToPayStatus> {
  return mtnMomoAuthorizedRequest<MtnMomoRequestToPayStatus>(
    params.creds,
    `/collection/v1_0/requesttopay/${encodeURIComponent(params.referenceId)}`,
    { method: "GET" },
    "transaction status",
  );
}

/**
 * Whether the MSISDN is an active MoMo wallet — a pre-flight UX check so the
 * shopper learns about a wrong number before a prompt is attempted, not after
 * a PENDING that can never resolve.
 */
export async function isMtnMomoAccountActive(params: {
  creds: MtnMomoCredentials;
  msisdn: string;
}): Promise<boolean> {
  const data = await mtnMomoAuthorizedRequest<{ result?: boolean }>(
    params.creds,
    `/collection/v1_0/accountholder/msisdn/${encodeURIComponent(params.msisdn)}/active`,
    { method: "GET" },
    "account holder check",
  );
  return data.result === true;
}

/**
 * The collections account balance — the natural "Test connection" call: it
 * exercises the subscription key, the API user/key pair and the target
 * environment in one authenticated round trip without moving money.
 */
export async function getMtnMomoAccountBalance(params: {
  creds: MtnMomoCredentials;
}): Promise<{ availableBalance?: string; currency?: string }> {
  return mtnMomoAuthorizedRequest<{
    availableBalance?: string;
    currency?: string;
  }>(
    params.creds,
    "/collection/v1_0/account/balance",
    { method: "GET" },
    "balance check",
  );
}

/**
 * Maps MoMo's status enum to the normalized outcome used by the finalizer.
 *
 * The docs name `PENDING | SUCCESSFUL | FAILED`, but the sandbox actually
 * reports an unfinished request as **`CREATED`** — verified against the live
 * sandbox, where the "stays pending" test number holds that state
 * indefinitely. Anything unrecognized is therefore pending: the only safe
 * reading of a state we do not know is "not finished", and that default is
 * what already covered `CREATED` before it was observed.
 */
export function getMtnMomoTransactionState(
  transaction: Pick<MtnMomoRequestToPayStatus, "status">,
): MtnMomoTransactionState {
  const status = String(transaction.status || "").trim().toUpperCase();
  if (status === "SUCCESSFUL" || status === "SUCCESS") return "completed";
  if (status === "FAILED" || status === "FAILURE") return "failed";
  return "pending";
}

/**
 * The failure reason as a bare code, tolerating both documented shapes
 * (a string, or `{ code, message }`).
 */
export function getMtnMomoFailureReason(
  transaction: Pick<MtnMomoRequestToPayStatus, "reason">,
): string | undefined {
  const reason = transaction.reason;
  if (typeof reason === "string" && reason.trim()) return reason.trim();
  if (reason && typeof reason === "object") {
    const code = reason.code;
    if (typeof code === "string" && code.trim()) return code.trim();
    const message = reason.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return undefined;
}
