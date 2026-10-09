/**
 * Push Subscription Model
 *
 * One row per device a user can be reached on. Two kinds live here:
 *
 * - `web`  — a browser Web Push subscription, keyed by its `endpoint` and
 *            carrying the VAPID `keys` needed to encrypt a message to it.
 * - `ios` / `android` — a native app install, keyed by the `deviceToken` its
 *            push service issued. No endpoint, no keys.
 *
 * They share a collection because everything above the transport is the same:
 * which user to reach, in which locale, and whether the registration is still
 * good. Only the delivery step differs, and `lib/push-notifications.ts`
 * branches on `platform` to pick it.
 *
 * A native install also says which of the store's apps it is (`app`): the
 * shopper app hears what a customer hears, the business app (later) what the
 * store's people hear (lib/notifications/notification-app.ts).
 */

import mongoose, { Schema, Document, Model } from "mongoose";

type PushPlatform = "web" | "ios" | "android";
type PushApp = "shop" | "biz";

interface IPushSubscription extends Document {
  userId: string;
  role?: string;
  platform: PushPlatform;
  /** Web only: the browser's push endpoint. */
  endpoint?: string;
  expirationTime?: number | null;
  /** Web only: VAPID encryption keys for `endpoint`. */
  keys?: {
    p256dh: string;
    auth: string;
  };
  /** Native only: the token the device's push service issued. */
  deviceToken?: string;
  /**
   * Native only: which app the install is. Missing on an install registered
   * before the field existed, which is the shopper app's (the `push`
   * migration writes it).
   */
  app?: PushApp;
  /**
   * Native only: the sign-in that registered it. Revoking that session
   * (lib/auth/session-revocation.ts) stops the device's notifications.
   */
  sessionId?: string;
  locale?: string;
  userAgent?: string;
  isActive: boolean;
  lastSeenAt: Date;
  failedAt?: Date;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: {
      type: String,
      required: true,
    },
    role: {
      type: String,
    },
    platform: {
      type: String,
      enum: ["web", "ios", "android"],
      default: "web",
      index: true,
    },
    endpoint: {
      type: String,
    },
    deviceToken: {
      type: String,
    },
    app: {
      type: String,
      enum: ["shop", "biz"],
    },
    sessionId: {
      type: String,
    },
    expirationTime: {
      type: Number,
      default: null,
    },
    keys: {
      p256dh: { type: String },
      auth: { type: String },
    },
    locale: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSeenAt: {
      type: Date,
      default: () => new Date(),
    },
    failedAt: {
      type: Date,
    },
    failureReason: {
      type: String,
      maxlength: 500,
    },
  },
  {
    timestamps: true,
  },
);

PushSubscriptionSchema.index({ userId: 1, isActive: 1, updatedAt: -1 });

// Partial uniqueness per transport. A plain unique index on either key would
// treat every row of the *other* kind as a duplicate null.
PushSubscriptionSchema.index(
  { endpoint: 1 },
  { unique: true, partialFilterExpression: { endpoint: { $type: "string" } } },
);
PushSubscriptionSchema.index(
  { deviceToken: 1 },
  { unique: true, partialFilterExpression: { deviceToken: { $type: "string" } } },
);

export const PushSubscription: Model<IPushSubscription> =
  mongoose.models.PushSubscription ||
  mongoose.model<IPushSubscription>(
    "PushSubscription",
    PushSubscriptionSchema,
  );
