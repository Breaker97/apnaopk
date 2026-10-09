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

interface IConversationChannelIdentity {
  channel: ConversationChannel;
  channelConnectionId?: Types.ObjectId;
  externalId: string;
  displayValue?: string;
  verifiedAt?: Date;
}

interface IConversationContact extends Document {
  userId?: Types.ObjectId;
  guestKeyHash?: string;
  name: string;
  email?: string;
  phone?: string;
  image?: string;
  channelIdentities: IConversationChannelIdentity[];
  createdAt: Date;
  updatedAt: Date;
}

const ChannelIdentitySchema = new Schema<IConversationChannelIdentity>(
  {
    channel: {
      type: String,
      // Derived, so a new channel cannot be added without this accepting it.
      enum: Object.values(CONVERSATION_CHANNELS),
      required: true,
    },
    channelConnectionId: {
      type: Schema.Types.ObjectId,
      ref: "ChannelConnection",
    },
    externalId: { type: String, required: true, trim: true, maxlength: 500 },
    displayValue: { type: String, trim: true, maxlength: 320 },
    verifiedAt: Date,
  },
  { _id: false },
);

const ConversationContactSchema = new Schema<IConversationContact>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guestKeyHash: { type: String, minlength: 64, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true, maxlength: 320 },
    phone: { type: String, trim: true, maxlength: 40 },
    image: { type: String, maxlength: 2000 },
    channelIdentities: { type: [ChannelIdentitySchema], default: [] },
  },
  { timestamps: true },
);

ConversationContactSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { userId: { $type: "objectId" } },
  },
);
ConversationContactSchema.index(
  { guestKeyHash: 1 },
  {
    unique: true,
    partialFilterExpression: { guestKeyHash: { $type: "string" } },
  },
);
// Partial, like every other unique index here: live-chat contacts carry an
// empty `channelIdentities`, and an unfiltered unique index keys those as
// (null, null) — so the second identity-less contact would collide.
ConversationContactSchema.index(
  {
    "channelIdentities.channelConnectionId": 1,
    "channelIdentities.externalId": 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      "channelIdentities.externalId": { $type: "string" },
    },
  },
);

export const ConversationContact: Model<IConversationContact> =
  mongoose.models.ConversationContact ||
  mongoose.model<IConversationContact>(
    "ConversationContact",
    ConversationContactSchema,
  );
