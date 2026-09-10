import {
  CARRIER_ERROR_CODES,
  CarrierError,
  classifyHttpStatus,
  parseRetryAfter,
} from "./errors";

/**
 * Minimal Shippo transport.
 *
 * Hand-rolled `fetch` rather than the `shippo` npm SDK, matching every other
 * gateway in this repo (`lib/iotec.ts`, `lib/pesapal.ts`, `lib/paystack.ts`):
 * it keeps the dependency surface flat and lets tests stub `fetch` the way
 * `tests/iotec.test.ts` already does.
 */

const SHIPPO_BASE_URL = "https://api.goshippo.com";

/** Pinned so a Shippo-side default change cannot silently reshape responses. */
const SHIPPO_API_VERSION = "2018-02-08";

const REQUEST_TIMEOUT_MS = 20_000;

export interface ShippoAddress {
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  email?: string;
  validate?: boolean;
}

export interface ShippoParcel {
  length: string;
  width: string;
  height: string;
  distance_unit: "cm" | "in";
  weight: string;
  mass_unit: "g" | "kg" | "lb" | "oz";
}

export interface ShippoRate {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel?: { name?: string; token?: string };
  estimated_days?: number;
  attributes?: string[];
  duration_terms?: string;
}

interface ShippoShipment {
  object_id: string;
  status?: string;
  rates?: ShippoRate[];
  messages?: Array<{ source?: string; code?: string; text?: string }>;
}

export interface ShippoTransaction {
  object_id: string;
  status: "QUEUED" | "WAITING" | "SUCCESS" | "ERROR" | "REFUNDED";
  label_url?: string;
  tracking_number?: string;
  tracking_url_provider?: string;
  tracking_status?: string;
  rate?: string | ShippoRate;
  messages?: Array<{ source?: string; code?: string; text?: string }>;
  test?: boolean;
}

/**
 * One line of a customs declaration.
 *
 * Amounts and weights are strings because Shippo's API takes decimals as
 * strings throughout, exactly as `ShippoParcel` does.
 */
export interface ShippoCustomsItem {
  description: string;
  quantity: number;
  /** The line's TOTAL weight — quantity × unit weight, not the unit weight. */
  net_weight: string;
  mass_unit: "g" | "kg" | "lb" | "oz";
  value_amount: string;
  value_currency: string;
  /** ISO-3166 alpha-2. Required on every line; Shippo rejects a blank. */
  origin_country: string;
  tariff_number?: string;
}

export interface ShippoTrackingStatus {
  status?: string;
  substatus?: { code?: string; text?: string };
  status_details?: string;
  status_date?: string;
  location?: {
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
}

interface ShippoTrack {
  carrier?: string;
  tracking_number?: string;
  eta?: string;
  tracking_status?: ShippoTrackingStatus;
  tracking_history?: ShippoTrackingStatus[];
  test?: boolean;
}

function messageText(
  messages: Array<{ text?: string; code?: string }> | undefined,
): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  return messages
    .map((message) => message.text || message.code)
    .filter(Boolean)
    .join("; ");
}

