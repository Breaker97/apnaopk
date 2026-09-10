import type {
  CarrierLabelFileType,
  CarrierMode,
  CarrierProvider,
  DimensionUnit,
  ParcelWeightUnit,
} from "@/lib/shipping/carrier-config";
import type { CarrierFailure } from "./errors";

/**
 * The vocabulary every carrier is translated into.
 *
 * Nothing here references a Mongoose model or a provider's own field names:
 * `build-request.ts` maps Storify's domain into these shapes and each adapter
 * maps these shapes into its provider's. Keeping the middle language free of
 * both ends is what stops Shiprocket's four-step flow or Shippo's rate objects
 * leaking into the routes.
 */

export interface CarrierAddress {
  name: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  postalCode: string;
  /** ISO-3166 alpha-2, uppercased. Carriers reject country names. */
  country: string;
  phone?: string;
  email?: string;
}

export interface CarrierParcel {
  length: number;
  width: number;
  height: number;
  dimensionUnit: DimensionUnit;
  weight: number;
  weightUnit: ParcelWeightUnit;
}

interface CarrierCustomsItem {
  description: string;
  quantity: number;
  netWeight: number;
  weightUnit: ParcelWeightUnit;
  valueAmount: number;
  valueCurrency: string;
  originCountry?: string;
  hsCode?: string;
}

export interface CarrierShipmentRequest {
  /** Stable per sub-order; providers that de-duplicate see it as their order id. */
  reference: string;
  orderNumber: string;
  shipFrom: CarrierAddress;
  shipTo: CarrierAddress;
  parcels: CarrierParcel[];
  /** Populated only for a cross-border shipment. */
  customsItems?: CarrierCustomsItem[];
  /** Amount to collect on delivery; absent for a prepaid order. */
  cod?: { amount: number; currency: string };
  /** Order value, needed by providers that price against declared value. */
  declaredValue?: { amount: number; currency: string };
  /**
   * What the customer was charged for shipping, in the order's currency.
   *
   * Declared separately from `cod.amount` because a provider that computes the
   * collectable itself needs the components, not the total — and a prepaid
   * order still wants it on the invoice.
   */
  shippingAmount?: number;
  items?: Array<{
    name: string;
    sku?: string;
    quantity: number;
    unitPrice: number;
  }>;
}

export interface CarrierRateQuote {
  provider: CarrierProvider;
  /** Redeemed by `purchaseLabel`; may expire (see CARRIER_RATE_TTL_MS). */
  rateId: string;
  /** Provider-side shipment handle, when the quote created one. */
  shipmentId?: string;
  orderId?: string;
  carrierName: string;
  serviceName: string;
  serviceToken?: string;
  amount: number;
  currency: string;
  estimatedDays?: number;
  /** Provider hints such as CHEAPEST / FASTEST / BESTVALUE. */
  attributes?: string[];
}

export interface CarrierLabel {
  transactionId: string;
  trackingNumber: string;
  trackingUrl?: string;
  labelUrl: string;
  labelFormat: CarrierLabelFileType;
  carrierName: string;
  serviceName?: string;
  amount?: number;
  currency?: string;
  /** Provider state carried forward so a retry can resume mid-sequence. */
  resume?: CarrierResumeState;
}

/**
 * What a partially completed purchase left behind.
 *
 * Shiprocket creates an order, then assigns an AWB, then generates a label —
 * three calls that can fail independently. Persisting each step's handle is
 * what lets a retry continue instead of creating a second Indian shipment.
 * Shippo ignores it.
 */
export interface CarrierResumeState {
  providerOrderId?: string;
  providerShipmentId?: string;
  providerTransactionId?: string;
  trackingNumber?: string;
  labelUrl?: string;
}

export type NormalizedTrackingStatus =
  | "unknown"
  | "pre_transit"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "returned"
  | "failure";

export interface CarrierTrackingEvent {
  at: Date;
  status: NormalizedTrackingStatus;
  providerStatus?: string;
  description?: string;
  location?: string;
}

export interface CarrierTracking {
  status: NormalizedTrackingStatus;
  eta?: Date;
  events: CarrierTrackingEvent[];
}

