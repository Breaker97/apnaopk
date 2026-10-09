import type {
  Conversation,
  ConversationAction,
  ConversationMessage,
  MessageAttachment,
  MessageProduct,
} from "@/contracts/mobile/biz/v1/inbox";
import { grantCan } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { BIZ_UPLOAD_FILE_MAX_BYTES } from "@/lib/api-core/biz/upload-form";
import type { MobileSession } from "@/lib/api-core/ports";
import { absoluteUrl } from "@/lib/api-core/shop/absolute-url";
import { imageSet } from "@/lib/api-core/shop/images";
import { toMoney } from "@/lib/api-core/shop/money";
import { conversationAttachmentPolicy } from "@/lib/conversations/channels";
import type {
  ConversationDTO,
  ConversationMessageDTO,
  ConversationViewer,
} from "@/lib/conversations/types";

/**
 * What every inbox endpoint shares: the operator as the conversation service
 * sees them, and the service's DTOs in the contract's shape
 * (contracts/mobile/biz/v1/inbox.ts).
 *
 * The conversations themselves are lib/conversations/service.ts, the same
 * functions the website's dashboard inbox calls, so a thread reads, replies,
 * notifies the customer and clears its unread count alike from either. What
 * the app adds is who is asking: the viewer comes from the workspace the
 * request is for, never from the website's session rules.
 */

/**
 * The operator as the conversation service's viewer, for the workspace the
 * request is for:
 * - the store's administrator sees every conversation (the store's own and
 *   every seller's);
 * - the store's staff see theirs: all, or the sellers they are scoped to;
 * - a seller, and their staff, see that seller's conversations only.
 *
 * The seller's workspace is the viewer's whole reach: a seller's staff are
 * pinned to the one seller of the workspace, so another seller's thread is a
 * 404 whatever else their profile says. The service refuses a reply the
 * viewer's permissions do not allow, as it does for the website.
 */
export function bizConversationViewer(
  session: MobileSession,
  workspace: BizWorkspaceGrant,
): ConversationViewer {
  const who = {
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    ...(session.user.image ? { image: session.user.image } : {}),
  };
  if (workspace.kind === "admin") return { kind: "admin", ...who };
  if (workspace.kind === "staff") {
    return {
      kind: "staff",
      ...who,
      permissions: workspace.permissions,
      vendorIds:
        workspace.workspace === "vendor" ? [workspace.vendor.id] : workspace.staffScope.vendorIds,
    };
  }
  return {
    kind: "vendor",
    ...who,
    vendorId: workspace.vendor.id,
    permissions: Array.from(workspace.access.effective),
  };
}

/**
 * Whether a free-form reply is inside the channel's window, and when the
 * window closes. A channel with none (live chat, Telegram) has no
 * `replyWindowExpiresAt`. Messenger and Instagram keep a longer manual-support
 * window after the first: while it runs the window is open as far as this
 * can tell (whether the store enabled it is a read the service makes when a
 * reply is sent, and its refusal is the final word).
 */
export function replyWindowOf(
  conversation: Pick<ConversationDTO, "replyWindowExpiresAt" | "humanAgentWindowExpiresAt">,
  now = Date.now(),
): { open: boolean; endsAt?: string } {
  const standard = conversation.replyWindowExpiresAt;
  if (!standard) return { open: true };
  if (Date.parse(standard) >= now) return { open: true, endsAt: standard };
  const extended = conversation.humanAgentWindowExpiresAt;
  if (extended && Date.parse(extended) > now) return { open: true, endsAt: extended };
  return { open: false, endsAt: standard };
}

const NO_REPLY_STATUSES = new Set(["closed", "spam"]);

/** Where each status step starts: the website's own pair (resolve, reopen). */
const RESOLVABLE_STATUSES = new Set(["open", "pending"]);
const REOPENABLE_STATUSES = new Set(["resolved"]);

/**
 * What the operator may do to a conversation besides replying (the
 * contract's `CONVERSATION_ACTIONS`), as the conversation service would let
 * them (lib/conversations): a note and taking it themselves with the reply
 * permission; giving it to someone else or nobody, resolving and reopening
 * with the manage permission. Closing it and marking it spam are the
 * website's. The routes refuse what this does not offer.
 */
export function conversationActions(
  conversation: Pick<ConversationDTO, "status" | "assignedTo">,
  context: { workspace: BizWorkspaceGrant; operatorId: string },
): ConversationAction[] {
  const mayReply = grantCan(context.workspace, "REPLY_INBOX");
  const mayManage = grantCan(context.workspace, "MANAGE_INBOX");
  const actions: ConversationAction[] = [];
  if (mayReply) actions.push("note");
  if (mayManage) actions.push("assign");
  if (mayReply && conversation.assignedTo?.userId !== context.operatorId) actions.push("claim");
  if (mayManage && RESOLVABLE_STATUSES.has(conversation.status)) actions.push("resolve");
  if (mayManage && REOPENABLE_STATUSES.has(conversation.status)) actions.push("reopen");
  return actions;
}

/**
 * What the app's attachment upload carries (POST …/attachments): one file per
 * request, no larger than the business app's upload ceiling (a request body a
 * serverless host accepts). The policy a conversation advertises is the
 * channel's, capped at this.
 */
