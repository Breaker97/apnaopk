/**
 * ShipmentJob — the carrier work queue.
 *
 * A label purchase is a *paid* external call, provider-rate-limited, and
 * capable of partial success (Shiprocket's order is created and the AWB
 * assignment 500s). `afterResponse` survives the response but has no retry, no
 * backoff, no dead letter and no visibility, and dies with the invocation —
 * dropping a half-finished purchase leaves a phantom consignment with no local
 * record. This is the same shape `models/message-outbox.model.ts` exists for.
 */

import mongoose, { Schema, type Model } from "mongoose";
import { CARRIER_PROVIDERS, type CarrierProvider } from "@/lib/shipping/carrier-config";

const SHIPMENT_JOB_KINDS = [
  "auto_ship",
  "purchase_label",
  "void_label",
  "sync_tracking",
] as const;

export type ShipmentJobKind = (typeof SHIPMENT_JOB_KINDS)[number];

export type ShipmentJobStatus = "pending" | "processing" | "done" | "failed";

export interface IShipmentJob {
  _id: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  subOrderId?: mongoose.Types.ObjectId;
  vendorId?: mongoose.Types.ObjectId;
  shipmentId?: mongoose.Types.ObjectId;
  kind: ShipmentJobKind;
  provider?: CarrierProvider;
  status: ShipmentJobStatus;
  attempts: number;
  nextAttemptAt: Date;
  /** Crash recovery: an expired lease frees the job for another worker. */
  leaseUntil?: Date | null;
  /** User id, or "system" for an automated enqueue. */
  requestedBy?: string;
  payload?: {
    rateId?: string;
    serviceToken?: string;
    packageId?: string;
  };
  lastError?: string | null;
  lastErrorCode?: string | null;
  /**
   * When this job stopped retrying for good.
   *
   * Its own field rather than `updatedAt`, which Mongoose bumps on every write
   * — including the no-op enqueue that matches an existing row — and so can
   * never say how long a job has actually been dead.
   */
  deadLetteredAt?: Date | null;
  /** Set only on a terminal state, so the TTL never reaps live work. */
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ShipmentJobSchema = new Schema<IShipmentJob>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    subOrderId: { type: Schema.Types.ObjectId },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    shipmentId: { type: Schema.Types.ObjectId, ref: "Shipment" },
    kind: { type: String, enum: SHIPMENT_JOB_KINDS, required: true },
    provider: { type: String, enum: CARRIER_PROVIDERS },
    status: {
      type: String,
      enum: ["pending", "processing", "done", "failed"],
      default: "pending",
      required: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), required: true },
    leaseUntil: { type: Date, default: null },
    requestedBy: { type: String },
    payload: {
      type: new Schema(
        {
          rateId: String,
          serviceToken: String,
          packageId: String,
        },
        { _id: false },
      ),
      default: undefined,
    },
    lastError: { type: String, default: null, maxlength: 2000 },
    lastErrorCode: { type: String, default: null },
    deadLetteredAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Idempotent enqueue: one job per (sub-order, shipment, kind), ever. Combined
// with `$setOnInsert` this is what stops a sweep and an inline hook both
// queueing the same auto-ship.
ShipmentJobSchema.index(
  { orderId: 1, subOrderId: 1, shipmentId: 1, kind: 1 },
  { unique: true },
);
// The claim query.
ShipmentJobSchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
ShipmentJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ShipmentJob: Model<IShipmentJob> =
  mongoose.models.ShipmentJob ||
  mongoose.model<IShipmentJob>("ShipmentJob", ShipmentJobSchema);
