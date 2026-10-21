/**
 * VendorTaxRequest Model
 *
 * A vendor asking the store to change the tax of some of their products —
 * Charge tax, the tax class, or a custom rate. Under Settings → Tax Settings
 * → Vendors' default policy a vendor cannot write a product's tax themselves
 * (lib/tax/vendor-tax.ts); this is how they ask instead.
 *
 * Its own document, like VendorAccessRequest: it has a lifecycle (pending →
 * approved/declined/withdrawn), an author on each side, and it stays after
 * the decision so "we asked and were told no" remains answerable. Approving
 * it writes the tax onto the products (lib/vendors/vendor-tax-requests.ts);
 * the request itself changes nothing.
 */
import mongoose, { Schema, Document, Model, Types } from "mongoose";

export const VENDOR_TAX_REQUEST_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  DECLINED: "declined",
  WITHDRAWN: "withdrawn",
} as const;

type VendorTaxRequestStatus =
  (typeof VENDOR_TAX_REQUEST_STATUS)[keyof typeof VENDOR_TAX_REQUEST_STATUS];

/** A product's tax as the three fields store it. */
export interface IProductTaxValue {
  chargeTax: boolean;
  taxClass: string | null;
  taxRate: number | null;
}

export interface IVendorTaxRequestProduct {
  productId: Types.ObjectId;
  /** The product's name when asked, so the request reads the same after a rename. */
  name: string;
  /** Its tax when asked: what the admin compares the request against. */
  before: IProductTaxValue;
}

export interface IVendorTaxRequest extends Document {
  vendorId: Types.ObjectId;
  products: IVendorTaxRequestProduct[];
  /** Every product's id, for the one-open-request-per-product index. */
  productIds: Types.ObjectId[];
  /** The tax asked for, the same for every product. */
  requested: IProductTaxValue;
  reason: string;
  status: VendorTaxRequestStatus;
  requestedBy: string;
  requestedAt: Date;
  decidedBy?: string | null;
  decidedAt?: Date | null;
  decisionNote?: string | null;
  /**
   * Held while an approval writes the products, with the request still
   * pending, so a crash or a failed write leaves it answerable once the lease
   * runs out — see `decideVendorTaxRequest`.
   */
  decisionLease?: { token: string; at: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}

const TaxValueSchema = new Schema<IProductTaxValue>(
  {
    chargeTax: { type: Boolean, required: true },
    taxClass: { type: String, default: null, maxlength: 40 },
    taxRate: { type: Number, default: null, min: 0, max: 100 },
  },
  { _id: false },
);

const VendorTaxRequestSchema = new Schema<IVendorTaxRequest>(
  {
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    products: {
      type: [
        new Schema<IVendorTaxRequestProduct>(
          {
            productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
            name: { type: String, required: true, maxlength: 300 },
            before: { type: TaxValueSchema, required: true },
          },
          { _id: false },
        ),
      ],
      validate: [
        (products: unknown[]) => products.length > 0,
        "A tax change request names at least one product",
      ],
    },
    productIds: { type: [Schema.Types.ObjectId], required: true },
    requested: { type: TaxValueSchema, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: Object.values(VENDOR_TAX_REQUEST_STATUS),
      default: VENDOR_TAX_REQUEST_STATUS.PENDING,
      index: true,
    },
    requestedBy: { type: String, required: true },
    requestedAt: { type: Date, default: Date.now },
    decidedBy: { type: String, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: null, maxlength: 1000 },
    decisionLease: {
      type: new Schema({ token: { type: String, required: true }, at: { type: Date, required: true } }, { _id: false }),
      default: undefined,
    },
  },
  { timestamps: true },
);

// The admin queue reads pending rows newest-first; a vendor reads their own.
VendorTaxRequestSchema.index({ status: 1, requestedAt: -1 });
VendorTaxRequestSchema.index({ vendorId: 1, requestedAt: -1 });

// One open request per product: two pending asks for one product would leave
// the admin approving whichever came last without knowing of the other.
// Partial, so decided requests accumulate freely as history.
VendorTaxRequestSchema.index(
  { productIds: 1 },
  {
    unique: true,
    partialFilterExpression: { status: VENDOR_TAX_REQUEST_STATUS.PENDING },
  },
);

export const VendorTaxRequest: Model<IVendorTaxRequest> =
  (mongoose.models.VendorTaxRequest as Model<IVendorTaxRequest>) ||
  mongoose.model<IVendorTaxRequest>("VendorTaxRequest", VendorTaxRequestSchema);
