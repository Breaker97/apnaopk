import { Types } from "mongoose";
import type { MessageProvider } from "@/models/channel-connection.model";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { ConversationMessage, MessageOutbox } from "@/models";
import type { ConversationViewer } from "@/lib/conversations/types";
import {
  assertStoreConversationPermission,
  isStoreViewer,
} from "@/lib/conversations/viewer";
import { assertConversationAccess } from "@/lib/conversations/service";
import { processQueuedMessageNow } from "@/lib/conversations/providers/outbox";
import { CONVERSATION_MESSAGE_STATUSES } from "@/models/conversation-message.model";

interface FailureAggregationRow {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  messageId: Types.ObjectId;
  provider: MessageProvider;
  status: "failed";
  attempts: number;
  nextAttemptAt: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
  conversation: {
    contact?: { name?: string };
    subject?: string;
    ownerVendorId?: Types.ObjectId;
  };
  message: {
    body?: string;
    deliveryStatus?: string;
    createdAt?: Date;
  };
}

function requireStoreViewer(viewer: ConversationViewer) {
  if (!isStoreViewer(viewer)) {
    throw new AuthorizationError(
      "Only store users can manage provider deliveries",
    );
  }
}

export async function listFailedDeliveries(params: {
  viewer: ConversationViewer;
  limit?: number;
}) {
  requireStoreViewer(params.viewer);
  if (params.viewer.kind === "vendor" || params.viewer.kind === "staff") {
    assertStoreConversationPermission(params.viewer, "view");
  }
  const limit = Math.min(Math.max(params.limit || 50, 1), 100);
  const vendorIds =
    params.viewer.kind === "vendor"
      ? [new Types.ObjectId(params.viewer.vendorId)]
      : params.viewer.kind === "staff"
        ? params.viewer.vendorIds.map((vendorId) => new Types.ObjectId(vendorId))
        : [];
  const rows = await MessageOutbox.aggregate<FailureAggregationRow>([
    { $match: { status: "failed" } },
    { $sort: { updatedAt: -1, _id: -1 } },
    {
      $lookup: {
        from: "conversations",
        localField: "conversationId",
        foreignField: "_id",
        as: "conversation",
      },
    },
    { $unwind: "$conversation" },
    ...(vendorIds.length
      ? [
          {
            $match: {
              "conversation.ownerVendorId": { $in: vendorIds },
            },
          },
        ]
      : []),
    {
      $lookup: {
        from: "conversationmessages",
        localField: "messageId",
        foreignField: "_id",
        as: "message",
      },
    },
    { $unwind: "$message" },
    { $limit: limit },
  ]);
  return rows.map((row) => ({
    _id: String(row._id),
    conversationId: String(row.conversationId),
    messageId: String(row.messageId),
    provider: row.provider,
    attempts: row.attempts,
    nextAttemptAt: new Date(row.nextAttemptAt).toISOString(),
    lastError: row.lastError,
    deadLetter:
      row.attempts >= 8 ||
      new Date(row.nextAttemptAt).getUTCFullYear() >= 9999,
    contactName: row.conversation.contact?.name || "Customer",
    subject: row.conversation.subject || "Conversation",
    messagePreview: row.message.body?.slice(0, 240) || "Attachment",
    deliveryStatus: row.message.deliveryStatus || "failed",
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}

export async function retryFailedDelivery(params: {
  viewer: ConversationViewer;
  outboxId: string;
}) {
  requireStoreViewer(params.viewer);
  if (params.viewer.kind === "vendor" || params.viewer.kind === "staff") {
    assertStoreConversationPermission(params.viewer, "reply");
  }
  if (!Types.ObjectId.isValid(params.outboxId)) {
    throw new ValidationError("Delivery is invalid");
  }
  const outbox = await MessageOutbox.findOne({
    _id: new Types.ObjectId(params.outboxId),
    status: "failed",
  });
  if (!outbox) throw new NotFoundError("Failed delivery");
  await assertConversationAccess(String(outbox.conversationId), params.viewer);
  const message = await ConversationMessage.findById(outbox.messageId);
  if (!message) throw new NotFoundError("Message");

  await Promise.all([
    MessageOutbox.updateOne(
      { _id: outbox._id, status: "failed" },
      {
        $set: {
          status: "pending",
          attempts: 0,
          nextAttemptAt: new Date(),
        },
        $unset: { leaseUntil: "", lastError: "", providerMessageId: "" },
      },
    ),
    ConversationMessage.updateOne(
      { _id: message._id },
      {
        $set: {
          deliveryStatus: CONVERSATION_MESSAGE_STATUSES.QUEUED,
        },
        $unset: { errorCode: "", errorMessage: "", providerMessageId: "" },
      },
    ),
  ]);
  const result = await processQueuedMessageNow(message._id);
  const [nextOutbox, nextMessage] = await Promise.all([
    MessageOutbox.findById(outbox._id).lean(),
    ConversationMessage.findById(message._id).lean(),
  ]);
  return {
    processed: result.processed,
    sent: result.sent,
    delivery: nextOutbox
      ? {
          _id: String(nextOutbox._id),
          status: nextOutbox.status,
          attempts: nextOutbox.attempts,
          nextAttemptAt: nextOutbox.nextAttemptAt.toISOString(),
          lastError: nextOutbox.lastError,
        }
      : undefined,
    messageStatus: nextMessage?.deliveryStatus,
  };
}
