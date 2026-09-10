import { mongoose } from "@/lib/db";
import {
  RETURN_REFUND_STATUS,
  RETURN_STATUS,
  type ReturnRefundStatus,
  type ReturnStatus,
} from "@/lib/returns/returns";
import { REFUND_DESTINATION_METHODS } from "@/lib/returns/refund-settlement";

const { Schema, models, model } = mongoose;

export interface ReturnRequestItem {
  productId: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  orderItemIndex: number;
  name: string;
  sku: string;
  quantityOrdered: number;
  quantityRequested: number;
  quantityApproved: number;
  quantityReceived: number;
  unitPrice: number;
  image?: string;
  condition?: "new" | "opened" | "damaged" | "missing_parts" | "unusable";
  restockable?: boolean;
}

/**
 * Where the money goes when no gateway can carry it back.
 *
 * Collected from the shopper at request time rather than chased afterwards: a
 * cash-on-delivery refund has no payment instrument to reverse, and asking for
 * bank details once the return is already approved means an email thread.
 */
interface ReturnRequestRefundDestination {
  method: string;
  accountName?: string;
  accountNumber?: string;
  provider?: string;
  note?: string;
  providedAt?: Date;
}

export interface ReturnRequestRefundEstimate {
  itemsSubtotal: number;
  shipping: number;
  tax: number;
  discountAdjustment: number;
  restockingFee: number;
  returnShippingFee: number;
  total: number;
  currency: string;
}

interface IReturnRequest {
  _id: mongoose.Types.ObjectId;
  returnNumber: string;
  orderId: mongoose.Types.ObjectId;
  orderNumber: string;
  customerId: mongoose.Types.ObjectId;
  ownerType: "admin" | "vendor";
  ownerVendorId?: mongoose.Types.ObjectId;
  vendorIds: mongoose.Types.ObjectId[];
  status: ReturnStatus;
  refundStatus: ReturnRefundStatus;
  reason: string;
  customerNote?: string;
  adminNote?: string;
  rejectionReason?: string;
  items: ReturnRequestItem[];
  estimatedRefund: ReturnRequestRefundEstimate;
  /**
   * The merchant's own finding on whose failure this return was, recorded
   * alongside the shopper's stated reason rather than replacing it.
   *
   * The reason is the shopper's account; this is what someone found when they
   * opened the parcel. Keeping both is what makes a disputed return reviewable.
   */
  faultOverride?: {
    merchantAtFault: boolean;
    note?: string;
    setBy: string;
    setAt: Date;
  };
  refundDestination?: ReturnRequestRefundDestination;
  actualRefund?: {
    amount?: number;
    paymentTransactionId?: mongoose.Types.ObjectId;
    provider?: string;
    externalRefundId?: string;
    /**
     * How the money physically reached the shopper on a refund no gateway
     * carried. Until this is set, `manual_required` means nothing has moved —
     * which is the distinction the status alone could never make.
     */
    settledMethod?: string;
    settledReference?: string;
    settledAt?: Date;
    settledBy?: string;
  };
  shipment?: {
    carrier?: string;
    trackingNumber?: string;
    labelUrl?: string;
    shippedAt?: Date;
    deliveredAt?: Date;
  };
  inventoryRestored?: boolean;
  createdBy: string;
  updatedBy?: string;
  requestedAt: Date;
  approvedAt?: Date;
  rejectedAt?: Date;
  receivedAt?: Date;
  inspectedAt?: Date;
  refundedAt?: Date;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReturnRequestItemSchema = new Schema<ReturnRequestItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantId: { type: Schema.Types.ObjectId },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },
    orderItemIndex: { type: Number, required: true, min: 0 },
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    quantityOrdered: { type: Number, required: true, min: 1 },
    quantityRequested: { type: Number, required: true, min: 1 },
    quantityApproved: { type: Number, required: true, min: 0, default: 0 },
    quantityReceived: { type: Number, required: true, min: 0, default: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    image: { type: String },
    condition: {
      type: String,
      enum: ["new", "opened", "damaged", "missing_parts", "unusable"],
    },
    restockable: { type: Boolean, default: false },
  },
  { _id: false },
);

