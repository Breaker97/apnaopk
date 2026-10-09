/**
 * VendorApplication Model
 * Pre-approval application and billing setup state for become-a-vendor.
 *
 * Billing begins only after admin verification. This document keeps review and
 * payment state separate from the Vendor projection so neither approval nor a
 * browser redirect can grant selling access by itself.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import {
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_BILLING_INTERVAL,
  type VendorApplicationPaymentStatus,
  type VendorApplicationStatus,
  type VendorBillingInterval,
} from "@/config/app.config";

export interface IVendorApplicationPlanSnapshot {
  name: string;
  price: number;
  currency: string;
  billingInterval: VendorBillingInterval;
  commissionRate: number;
  trialDays: number;
  features: string[];
  limits: { products?: number | null; staff?: number | null };
  capabilities: { aiAuthoring?: boolean };
  stripeProductId?: string | null;
  stripePriceId?: string | null;
}

export interface IVendorApplicationData {
  storeName: string;
  description: string;
  logo?: string | null;
  banner?: string | null;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
  } | null;
  socialLinks?: {
    website?: string;
    facebook?: string;
    instagram?: string;
    twitter?: string;
  } | null;
  bankDetails?: {
    accountName?: string;
    accountNumber?: string;
    bankName?: string;
    routingNumber?: string;
    swiftCode?: string;
  } | null;
  documents?: {
    businessLicense?: string;
    taxId?: string;
    taxCertificate?: string;
    governmentId?: string;
  } | null;
  responses?: Record<string, { label: string; value: string | boolean }>;
}

export interface IVendorApplication extends Document {
  userId: mongoose.Types.ObjectId;
  vendorId?: mongoose.Types.ObjectId | null;
  status: VendorApplicationStatus;
  paymentStatus: VendorApplicationPaymentStatus;
  planId?: mongoose.Types.ObjectId | null;
  planSnapshot?: IVendorApplicationPlanSnapshot | null;
  applicationData: IVendorApplicationData;
  stripeCustomerId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeLatestInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeProviderStatus?: string | null;
  checkoutExpiresAt?: Date | null;
  paymentCompletedAt?: Date | null;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  paymentDueAt?: Date | null;
  paymentReminder3SentAt?: Date | null;
  paymentReminder6SentAt?: Date | null;
  setupAccessExpiredAt?: Date | null;
  paymentExpiredAt?: Date | null;
  /** When a paid plan's free trial ran out unpaid, handing this application
   * back to the initial-payment rail. Distinguishes "your trial is over" from
   * "your setup window is over" on the vendor's payment gate. */
  trialEndedAt?: Date | null;
  activationNotifiedAt?: Date | null;
  termsAcceptedAt?: Date | null;
  termsVersion?: string | null;
  termsAcceptedIp?: string | null;
  termsAcceptedUserAgent?: string | null;
  rejectedAt?: Date | null;
  refundedAt?: Date | null;
  rejectionReason?: string | null;
  lastError?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const VendorApplicationPlanSnapshotSchema =
  new Schema<IVendorApplicationPlanSnapshot>(
    {
      name: { type: String, required: true },
      price: { type: Number, required: true, min: 0 },
      currency: { type: String, default: "USD", uppercase: true },
      billingInterval: {
        type: String,
        enum: Object.values(VENDOR_BILLING_INTERVAL),
        required: true,
      },
      commissionRate: { type: Number, required: true, min: 0, max: 100 },
      trialDays: { type: Number, default: 0, min: 0 },
      features: { type: [String], default: [] },
      limits: {
        type: new Schema(
          {
            products: { type: Number, default: null },
            staff: { type: Number, default: null },
          },
          { _id: false },
        ),
        default: () => ({}),
      },
      capabilities: {
        type: new Schema(
          {
            aiAuthoring: { type: Boolean, default: false },
          },
          { _id: false },
        ),
        default: () => ({}),
      },
      stripeProductId: { type: String, default: null },
      stripePriceId: { type: String, default: null },
    },
    { _id: false },
  );

const VendorApplicationDataSchema = new Schema<IVendorApplicationData>(
  {
    storeName: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    logo: { type: String, default: null },
    banner: { type: String, default: null },
    address: {
      type: new Schema(
        {
          street: String,
          city: String,
          state: String,
          postalCode: String,
          country: String,
          phone: String,
        },
        { _id: false },
      ),
      default: null,
    },
    socialLinks: {
      type: new Schema(
        {
          website: String,
          facebook: String,
          instagram: String,
          twitter: String,
        },
        { _id: false },
      ),
      default: null,
    },
    bankDetails: {
      type: new Schema(
        {
          accountName: String,
          accountNumber: String,
          bankName: String,
          routingNumber: String,
          swiftCode: String,
        },
        { _id: false },
      ),
      default: null,
    },
    documents: {
      type: new Schema(
        {
          businessLicense: String,
          taxId: String,
          taxCertificate: String,
          governmentId: String,
        },
        { _id: false },
      ),
      default: null,
    },
    responses: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false },
);

const VendorApplicationSchema = new Schema<IVendorApplication>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(VENDOR_APPLICATION_STATUS),
      default: VENDOR_APPLICATION_STATUS.DRAFT,
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(VENDOR_APPLICATION_PAYMENT_STATUS),
      default: VENDOR_APPLICATION_PAYMENT_STATUS.UNPAID,
      required: true,
    },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "VendorPlan",
      default: null,
    },
    planSnapshot: {
      type: VendorApplicationPlanSnapshotSchema,
      default: null,
    },
    applicationData: {
      type: VendorApplicationDataSchema,
      required: true,
    },
    stripeCustomerId: { type: String, default: null },
    stripeCheckoutSessionId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    stripeLatestInvoiceId: { type: String, default: null },
    stripePaymentIntentId: { type: String, default: null },
    stripeProviderStatus: { type: String, default: null },
    checkoutExpiresAt: { type: Date, default: null },
    paymentCompletedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    paymentDueAt: { type: Date, default: null },
    paymentReminder3SentAt: { type: Date, default: null },
    paymentReminder6SentAt: { type: Date, default: null },
    setupAccessExpiredAt: { type: Date, default: null },
    paymentExpiredAt: { type: Date, default: null },
    trialEndedAt: { type: Date, default: null },
    activationNotifiedAt: { type: Date, default: null },
    termsAcceptedAt: { type: Date, default: null },
    termsVersion: { type: String, default: null, maxlength: 100 },
    termsAcceptedIp: { type: String, default: null, maxlength: 200 },
    termsAcceptedUserAgent: { type: String, default: null, maxlength: 1000 },
    rejectedAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null, maxlength: 1000 },
    lastError: { type: String, default: null, maxlength: 2000 },
  },
  {
    timestamps: true,
  },
);

VendorApplicationSchema.index({ status: 1, updatedAt: -1 });
VendorApplicationSchema.index({ paymentStatus: 1, updatedAt: -1 });
VendorApplicationSchema.index({ stripeCheckoutSessionId: 1 });
VendorApplicationSchema.index({ stripeSubscriptionId: 1 });
VendorApplicationSchema.index({ status: 1, paymentStatus: 1, paymentDueAt: 1 });

// Keep Next.js development hot reload from validating application billing
// fields against an older model schema retained in Mongoose's global cache.
if (
  process.env.NODE_ENV === "development" &&
  mongoose.models.VendorApplication
) {
  mongoose.deleteModel("VendorApplication");
}

export const VendorApplication: Model<IVendorApplication> =
  mongoose.models.VendorApplication ||
  mongoose.model<IVendorApplication>(
    "VendorApplication",
    VendorApplicationSchema,
  );