/** Everything an adapter needs to talk to one account. */
export interface CarrierContext {
  provider: CarrierProvider;
  mode: CarrierMode;
  /**
   * Whose carrier account this call spends from.
   *
   * The adapters do not care, but the books do: a label bought on a vendor's
   * own token costs the vendor, not the platform, and posting it as a platform
   * expense overstates costs the store never bore. Deciding it here is what
   * keeps that answer in the same place the credentials are chosen.
   */
  accountOwner: "platform" | "vendor";
  /** Shippo token, or the Shiprocket bearer once logged in. */
  token?: string;
  shiprocket?: {
    email?: string;
    password?: string;
    pickupLocationName?: string;
    channelId?: string;
    /** Persisted 240h token, reused across cold starts. */
    cachedToken?: string;
    cachedTokenExpiresAt?: Date;
    /** Lets the adapter write a refreshed token back to settings. */
    onToken?: (token: string, expiresAt: Date) => Promise<void>;
  };
  shippo?: {
    labelFileType?: CarrierLabelFileType;
    serviceTokenAllowList?: string[];
  };
}

export interface CarrierWebhookEnvelope {
  provider: CarrierProvider;
  /** Stable per delivered event; the de-duplication key. */
  eventId: string;
  type: string;
  /** The provider handle the event is about. */
  objectId?: string;
  trackingNumber?: string;
  transactionId?: string;
  /** True when the event came from the provider's test environment. */
  test?: boolean;
}

/**
 * What every carrier must supply.
 *
 * Modelled on `lib/conversations/providers/registry.ts`, which exists for the
 * same reason: without a seam, the queue and the routes would interpret each
 * provider's errors inline and could not express a second provider's retry
 * semantics at all. Adding Shiprocket — whose booking flow shares nothing with
 * Shippo's — is what forces the abstraction here.
 */
export interface CarrierAdapter {
  readonly provider: CarrierProvider;

  /** Whether this carrier can serve the lane at all, before any network call. */
  supports(params: {
    originCountry?: string;
    destinationCountry?: string;
    hasPickupLocation: boolean;
  }): boolean;

  /** Must not create provider-side state — rate shopping is side-effect free. */
  getRates(
    ctx: CarrierContext,
    request: CarrierShipmentRequest,
  ): Promise<CarrierRateQuote[]>;

  /**
   * The only method allowed to create provider state, and the only one that
   * spends money. Resumable: `resume` carries whatever a previous attempt
   * completed so a retry continues rather than duplicating the consignment.
   */
  purchaseLabel(
    ctx: CarrierContext,
    params: {
      quote: CarrierRateQuote;
      request: CarrierShipmentRequest;
      idempotencyKey: string;
      resume?: CarrierResumeState;
      /**
       * Persist what a multi-call booking has completed so far.
       *
       * Returning the handles only on success is not enough: Shiprocket's
       * sequence can create the consignment and then fail to assign an AWB, and
       * an attempt that throws would take the order handle with it — leaving a
       * real consignment in the merchant's panel that Storify has no record of
       * and no way to cancel. Best-effort by contract; an adapter must not fail
       * a paid sequence because a local write did.
       */
      onProgress?: (resume: CarrierResumeState) => Promise<void>;
    },
  ): Promise<CarrierLabel>;

  track(
    ctx: CarrierContext,
    params: {
      trackingNumber: string;
      carrierName?: string;
      shipmentId?: string;
    },
  ): Promise<CarrierTracking>;

  voidLabel(
    ctx: CarrierContext,
    params: { transactionId?: string; awb?: string; orderId?: string },
  ): Promise<{ refunded: boolean; state: string }>;

  validateAddress?(
    ctx: CarrierContext,
    address: CarrierAddress,
  ): Promise<{
    valid: boolean;
    messages: string[];
    normalized?: CarrierAddress;
  }>;

  testConnection(ctx: CarrierContext): Promise<{
    ok: true;
    account?: string;
    mode: CarrierMode;
  }>;

  /**
   * Interpret a thrown error. `undefined` means "not a recognised provider
   * error", which the caller must treat as retryable — mistaking an unknown
   * fault for a permanent one strands an order the carrier would have taken.
   */
  classify(error: unknown): CarrierFailure | undefined;

  /** Returns null when the payload is not a recognisable event. */
  parseWebhook(params: {
    rawBody: string;
    headers: Headers;
    url: URL;
  }): CarrierWebhookEnvelope | null;
}
