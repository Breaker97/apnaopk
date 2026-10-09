import mongoose, {
  Schema,
  type Document,
  type Model,
  type Types,
} from "mongoose";
import {
  MESSAGE_PROVIDERS,
  type MessageProvider,
} from "@/models/channel-connection.model";

interface IMessageOutbox extends Document {
  conversationId: Types.ObjectId;
  messageId: Types.ObjectId;
  channelConnectionId: Types.ObjectId;
  provider: MessageProvider;
  status: "pending" | "processing" | "sent" | "failed";
  attempts: number;
  nextAttemptAt: Date;
  leaseUntil?: Date;
  providerMessageId?: string;
  lastError?: string;
  /**
   * Set only once a row reaches a terminal state, so a live queue entry is
   * never reaped. A per-row date (rather than a TTL over `updatedAt`) lets a
   * delivered row expire quickly while a dead-lettered one is retained long
   * enough for the failed-delivery dashboard.
   */
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MessageOutboxSchema = new Schema<IMessageOutbox>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    messageId: {
      type: Schema.Types.ObjectId,
      ref: "ConversationMessage",
      required: true,
    },
    channelConnectionId: {
      type: Schema.Types.ObjectId,
      ref: "ChannelConnection",
      required: true,
    },
    provider: {
      type: String,
      // Derived, so adding a provider cannot leave the queue rejecting it.
      enum: Object.values(MESSAGE_PROVIDERS),
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "sent", "failed"],
      required: true,
      default: "pending",
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, default: Date.now, required: true },
    leaseUntil: Date,
    providerMessageId: { type: String, maxlength: 500 },
    lastError: { type: String, maxlength: 2000 },
    expiresAt: Date,
  },
  { timestamps: true },
);

MessageOutboxSchema.index({ messageId: 1 }, { unique: true });
MessageOutboxSchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
// Serves the failed-delivery dashboard's { updatedAt: -1, _id: -1 } sort, which
// otherwise sorted the whole failed set in memory before $limit.
MessageOutboxSchema.index({ status: 1, updatedAt: -1, _id: -1 });
// Terminal rows self-reap; `expiresAt` is absent while a row is still live, and
// TTL indexes ignore documents where the field is missing.
MessageOutboxSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MessageOutbox: Model<IMessageOutbox> =
  mongoose.models.MessageOutbox ||
  mongoose.model<IMessageOutbox>("MessageOutbox", MessageOutboxSchema);