async function shippoRequest<T>(params: {
  token: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}): Promise<T> {
  const url = new URL(params.path, SHIPPO_BASE_URL);
  for (const [key, value] of Object.entries(params.query || {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: params.method,
      headers: {
        Authorization: `ShippoToken ${params.token}`,
        "Content-Type": "application/json",
        "Shippo-API-Version": SHIPPO_API_VERSION,
      },
      body: params.body === undefined ? undefined : JSON.stringify(params.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    // A transport fault says nothing about the request's validity, so it stays
    // retryable.
    throw new CarrierError({
      provider: "shippo",
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message:
        error instanceof Error ? error.message : "Could not reach Shippo",
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
    const detail =
      (payload as { detail?: string } | undefined)?.detail ||
      messageText((payload as { messages?: Array<{ text?: string }> } | undefined)?.messages) ||
      text.slice(0, 300) ||
      `Shippo returned ${response.status}`;
    throw new CarrierError({
      provider: "shippo",
      code: failure.errorCode || CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: detail,
      permanent: failure.permanent,
      authFailure: failure.authFailure,
      retryAfterSeconds: failure.retryAfterSeconds,
      status: response.status,
    });
  }

  return payload as T;
}

/** Cheapest authenticated call, used by the Test-connection action. */
export async function shippoWhoAmI(token: string): Promise<{ account?: string }> {
  const result = await shippoRequest<{
    results?: Array<{ object_id?: string; carrier?: string }>;
  }>({
    token,
    method: "GET",
    path: "/carrier_accounts",
    query: { results: "1" },
  });
  const first = result?.results?.[0];
  return { account: first?.carrier || undefined };
}

export async function shippoCreateShipment(params: {
  token: string;
  addressFrom: ShippoAddress;
  addressTo: ShippoAddress;
  parcels: ShippoParcel[];
  customsDeclaration?: string;
  metadata?: string;
}): Promise<ShippoShipment> {
  const shipment = await shippoRequest<ShippoShipment>({
    token: params.token,
    method: "POST",
    path: "/shipments",
    body: {
      address_from: params.addressFrom,
      address_to: params.addressTo,
      parcels: params.parcels,
      customs_declaration: params.customsDeclaration,
      metadata: params.metadata,
      // Synchronous: the caller is a merchant waiting on a rate list, and
      // polling an async shipment would double the round trips.
      async: false,
    },
  });

  if (!shipment?.object_id) {
    throw new CarrierError({
      provider: "shippo",
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message: messageText(shipment?.messages) || "Shippo did not return a shipment",
      permanent: true,
    });
  }
  return shipment;
}

/**
 * Create the customs declaration a cross-border shipment is quoted with.
 *
 * Shippo returns no international rates at all for a shipment without one, and
 * the declaration a rate was quoted against is the one its label inherits — so
 * this has to happen before the rate list, not at purchase time.
 *
 * Items are sent inline rather than created as separate CustomsItem objects
 * first: one round trip instead of one per order line, on a call a merchant is
 * waiting for.
 */
export async function shippoCreateCustomsDeclaration(params: {
  token: string;
  items: ShippoCustomsItem[];
  /** Whoever certifies the declaration — the shipper's name. */
  signer: string;
  incoterm?: "DDU" | "DDP";
}): Promise<{ object_id: string }> {
  const declaration = await shippoRequest<{
    object_id?: string;
    messages?: Array<{ text?: string; code?: string }>;
  }>({
    token: params.token,
    method: "POST",
    path: "/customs/declarations",
    body: {
      contents_type: "MERCHANDISE",
      // The parcel comes back to the shipper rather than being abandoned or
      // destroyed if the destination country refuses it.
      non_delivery_option: "RETURN",
      certify: true,
      certify_signer: params.signer,
      // Duties billed to the recipient. DDP would bill the merchant's carrier
      // account for duties it never agreed to.
      incoterm: params.incoterm || "DDU",
      items: params.items,
    },
  });

  if (!declaration?.object_id) {
    throw new CarrierError({
      provider: "shippo",
      code: CARRIER_ERROR_CODES.PROVIDER_ERROR,
      message:
        messageText(declaration?.messages) ||
        "Shippo rejected the customs declaration for this international shipment",
      permanent: true,
    });
  }

  return { object_id: declaration.object_id };
}

export async function shippoCreateTransaction(params: {
  token: string;
  rateId: string;
  labelFileType: string;
  metadata?: string;
}): Promise<ShippoTransaction> {
  return shippoRequest<ShippoTransaction>({
    token: params.token,
    method: "POST",
    path: "/transactions",
    body: {
      rate: params.rateId,
      label_file_type: params.labelFileType,
      metadata: params.metadata,
      async: false,
    },
  });
}

/**
 * The rate a transaction was bought against.
 *
 * `rate` comes back as a bare object id on a list response and as an expanded
 * object when it was created inline, so both shapes have to be read.
 */
function transactionRateId(
  transaction: ShippoTransaction,
): string | undefined {
  const rate = transaction.rate;
  if (typeof rate === "string") return rate || undefined;
  return rate?.object_id || undefined;
}

/**
 * Find a transaction already bought for a rate.
 *
 * Shippo transactions are immutable, so re-POSTing the same rate errors rather
 * than returning the original. A retry that lost its response would otherwise
 * have no way back to the label it already paid for.
 *
 * The rate is confirmed on the way out rather than trusted to the query. This
 * runs only after a purchase has already failed, and whatever it returns is
 * written onto the parcel as its label: a `rate` filter the API ignored, or a
 * response shape that changed, would hand back another order's transaction and
 * put that customer's tracking number on this shipment. A transaction we cannot
 * attribute to this rate is not ours to claim — the caller then reports the
 * original failure, which is recoverable, instead of shipping the wrong label,
 * which is not.
 */
export async function shippoFindTransactionForRate(params: {
  token: string;
  rateId: string;
}): Promise<ShippoTransaction | null> {
  const result = await shippoRequest<{ results?: ShippoTransaction[] }>({
    token: params.token,
    method: "GET",
    path: "/transactions",
    query: { rate: params.rateId, results: "5" },
  });

  const mine = (result?.results || []).filter(
    (transaction) => transactionRateId(transaction) === params.rateId,
  );
  const success = mine.find((transaction) => transaction.status === "SUCCESS");
  return success ?? mine[0] ?? null;
}

export async function shippoGetTransaction(params: {
  token: string;
  transactionId: string;
}): Promise<ShippoTransaction> {
  return shippoRequest<ShippoTransaction>({
    token: params.token,
    method: "GET",
    path: `/transactions/${encodeURIComponent(params.transactionId)}`,
  });
}

export async function shippoRefundTransaction(params: {
  token: string;
  transactionId: string;
}): Promise<{ status?: string }> {
  return shippoRequest<{ status?: string }>({
    token: params.token,
    method: "POST",
    path: "/refunds",
    body: { transaction: params.transactionId, async: false },
  });
}

export async function shippoTrack(params: {
  token: string;
  carrier: string;
  trackingNumber: string;
}): Promise<ShippoTrack> {
  return shippoRequest<ShippoTrack>({
    token: params.token,
    method: "GET",
    path: `/tracks/${encodeURIComponent(params.carrier)}/${encodeURIComponent(
      params.trackingNumber,
    )}`,
  });
}

export async function shippoValidateAddress(params: {
  token: string;
  address: ShippoAddress;
}): Promise<{
  object_id?: string;
  validation_results?: {
    is_valid?: boolean;
    messages?: Array<{ text?: string; code?: string }>;
  };
} & ShippoAddress> {
  return shippoRequest({
    token: params.token,
    method: "POST",
    path: "/addresses",
    body: { ...params.address, validate: true },
  });
}

export { messageText as shippoMessageText };