export const BIZ_ATTACHMENT_CEILING = { maxBytes: BIZ_UPLOAD_FILE_MAX_BYTES, maxFiles: 1 } as const;

export function toBizConversation(
  conversation: ConversationDTO,
  context: {
    /** The workspace the request is for. */
    workspace: BizWorkspaceGrant;
    /** The operator's own account id: whether it is assigned to them. */
    operatorId: string;
    now?: number;
    /** Who the conversation is with, among the operator's customers (./customers.ts). */
    customerId?: string;
  },
): Conversation {
  const window = replyWindowOf(conversation, context.now);
  const mayReply = grantCan(context.workspace, "REPLY_INBOX");
  const canReply = mayReply && !NO_REPLY_STATUSES.has(conversation.status) && window.open;
  const attachments = canReply
    ? conversationAttachmentPolicy(conversation.channel, BIZ_ATTACHMENT_CEILING)
    : undefined;
  const image = conversation.productContext
    ? imageSet(conversation.productContext.image, conversation.productContext.name)
    : undefined;
  const contactImage = absoluteUrl(conversation.contact.image);
  const assigneeImage = absoluteUrl(conversation.assignedTo?.image);
  return {
    id: conversation._id,
    channel: conversation.channel,
    subject: conversation.subject,
    status: conversation.status,
    contact: {
      name: conversation.contact.name,
      ...(conversation.contact.email ? { email: conversation.contact.email } : {}),
      ...(conversation.contact.phone ? { phone: conversation.contact.phone } : {}),
      ...(contactImage ? { imageUrl: contactImage } : {}),
    },
    ...(context.customerId ? { customerId: context.customerId } : {}),
    ...(conversation.productContext
      ? {
          product: {
            id: conversation.productContext.productId,
            name: conversation.productContext.name,
            ...(image ? { image } : {}),
            ...(conversation.productContext.variantName
              ? { variantName: conversation.productContext.variantName }
              : {}),
          },
        }
      : {}),
    // The store's own operators are told whose conversation it is; a seller
    // knows.
    ...(context.workspace.workspace === "platform" && conversation.ownerName
      ? { vendorName: conversation.ownerName }
      : {}),
    ...(conversation.assignedTo
      ? {
          assignedTo: conversation.assignedTo.name,
          assignee: {
            id: conversation.assignedTo.userId,
            name: conversation.assignedTo.name,
            ...(assigneeImage ? { imageUrl: assigneeImage } : {}),
          },
        }
      : {}),
    actions: conversationActions(conversation, context),
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: conversation.unreadForStore,
    canReply,
    ...(window.endsAt ? { replyWindowEndsAt: window.endsAt } : {}),
    ...(attachments?.types.length ? { attachments } : {}),
    createdAt: conversation.createdAt,
  };
}

/**
 * Media an external channel delivered is streamed through a route that reads
 * the website's session (app/api/chat/messages/…/attachments): the app cannot
 * load it, so it is counted, not linked.
 */
const WEB_ONLY_MEDIA = "/api/chat/";

function toBizAttachment(
  attachment: ConversationMessageDTO["attachments"][number],
): MessageAttachment | null {
  if (attachment.url.startsWith(WEB_ONLY_MEDIA)) return null;
  const url = absoluteUrl(attachment.url);
  if (!url) return null;
  return {
    type: attachment.type,
    url,
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(typeof attachment.size === "number" ? { size: Math.round(attachment.size) } : {}),
  };
}

/** A shared product's snapshot as the message's card. */
function toBizMessageProduct(
  product: NonNullable<ConversationMessageDTO["product"]>,
): MessageProduct {
  const image = imageSet(product.imageUrl, product.name);
  return {
    id: product.productId,
    name: product.name,
    ...(image ? { image } : {}),
    ...(product.variantName ? { variantName: product.variantName } : {}),
    ...(typeof product.price === "number" && product.currency
      ? { price: toMoney(product.price, product.currency) }
      : {}),
  };
}

export function toBizMessage(message: ConversationMessageDTO): ConversationMessage {
  const attachments: MessageAttachment[] = [];
  let webOnly = 0;
  for (const attachment of message.attachments) {
    const mapped = toBizAttachment(attachment);
    if (mapped) attachments.push(mapped);
    else webOnly += 1;
  }
  return {
    id: message._id,
    direction: message.direction,
    senderType: message.senderType,
    senderName: message.senderName,
    // The team's own: a customer's account id is not the operator's to read.
    ...(message.direction !== "inbound" && message.senderType !== "system" && message.senderUserId
      ? { senderId: message.senderUserId }
      : {}),
    body: message.body,
    attachments,
    ...(webOnly ? { webOnlyAttachments: webOnly } : {}),
    ...(message.product ? { product: toBizMessageProduct(message.product) } : {}),
    ...(message.product && message.bodyIsFallback ? { bodyIsFallback: true } : {}),
    deliveryStatus: message.deliveryStatus,
    ...(message.errorMessage ? { error: message.errorMessage } : {}),
    createdAt: message.createdAt,
  };
}
