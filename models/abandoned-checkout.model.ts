import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

const AbandonedCheckoutItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    variantId: { type: Schema.Types.ObjectId },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    name: { type: String, required: true, trim: true },
    image: { type: String, trim: true },
  },
  { _id: false },
);

const AbandonedCheckoutAddressSchema = new Schema(
  {
    fullName: { type: String, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    street: { type: String, trim: true },
    apartment: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true },
    phone: { type: String, trim: true },
  },
  { _id: false },
);

const AbandonedCheckoutPaymentEventSchema = new Schema(
  {
    gateway: { type: String, trim: true },
    status: {
      type: String,
      enum: ["created", "failed", "succeeded", "cancelled"],
      required: true,
    },
    message: { type: String, trim: true },
    paymentId: { type: String, trim: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const AbandonedCheckoutSchema = new Schema(
  {
    cartId: { type: Schema.Types.ObjectId, ref: "Cart", index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    sessionId: { type: String, index: true },
    checkoutToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    recoveryToken: { type: String, index: true },
    checkoutUrl: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true, index: true },
    phone: { type: String, trim: true },
    customerName: { type: String, trim: true },
    customerLocale: { type: String, trim: true },
    buyerAcceptsMarketing: { type: Boolean, default: false },
    billingAddress: { type: AbandonedCheckoutAddressSchema },
    shippingAddress: { type: AbandonedCheckoutAddressSchema },
    sourceName: { type: String, default: "online_store", trim: true, index: true },
    landingSite: { type: String, trim: true },
    referringSite: { type: String, trim: true },
    gateway: { type: String, trim: true },
    items: { type: [AbandonedCheckoutItemSchema], default: [] },
    itemCount: { type: Number, default: 0, min: 0 },
    subtotalPrice: { type: Number, default: 0, min: 0 },
    shippingPrice: { type: Number, default: 0, min: 0 },
    totalTax: { type: Number, default: 0, min: 0 },
    totalDiscounts: { type: Number, default: 0, min: 0 },
    totalPrice: { type: Number, default: 0, min: 0 },
    presentmentCurrency: { type: String, trim: true, uppercase: true },
    checkoutStartedAt: { type: Date, index: true },
    abandonedAt: { type: Date },
    completedAt: { type: Date },
    recoveryEmailStatus: {
      type: String,
      enum: ["not_sent", "sent", "failed", "not_applicable"],
      default: "not_sent",
      index: true,
    },
    emailSentAt: { type: Date },
    recoveryStatus: {
      type: String,
      enum: ["not_recovered", "recovered"],
      default: "not_recovered",
    },
    emailStatusReason: { type: String, trim: true },
    status: {
      type: String,
      enum: ["open", "recovered", "closed"],
      default: "open",
      index: true,
    },
    paymentEvents: { type: [AbandonedCheckoutPaymentEventSchema], default: [] },
  },
  {
    timestamps: true,
  },
);

AbandonedCheckoutSchema.index({ email: "text", phone: "text", customerName: "text" });
AbandonedCheckoutSchema.index({ recoveryStatus: 1, recoveryEmailStatus: 1 });
AbandonedCheckoutSchema.index({ abandonedAt: -1, updatedAt: -1 });

export const AbandonedCheckout =
  models.AbandonedCheckout ||
  model("AbandonedCheckout", AbandonedCheckoutSchema);
