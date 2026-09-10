import mongoose, {
  Schema,
  type Document,
  type Model,
  type Types,
} from "mongoose";

export const CONVERSATION_PARTICIPANT_SIDES = {
  CUSTOMER: "customer",
  STORE: "store",
} as const;

export const CONVERSATION_PARTICIPANT_TYPES = {
  CUSTOMER: "customer",
  GUEST: "guest",
  VENDOR: "vendor",
  STAFF: "staff",
  ADMIN: "admin",
} as const;

interface IConversationParticipant extends Document {
  conversationId: Types.ObjectId;
  side: "customer" | "store";
  participantType: "customer" | "guest" | "vendor" | "staff" | "admin";
  userId?: Types.ObjectId;
  guestKeyHash?: string;
  lastReadMessageId?: Types.ObjectId;
  lastReadAt?: Date;
  notificationMuted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ConversationParticipantSchema = new Schema<IConversationParticipant>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    side: {
      type: String,
      enum: Object.values(CONVERSATION_PARTICIPANT_SIDES),
      required: true,
    },
    participantType: {
      type: String,
      enum: Object.values(CONVERSATION_PARTICIPANT_TYPES),
      required: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guestKeyHash: { type: String, minlength: 64, maxlength: 64 },
    lastReadMessageId: {
      type: Schema.Types.ObjectId,
      ref: "ConversationMessage",
    },
    lastReadAt: Date,
    notificationMuted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ConversationParticipantSchema.index({ conversationId: 1, side: 1 });
ConversationParticipantSchema.index(
  { conversationId: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { userId: { $type: "objectId" } },
  },
);
ConversationParticipantSchema.index(
  { conversationId: 1, guestKeyHash: 1 },
  {
    unique: true,
    partialFilterExpression: { guestKeyHash: { $type: "string" } },
  },
);

export const ConversationParticipant: Model<IConversationParticipant> =
  mongoose.models.ConversationParticipant ||
  mongoose.model<IConversationParticipant>(
    "ConversationParticipant",
    ConversationParticipantSchema,
  );
