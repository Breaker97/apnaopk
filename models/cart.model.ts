import { mongoose } from "@/lib/db";
import { appConfig } from "@/config/app.config";
import type { Address, ICart, CartItem } from "@/types";

const { Schema, models, model } = mongoose;

/**
 * Cart Item Sub-Schema
 */
const CartItemSchema = new Schema<CartItem>({
  productId: {
    type: Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  variantId: {
    type: Schema.Types.ObjectId,
  },
  quantity: {
    type: Number,
    required: true,
    min: [1, "Quantity must be at least 1"],
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  name: {
    type: String,
    required: true,
  },
  variantName: {
    type: String,
  },
  image: {
    type: String,
  },
  purchaseType: {
    type: String,
    enum: ["standard", "preorder"],
    default: "standard",
  },
  preorderReleaseDate: {
    type: Date,
  },
  preorderMessage: {
    type: String,
    trim: true,
    maxlength: 500,
  },
  preorderPaymentMode: {
    type: String,
    enum: ["full", "deposit", "pay_later"],
  },
  preorderDepositAmount: {
    type: Number,
    min: 0,
  },
  preorderOutstandingAmount: {
    type: Number,
    min: 0,
  },
  preorderSupplierEta: {
    type: Date,
  },
  preorderBatchName: {
    type: String,
    trim: true,
    maxlength: 120,
  },
});

const CheckoutAddressSchema = new Schema<Address>(
  {
    fullName: { type: String, trim: true },
    street: { type: String, trim: true },
    apartment: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true },
    phone: { type: String, trim: true },
    isDefault: { type: Boolean },
  },
  { _id: false },
);

const PaymentEventSchema = new Schema(
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

/**
 * Cart Schema
 */
const CartSchema = new Schema<ICart>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    sessionId: {
      type: String,
    },
    items: {
      type: [CartItemSchema],
      default: [],
    },
    checkoutToken: {
      type: String,
      index: true,
      unique: true,
      sparse: true,
    },
    checkoutUrl: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    customerName: {
      type: String,
      trim: true,
    },
    customerLocale: {
      type: String,
      trim: true,
    },
    buyerAcceptsMarketing: {
      type: Boolean,
      default: false,
    },
    billingAddress: {
      type: CheckoutAddressSchema,
    },
    shippingAddress: {
      type: CheckoutAddressSchema,
    },
    sourceName: {
      type: String,
      default: "online_store",
      trim: true,
      index: true,
    },
    landingSite: {
      type: String,
      trim: true,
    },
    referringSite: {
      type: String,
      trim: true,
    },
    gateway: {
      type: String,
      trim: true,
    },
    subtotalPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    shippingPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalTax: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalDiscounts: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    presentmentCurrency: {
      type: String,
      trim: true,
      uppercase: true,
    },
    checkoutStartedAt: {
      type: Date,
    },
    abandonedAt: {
      type: Date,
      index: true,
    },
    completedAt: {
      type: Date,
    },
    recoveryEmailStatus: {
      type: String,
      enum: ["not_sent", "sent", "failed", "not_applicable"],
      default: "not_sent",
      index: true,
    },
    recoveryStatus: {
      type: String,
      enum: ["not_recovered", "recovered"],
      default: "not_recovered",
    },
    emailStatusReason: {
      type: String,
      trim: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
    },
    paymentEvents: {
      type: [PaymentEventSchema],
      default: [],
    },
    expiresAt: {
      type: Date,
      default: () =>
        new Date(Date.now() + appConfig.cartExpiryDays * 24 * 60 * 60 * 1000),
    },
    lastActionAt: {
      type: Date,
      default: () => new Date(),
    },
    status: {
      type: String,
      enum: ["active", "abandoned", "recovered"],
      default: "active",
    },
    recoveryToken: {
      type: String,
    },
    emailSentAt: {
      type: Date,
    },
    recoveredAt: {
      type: Date,
    },
    // Set atomically when an order-creation request claims this cart, so a
    // double-submitted checkout can't create two orders (and decrement stock
    // twice) from the same cart. Stale claims (crashed request) expire after a
    // short window; successful checkouts delete the cart anyway.
    checkoutClaimedAt: {
      type: Date,
    },
    // Stripe PaymentIntents rejected because the cart changed after the
    // payment was quoted (tamper guard) and then auto-refunded. Once an
    // intent is recorded here it must NEVER fulfil an order — without this
    // marker, editing the cart back to the quoted sum would let a refunded
    // payment ship goods.
    rejectedPaymentIntentIds: {
      type: [String],
      default: undefined,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
CartSchema.index({ userId: 1 });
CartSchema.index({ sessionId: 1 });
CartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
CartSchema.index({ status: 1, updatedAt: -1 });
CartSchema.index({ status: 1, abandonedAt: -1 });
// Serves the abandonment-detection cron ({status, checkoutStartedAt/lastActionAt} scans).
CartSchema.index({ status: 1, lastActionAt: 1 });
CartSchema.index({ recoveryStatus: 1, recoveryEmailStatus: 1 });
// Recovery links resolve by $or on checkoutToken/recoveryToken; without this
// the recoveryToken branch was a collection scan.
CartSchema.index({ recoveryToken: 1 }, { sparse: true });
CartSchema.index({ email: "text", phone: "text", customerName: "text" });

// Sliding TTL: any item activity pushes expiry forward. Without this,
// `expiresAt` was set only at creation, so an actively-used cart still got
// TTL-deleted 30 days after its FIRST item regardless of recent activity.
CartSchema.pre("save", function () {
  if (this.isModified("items")) {
    this.lastActionAt = new Date();
    this.expiresAt = new Date(
      Date.now() + appConfig.cartExpiryDays * 24 * 60 * 60 * 1000,
    );
  }
});

// Virtual for total items
CartSchema.virtual("totalItems").get(function () {
  return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// Virtual for subtotal
CartSchema.virtual("subtotal").get(function () {
  return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
});

export const Cart = models.Cart || model<ICart>("Cart", CartSchema);
