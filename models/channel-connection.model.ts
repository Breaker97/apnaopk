import mongoose, {
  Schema,
  type Document,
  type Model,
  type Types,
} from "mongoose";
import type { EncryptedSecret } from "@/lib/conversations/secret-box";

export const MESSAGE_PROVIDERS = {
  WHATSAPP: "whatsapp",
  MESSENGER: "messenger",
  INSTAGRAM: "instagram",
  TELEGRAM: "telegram",
} as const;

export const CHANNEL_CONNECTION_STATUSES = {
  PENDING: "pending",
  ACTIVE: "active",
  ERROR: "error",
  REVOKED: "revoked",
} as const;

/**
 * Statuses whose INBOUND traffic is still accepted.
 *
 * Receiving does not use the stored credential at all — the profile lookup is
 * fail-soft and media is resolved lazily through the attachment proxy — so a
 * connection whose token has died must keep ingesting. Gating inbound on
 * `active` alone meant an expired token turned the channel into a black hole:
 * the webhook resolved nothing, `continue`d every event, and still answered
 * 2xx, so the provider discarded its redelivery and the customer's message was
 * lost with no record anywhere.
 *
 * `pending` is excluded because such a connection was never verified, and
 * `revoked` because the operator deliberately disconnected it.
 */
export const INBOUND_CONNECTION_STATUSES = [
  CHANNEL_CONNECTION_STATUSES.ACTIVE,
  CHANNEL_CONNECTION_STATUSES.ERROR,
] as const;

export type MessageProvider =
  (typeof MESSAGE_PROVIDERS)[keyof typeof MESSAGE_PROVIDERS];

export interface IChannelConnection extends Document {
  ownerType: "platform" | "vendor";
  ownerKey: string;
  ownerVendorId?: Types.ObjectId;
  provider: MessageProvider;
  status: "pending" | "active" | "error" | "revoked";
  displayName: string;
  externalAccountId?: string;
  businessAccountId?: string;
  phoneNumberId?: string;
  pageId?: string;
  /**
   * Instagram professional account ID. Also the webhook routing key: an
   * `object: "instagram"` payload arrives with this value as `entry[].id`.
   */
  instagramUserId?: string;
  /** Telegram bot's numeric ID, from getMe. Identifies the bot account. */
  telegramBotId?: string;
  /**
   * SHA-256 of the secret handed to Telegram's setWebhook.
   *
   * Telegram signs nothing, so the `X-Telegram-Bot-Api-Secret-Token` header is
   * the only proof an update is genuine — and since the payload never names the
   * receiving bot, that same header is also how the connection is found. Only
   * the hash is stored, exactly like the guest chat cookie: a database read
   * cannot be replayed as a valid webhook.
   */
  telegramWebhookSecretHash?: string;
  publicPhoneNumberE164?: string;
  publicPageUsername?: string;
  /** Instagram handle used for the public ig.me click-to-chat link. */
  publicInstagramUsername?: string;
  /** Bot username used for the public t.me click-to-chat link. */
  publicTelegramUsername?: string;
  messengerHumanAgentEnabled?: boolean;
  /**
   * Absent only on a `revoked` row. Disconnecting keeps the document so its
   * `_id` — which every conversation on the channel references — survives, but
   * a credential the operator asked us to drop must not be retained, so it is
   * unset rather than left encrypted at rest.
   */
  accessTokenEncrypted?: EncryptedSecret;
  tokenExpiresAt?: Date;
  scopes: string[];
  lastVerifiedAt?: Date;
  lastError?: string;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const EncryptedSecretSchema = new Schema<EncryptedSecret>(
  {
    version: { type: Number, enum: [1], required: true },
    algorithm: { type: String, enum: ["aes-256-gcm"], required: true },
    iv: { type: String, required: true },
    ciphertext: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false },
);

const ChannelConnectionSchema = new Schema<IChannelConnection>(
  {
    ownerType: {
      type: String,
      enum: ["platform", "vendor"],
      required: true,
    },
    ownerKey: { type: String, required: true, maxlength: 100 },
    ownerVendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    provider: {
      type: String,
      enum: Object.values(MESSAGE_PROVIDERS),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(CHANNEL_CONNECTION_STATUSES),
      default: CHANNEL_CONNECTION_STATUSES.PENDING,
      required: true,
    },
    displayName: { type: String, required: true, trim: true, maxlength: 160 },
    externalAccountId: { type: String, trim: true, maxlength: 300 },
    businessAccountId: { type: String, trim: true, maxlength: 300 },
    phoneNumberId: { type: String, trim: true, maxlength: 300 },
    pageId: { type: String, trim: true, maxlength: 300 },
    instagramUserId: { type: String, trim: true, maxlength: 300 },
    telegramBotId: { type: String, trim: true, maxlength: 64 },
    telegramWebhookSecretHash: { type: String, minlength: 64, maxlength: 64 },
    publicPhoneNumberE164: { type: String, trim: true, maxlength: 40 },
    publicPageUsername: { type: String, trim: true, maxlength: 120 },
    publicInstagramUsername: { type: String, trim: true, maxlength: 120 },
    publicTelegramUsername: { type: String, trim: true, maxlength: 120 },
    messengerHumanAgentEnabled: { type: Boolean, default: false },
    // Not `required`: a revoked row deliberately carries no credential.
    accessTokenEncrypted: { type: EncryptedSecretSchema },
    tokenExpiresAt: Date,
    scopes: { type: [String], default: [] },
    lastVerifiedAt: Date,
    lastError: { type: String, maxlength: 1000 },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

ChannelConnectionSchema.index({ ownerKey: 1, provider: 1 }, { unique: true });
ChannelConnectionSchema.index(
  { provider: 1, phoneNumberId: 1 },
  {
    unique: true,
    partialFilterExpression: { phoneNumberId: { $type: "string" } },
  },
);
ChannelConnectionSchema.index(
  { provider: 1, pageId: 1 },
  {
    unique: true,
    partialFilterExpression: { pageId: { $type: "string" } },
  },
);
// Webhook routing key for `object: "instagram"` payloads, and the guard that
// stops one Instagram account being connected to two owners.
ChannelConnectionSchema.index(
  { provider: 1, instagramUserId: 1 },
  {
    unique: true,
    partialFilterExpression: { instagramUserId: { $type: "string" } },
  },
);

ChannelConnectionSchema.index(
  { provider: 1, telegramBotId: 1 },
  {
    unique: true,
    partialFilterExpression: { telegramBotId: { $type: "string" } },
  },
);
// The webhook's only routing key: an update names the chat, never the bot.
ChannelConnectionSchema.index(
  { telegramWebhookSecretHash: 1 },
  {
    unique: true,
    partialFilterExpression: { telegramWebhookSecretHash: { $type: "string" } },
  },
);

export const ChannelConnection: Model<IChannelConnection> =
  mongoose.models.ChannelConnection ||
  mongoose.model<IChannelConnection>(
    "ChannelConnection",
    ChannelConnectionSchema,
  );
