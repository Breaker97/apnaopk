import { createHash } from "node:crypto";
import { Types, type UpdateQuery } from "mongoose";
import {
  PRODUCT_STATUS,
  USER_ACCOUNT_STATUS,
  USER_ROLES,
  VENDOR_STATUS,
} from "@/config/app.config";
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { afterResponse } from "@/lib/after-response";
import { createNotification } from "@/lib/notifications/notifications";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import {
  Conversation,
  ConversationContact,
  ConversationMessage,
  ConversationParticipant,
  ChannelConnection,
  MessageOutbox,
  Product,
  StaffProfile,
  User,
  Vendor,
} from "@/models";
import {
  CHANNEL_CONNECTION_STATUSES,
} from "@/models/channel-connection.model";
import {
  CONVERSATION_CHANNELS,
  CONVERSATION_OWNER_TYPES,
  CONVERSATION_STATUSES,
  type IConversation,
} from "@/models/conversation.model";
import {
  CONVERSATION_MESSAGE_DIRECTIONS,
  CONVERSATION_MESSAGE_SENDER_TYPES,
  CONVERSATION_MESSAGE_STATUSES,
  type IConversationMessage,
  type IConversationAttachment,
} from "@/models/conversation-message.model";
import {
  CONVERSATION_PARTICIPANT_SIDES,
  CONVERSATION_PARTICIPANT_TYPES,
} from "@/models/conversation-participant.model";
import { NotificationType } from "@/models/notification.model";
import type {
  ConversationDTO,
  ConversationMessageDTO,
  ConversationQuery,
  ConversationTarget,
  ConversationViewer,
} from "@/lib/conversations/types";
import {
  assertStoreConversationPermission,
  isStoreViewer,
} from "@/lib/conversations/viewer";
import {
  channelCapability,
  channelProvider,
  isExternalChannel,
  supportsTemplates,
} from "@/lib/conversations/channels";
import { resolveVendorMessaging } from "@/lib/notifications/vendor-messaging";
import {
  processQueuedMessageNow,
  queueExternalMessage,
} from "@/lib/conversations/providers/outbox";
import {
  compileWhatsAppTemplate,
  getApprovedWhatsAppTemplate,
  listApprovedWhatsAppTemplates,
} from "@/lib/conversations/providers/whatsapp-templates";
import {
  markMessengerPlatformSeen,
  markWhatsAppMessageRead,
} from "@/lib/conversations/providers/meta-client";
import { getPlatformMessagingConfiguration } from "@/lib/notifications/platform-messaging";

const ACTIVE_STATUSES = [
  CONVERSATION_STATUSES.OPEN,
  CONVERSATION_STATUSES.PENDING,
] as const;

function id(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  const candidate = value as {
    _id?: unknown;
    toHexString?: () => string;
    toString?: () => string;
  };
  if (typeof candidate.toHexString === "function") return candidate.toHexString();
  if (candidate._id && candidate._id !== value) return id(candidate._id);
  const text = candidate.toString?.();
  return text && text !== "[object Object]" ? text : "";
}

function objectId(value: string, label: string) {
  if (!Types.ObjectId.isValid(value)) {
    throw new ValidationError(`${label} is invalid`);
  }
  return new Types.ObjectId(value);
}

export function normalizeConversationText(value: string, maxLength = 4000) {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  if (!normalized) throw new ValidationError("Message is required");
  if (normalized.length > maxLength) {
    throw new ValidationError(`Message cannot exceed ${maxLength} characters`);
  }
  return normalized;
}

