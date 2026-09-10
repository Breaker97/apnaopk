import mongoose, {
  Schema,
  type Document,
  type Model,
  type Types,
} from "mongoose";

export const CONVERSATION_CHANNELS = {
  LIVE_CHAT: "live_chat",
  WHATSAPP: "whatsapp",
  MESSENGER: "messenger",
  INSTAGRAM: "instagram",
  TELEGRAM: "telegram",
} as const;

export const CONVERSATION_OWNER_TYPES = {
  PLATFORM: "platform",
  VENDOR: "vendor",
} as const;

export const CONVERSATION_STATUSES = {
  OPEN: "open",
  PENDING: "pending",
  RESOLVED: "resolved",
  CLOSED: "closed",
  SPAM: "spam",
} as const;

export type ConversationChannel =
  (typeof CONVERSATION_CHANNELS)[keyof typeof CONVERSATION_CHANNELS];
type ConversationOwnerType =
  (typeof CONVERSATION_OWNER_TYPES)[keyof typeof CONVERSATION_OWNER_TYPES];
type ConversationStatus =
  (typeof CONVERSATION_STATUSES)[keyof typeof CONVERSATION_STATUSES];

interface IConversationContactSnapshot {
  name: string;
  email?: string;
  phone?: string;
  image?: string;
}

interface IConversationProductContext {
  productId: Types.ObjectId;
  vendorId?: Types.ObjectId;
  name: string;
  slug: string;
  image?: string;
  variantId?: Types.ObjectId;
  variantName?: string;
}

export interface IConversation extends Document {
  channel: ConversationChannel;
  ownerType: ConversationOwnerType;
  ownerVendorId?: Types.ObjectId;
  channelConnectionId?: Types.ObjectId;
  contactId: Types.ObjectId;
  customerUserId?: Types.ObjectId;
  guestKeyHash?: string;
  contact: IConversationContactSnapshot;
  subject: string;
  status: ConversationStatus;
  assignedToUserId?: Types.ObjectId;
  legacySource?: "support";
  legacyConversationId?: Types.ObjectId;
  productContext?: IConversationProductContext;
  externalThreadId?: string;
  activeKey?: string;
  lastMessageId?: Types.ObjectId;
  lastMessagePreview: string;
  lastMessageAt: Date;
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
  replyWindowExpiresAt?: Date;
  humanAgentWindowExpiresAt?: Date;
  escalationNotifiedAt?: Date;
  unreadForCustomer: number;
  unreadForStore: number;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSnapshotSchema = new Schema<IConversationContactSnapshot>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 320 },
    phone: { type: String, trim: true, maxlength: 40 },
    image: { type: String, maxlength: 2000 },
  },
  { _id: false },
);

const ProductContextSchema = new Schema<IConversationProductContext>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    name: { type: String, required: true, trim: true, maxlength: 240 },
    slug: { type: String, required: true, trim: true, maxlength: 240 },
    image: { type: String, maxlength: 2000 },
    variantId: { type: Schema.Types.ObjectId },
    variantName: { type: String, trim: true, maxlength: 160 },
  },
  { _id: false },
);

const ConversationSchema = new Schema<IConversation>(
  {
    channel: {
      type: String,
      enum: Object.values(CONVERSATION_CHANNELS),
      required: true,
      index: true,
    },
    ownerType: {
      type: String,
      enum: Object.values(CONVERSATION_OWNER_TYPES),
      required: true,
    },
    ownerVendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    channelConnectionId: {
      type: Schema.Types.ObjectId,
      ref: "ChannelConnection",
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: "ConversationContact",
      required: true,
    },
    customerUserId: { type: Schema.Types.ObjectId, ref: "User" },
    // SHA-256 of the high-entropy HttpOnly cookie. The bearer value itself is
    // never stored, so a database read cannot be turned into a guest session.
    guestKeyHash: { type: String, minlength: 64, maxlength: 64 },
    contact: { type: ContactSnapshotSchema, required: true },
    subject: { type: String, required: true, trim: true, maxlength: 180 },
    status: {
      type: String,
      enum: Object.values(CONVERSATION_STATUSES),
      default: CONVERSATION_STATUSES.OPEN,
      required: true,
    },
    assignedToUserId: { type: Schema.Types.ObjectId, ref: "User" },
    legacySource: { type: String, enum: ["support"] },
    legacyConversationId: { type: Schema.Types.ObjectId },
    productContext: { type: ProductContextSchema },
    externalThreadId: { type: String, trim: true, maxlength: 500 },
    // Present only while a thread is active. A sparse unique index prevents two
    // concurrent "start chat" requests from creating duplicate open threads.
    activeKey: { type: String, trim: true, maxlength: 64 },
    lastMessageId: { type: Schema.Types.ObjectId, ref: "ConversationMessage" },
    lastMessagePreview: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    lastMessageAt: { type: Date, required: true, default: Date.now },
    lastInboundAt: Date,
    lastOutboundAt: Date,
    replyWindowExpiresAt: Date,
    humanAgentWindowExpiresAt: Date,
    escalationNotifiedAt: Date,
    unreadForCustomer: { type: Number, default: 0, min: 0 },
    unreadForStore: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// Inbox list access paths. `listConversations` sorts by
// { lastMessageAt: -1, _id: -1 }, and MongoDB can only serve a sort from an
// index that covers the WHOLE sort pattern — hence the trailing `_id: -1` on
// every one of these. Each viewer kind gets the equality prefix it filters on,
// with and without the optional `status` narrowing, so no inbox query falls
// back to a collection scan plus a blocking in-memory sort every SSE tick.
ConversationSchema.index({ lastMessageAt: -1, _id: -1 });
ConversationSchema.index({ status: 1, lastMessageAt: -1, _id: -1 });
ConversationSchema.index({ ownerVendorId: 1, lastMessageAt: -1, _id: -1 });
ConversationSchema.index({
  ownerVendorId: 1,
  status: 1,
  lastMessageAt: -1,
  _id: -1,
});
ConversationSchema.index({ customerUserId: 1, lastMessageAt: -1, _id: -1 });
ConversationSchema.index({ guestKeyHash: 1, lastMessageAt: -1, _id: -1 });
ConversationSchema.index({ ownerType: 1, status: 1, lastMessageAt: -1, _id: -1 });
ConversationSchema.index({ status: 1, escalationNotifiedAt: 1, lastInboundAt: 1 });
ConversationSchema.index({ contactId: 1, channel: 1, lastMessageAt: -1 });
ConversationSchema.index(
  { channelConnectionId: 1, externalThreadId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      channelConnectionId: { $type: "objectId" },
      externalThreadId: { $type: "string" },
    },
  },
);
ConversationSchema.index(
  { activeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { activeKey: { $type: "string" } },
  },
);
ConversationSchema.index(
  { legacySource: 1, legacyConversationId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      legacySource: { $type: "string" },
      legacyConversationId: { $type: "objectId" },
    },
  },
);

export const Conversation: Model<IConversation> =
  mongoose.models.Conversation ||
  mongoose.model<IConversation>("Conversation", ConversationSchema);
