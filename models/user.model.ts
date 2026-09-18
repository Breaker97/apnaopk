import { mongoose } from "@/lib/db";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import type { IUser, Address, VendorOnboardingDraft } from "@/types";
import type { Model } from "mongoose";

const { Schema, models, model } = mongoose;

type UserDoc = IUser & {
  password?: string;
};

/**
 * Address Sub-Schema
 */
const AddressSchema = new Schema<Address>(
  {
    firstName: { type: String },
    lastName: { type: String },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String },
    apartment: { type: String },
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
    phone: { type: String },
    isDefault: { type: Boolean, default: false },
    label: { type: String, default: "home" },
  },
  // `_id` is deliberately left on (the Mongoose default) so every address has a
  // stable identity. It used to be disabled, which forced the API to address
  // entries by array position: deleting an address in one tab shifted every
  // index in another, so a concurrent edit silently rewrote the wrong one.
  //
  // Addresses written before this change have no `_id`, and none is minted
  // retroactively. The routes therefore accept an id *or* an index and prefer
  // the id when present — see `resolveAddressIndex`. Legacy entries pick up an
  // id the first time they are written.
);

/**
 * Vendor Onboarding Draft Sub-Schema
 * Resumable progress for the become-a-vendor wizard. All fields optional;
 * cleared once the application is submitted.
 */
const VendorOnboardingSchema = new Schema<VendorOnboardingDraft>(
  {
    step: { type: Number },
    stepKey: { type: String },
    storeName: { type: String },
    description: { type: String },
    country: { type: String },
    state: { type: String },
    city: { type: String },
    address: { type: String },
    pincode: { type: String },
    phone: { type: String },
    phoneCode: { type: String },
    documents: {
      businessLicense: { type: String },
      taxId: { type: String },
      taxCertificate: { type: String },
      governmentId: { type: String },
    },
    plan: {
      planId: { type: String },
      billingInterval: { type: String },
      startTrial: { type: Boolean },
    },
    // Answers to admin-defined custom onboarding fields, keyed by field key.
    responses: { type: Schema.Types.Mixed },
    updatedAt: { type: Date },
  },
  { _id: false },
);

/**
 * User Schema
 */
const UserSchema = new Schema<UserDoc>(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [100, "Name cannot exceed 100 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email"],
    },
    password: {
      type: String,
      select: false,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    image: {
      type: String,
    },
    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.CUSTOMER,
    },
    roles: {
      type: [String],
      enum: Object.values(USER_ROLES),
      default: [USER_ROLES.CUSTOMER],
    },
    status: {
      type: String,
      enum: Object.values(USER_ACCOUNT_STATUS),
      default: USER_ACCOUNT_STATUS.ACTIVE,
    },
    phone: {
      type: String,
      trim: true,
    },
    addresses: {
      type: [AddressSchema],
      default: [],
    },
    // 2FA fields
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
    },
    emailVerifiedAt: {
      type: Date,
    },
    emailVerificationRequiredAt: {
      type: Date,
    },
    emailVerificationAudience: {
      type: String,
      enum: [USER_ROLES.CUSTOMER, USER_ROLES.VENDOR],
      default: USER_ROLES.CUSTOMER,
    },
    // The shopper's Stripe Customer, minted lazily the first time they pay by
    // card (`lib/payments/stripe-customer.ts`).
    //
    // A saved card can only hang off a Customer, so a deposit or pay-later
    // pre-order has nothing to vault against until this exists. No card is
    // saved yet — this only gives every card payment a person to belong to,
    // so that the consent flow which does save one has somewhere to put it.
    //
    // Neither unique nor indexed on purpose: it is read by `_id` and never
    // searched by. Nor is it authoritative — an id this Stripe account does
    // not recognise (a deleted customer, a new account, a test/live switch) is
    // treated as absent and re-minted by the resolver.
    stripeCustomerId: {
      type: String,
      default: null,
    },
    vendorOnboarding: {
      type: VendorOnboardingSchema,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    collection: "user",
  },
);

// Indexes
// Admin user list sorts by createdAt, optionally filtered by role. { createdAt }
// serves the "all" tab (no filter); { role, createdAt } serves the role tabs
// without an in-memory sort and supersedes the old single-field { role: 1 }.
UserSchema.index({ createdAt: -1 });
UserSchema.index({ role: 1, createdAt: -1 });
// The dashboard counts customers all-time / this month / last month from one
// pipeline. With createdAt in the index that pipeline is covered — no document
// fetch — and the `roles` prefix still serves plain membership lookups, so this
// supersedes the old single-field { roles: 1 }.
UserSchema.index({ roles: 1, createdAt: -1 });
// Account state is rare-valued (almost everyone is active); the customers
// stats card and the staff/assignment lists filter on it.
UserSchema.index({ status: 1 });

// Virtual for vendor profile
UserSchema.virtual("vendorProfile", {
  ref: "Vendor",
  localField: "_id",
  foreignField: "userId",
  justOne: true,
});

export const User = ((models.User as Model<UserDoc> | undefined) ??
  model<UserDoc>("User", UserSchema, "user")) as Model<UserDoc>;
