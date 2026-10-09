import {
  CARRIER_ERROR_CODES,
  CarrierError,
  classifyHttpStatus,
  parseRetryAfter,
} from "./errors";

/**
 * Minimal Shiprocket transport.
 *
 * Two things shape this file. First, Shiprocket authenticates with an
 * email/password login that returns a token valid for 240 hours — so the token
 * is cached both in process and in settings, because a serverless cold start
 * would otherwise log in on every invocation and trip their auth throttle.
 * Second, a shipment is created across four calls rather than one, so each
 * step is exposed separately and the adapter drives the sequence.
 */

const SHIPROCKET_BASE_URL = "https://apiv2.shiprocket.in/v1/external";

const REQUEST_TIMEOUT_MS = 25_000;

/** Their token lasts 240h; refresh a day early so no call races the expiry. */
const SHIPROCKET_TOKEN_TTL_MS = 239 * 60 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

interface ShiprocketCourier {
  courier_company_id: number;
  courier_name: string;
  rate: number;
  etd?: string;
  estimated_delivery_days?: string;
  cod?: number;
  freight_charge?: number;
}

interface ShiprocketServiceability {
  data?: {
    available_courier_companies?: ShiprocketCourier[];
    recommended_courier_company_id?: number;
  };
}

interface ShiprocketOrderItem {
  name: string;
  sku: string;
  units: number;
  selling_price: number;
  hsn?: string;
}

export interface ShiprocketCreateOrderPayload {
  order_id: string;
  order_date: string;
  pickup_location: string;
  channel_id?: string;
  billing_customer_name: string;
  billing_last_name?: string;
  billing_address: string;
  billing_address_2?: string;
  billing_city: string;
  billing_pincode: string;
  billing_state: string;
  billing_country: string;
  billing_email?: string;
  billing_phone: string;
  shipping_is_billing: boolean;
  order_items: ShiprocketOrderItem[];
  payment_method: "COD" | "Prepaid";
  sub_total: number;
  /**
   * Shiprocket derives the COD collectable from the order total, which it
   * computes as sub_total + these charges. Omitting it means the courier
   * collects the goods value and the merchant eats the delivery fee.
   */
  shipping_charges?: number;
  length: number;
  breadth: number;
  height: number;
  weight: number;
}

interface ShiprocketCreateOrderResult {
  order_id?: number | string;
  shipment_id?: number | string;
  status?: string;
  status_code?: number;
  message?: string;
  errors?: unknown;
}

interface ShiprocketAwbResult {
  awb_assign_status?: number;
  response?: {
    data?: {
      awb_code?: string;
      courier_name?: string;
      courier_company_id?: number;
      shipment_id?: number | string;
      order_id?: number | string;
      freight_charges?: number;
    };
  };
  message?: string;
}

interface ShiprocketTrackingActivity {
  date?: string;
  status?: string;
  activity?: string;
  location?: string;
}

interface ShiprocketTrackResult {
  tracking_data?: {
    track_status?: number;
    shipment_status?: number;
    shipment_track?: Array<{
      current_status?: string;
      delivered_date?: string;
      edd?: string;
      courier_name?: string;
    }>;
    shipment_track_activities?: ShiprocketTrackingActivity[];
    etd?: string;
  };
}

/**
 * In-process token cache, keyed by account email.
 *
 * The persisted cache in settings survives cold starts; this one avoids a
 * settings read on every call within a single warm instance.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * token → the account that minted it, so a rejection can evict the cache entry
 * without every call site having to thread the account email down to the fetch.
 */
const tokenOwners = new Map<string, string>();

/**
 * Tokens Shiprocket has rejected.
 *
 * Evicting the in-process cache alone is not enough: `shiprocketLogin` falls
 * through to the token persisted in settings, which on a revoked credential is
 * the same dead string — so the next call would present it again and 401 again,
 * for the remaining 215 hours of its nominal life, with no path back short of a
 * redeploy. Remembering which token was refused is what makes the next call
 * actually log in, and a login that succeeds heals the account by itself.
 */
const rejectedTokens = new Set<string>();

