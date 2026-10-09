import mongoose, {
  Schema,
  type Document,
  type Model,
  type Types,
} from "mongoose";
import {
  CONVERSATION_CHANNELS,
  type ConversationChannel,
} from "@/models/conversation.model";

export const CONVERSATION_MESSAGE_DIRECTIONS = {
  INBOUND: "inbound",
  OUTBOUND: "outbound",
  INTERNAL: "internal",
} as const;

export const CONVERSATION_MESSAGE_SENDER_TYPES = {
  CUSTOMER: "customer",
  GUEST: "guest",
  VENDOR: "vendor",
  STAFF: "staff",
  ADMIN: "admin",
  SYSTEM: "system",
} as const;

export const CONVERSATION_MESSAGE_STATUSES = {
  QUEUED: "queued",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
} as const;

type ConversationMessageDirection =
  (typeof CONVERSATION_MESSAGE_DIRECTIONS)[keyof typeof CONVERSATION_MESSAGE_DIRECTIONS];
type ConversationMessageSenderType =
  (typeof CONVERSATION_MESSAGE_SENDER_TYPES)[keyof typeof CONVERSATION_MESSAGE_SENDER_TYPES];
type ConversationMessageStatus =
  (typeof CONVERSATION_MESSAGE_STATUSES)[keyof typeof CONVERSATION_MESSAGE_STATUSES];

export interface IConversationAttachment {
  type: "image" | "video" | "audio" | "document";
  url?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  providerMediaId?: string;
}

/**
 * A product shared in a message, as it was when it was sent: the card the
 * thread shows keeps its name, picture and price after the product changes
 * or is gone. The message's `body` carries the product's name and link when
 * nothing was written with it, which is all an external channel (WhatsApp,
 * Messenger…) sends.
 */
export interface IConversationMessageProduct {
  productId: Types.ObjectId;
  name: string;
  slug: string;
  imageUrl?: string;
  variantName?: string;
  /** The price shown when it was sent; absent for a price-on-request product. */
  price?: number;
  compareAtPrice?: number;
  /** The store's currency code the prices are in. */
  currency?: string;
}

export interface IConversationMessage extends Document {
  conversationId: Types.ObjectId;
  channel: ConversationChannel;
  direction: ConversationMessageDirection;
  senderType: ConversationMessageSenderType;
  senderUserId?: Types.ObjectId;
  senderName: string;
  body: string;
  attachments: IConversationAttachment[];
  product?: IConversationMessageProduct;
  /**
   * The body is the product's name and link, written for the sender (nothing
   * was typed with the product). A client that shows the product's card
   * hides it; every other reader still has text.
   */
  bodyIsFallback?: boolean;
  clientMessageId?: string;
  providerMessageId?: string;
  providerMetadata?: Record<string, unknown>;
  deliveryStatus: ConversationMessageStatus;
  replyToMessageId?: Types.ObjectId;
  errorCode?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AttachmentSchema = new Schema<IConversationAttachment>(
  {
    type: {
      type: String,
      enum: ["image", "video", "audio", "document"],
      required: true,
    },
    url: { type: String, maxlength: 2000 },
    name: { type: String, trim: true, maxlength: 255 },
    mimeType: { type: String, trim: true, maxlength: 160 },
    size: { type: Number, min: 0 },
    providerMediaId: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const MessageProductSchema = new Schema<IConversationMessageProduct>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true, trim: true, maxlength: 500 },
    slug: { type: String, required: true, trim: true, maxlength: 500 },
    imageUrl: { type: String, maxlength: 2000 },
    variantName: { type: String, trim: true, maxlength: 160 },
    price: { type: Number, min: 0 },
    compareAtPrice: { type: Number, min: 0 },
    currency: { type: String, trim: true, maxlength: 10 },
  },
  { _id: false },
);

const ConversationMessageSchema = new Schema<IConversationMessage>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    channel: {
      type: String,
      enum: Object.values(CONVERSATION_CHANNELS),
      required: true,
    },
    direction: {
      type: String,
      enum: Object.values(CONVERSATION_MESSAGE_DIRECTIONS),
      required: true,
    },
    senderType: {
      type: String,
      enum: Object.values(CONVERSATION_MESSAGE_SENDER_TYPES),
      required: true,
    },
    senderUserId: { type: Schema.Types.ObjectId, ref: "User" },
    senderName: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: "", maxlength: 4000 },
    attachments: { type: [AttachmentSchema], default: [] },
    product: { type: MessageProductSchema, default: undefined },
    bodyIsFallback: { type: Boolean, default: false },
    clientMessageId: { type: String, trim: true, maxlength: 100 },
    providerMessageId: { type: String, trim: true, maxlength: 500 },
    providerMetadata: { type: Schema.Types.Mixed },
    deliveryStatus: {
      type: String,
      enum: Object.values(CONVERSATION_MESSAGE_STATUSES),
      default: CONVERSATION_MESSAGE_STATUSES.SENT,
      required: true,
    },
    replyToMessageId: {
      type: Schema.Types.ObjectId,
      ref: "ConversationMessage",
    },
    errorCode: { type: String, trim: true, maxlength: 120 },
    errorMessage: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

ConversationMessageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
ConversationMessageSchema.index({ conversationId: 1, _id: 1 });
ConversationMessageSchema.index({ conversationId: 1, updatedAt: -1 });
ConversationMessageSchema.index(
  { conversationId: 1, clientMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientMessageId: { $type: "string" } },
  },
);
ConversationMessageSchema.index(
  { channel: 1, providerMessageId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerMessageId: { $type: "string" } },
  },
);

export const ConversationMessage: Model<IConversationMessage> =
  mongoose.models.ConversationMessage ||
  mongoose.model<IConversationMessage>(
    "ConversationMessage",
    ConversationMessageSchema,
  );
