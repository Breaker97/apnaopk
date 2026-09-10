import { mongoose } from "@/lib/db";
import type { Address } from "@/types";
import {
  CARRIER_LABEL_FILE_TYPES,
  CARRIER_MODES,
  CARRIER_PROVIDERS,
  DIMENSION_UNITS,
  PARCEL_WEIGHT_UNITS,
  type CarrierLabelFileType,
  type CarrierMode,
  type CarrierProvider,
} from "@/lib/shipping/carrier-config";
import type { NormalizedTrackingStatus } from "@/lib/shipping/carriers/types";

const { Schema, models, model } = mongoose;

export type ShipmentStatus =
  | "draft"
  | "label_ready"
  | "shipped"
  | "in_transit"
  | "delivered"
  | "cancelled";

/**
 * Where a label purchase has got to.
 *
 * Deliberately separate from `status`. `status` is the parcel's journey and is
 * already read by the label route and both order screens; purchase is
 * orthogonal to it — a shipment can be `draft` with `purchase.state: "failed"`,
 * which no single enum expresses. Folding the two together would force every
 * existing reader to learn carrier semantics.
 */
type ShipmentPurchaseState =
  | "none"
  | "purchasing"
  | "purchased"
  | "failed"
  | "voided";

interface IShipmentQuote {
  rateId: string;
  carrierName: string;
  serviceName: string;
  serviceToken?: string;
  amount: number;
  currency: string;
  estimatedDays?: number;
  attributes?: string[];
}

export interface IShipmentEvent {
  at: Date;
  status: NormalizedTrackingStatus;
  providerStatus?: string;
  description?: string;
  location?: string;
}

export interface IShipment {
  _id: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  orderNumber: string;
  vendorId?: mongoose.Types.ObjectId;
  subOrderId?: mongoose.Types.ObjectId;
  carrier: string;
  service?: string;
  /** Absent on a rate-shopped draft; only a bought label has one. */
  trackingNumber?: string;
  status: ShipmentStatus;
  source: "manual" | "carrier_api";
  shipFrom: Address;
  shipTo: Address;
  parcel: {
    weight?: number;
    weightUnit?: "g" | "kg" | "lb" | "oz";
    length?: number;
    width?: number;
    height?: number;
    dimensionUnit?: "cm" | "in";
  };
  label: {
    source: "internal" | "carrier";
    format: "pdf" | "zpl" | "png";
    storageKey?: string;
    checksum?: string;
  };

  // ── Carrier integration ────────────────────────────────────────────────
  provider?: CarrierProvider;
  /** Which environment bought this. A live webhook must not touch a test parcel. */
  providerMode?: CarrierMode;
  providerShipmentId?: string;
  /** Shiprocket's order handle; Shippo has no analogue. */
  providerOrderId?: string;
  providerRateId?: string;
  providerTransactionId?: string;
  serviceToken?: string;
  rate?: {
    amount: number;
    /** The carrier account's currency — NOT converted to the store's. */
    currency: string;
    /** The store's currency on the day, so the pair stays interpretable. */
    baseCurrency?: string;
    estimatedDays?: number;
    carrierName?: string;
  };
  /** The rate list this draft was quoted from, and when. */
  quotes?: IShipmentQuote[];
  quotedAt?: Date;
  /** Carrier-hosted; may expire, which is why the label route proxies it. */
  labelUrl?: string;
  labelFileType?: CarrierLabelFileType;
  trackingUrl?: string;
  packageId?: string;
  contactEmail?: string;
  events?: IShipmentEvent[];
  /** A return or failed delivery, which has no home in `status`. */
  exception?: { code: string; message: string; at: Date };
  lastSyncedAt?: Date;
  purchase?: {
    state: ShipmentPurchaseState;
    attempts: number;
    startedAt?: Date;
    purchasedAt?: Date;
    voidedAt?: Date;
    lastError?: string;
    lastErrorCode?: string;
    idempotencyKey?: string;
    /**
     * Whose carrier account was charged for this label.
     *
     * Frozen at purchase rather than derived later, for the reason
     * `codCollectedBy` is: a vendor who connects or disconnects their own
     * carrier account next month must not silently rewrite who paid for the
     * labels already bought. Absent means the platform.
     */
    billedTo?: "platform" | "vendor";
  };
  /**
   * How many labels this parcel has been through, incremented on every void.
   *
   * The carrier reference is stable per sub-order — that is what makes a failed
   * purchase resumable rather than a duplicate consignment. But Shiprocket
   * refuses a repeat `order_id`, so after a void the same reference would land
   * on the consignment that was just cancelled. This discriminates the second
   * booking from the first without weakening the retry guarantee within one.
   */
  bookingSequence?: number;

  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<Address>(
  {
    fullName: String,
    firstName: String,
    lastName: String,
    street: { type: String, required: true },
    apartment: String,
    city: { type: String, required: true },
    // Not required: much of the world has no state or province, and carriers
    // accept a blank one for those countries. Requiring it here meant a
    // Singapore or Maltese address failed Mongoose validation *after* the
    // carrier call had already succeeded. Where a subdivision genuinely is
    // mandatory it is enforced by country in `carriers/address.ts`, which can
    // say so before anything is spent.
    state: String,
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
    phone: String,
  },
  { _id: false },
);

const QuoteSchema = new Schema<IShipmentQuote>(
  {
    rateId: { type: String, required: true },
    carrierName: { type: String, required: true },
    serviceName: { type: String, required: true },
    serviceToken: String,
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true },
    estimatedDays: Number,
    attributes: { type: [String], default: [] },
  },
  { _id: false },
);