/**
 * Bounded so a pathological account — one whose login keeps succeeding and
 * whose tokens keep being refused — cannot grow this without limit in a
 * long-lived process. Far above the handful a real incident produces.
 */
const MAX_REJECTED_TOKENS = 64;

export function clearShiprocketTokenCache() {
  tokenCache.clear();
  tokenOwners.clear();
  rejectedTokens.clear();
  pickupCache.clear();
}

/**
 * Retire a token the carrier refused.
 *
 * Called from the transport on any auth failure, so it covers every endpoint
 * including ones added later — the alternative, remembering to do it at each
 * call site, is the kind of thing that is right on the day it is written.
 */
function evictShiprocketToken(token: string | undefined) {
  if (!token) return;

  if (rejectedTokens.size >= MAX_REJECTED_TOKENS) {
    // Insertion-ordered, so this drops the oldest.
    const oldest = rejectedTokens.values().next().value;
    if (oldest !== undefined) rejectedTokens.delete(oldest);
  }
  rejectedTokens.add(token);

  const email = tokenOwners.get(token);
  if (email) {
    tokenOwners.delete(token);
    // Only if it is still the current one: a concurrent call may already have
    // logged in and replaced it, and clearing that would force a second login.
    if (tokenCache.get(email)?.token === token) tokenCache.delete(email);
  }
}

async function shiprocketFetch(params: {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  token?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}): Promise<unknown> {
  const url = new URL(
    `${SHIPROCKET_BASE_URL}${params.path.startsWith("/") ? "" : "/"}${params.path}`,
  );
  for (const [key, value] of Object.entries(params.query || {})) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: params.method,
      headers: {
        "Content-Type": "application/json",
        ...(params.token ? { Authorization: `Bearer ${params.token}` } : {}),
      },
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new CarrierError({
      provider: "shiprocket",
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message:
        error instanceof Error ? error.message : "Could not reach Shiprocket",
      permanent: false,
    });
  }

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const failure = classifyHttpStatus(
      response.status,
      parseRetryAfter(response.headers.get("retry-after")),
    );
    if (failure.authFailure) {
      // The bearer this call used is dead. Retiring it here — in the transport
      // rather than at each call site — is what lets the next attempt log in
      // instead of replaying the same rejected token until its 239h TTL runs
      // out. A login has no token, so this never fires on the login itself.
      evictShiprocketToken(params.token);
    }
    const body = payload as { message?: string; errors?: unknown } | undefined;
    const detail =
      body?.message ||
      (body?.errors ? JSON.stringify(body.errors).slice(0, 300) : undefined) ||
      text.slice(0, 300) ||
      `Shiprocket returned ${response.status}`;
    throw new CarrierError({
      provider: "shiprocket",
      code: failure.errorCode || CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: detail,
      permanent: failure.permanent,
      authFailure: failure.authFailure,
      retryAfterSeconds: failure.retryAfterSeconds,
      status: response.status,
    });
  }

  return payload;
}

interface ShiprocketAuth {
  email: string;
  password: string;
  /** Token persisted in settings, reused across cold starts. */
  cachedToken?: string;
  cachedTokenExpiresAt?: Date;
  /** Persists a freshly minted token so the next cold start reuses it. */
  onToken?: (token: string, expiresAt: Date) => Promise<void>;
}