function normalizeConversationAttachments(
  attachments: IConversationAttachment[] | undefined,
) {
  if (!attachments?.length) return [];
  if (attachments.length > 4) {
    throw new ValidationError("A message can contain up to 4 attachments");
  }
  return attachments.map((attachment) => {
    if (
      !["image", "video", "audio", "document"].includes(attachment.type)
    ) {
      throw new ValidationError("Attachment type is invalid");
    }
    const url = attachment.url?.trim();
    if (!url || url.length > 2000) {
      throw new ValidationError("Attachment URL is invalid");
    }
    if (!(url.startsWith("/") || /^https:\/\//i.test(url))) {
      throw new ValidationError("Attachment URL must be HTTPS or same-origin");
    }
    return {
      type: attachment.type,
      url,
      name: attachment.name?.trim().slice(0, 255) || undefined,
      mimeType: attachment.mimeType?.trim().slice(0, 160) || undefined,
      size:
        typeof attachment.size === "number" && attachment.size >= 0
          ? attachment.size
          : undefined,
    };
  });
}

function preview(value: string, maxLength = 240) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= maxLength
    ? clean
    : `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

function date(value: unknown) {
  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString();
}

export function getConversationAccessQuery(
  viewer: ConversationViewer,
): ConversationQuery {
  if (viewer.kind === "admin") return {};
  if (viewer.kind === "vendor") {
    return { ownerVendorId: objectId(viewer.vendorId, "Vendor") };
  }
  if (viewer.kind === "staff") {
    // No vendor scope means platform staff, which lib/staff-scope.ts treats as
    // unscoped rather than as access to nothing.
    //
    // Read that consequence plainly before granting the role: an unscoped staff
    // member with `view_inbox` sees EVERY vendor's customer conversations, the
    // same as an admin. That is deliberate — it is what a platform support desk
    // needs — but on a marketplace it is a real disclosure, so a staff member
    // who should only see one seller's threads must be given `vendorIds`.
    if (!viewer.vendorIds.length) return {};
    return {
      ownerVendorId: {
        $in: viewer.vendorIds.map((vendorId) =>
          objectId(vendorId, "Vendor"),
        ),
      },
    };
  }
  if (viewer.kind === "customer") {
    return { customerUserId: objectId(viewer.userId, "Customer") };
  }
  return { guestKeyHash: viewer.guestKeyHash };
}

export function serializeConversation(
  conversation: IConversation | Record<string, unknown>,
  viewer: ConversationViewer,
): ConversationDTO {
  const doc = conversation as IConversation & {
    _id: unknown;
    ownerVendorId?: unknown;
    lastMessageId?: unknown;
    createdAt: Date;
    updatedAt: Date;
    ownerVendor?: { storeName?: string };
    assignedToUserId?:
      | unknown
      | { _id?: unknown; name?: string; image?: string };
  };
  const context = doc.productContext;
  const storeViewer = isStoreViewer(viewer);
  const populatedOwner =
    doc.ownerVendorId &&
    typeof doc.ownerVendorId === "object" &&
    "storeName" in doc.ownerVendorId
      ? (doc.ownerVendorId as { storeName?: string })
      : undefined;

  return {
    _id: id(doc._id),
    channel: doc.channel,
    ownerType: doc.ownerType,
    ownerVendorId: id(doc.ownerVendorId) || undefined,
    ownerName: doc.ownerVendor?.storeName || populatedOwner?.storeName,
    contact: {
      name: doc.contact.name,
      email: doc.contact.email,
      phone: doc.contact.phone,
      image: doc.contact.image,
    },
    subject: doc.subject,
    status: doc.status,
    assignedTo: doc.assignedToUserId
      ? {
          userId: id(doc.assignedToUserId),
          name:
            typeof doc.assignedToUserId === "object" &&
            doc.assignedToUserId !== null &&
            "name" in doc.assignedToUserId
              ? String(doc.assignedToUserId.name || "Assigned agent")
              : "Assigned agent",
          image:
            typeof doc.assignedToUserId === "object" &&
            doc.assignedToUserId !== null &&
            "image" in doc.assignedToUserId
              ? String(doc.assignedToUserId.image || "") || undefined
              : undefined,
        }
      : undefined,
    productContext: context
      ? {
          productId: id(context.productId),
          vendorId: id(context.vendorId) || undefined,
          name: context.name,
          slug: context.slug,
          image: context.image,
          variantId: id(context.variantId) || undefined,
          variantName: context.variantName,
        }
      : undefined,
    lastMessageId: id(doc.lastMessageId) || undefined,
    lastMessagePreview: doc.lastMessagePreview,
    lastMessageAt: date(doc.lastMessageAt),
    replyWindowExpiresAt: doc.replyWindowExpiresAt
      ? date(doc.replyWindowExpiresAt)
      : undefined,
    humanAgentWindowExpiresAt: doc.humanAgentWindowExpiresAt
      ? date(doc.humanAgentWindowExpiresAt)
      : undefined,
    unreadCount: storeViewer ? doc.unreadForStore : doc.unreadForCustomer,
    unreadForCustomer: doc.unreadForCustomer,
    unreadForStore: doc.unreadForStore,
    createdAt: date(doc.createdAt),
    updatedAt: date(doc.updatedAt),
  };
}

export function serializeConversationMessage(
  message: IConversationMessage | Record<string, unknown>,
): ConversationMessageDTO {
  const doc = message as IConversationMessage & {
    _id: unknown;
    conversationId: unknown;
    senderUserId?: unknown;
  };
  return {
    _id: id(doc._id),
    conversationId: id(doc.conversationId),
    channel: doc.channel,
    direction: doc.direction,
    senderType: doc.senderType,
    senderUserId: id(doc.senderUserId) || undefined,
    senderName: doc.senderName,
    body: doc.body,
    attachments: (doc.attachments || []).map((attachment, index) => ({
      type: attachment.type,
      url:
        attachment.url ||
        `/api/chat/messages/${id(doc._id)}/attachments/${index}`,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
    })),
    deliveryStatus: doc.deliveryStatus,
    messageKind:
      (
        doc.providerMetadata as
          | { kind?: "whatsapp_template" }
          | undefined
      )?.kind === "whatsapp_template"
        ? "whatsapp_template"
        : undefined,
    errorMessage: doc.errorMessage,
    createdAt: date(doc.createdAt),
    updatedAt: date(doc.updatedAt),
  };
}

async function resolveTarget(params: {
  productId?: string;
  vendorId?: string;
  variantId?: string;
  variantName?: string;
  /**
   * Live-chat availability gates whether a *storefront chat widget* may open a
   * thread. Callers that are not the widget — the public contact form, which
   * must keep working when live chat is switched off — opt out.
   */
  enforceLiveChatAvailability?: boolean;
}): Promise<ConversationTarget> {
  const enforceAvailability = params.enforceLiveChatAvailability !== false;
  if (params.productId) {
    const productId = objectId(params.productId, "Product");
    const product = await Product.findOne({
      _id: productId,
      status: PRODUCT_STATUS.ACTIVE,
      ...(await getStorefrontProductConstraint()),
    })
      .select("_id name title slug images media vendorId variants._id variants.name")
      .lean<{
        _id: Types.ObjectId;
        name?: string;
        title?: string;
        slug: string;
        images?: string[];
        media?: Array<{ type?: string; url?: string }>;
        vendorId?: Types.ObjectId;
        variants?: Array<{ _id: Types.ObjectId; name?: string }>;
      } | null>();
    if (!product) throw new NotFoundError("Product");
    const requestedVariantId = params.variantId
      ? objectId(params.variantId, "Variant")
      : undefined;
    const variant = requestedVariantId
      ? product.variants?.find((item) => item._id.equals(requestedVariantId))
      : undefined;
    if (requestedVariantId && !variant) {
      throw new ValidationError("Variant does not belong to this product");
    }

    const vendor = product.vendorId
      ? await Vendor.findOne({
          _id: product.vendorId,
          isDefault: { $ne: true },
          status: VENDOR_STATUS.APPROVED,
          storeActive: { $ne: false },
        })
          .select("_id storeName messaging")
          .lean<{
            _id: Types.ObjectId;
            storeName: string;
            messaging?: unknown;
          } | null>()
      : null;
    if (
      enforceAvailability &&
      vendor &&
      !resolveVendorMessaging(vendor.messaging).liveChatEnabled
    ) {
      throw new ConflictError("This vendor is not accepting live-chat messages");
    }
    if (enforceAvailability && !vendor) {
      const platformMessaging = await getPlatformMessagingConfiguration();
      if (!platformMessaging.liveChatEnabled) {
        throw new ConflictError("The store is not accepting live-chat messages");
      }
    }
    const image =
      product.media?.find((item) => item.type !== "video" && item.url)?.url ||
      product.images?.[0];

    return {
      ownerType: vendor
        ? CONVERSATION_OWNER_TYPES.VENDOR
        : CONVERSATION_OWNER_TYPES.PLATFORM,
      ownerVendorId: vendor?._id,
      ownerName: vendor?.storeName,
      productContext: {
        productId: product._id,
        vendorId: vendor?._id,
        name: product.name || product.title || "Product",
        slug: product.slug,
        image,
        variantId: variant?._id,
        variantName: variant?.name?.trim().slice(0, 160) || undefined,
      },
    };
  }

  if (params.vendorId) {
    const vendor = await Vendor.findOne({
      _id: objectId(params.vendorId, "Vendor"),
      isDefault: { $ne: true },
      status: VENDOR_STATUS.APPROVED,
      storeActive: { $ne: false },
    })
      .select("_id storeName messaging")
      .lean<{
        _id: Types.ObjectId;
        storeName: string;
        messaging?: unknown;
      } | null>();
    if (!vendor) throw new NotFoundError("Vendor");
    if (
      enforceAvailability &&
      !resolveVendorMessaging(vendor.messaging).liveChatEnabled
    ) {
      throw new ConflictError("This vendor is not accepting live-chat messages");
    }
    return {
      ownerType: CONVERSATION_OWNER_TYPES.VENDOR,
      ownerVendorId: vendor._id,
      ownerName: vendor.storeName,
    };
  }

  if (enforceAvailability) {
    const platformMessaging = await getPlatformMessagingConfiguration();
    if (!platformMessaging.liveChatEnabled) {
      throw new ConflictError("The store is not accepting live-chat messages");
    }
  }
  return { ownerType: CONVERSATION_OWNER_TYPES.PLATFORM };
}

async function ensureContact(params: {
  viewer: Extract<ConversationViewer, { kind: "customer" | "guest" }>;
  name: string;
  email?: string;
}) {
  const query =
    params.viewer.kind === "customer"
      ? { userId: objectId(params.viewer.userId, "Customer") }
      : { guestKeyHash: params.viewer.guestKeyHash };
  const update = {
    $set: {
      name: params.name,
      ...(params.email ? { email: params.email } : {}),
      ...(params.viewer.kind === "customer" && params.viewer.image
        ? { image: params.viewer.image }
        : {}),
    },
    $setOnInsert: {
      channelIdentities: [],
      ...(params.viewer.kind === "customer"
        ? { userId: objectId(params.viewer.userId, "Customer") }
        : { guestKeyHash: params.viewer.guestKeyHash }),
    },
  };

  try {
    return await ConversationContact.findOneAndUpdate(query, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      (error as { code?: number }).code !== 11000
    ) {
      throw error;
    }
    const existing = await ConversationContact.findOne(query);
    if (!existing) throw error;
    return existing;
  }
}

function activeKeyDigest(parts: {
  customerKey: string;
  ownerKey: string;
  productKey: string;
}) {
  return createHash("sha256")
    .update(
      `live_chat|${parts.ownerKey}|${parts.customerKey}|${parts.productKey}`,
      "utf8",
    )
    .digest("hex");
}

function activeKey(params: {
  viewer: Extract<ConversationViewer, { kind: "customer" | "guest" }>;
  target: ConversationTarget;
}) {
  return activeKeyDigest({
    customerKey:
      params.viewer.kind === "customer"
        ? `user:${params.viewer.userId}`
        : `guest:${params.viewer.guestKeyHash}`,
    ownerKey: params.target.ownerVendorId
      ? `vendor:${params.target.ownerVendorId.toHexString()}`
      : "platform",
    productKey:
      params.target.productContext?.productId.toHexString() || "general",
  });
}

/**
 * Rebuilds the active-thread key from a stored conversation.
 *
 * `updateConversationStatus` releases the key when a thread is resolved or
 * closed, so a later thread can supersede it. Reopening therefore has to mint
 * it again: without this a reopened thread stayed keyless, and the shopper's
 * next message from the same product page opened a SECOND live thread beside
 * the one the agent had just reopened.
 *
 * Only live chat has this key — external channels are deduplicated by
 * `channelConnectionId` + `externalThreadId` instead.
 */
function liveChatActiveKeyFor(conversation: IConversation) {
  if (conversation.channel !== CONVERSATION_CHANNELS.LIVE_CHAT) return undefined;
  const customerUserId = id(conversation.customerUserId);
  const customerKey = customerUserId
    ? `user:${customerUserId}`
    : conversation.guestKeyHash
      ? `guest:${conversation.guestKeyHash}`
      : undefined;
  if (!customerKey) return undefined;
  const ownerVendorId = id(conversation.ownerVendorId);
  return activeKeyDigest({
    customerKey,
    ownerKey: ownerVendorId ? `vendor:${ownerVendorId}` : "platform",
    productKey: id(conversation.productContext?.productId) || "general",
  });
}

async function ensureCustomerParticipant(params: {
  conversationId: Types.ObjectId;
  viewer: Extract<ConversationViewer, { kind: "customer" | "guest" }>;
  lastReadMessageId?: Types.ObjectId;
}) {
  const identity =
    params.viewer.kind === "customer"
      ? { userId: objectId(params.viewer.userId, "Customer") }
      : { guestKeyHash: params.viewer.guestKeyHash };
  await ConversationParticipant.findOneAndUpdate(
    { conversationId: params.conversationId, ...identity },
    {
      $set: {
        side: CONVERSATION_PARTICIPANT_SIDES.CUSTOMER,
        participantType:
          params.viewer.kind === "customer"
            ? CONVERSATION_PARTICIPANT_TYPES.CUSTOMER
            : CONVERSATION_PARTICIPANT_TYPES.GUEST,
        ...(params.lastReadMessageId
          ? {
              lastReadMessageId: params.lastReadMessageId,
              lastReadAt: new Date(),
            }
          : {}),
      },
      $setOnInsert: identity,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function ensureStoreParticipant(params: {
  conversationId: Types.ObjectId;
  viewer: Extract<ConversationViewer, { kind: "admin" | "vendor" | "staff" }>;
  lastReadMessageId?: Types.ObjectId;
}) {
  const userId = objectId(params.viewer.userId, "User");
  await ConversationParticipant.findOneAndUpdate(
    { conversationId: params.conversationId, userId },
    {
      $set: {
        side: CONVERSATION_PARTICIPANT_SIDES.STORE,
        participantType:
          params.viewer.kind === "admin"
            ? CONVERSATION_PARTICIPANT_TYPES.ADMIN
            : params.viewer.kind === "staff"
              ? CONVERSATION_PARTICIPANT_TYPES.STAFF
              : CONVERSATION_PARTICIPANT_TYPES.VENDOR,
        ...(params.lastReadMessageId
          ? {
              lastReadMessageId: params.lastReadMessageId,
              lastReadAt: new Date(),
            }
          : {}),
      },
      $setOnInsert: { userId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function assertConversationAccess(
  conversationId: string,
  viewer: ConversationViewer,
) {
  const conversation = await Conversation.findOne({
    _id: objectId(conversationId, "Conversation"),
    ...getConversationAccessQuery(viewer),
  }).populate([
    { path: "assignedToUserId", select: "name image" },
    { path: "ownerVendorId", select: "storeName" },
  ]);
  if (!conversation) throw new NotFoundError("Conversation");
  return conversation;
}

const CONVERSATION_HEADER_POPULATE = [
  { path: "assignedToUserId", select: "name image" },
  { path: "ownerVendorId", select: "storeName" },
];

/**
 * Applies a conversation-header transition as one atomic document update.
 *
 * The header has five concurrent writers (inbound message, outbound reply, read
 * receipt, status change, provider webhook). Mutating a hydrated document and
 * calling `save()` emits `$set` of whatever that in-memory snapshot held — never
 * `$inc` — so two messages landing together each wrote "stale value + 1" and one
 * of the unread increments was silently lost. Routing every transition through
 * `findOneAndUpdate` keeps counters additive and the rest last-writer-wins on
 * the server's value rather than on a snapshot read seconds earlier.
 */
export async function applyConversationHeader(
  conversationId: Types.ObjectId,
  update: UpdateQuery<IConversation>,
) {
  return Conversation.findOneAndUpdate({ _id: conversationId }, update, {
    new: true,
  }).populate(CONVERSATION_HEADER_POPULATE);
}

/**
 * Keyset cursor for the inbox list: `<lastMessageAt ISO>_<conversation id>`.
 * The id breaks ties so a page boundary that lands inside a group of identical
 * `lastMessageAt` values can neither repeat nor skip a row.
 */
export function parseConversationCursor(value?: string) {
  if (!value) return undefined;
  const separator = value.lastIndexOf("_");
  if (separator <= 0) return undefined;
  const lastMessageAt = new Date(value.slice(0, separator));
  const cursorId = value.slice(separator + 1);
  if (
    Number.isNaN(lastMessageAt.getTime()) ||
    !Types.ObjectId.isValid(cursorId)
  ) {
    return undefined;
  }
  return { lastMessageAt, _id: new Types.ObjectId(cursorId) };
}

export async function listConversations(params: {
  viewer: ConversationViewer;
  limit?: number;
  status?: string;
  before?: string;
}) {
  const access: ConversationQuery = getConversationAccessQuery(params.viewer);
  const query: ConversationQuery = { ...access };
  if (
    params.status &&
    Object.values(CONVERSATION_STATUSES).includes(
      params.status as (typeof CONVERSATION_STATUSES)[keyof typeof CONVERSATION_STATUSES],
    )
  ) {
    query.status = params.status;
  }
  const cursor = parseConversationCursor(params.before);
  if (cursor) {
    query.$or = [
      { lastMessageAt: { $lt: cursor.lastMessageAt } },
      { lastMessageAt: cursor.lastMessageAt, _id: { $lt: cursor._id } },
    ];
  }

  const limit = Math.min(Math.max(params.limit || 50, 1), 100);
  const rows = await Conversation.find(query)
    .populate("assignedToUserId", "name image")
    .populate("ownerVendorId", "storeName")
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    conversations: page.map((conversation) =>
      serializeConversation(conversation, params.viewer),
    ),
    hasMore,
    nextCursor:
      hasMore && last
        ? `${new Date(last.lastMessageAt).toISOString()}_${id(last._id)}`
        : undefined,
  };
}

/**
 * Stable namespace for a viewer, so two viewers can never share a version.
 *
 * The version below is already viewer-scoped by construction, but two viewers
 * with an empty inbox reduce to the same numbers. Folding identity in keeps
 * "nothing changed" from ever meaning "nothing changed for somebody else".
 */
function conversationViewerKey(viewer: ConversationViewer): string {
  return viewer.kind === "guest"
    ? `guest:${viewer.guestKeyHash}`
    : `${viewer.kind}:${viewer.userId}`;
}

/**
 * Cheap "has anything in this viewer's feed moved" signature.
 *
 * `GET /api/chat/conversations/live` used to hash the payload it had already
 * built, so a 304 saved bytes and renders but no database work: an idle inbox
 * still paid `listConversations` (two populates) plus up to 600 message
 * documents every tick, per open tab. This is the validator that runs instead,
 * on the same principle as GET /api/notifications — three light reads decide
 * whether the expensive ones are worth running.
 *
 *   1. the page of conversation ids, projected to `{ _id, updatedAt }` — no
 *      populate, no bodies. Its membership covers a thread entering or leaving
 *      the window; its newest `updatedAt` covers a new message, a status
 *      change, an assignment, and the unread counters, all of which are
 *      conversation-level writes.
 *   2. the newest message `_id` in those threads. Ids are time-ordered and are
 *      exactly what the payload's `_id > cursor` read selects on, so this
 *      catches an arrival even when it lands with an `updatedAt` behind one
 *      already observed — which multiple instances stamping their own clocks
 *      makes possible.
 *   3. the newest message `updatedAt` in those threads. Delivery receipts write
 *      the message and not its conversation, so nothing else here would move.
 *
 * Two changes it does NOT see, both accepted deliberately, because covering
 * either means reading on every poll the very documents this exists not to
 * read:
 *
 * - An edit to a *populated* field — a vendor renaming their store, an
 *   assigned agent changing their avatar. Those are written on another
 *   document, so no conversation's `updatedAt` moves and the inbox keeps the
 *   old label until that thread is next touched.
 * - A delivery receipt stamped *behind* one already observed, which needs two
 *   instances whose clocks disagree by less than the watermark overlap. The
 *   maximum does not move, so the tick is answered 304 and the row waits for
 *   the next genuine change. A status label sits one state stale for a while;
 *   nothing is lost, because the overlap still re-reads it when that tick runs.
 *
 * Both self-correct on the next real change, and neither survives a navigation
 * — the inbox is server-rendered on arrival.
 */
export async function getConversationFeedVersion(params: {
  viewer: ConversationViewer;
  limit?: number;
}) {
  const access: ConversationQuery = getConversationAccessQuery(params.viewer);
  const limit = Math.min(Math.max(params.limit || 50, 1), 100);

  const page = await Conversation.find(access)
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(limit)
    .select({ _id: 1, updatedAt: 1 })
    .lean();

  const conversationIds = page.map((row) => row._id as Types.ObjectId);
  const newestConversationAt = page.reduce(
    (newest, row) => Math.max(newest, new Date(row.updatedAt).getTime() || 0),
    0,
  );

  if (conversationIds.length === 0) {
    return {
      viewer: conversationViewerKey(params.viewer),
      conversations: "",
      newestConversationAt: 0,
      newestMessageId: "",
      newestMessageAt: 0,
    };
  }

  const [newestMessage, newestUpdatedMessage] = await Promise.all([
    ConversationMessage.findOne({ conversationId: { $in: conversationIds } })
      .sort({ _id: -1 })
      .select({ _id: 1 })
      .lean(),
    ConversationMessage.findOne({ conversationId: { $in: conversationIds } })
      .sort({ updatedAt: -1 })
      .select({ updatedAt: 1 })
      .lean(),
  ]);

  return {
    viewer: conversationViewerKey(params.viewer),
    // Order matters as much as membership: it is the order the payload renders.
    conversations: conversationIds.map((value) => String(value)).join(","),
    newestConversationAt,
    newestMessageId: newestMessage ? String(newestMessage._id) : "",
    newestMessageAt: newestUpdatedMessage
      ? new Date(newestUpdatedMessage.updatedAt as Date).getTime() || 0
      : 0,
  };
}

export async function listConversationMessages(params: {
  conversationId: string;
  viewer: ConversationViewer;
  before?: string;
  limit?: number;
}) {
  const conversation = await assertConversationAccess(
    params.conversationId,
    params.viewer,
  );
  const query: ConversationQuery = { conversationId: conversation._id };
  if (params.before) {
    query._id = { $lt: objectId(params.before, "Message cursor") };
  }
  const limit = Math.min(Math.max(params.limit || 30, 1), 100);
  const messages = await ConversationMessage.find(query)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = messages.length > limit;
  const page = messages.slice(0, limit).reverse();
  return {
    conversation: serializeConversation(conversation, params.viewer),
    messages: page.map(serializeConversationMessage),
    hasMore,
    nextCursor: hasMore ? id(page[0]?._id) : undefined,
  };
}

export async function startLiveConversation(params: {
  viewer: ConversationViewer;
  name?: string;
  email?: string;
  message: string;
  subject?: string;
  productId?: string;
  vendorId?: string;
  variantId?: string;
  variantName?: string;
  clientMessageId?: string;
  /**
   * Defaults to true (the storefront chat widget). The public contact form
   * passes false so a submission is never rejected — and silently lost —
   * because an admin switched live chat off.
   */
  enforceLiveChatAvailability?: boolean;
}) {
  if (params.viewer.kind !== "customer" && params.viewer.kind !== "guest") {
    throw new AuthorizationError("Only shoppers can start a storefront chat");
  }
  const body = normalizeConversationText(params.message);
  const name =
    params.viewer.kind === "customer"
      ? params.viewer.name
      : params.name?.trim().slice(0, 120);
  const email =
    params.viewer.kind === "customer"
      ? params.viewer.email
      : params.email?.trim().toLowerCase().slice(0, 320);
  if (!name || name.length < 2) {
    throw new ValidationError("Your name is required");
  }

  const target = await resolveTarget(params);
  const contact = await ensureContact({
    viewer: params.viewer,
    name,
    email,
  });
  const key = activeKey({ viewer: params.viewer, target });
  const existing = await Conversation.findOne({
    activeKey: key,
    status: { $in: ACTIVE_STATUSES },
  });
  if (existing) {
    const result = await appendConversationMessage({
      conversationId: id(existing._id),
      viewer: params.viewer,
      message: body,
      clientMessageId: params.clientMessageId,
    });
    return { ...result, created: false };
  }

  const now = new Date();
  const conversationId = new Types.ObjectId();
  const messageId = new Types.ObjectId();
  const senderType =
    params.viewer.kind === "customer"
      ? CONVERSATION_MESSAGE_SENDER_TYPES.CUSTOMER
      : CONVERSATION_MESSAGE_SENDER_TYPES.GUEST;
  const subject =
    params.subject?.trim().slice(0, 180) ||
    (target.productContext
      ? `Question about ${target.productContext.name}`
      : target.ownerName
        ? `Message to ${target.ownerName}`
        : "Store support");

  try {
    const conversation = await Conversation.create({
      _id: conversationId,
      channel: CONVERSATION_CHANNELS.LIVE_CHAT,
      ownerType: target.ownerType,
      ownerVendorId: target.ownerVendorId,
      contactId: contact._id,
      customerUserId:
        params.viewer.kind === "customer"
          ? objectId(params.viewer.userId, "Customer")
          : undefined,
      guestKeyHash:
        params.viewer.kind === "guest"
          ? params.viewer.guestKeyHash
          : undefined,
      contact: {
        name,
        email,
        image:
          params.viewer.kind === "customer" ? params.viewer.image : undefined,
      },
      subject,
      status: CONVERSATION_STATUSES.OPEN,
      productContext: target.productContext,
      activeKey: key,
      lastMessageId: messageId,
      lastMessagePreview: preview(body),
      lastMessageAt: now,
      lastInboundAt: now,
      unreadForCustomer: 0,
      unreadForStore: 1,
    });
    const message = await ConversationMessage.create({
      _id: messageId,
      conversationId,
      channel: CONVERSATION_CHANNELS.LIVE_CHAT,
      direction: CONVERSATION_MESSAGE_DIRECTIONS.INBOUND,
      senderType,
      senderUserId:
        params.viewer.kind === "customer"
          ? objectId(params.viewer.userId, "Customer")
          : undefined,
      senderName: name,
      body,
      clientMessageId: params.clientMessageId,
      deliveryStatus: CONVERSATION_MESSAGE_STATUSES.SENT,
    });
    await ensureCustomerParticipant({
      conversationId,
      viewer: params.viewer,
      lastReadMessageId: messageId,
    });
    afterResponse(() => notifyStoreAboutInbound(conversation, body));
    return {
      conversation: serializeConversation(conversation, params.viewer),
      message: serializeConversationMessage(message),
      created: true,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: number }).code === 11000
    ) {
      const concurrent = await Conversation.findOne({ activeKey: key });
      if (concurrent) {
        const result = await appendConversationMessage({
          conversationId: id(concurrent._id),
          viewer: params.viewer,
          message: body,
          clientMessageId: params.clientMessageId,
        });
        return { ...result, created: false };
      }
      throw new ConflictError("Conversation already exists");
    }
    await Promise.allSettled([
      Conversation.deleteOne({ _id: conversationId }),
      ConversationMessage.deleteOne({ _id: messageId }),
    ]);
    throw error;
  }
}

export async function appendConversationMessage(params: {
  conversationId: string;
  viewer: ConversationViewer;
  message?: string;
  attachments?: IConversationAttachment[];
  clientMessageId?: string;
}) {
  const conversation = await assertConversationAccess(
    params.conversationId,
    params.viewer,
  );
  if (
    conversation.status === CONVERSATION_STATUSES.CLOSED ||
    conversation.status === CONVERSATION_STATUSES.SPAM
  ) {
    throw new ConflictError("This conversation is closed");
  }
  if (params.viewer.kind === "vendor" || params.viewer.kind === "staff") {
    assertStoreConversationPermission(params.viewer, "reply");
  }

  const attachments = normalizeConversationAttachments(params.attachments);
  const body = params.message?.trim()
    ? normalizeConversationText(params.message)
    : attachments.length
      ? ""
      : normalizeConversationText("");
  if (params.clientMessageId) {
    const duplicate = await ConversationMessage.findOne({
      conversationId: conversation._id,
      clientMessageId: params.clientMessageId,
    });
    if (duplicate) {
      return {
        conversation: serializeConversation(conversation, params.viewer),
        message: serializeConversationMessage(duplicate),
      };
    }
  }

  const storeViewer = isStoreViewer(params.viewer);
  const capability = channelCapability(conversation.channel);
  // An external channel is named after the provider that carries it, so the
  // channel value doubles as the provider and needs no mapping table. Resolving
  // it once here is what lets the queue call below stay typed instead of
  // casting `conversation.channel` to a hand-listed pair of providers.
  const outboundProvider = storeViewer
    ? channelProvider(conversation.channel)
    : undefined;
  const externalOutbound = Boolean(outboundProvider);
  let messengerHumanAgent = false;
  if (outboundProvider) {
    const provider = outboundProvider;
    if (!conversation.channelConnectionId || !conversation.externalThreadId) {
      throw new ConflictError("This external channel is not connected");
    }
    if (
      conversation.replyWindowExpiresAt &&
      conversation.replyWindowExpiresAt.getTime() < Date.now()
    ) {
      if (
        capability.humanAgentWindowDays !== undefined &&
        conversation.humanAgentWindowExpiresAt &&
        conversation.humanAgentWindowExpiresAt.getTime() > Date.now()
      ) {
        const humanAgentConnection = await ChannelConnection.findOne({
          _id: conversation.channelConnectionId,
          provider,
          status: CHANNEL_CONNECTION_STATUSES.ACTIVE,
          messengerHumanAgentEnabled: true,
        }).select("_id");
        messengerHumanAgent = Boolean(humanAgentConnection);
      }
      if (!messengerHumanAgent) {
        throw new ConflictError(
          capability.templates
            ? `The ${capability.replyWindowHours}-hour reply window has expired; use an approved provider template`
            : `The ${capability.label} reply window has expired`,
        );
      }
    }
    if (attachments.length > capability.maxAttachments) {
      throw new ValidationError(
        `${capability.label} messages support ${capability.maxAttachments} attachment at a time`,
      );
    }
    if (!capability.captionsWithMedia && attachments.length && body) {
      throw new ValidationError(
        `Send ${capability.label} attachment captions as a separate text message`,
      );
    }
    if (
      attachments.some(
        (attachment) => !/^https:\/\//i.test(attachment.url || ""),
      )
    ) {
      throw new ValidationError(
        "External channel attachments require a public HTTPS storage URL",
      );
    }
  }
  const now = new Date();
  const senderType =
    params.viewer.kind === "admin"
      ? CONVERSATION_MESSAGE_SENDER_TYPES.ADMIN
      : params.viewer.kind === "vendor"
        ? CONVERSATION_MESSAGE_SENDER_TYPES.VENDOR
        : params.viewer.kind === "staff"
          ? CONVERSATION_MESSAGE_SENDER_TYPES.STAFF
        : params.viewer.kind === "customer"
          ? CONVERSATION_MESSAGE_SENDER_TYPES.CUSTOMER
          : CONVERSATION_MESSAGE_SENDER_TYPES.GUEST;

  let message: IConversationMessage;
  try {
    message = await ConversationMessage.create({
      conversationId: conversation._id,
      channel: conversation.channel,
      direction: storeViewer
        ? CONVERSATION_MESSAGE_DIRECTIONS.OUTBOUND
        : CONVERSATION_MESSAGE_DIRECTIONS.INBOUND,
      senderType,
      senderUserId:
        params.viewer.kind === "guest"
          ? undefined
          : objectId(params.viewer.userId, "User"),
      senderName:
        params.viewer.kind === "guest"
          ? conversation.contact.name
          : params.viewer.name,
      body,
      attachments,
      clientMessageId: params.clientMessageId,
      providerMetadata: externalOutbound
        ? {
            channelConnectionId: String(conversation.channelConnectionId),
            ...(messengerHumanAgent
              ? { messengerMessageTag: "HUMAN_AGENT" }
              : {}),
          }
        : undefined,
      deliveryStatus: externalOutbound
        ? CONVERSATION_MESSAGE_STATUSES.QUEUED
        : CONVERSATION_MESSAGE_STATUSES.SENT,
    });
  } catch (error) {
    if (
      params.clientMessageId &&
      typeof error === "object" &&
      error !== null &&
      (error as { code?: number }).code === 11000
    ) {
      const duplicate = await ConversationMessage.findOne({
        conversationId: conversation._id,
        clientMessageId: params.clientMessageId,
      });
      if (!duplicate) throw error;
      return {
        conversation: serializeConversation(conversation, params.viewer),
        message: serializeConversationMessage(duplicate),
      };
    }
    throw error;
  }

  const messagePreview =
    body ||
    `Attachment: ${attachments[0]?.name || attachments[0]?.type || "file"}`;
  const sharedHeader = {
    lastMessageId: message._id,
    lastMessagePreview: preview(messagePreview),
    lastMessageAt: now,
  };
  const updatedConversation =
    (await applyConversationHeader(
      conversation._id,
      storeViewer
        ? {
            $set: {
              ...sharedHeader,
              lastOutboundAt: now,
              status: CONVERSATION_STATUSES.PENDING,
              unreadForStore: 0,
            },
            $inc: { unreadForCustomer: 1 },
          }
        : {
            $set: {
              ...sharedHeader,
              lastInboundAt: now,
              status: CONVERSATION_STATUSES.OPEN,
              unreadForCustomer: 0,
            },
            $inc: { unreadForStore: 1 },
            // A fresh inbound message restarts the escalation clock.
            $unset: { escalationNotifiedAt: "" },
          },
    )) || conversation;

  if (outboundProvider && conversation.channelConnectionId) {
    try {
      await queueExternalMessage({
        conversationId: conversation._id,
        messageId: message._id,
        channelConnectionId: conversation.channelConnectionId,
        provider: outboundProvider,
      });
    } catch (error) {
      // Enqueueing itself failed, so there is nothing durable to retry.
      await ConversationMessage.updateOne(
        { _id: message._id },
        {
          $set: {
            deliveryStatus: CONVERSATION_MESSAGE_STATUSES.FAILED,
            errorMessage: "Unable to queue provider delivery",
          },
        },
      );
      throw error;
    }
    // The durable outbox is the source of truth; this call only shortens the
    // latency for a live agent reply. A failure here must NOT delete the queue
    // row — doing so turned a transient error into permanent message loss, the
    // exact outcome the outbox exists to prevent. The cron retries it.
    try {
      await processQueuedMessageNow(message._id);
    } catch (error) {
      console.error(
        "Immediate provider delivery failed; message remains queued:",
        error,
      );
    }
  }

  if (params.viewer.kind === "customer" || params.viewer.kind === "guest") {
    await ensureCustomerParticipant({
      conversationId: conversation._id,
      viewer: params.viewer,
      lastReadMessageId: message._id,
    });
    afterResponse(() =>
      notifyStoreAboutInbound(updatedConversation, messagePreview),
    );
  } else {
    await ensureStoreParticipant({
      conversationId: conversation._id,
      viewer: params.viewer,
      lastReadMessageId: message._id,
    });
    afterResponse(() =>
      notifyCustomerAboutOutbound(updatedConversation, messagePreview),
    );
  }
  const responseMessage = externalOutbound
    ? (await ConversationMessage.findById(message._id)) || message
    : message;

  return {
    conversation: serializeConversation(updatedConversation, params.viewer),
    message: serializeConversationMessage(responseMessage),
  };
}

export async function listConversationWhatsAppTemplates(params: {
  conversationId: string;
  viewer: ConversationViewer;
}) {
  if (!isStoreViewer(params.viewer)) {
    throw new AuthorizationError(
      "Only store users can use WhatsApp templates",
    );
  }
  if (params.viewer.kind === "vendor" || params.viewer.kind === "staff") {
    assertStoreConversationPermission(params.viewer, "reply");
  }
  const conversation = await assertConversationAccess(
    params.conversationId,
    params.viewer,
  );
  // Templates are a channel capability, not a WhatsApp-shaped special case.
  if (
    !supportsTemplates(conversation.channel) ||
    !conversation.channelConnectionId
  ) {
    throw new ConflictError(
      "WhatsApp templates are unavailable for this conversation",
    );
  }
  return {
    templates: await listApprovedWhatsAppTemplates(
      conversation.channelConnectionId,
    ),
  };
}

export async function sendConversationWhatsAppTemplate(params: {
  conversationId: string;
  viewer: ConversationViewer;
  templateId: string;
  values: Record<string, string>;
  clientMessageId?: string;
}) {
  if (!isStoreViewer(params.viewer)) {
    throw new AuthorizationError(
      "Only store users can send WhatsApp templates",
    );
  }
  if (params.viewer.kind === "vendor" || params.viewer.kind === "staff") {
    assertStoreConversationPermission(params.viewer, "reply");
  }
  const conversation = await assertConversationAccess(
    params.conversationId,
    params.viewer,
  );
  if (
    conversation.status === CONVERSATION_STATUSES.CLOSED ||
    conversation.status === CONVERSATION_STATUSES.SPAM
  ) {
    throw new ConflictError("This conversation is closed");
  }
  if (
    !supportsTemplates(conversation.channel) ||
    !conversation.channelConnectionId ||
    !conversation.externalThreadId
  ) {
    throw new ConflictError(
      "WhatsApp templates are unavailable for this conversation",
    );
  }
  if (params.clientMessageId) {
    const duplicate = await ConversationMessage.findOne({
      conversationId: conversation._id,
      clientMessageId: params.clientMessageId,
    });
    if (duplicate) {
      return {
        conversation: serializeConversation(conversation, params.viewer),
        message: serializeConversationMessage(duplicate),
      };
    }
  }

  const connection = await ChannelConnection.findOne({
    _id: conversation.channelConnectionId,
    provider: "whatsapp",
    status: CHANNEL_CONNECTION_STATUSES.ACTIVE,
  });
  if (!connection) throw new ConflictError("WhatsApp channel is not connected");
  const template = await getApprovedWhatsAppTemplate({
    connection,
    templateId: params.templateId,
  });
  const compiled = compileWhatsAppTemplate({
    template,
    values: params.values,
  });
  const now = new Date();
  let message: IConversationMessage;
  try {
    message = await ConversationMessage.create({
      conversationId: conversation._id,
      channel: CONVERSATION_CHANNELS.WHATSAPP,
      direction: CONVERSATION_MESSAGE_DIRECTIONS.OUTBOUND,
      senderType:
        params.viewer.kind === "admin"
          ? CONVERSATION_MESSAGE_SENDER_TYPES.ADMIN
          : params.viewer.kind === "staff"
            ? CONVERSATION_MESSAGE_SENDER_TYPES.STAFF
            : CONVERSATION_MESSAGE_SENDER_TYPES.VENDOR,
      senderUserId: objectId(params.viewer.userId, "User"),
      senderName: params.viewer.name,
      body: compiled.preview,
      clientMessageId: params.clientMessageId,
      providerMetadata: {
        kind: "whatsapp_template",
        templateId: String(template._id),
        channelConnectionId: String(conversation.channelConnectionId),
        whatsappTemplate: compiled.payload,
      },
      deliveryStatus: CONVERSATION_MESSAGE_STATUSES.QUEUED,
    });
  } catch (error) {
    if (
      params.clientMessageId &&
      typeof error === "object" &&
      error !== null &&
      (error as { code?: number }).code === 11000
    ) {
      const duplicate = await ConversationMessage.findOne({
        conversationId: conversation._id,
        clientMessageId: params.clientMessageId,
      });
      if (!duplicate) throw error;
      return {
        conversation: serializeConversation(conversation, params.viewer),
        message: serializeConversationMessage(duplicate),
      };
    }
    throw error;
  }

  const updatedConversation =
    (await applyConversationHeader(conversation._id, {
      $set: {
        lastMessageId: message._id,
        lastMessagePreview: preview(compiled.preview),
        lastMessageAt: now,
        lastOutboundAt: now,
        status: CONVERSATION_STATUSES.PENDING,
        unreadForStore: 0,
      },
      $inc: { unreadForCustomer: 1 },
    })) || conversation;

  try {
    await queueExternalMessage({
      conversationId: conversation._id,
      messageId: message._id,
      channelConnectionId: conversation.channelConnectionId,
      provider: "whatsapp",
    });
    await processQueuedMessageNow(message._id);
  } catch (error) {
    await ConversationMessage.updateOne(
      { _id: message._id },
      {
        $set: {
          deliveryStatus: CONVERSATION_MESSAGE_STATUSES.FAILED,
          errorMessage: "Unable to queue provider template delivery",
        },
      },
    );
    await MessageOutbox.deleteOne({ messageId: message._id });
    throw error;
  }

  await ensureStoreParticipant({
    conversationId: conversation._id,
    viewer: params.viewer,
    lastReadMessageId: message._id,
  });
  afterResponse(() =>
    notifyCustomerAboutOutbound(updatedConversation, compiled.preview),
  );
  const responseMessage =
    (await ConversationMessage.findById(message._id)) || message;

  return {
    conversation: serializeConversation(updatedConversation, params.viewer),
    message: serializeConversationMessage(responseMessage),
  };
}

export async function markConversationRead(params: {
  conversationId: string;
  viewer: ConversationViewer;
}) {
  const conversation = await assertConversationAccess(
    params.conversationId,
    params.viewer,
  );
  const storeViewer = isStoreViewer(params.viewer);
  // Clearing to zero is idempotent, but it still has to go through the atomic
  // path so it cannot resurrect a stale counter read seconds ago.
  const updatedConversation =
    (await applyConversationHeader(conversation._id, {
      $set: storeViewer ? { unreadForStore: 0 } : { unreadForCustomer: 0 },
    })) || conversation;

  // Tell the provider the agent has seen the thread, so the customer gets the
  // read indicator they expect in their own app.
  if (
    storeViewer &&
    isExternalChannel(conversation.channel) &&
    conversation.channelConnectionId
  ) {
    const provider = conversation.channel;
    const [connection, latestInbound] = await Promise.all([
      ChannelConnection.findOne({
        _id: conversation.channelConnectionId,
        provider,
        status: CHANNEL_CONNECTION_STATUSES.ACTIVE,
      }),
      ConversationMessage.findOne({
        conversationId: conversation._id,
        direction: CONVERSATION_MESSAGE_DIRECTIONS.INBOUND,
        providerMessageId: { $exists: true },
        deliveryStatus: { $ne: CONVERSATION_MESSAGE_STATUSES.READ },
      }).sort({ createdAt: -1 }),
    ]);
    if (connection && latestInbound?.providerMessageId) {
      afterResponse(async () => {
        if (provider === CONVERSATION_CHANNELS.WHATSAPP) {
          // WhatsApp marks one specific message as read.
          await markWhatsAppMessageRead({
            connection,
            providerMessageId: latestInbound.providerMessageId as string,
          });
        } else if (conversation.externalThreadId) {
          // Messenger and Instagram mark the whole thread seen per recipient.
          await markMessengerPlatformSeen({
            connection,
            recipientId: conversation.externalThreadId,
          });
        } else {
          return;
        }
        await ConversationMessage.updateOne(
          { _id: latestInbound._id },
          { $set: { deliveryStatus: CONVERSATION_MESSAGE_STATUSES.READ } },
        );
      });
    }
  }

  if (params.viewer.kind === "customer" || params.viewer.kind === "guest") {
    await ensureCustomerParticipant({
      conversationId: conversation._id,
      viewer: params.viewer,
      lastReadMessageId: conversation.lastMessageId,
    });
  } else {
    await ensureStoreParticipant({
      conversationId: conversation._id,
      viewer: params.viewer,
      lastReadMessageId: conversation.lastMessageId,
    });
  }
  return serializeConversation(updatedConversation, params.viewer);
}

export async function updateConversationStatus(params: {
  conversationId: string;
  viewer: ConversationViewer;
  status: "open" | "pending" | "resolved" | "closed" | "spam";
}) {
  if (!isStoreViewer(params.viewer)) {
    throw new AuthorizationError("Only store users can update conversation status");
  }
  if (params.viewer.kind === "vendor" || params.viewer.kind === "staff") {
    assertStoreConversationPermission(params.viewer, "manage");
  }
  const conversation = await assertConversationAccess(
    params.conversationId,
    params.viewer,
  );
  const staysActive = ACTIVE_STATUSES.includes(
    params.status as (typeof ACTIVE_STATUSES)[number],
  );
  // Reopening mints the key again; resolving or closing releases it.
  const restoredActiveKey =
    staysActive && !conversation.activeKey
      ? liveChatActiveKeyFor(conversation)
      : undefined;
  const applyStatus = (activeKey?: string) =>
    applyConversationHeader(conversation._id, {
      $set: { status: params.status, ...(activeKey ? { activeKey } : {}) },
      // Releasing the active-thread key lets a resolved thread be superseded by
      // a new one instead of colliding on the unique index.
      ...(staysActive ? {} : { $unset: { activeKey: "" } }),
    });

  let updatedConversation;
  try {
    updatedConversation = await applyStatus(restoredActiveKey);
  } catch (error) {
    // A newer thread already holds this key. Reopen without it rather than
    // stealing it or failing the status change the agent asked for.
    if (
      !restoredActiveKey ||
      typeof error !== "object" ||
      error === null ||
      (error as { code?: number }).code !== 11000
    ) {
      throw error;
    }
    updatedConversation = await applyStatus();
  }
  return serializeConversation(updatedConversation || conversation, params.viewer);
}

export async function notifyStoreAboutInbound(
  conversation: IConversation,
  body: string,
) {
  const conversationId = id(conversation._id);
  const data = {
    conversationId,
    channel: conversation.channel,
    ownerVendorId: id(conversation.ownerVendorId) || undefined,
  };
  if (conversation.ownerVendorId) {
    const vendorId = id(conversation.ownerVendorId);
    const [vendor, staffProfiles] = await Promise.all([
      Vendor.findById(vendorId)
        .select("userId")
        .lean<{ userId?: unknown } | null>(),
      StaffProfile.find({
        vendorIds: vendorId,
        isActive: true,
        permissions: {
          $in: [
            "view_inbox",
            "reply_inbox",
            "manage_inbox",
          ],
        },
      })
        .select("userId")
        .lean<Array<{ userId?: unknown }>>(),
    ]);
    const recipients = new Map<string, "vendor" | "staff">();
    const vendorUserId = id(vendor?.userId);
    if (vendorUserId) recipients.set(vendorUserId, "vendor");
    for (const profile of staffProfiles) {
      const staffUserId = id(profile.userId);
      if (staffUserId) recipients.set(staffUserId, "staff");
    }
    const assignedUserId = id(conversation.assignedToUserId);
    if (assignedUserId && !recipients.has(assignedUserId)) {
      recipients.set(assignedUserId, "staff");
    }
    await Promise.allSettled(
      [...recipients].map(([userId, recipientType]) =>
        createNotification({
          userId,
          type: NotificationType.CHAT_MESSAGE,
          title: `New message from ${conversation.contact.name}`,
          message: preview(body, 500),
          link:
            recipientType === "vendor"
              ? `/vendor/inbox?conversation=${conversationId}`
              : `/staff/inbox?conversation=${conversationId}`,
          data,
        }),
      ),
    );
    return;
  }

  const admins = await User.find({
    $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
    status: { $ne: USER_ACCOUNT_STATUS.BANNED },
  })
    .select("_id")
    .lean<Array<{ _id: unknown }>>();
  await Promise.allSettled(
    admins.map((admin) =>
      createNotification({
        userId: id(admin._id),
        type: NotificationType.CHAT_MESSAGE,
        title: `New live-chat message from ${conversation.contact.name}`,
        message: preview(body, 500),
        link: `/admin/inbox?view=chat&conversation=${conversationId}`,
        data,
      }),
    ),
  );
}

async function notifyCustomerAboutOutbound(
  conversation: IConversation,
  body: string,
) {
  const userId = id(conversation.customerUserId);
  if (!userId) return;
  const conversationId = id(conversation._id);
  await createNotification({
    userId,
    type: NotificationType.CHAT_MESSAGE,
    title: "New chat reply",
    message: preview(body, 500),
    link: `/account/inbox?view=chat&conversation=${conversationId}`,
    data: {
      conversationId,
      channel: conversation.channel,
      ownerVendorId: id(conversation.ownerVendorId) || undefined,
    },
  }).catch((error) =>
    console.error("Failed to notify customer about chat reply:", error),
  );
}

export function requireConversationViewer(
  viewer: ConversationViewer | null,
): ConversationViewer {
  if (!viewer) throw new AuthenticationError("Chat session is required");
  return viewer;
}