const EventSchema = new Schema<IShipmentEvent>(
  {
    at: { type: Date, required: true },
    status: { type: String, required: true },
    providerStatus: String,
    description: { type: String, maxlength: 500 },
    location: { type: String, maxlength: 200 },
  },
  { _id: false },
);

const ShipmentSchema = new Schema<IShipment>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, required: true, trim: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    subOrderId: { type: Schema.Types.ObjectId },
    carrier: { type: String, required: true, trim: true, maxlength: 100 },
    service: { type: String, trim: true, maxlength: 100 },
    // Not required: a rate-shopped draft exists before any carrier has issued
    // a tracking number. The uniqueness guarantee moves to a partial index.
    trackingNumber: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    status: {
      type: String,
      enum: [
        "draft",
        "label_ready",
        "shipped",
        "in_transit",
        "delivered",
        "cancelled",
      ],
      default: "label_ready",
    },
    source: {
      type: String,
      enum: ["manual", "carrier_api"],
      default: "manual",
    },
    shipFrom: { type: AddressSchema, required: true },
    shipTo: { type: AddressSchema, required: true },
    parcel: {
      weight: { type: Number, min: 0 },
      weightUnit: { type: String, enum: PARCEL_WEIGHT_UNITS },
      length: { type: Number, min: 0 },
      width: { type: Number, min: 0 },
      height: { type: Number, min: 0 },
      dimensionUnit: { type: String, enum: DIMENSION_UNITS },
    },
    label: {
      source: { type: String, enum: ["internal", "carrier"], required: true },
      format: { type: String, enum: ["pdf", "zpl", "png"], required: true },
      storageKey: String,
      checksum: String,
    },

    provider: { type: String, enum: CARRIER_PROVIDERS },
    providerMode: { type: String, enum: CARRIER_MODES },
    providerShipmentId: { type: String, trim: true },
    providerOrderId: { type: String, trim: true },
    providerRateId: { type: String, trim: true },
    providerTransactionId: { type: String, trim: true },
    serviceToken: { type: String, trim: true },
    rate: {
      type: new Schema(
        {
          amount: { type: Number, required: true, min: 0 },
          currency: { type: String, required: true },
          /**
           * The store's own currency at the moment the label was bought.
           *
           * `currency` above is the carrier account's, deliberately unconverted.
           * Without recording what the books were kept in that day, an admin
           * who later changes the store currency leaves every past label cost
           * as a bare number beside a code, with nothing to say what it should
           * be compared against. It cannot be reconstructed afterwards —
           * settings hold only the CURRENT value — so it is stamped here.
           */
          baseCurrency: { type: String, trim: true, uppercase: true },
          estimatedDays: Number,
          carrierName: String,
        },
        { _id: false },
      ),
      default: undefined,
    },
    quotes: { type: [QuoteSchema], default: undefined },
    quotedAt: Date,
    labelUrl: String,
    labelFileType: { type: String, enum: CARRIER_LABEL_FILE_TYPES },
    trackingUrl: String,
    packageId: String,
    contactEmail: String,
    events: { type: [EventSchema], default: undefined },
    exception: {
      type: new Schema(
        {
          code: { type: String, required: true },
          message: { type: String, required: true, maxlength: 500 },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    lastSyncedAt: Date,
    purchase: {
      type: new Schema(
        {
          state: {
            type: String,
            enum: ["none", "purchasing", "purchased", "failed", "voided"],
            default: "none",
          },
          attempts: { type: Number, default: 0, min: 0 },
          startedAt: Date,
          purchasedAt: Date,
          voidedAt: Date,
          lastError: { type: String, maxlength: 2000 },
          lastErrorCode: String,
          idempotencyKey: String,
          billedTo: { type: String, enum: ["platform", "vendor"] },
        },
        { _id: false },
      ),
      default: () => ({ state: "none", attempts: 0 }),
    },
    bookingSequence: { type: Number, default: 0, min: 0 },

    createdBy: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

ShipmentSchema.index({ orderId: 1, createdAt: -1 });
ShipmentSchema.index({ vendorId: 1, createdAt: -1 });
ShipmentSchema.index({ trackingNumber: 1, carrier: 1 });
// Partial: drafts share a null tracking number, and a unique index over nulls
// would let a sub-order have only one draft ever.
ShipmentSchema.index(
  { orderId: 1, vendorId: 1, trackingNumber: 1 },
  {
    unique: true,
    partialFilterExpression: { trackingNumber: { $type: "string" } },
  },
);
// One carrier shipment per sub-order per provider — this is what makes the
// rate-shopping route an upsert rather than a duplicate factory.
//
// Unique, because the upsert alone is not: two rate lookups racing (a double
// click, or the dialog against the automation worker) both miss the filter and
// both insert, leaving the parcel with two drafts and the purchase guard
// looking at whichever one it happened to load.
//
// Partial on `provider`, because a manual shipment has none — several of those
// per sub-order are legitimate, and a plain unique index over the missing field
// would let a sub-order have exactly one for all time.
ShipmentSchema.index(
  { orderId: 1, subOrderId: 1, provider: 1 },
  {
    unique: true,
    partialFilterExpression: { provider: { $type: "string" } },
  },
);
ShipmentSchema.index(
  { provider: 1, providerTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerTransactionId: { $type: "string" } },
  },
);
ShipmentSchema.index(
  { provider: 1, providerShipmentId: 1 },
  { partialFilterExpression: { providerShipmentId: { $type: "string" } } },
);
// Drives the tracking-poll sweep.
ShipmentSchema.index({ status: 1, lastSyncedAt: 1 });

export const Shipment =
  models.Shipment || model<IShipment>("Shipment", ShipmentSchema);