export async function shiprocketLogin(auth: ShiprocketAuth): Promise<string> {
  const now = Date.now();

  const inProcess = tokenCache.get(auth.email);
  if (
    inProcess &&
    inProcess.expiresAt > now &&
    !rejectedTokens.has(inProcess.token)
  ) {
    return inProcess.token;
  }

  const persistedExpiry = auth.cachedTokenExpiresAt
    ? new Date(auth.cachedTokenExpiresAt).getTime()
    : 0;
  if (
    auth.cachedToken &&
    persistedExpiry - TOKEN_REFRESH_MARGIN_MS > now &&
    // The settings copy outlives the process cache, so a revoked token would
    // otherwise come straight back the moment the in-process one was evicted.
    !rejectedTokens.has(auth.cachedToken)
  ) {
    tokenCache.set(auth.email, {
      token: auth.cachedToken,
      expiresAt: persistedExpiry - TOKEN_REFRESH_MARGIN_MS,
    });
    tokenOwners.set(auth.cachedToken, auth.email);
    return auth.cachedToken;
  }

  const result = (await shiprocketFetch({
    method: "POST",
    path: "/auth/login",
    body: { email: auth.email, password: auth.password },
  })) as { token?: string } | undefined;

  if (!result?.token) {
    throw new CarrierError({
      provider: "shiprocket",
      code: CARRIER_ERROR_CODES.AUTH_FAILED,
      message: "Shiprocket rejected the API user credentials",
      permanent: true,
      authFailure: true,
    });
  }

  const expiresAt = new Date(now + SHIPROCKET_TOKEN_TTL_MS);
  tokenCache.set(auth.email, {
    token: result.token,
    expiresAt: expiresAt.getTime() - TOKEN_REFRESH_MARGIN_MS,
  });
  tokenOwners.set(result.token, auth.email);
  if (auth.onToken) {
    // Best-effort: failing to persist only costs an extra login next cold start.
    await auth.onToken(result.token, expiresAt).catch(() => undefined);
  }
  return result.token;
}

export async function shiprocketServiceability(params: {
  token: string;
  pickupPostcode: string;
  deliveryPostcode: string;
  weight: number;
  cod: boolean;
  declaredValue?: number;
}): Promise<ShiprocketCourier[]> {
  const result = (await shiprocketFetch({
    method: "GET",
    path: "/courier/serviceability/",
    token: params.token,
    query: {
      pickup_postcode: params.pickupPostcode,
      delivery_postcode: params.deliveryPostcode,
      weight: params.weight,
      cod: params.cod ? 1 : 0,
      declared_value: params.declaredValue,
    },
  })) as ShiprocketServiceability | undefined;

  return result?.data?.available_courier_companies ?? [];
}

/** A registered pickup location, with the address Shiprocket actually ships from. */
interface ShiprocketPickupAddress {
  name: string;
  pincode?: string;
  city?: string;
  state?: string;
  country?: string;
}

/**
 * The pickup locations registered on the account.
 *
 * The address is carried through, not just the nickname: Shiprocket prices a
 * lane from the *pickup location's* pincode, and Storify's own ship-from is a
 * different record that a merchant is free to set differently. Quoting from the
 * wrong one produces a rate that does not match what the consignment is billed.
 */
export async function shiprocketPickupAddresses(params: {
  token: string;
}): Promise<ShiprocketPickupAddress[]> {
  const result = (await shiprocketFetch({
    method: "GET",
    path: "/settings/company/pickup",
    token: params.token,
  })) as
    | {
        data?: {
          shipping_address?: Array<{
            pickup_location?: string;
            pin_code?: string | number;
            city?: string;
            state?: string;
            country?: string;
          }>;
        };
      }
    | undefined;

  return (result?.data?.shipping_address || [])
    .filter((entry) => Boolean(entry?.pickup_location))
    .map((entry) => ({
      name: String(entry.pickup_location),
      // Their API is inconsistent about whether a pincode is a number.
      pincode:
        entry.pin_code === undefined || entry.pin_code === null
          ? undefined
          : String(entry.pin_code).trim() || undefined,
      city: entry.city,
      state: entry.state,
      country: entry.country,
    }));
}

export async function shiprocketPickupLocations(params: {
  token: string;
}): Promise<string[]> {
  const addresses = await shiprocketPickupAddresses(params);
  return addresses.map((address) => address.name);
}

/**
 * Pickup addresses, cached briefly per account.
 *
 * Registered locations change about as often as a warehouse moves, and this
 * lookup sits on the rate-shopping path a merchant is waiting on — so fetching
 * them per quote would spend a round trip to learn the same answer.
 */
const pickupCache = new Map<
  string,
  { at: number; addresses: ShiprocketPickupAddress[] }
>();
const PICKUP_CACHE_TTL_MS = 5 * 60 * 1000;

export async function shiprocketCachedPickupAddresses(params: {
  token: string;
  /** Account email — the cache key, so two logins never share a list. */
  account: string;
}): Promise<ShiprocketPickupAddress[]> {
  const cached = pickupCache.get(params.account);
  if (cached && Date.now() - cached.at < PICKUP_CACHE_TTL_MS) {
    return cached.addresses;
  }

  const addresses = await shiprocketPickupAddresses({ token: params.token });
  pickupCache.set(params.account, { at: Date.now(), addresses });
  return addresses;
}