const RefundEstimateSchema = new Schema<ReturnRequestRefundEstimate>(
  {
    itemsSubtotal: { type: Number, required: true, min: 0 },
    shipping: { type: Number, required: true, min: 0, default: 0 },
    tax: { type: Number, required: true, min: 0, default: 0 },
    discountAdjustment: { type: Number, required: true, min: 0, default: 0 },
    restockingFee: { type: Number, required: true, min: 0, default: 0 },
    returnShippingFee: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, default: "USD" },
  },
  { _id: false },
);

const ReturnRequestSchema = new Schema<IReturnRequest>(
  {
    returnNumber: { type: String, required: true, unique: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    orderNumber: { type: String, required: true, trim: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    ownerType: {
      type: String,
      enum: ["admin", "vendor"],
      default: "admin",
    },
    ownerVendorId: { type: Schema.Types.ObjectId, ref: "Vendor", index: true },
    vendorIds: [{ type: Schema.Types.ObjectId, ref: "Vendor" }],
    status: {
      type: String,
      enum: Object.values(RETURN_STATUS),
      default: RETURN_STATUS.REQUESTED,
      index: true,
    },
    refundStatus: {
      type: String,
      enum: Object.values(RETURN_REFUND_STATUS),
      default: RETURN_REFUND_STATUS.PENDING,
      index: true,
    },
    reason: { type: String, required: true, trim: true, maxlength: 100 },
    customerNote: { type: String, trim: true, maxlength: 1000 },
    adminNote: { type: String, trim: true, maxlength: 2000 },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },
    items: { type: [ReturnRequestItemSchema], required: true },
    estimatedRefund: { type: RefundEstimateSchema, required: true },
    faultOverride: {
      merchantAtFault: { type: Boolean },
      note: { type: String, trim: true, maxlength: 500 },
      setBy: { type: String, trim: true },
      setAt: { type: Date },
    },
    refundDestination: {
      type: new Schema<ReturnRequestRefundDestination>(
        {
          method: {
            type: String,
            enum: REFUND_DESTINATION_METHODS,
            required: true,
          },
          accountName: { type: String, trim: true, maxlength: 120 },
          accountNumber: { type: String, trim: true, maxlength: 64 },
          provider: { type: String, trim: true, maxlength: 120 },
          note: { type: String, trim: true, maxlength: 500 },
          providedAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      required: false,
    },
    actualRefund: {
      amount: { type: Number, min: 0 },
      paymentTransactionId: { type: Schema.Types.ObjectId, ref: "PaymentTransaction" },
      provider: { type: String, trim: true },
      externalRefundId: { type: String, trim: true },
      settledMethod: { type: String, trim: true, maxlength: 40 },
      settledReference: { type: String, trim: true, maxlength: 200 },
      settledAt: { type: Date },
      settledBy: { type: String, trim: true },
    },
    shipment: {
      carrier: { type: String, trim: true, maxlength: 100 },
      trackingNumber: { type: String, trim: true, maxlength: 100 },
      labelUrl: { type: String, trim: true },
      shippedAt: { type: Date },
      deliveredAt: { type: Date },
    },
    // Set atomically the first time returned items are restocked so a repeated
    // refund action can't restore the same quantities twice.
    inventoryRestored: { type: Boolean },
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, trim: true },
    requestedAt: { type: Date, default: Date.now, index: true },
    approvedAt: Date,
    rejectedAt: Date,
    receivedAt: Date,
    inspectedAt: Date,
    refundedAt: Date,
    closedAt: Date,
  },
  { timestamps: true },
);

ReturnRequestSchema.index({ customerId: 1, createdAt: -1 });
ReturnRequestSchema.index({ orderId: 1, status: 1 });
ReturnRequestSchema.index({ vendorIds: 1, createdAt: -1 });
ReturnRequestSchema.index({ ownerType: 1, ownerVendorId: 1, createdAt: -1 });
// Refund totals on the admin dashboard match succeeded refunds and bucket them
// by refundedAt; without this the card scanned every return request.
ReturnRequestSchema.index({ refundStatus: 1, refundedAt: -1 });

export const ReturnRequest =
  models.ReturnRequest ||
  model<IReturnRequest>("ReturnRequest", ReturnRequestSchema);