export async function shiprocketCreateOrder(params: {
  token: string;
  payload: ShiprocketCreateOrderPayload;
}): Promise<ShiprocketCreateOrderResult> {
  return (await shiprocketFetch({
    method: "POST",
    path: "/orders/create/adhoc",
    token: params.token,
    body: params.payload,
  })) as ShiprocketCreateOrderResult;
}

/**
 * Look an order up by the id we supplied.
 *
 * Used when `orders/create/adhoc` reports the order already exists — a retry
 * after a lost response. Without this, the retry would either duplicate the
 * consignment or dead-end.
 */
export async function shiprocketFindOrderByReference(params: {
  token: string;
  reference: string;
}): Promise<{
  orderId?: string;
  shipmentId?: string;
  /** Shiprocket's own words, so the caller can report what it found. */
  status?: string;
  /**
   * The consignment is cancelled. Reported rather than filtered out: a caller
   * that only learned "no match" would go on to create a second order, and a
   * caller handed the handle would go on to book a cancelled one.
   */
  cancelled: boolean;
} | null> {
  const result = (await shiprocketFetch({
    method: "GET",
    path: "/orders",
    token: params.token,
    query: { search: params.reference, per_page: 10 },
  })) as
    | {
        data?: Array<{
          id?: number | string;
          channel_order_id?: string;
          status?: string;
          shipments?: Array<{ id?: number | string }>;
        }>;
      }
    | undefined;

  const match = (result?.data || []).find(
    (order) => String(order?.channel_order_id || "") === params.reference,
  );
  if (!match) return null;

  const status = match.status ? String(match.status) : undefined;
  return {
    orderId: match.id !== undefined ? String(match.id) : undefined,
    shipmentId:
      match.shipments?.[0]?.id !== undefined
        ? String(match.shipments[0].id)
        : undefined,
    status,
    // Covers CANCELED, CANCELLED and CANCELLATION REQUESTED alike — Shiprocket
    // is not consistent about the spelling and the distinction does not matter
    // here: none of them can be assigned an AWB.
    cancelled: /cancel/i.test(status || ""),
  };
}

export async function shiprocketAssignAwb(params: {
  token: string;
  shipmentId: string;
  courierId?: number;
}): Promise<ShiprocketAwbResult> {
  return (await shiprocketFetch({
    method: "POST",
    path: "/courier/assign/awb",
    token: params.token,
    body: {
      shipment_id: params.shipmentId,
      ...(params.courierId ? { courier_id: params.courierId } : {}),
    },
  })) as ShiprocketAwbResult;
}

export async function shiprocketGeneratePickup(params: {
  token: string;
  shipmentId: string;
}): Promise<unknown> {
  return shiprocketFetch({
    method: "POST",
    path: "/courier/generate/pickup",
    token: params.token,
    body: { shipment_id: [params.shipmentId] },
  });
}

export async function shiprocketGenerateLabel(params: {
  token: string;
  shipmentId: string;
}): Promise<{ label_url?: string; label_created?: number }> {
  return (await shiprocketFetch({
    method: "POST",
    path: "/courier/generate/label",
    token: params.token,
    body: { shipment_id: [params.shipmentId] },
  })) as { label_url?: string; label_created?: number };
}

export async function shiprocketCancelOrder(params: {
  token: string;
  orderIds: string[];
}): Promise<{ message?: string; status?: number }> {
  return (await shiprocketFetch({
    method: "POST",
    path: "/orders/cancel",
    token: params.token,
    body: { ids: params.orderIds },
  })) as { message?: string; status?: number };
}

export async function shiprocketTrackByAwb(params: {
  token: string;
  awb: string;
}): Promise<ShiprocketTrackResult> {
  return (await shiprocketFetch({
    method: "GET",
    path: `/courier/track/awb/${encodeURIComponent(params.awb)}`,
    token: params.token,
  })) as ShiprocketTrackResult;
}
