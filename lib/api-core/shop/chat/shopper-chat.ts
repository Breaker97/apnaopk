import type {
  ChatAttachment,
  ChatConversation,
  ChatMessage,
  ChatMessageProduct,
  ChatProduct,
  ChatSeller,
} from "@/contracts/mobile/shop/v1/chat";
import type { ImageSet } from "@/contracts/mobile/shop/v1/common";
import { MobileApiError } from "@/lib/api-core/errors";
import type { MobileSession } from "@/lib/api-core/ports";
import { mongoose } from "@/lib/db";
import { conversationAttachmentPolicy } from "@/lib/conversations/channels";
import type {
  ConversationDTO,
  ConversationMessageDTO,
  ConversationViewer,
} from "@/lib/conversations/types";
import { Vendor } from "@/models";
import { absoluteUrl } from "../absolute-url";
import { imageSet } from "../images";
import { toMoney } from "../money";

/**
 * What every chat endpoint shares: the shopper as the conversation service
 * sees them, the service's DTOs in the contract's shape (contracts … chat.ts),
 * and the lists' cursors.
 *
 * The conversations themselves are lib/conversations/service.ts, the same
 * functions the website's Account → Inbox calls, so a thread reads, sends and
 * notifies the store alike from either.
 */

type ShopperChatViewer = Extract<ConversationViewer, { kind: "customer" }>;

/**
 * Always a shopper. The website resolves a store owner, a seller or staff to
 * their store's inbox (lib/conversations/viewer.ts); the shopper app has no
 * dashboard, so whoever signs in to it chats as a shopper, with their own
 * conversations, as its notifications do (notification-app.ts).
 */
export function shopperChatViewer(session: MobileSession): ShopperChatViewer {
  return {
    kind: "customer",
    userId: session.user.id,
    name: session.user.name,
    email: session.user.email,
    ...(session.user.image ? { image: session.user.image } : {}),
  };
}

function conversationNotFound(): MobileApiError {
  return new MobileApiError(404, "NOT_FOUND", "This conversation is not available.");
}

/** A conversation id from the path; one that cannot be an id is a 404, as an unknown one is. */
export function conversationIdParam(value: string): string {
  if (!mongoose.isValidObjectId(value)) throw conversationNotFound();
  return value;
}

/** What a shopper is told of a status: a thread marked spam reads as closed. */
const SHOPPER_STATUS: Readonly<Record<string, string>> = { spam: "closed" };
const NO_REPLY_STATUSES = new Set(["closed", "spam"]);

/**
 * What the app's attachment upload carries (POST …/attachments): one file per
 * request, no larger than a request body a serverless host accepts (4.5 MB on
 * Vercel, docs/DIRECT_MEDIA_UPLOADS.md), as the business app's uploads. The
 * policy a conversation advertises is its channel's, capped at this.
 */
export const CHAT_ATTACHMENT_CEILING = { maxBytes: 4 * 1024 * 1024, maxFiles: 1 } as const;

/** The largest multipart body POST …/attachments reads: the file, its text and the framing. */
export const CHAT_ATTACHMENT_FORM_BYTES = CHAT_ATTACHMENT_CEILING.maxBytes + 32 * 1024;

export function toChatProduct(
  context: NonNullable<ConversationDTO["productContext"]>,
): ChatProduct {
  const image = imageSet(context.image, context.name);
  return {
    id: context.productId,
    slug: context.slug,
    name: context.name,
    ...(image ? { image } : {}),
    ...(context.variantId ? { variantId: context.variantId } : {}),
    ...(context.variantName ? { variantName: context.variantName } : {}),
  };
}

/** The store logos of sellers, by vendor id; a seller with no logo is not in it. */
export type SellerLogos = ReadonlyMap<string, ImageSet>;

/**
 * The logos of the sellers some conversations are with, read in one query for
 * the whole page, never one per row. The seller's name is already on the
 * conversation; the logo is not, and a conversation row does not change when
 * a seller uploads one, so it is read when the answer is made.
 */
export async function sellerLogos(
  conversations: ReadonlyArray<Pick<ConversationDTO, "ownerVendorId"> | null | undefined>,
): Promise<SellerLogos> {
  const ids = new Set<string>();
  for (const conversation of conversations) {
    const id = conversation?.ownerVendorId;
    if (id && mongoose.isValidObjectId(id)) ids.add(id);
  }
  if (ids.size === 0) return new Map();
  const vendors = await Vendor.find({ _id: { $in: [...ids] } })
    .select("logo")
    .lean<Array<{ _id: unknown; logo?: string }>>();
  const logos = new Map<string, ImageSet>();
  for (const vendor of vendors) {
    const logo = imageSet(vendor.logo);
    if (logo) logos.set(String(vendor._id), logo);
  }
  return logos;
}

/** The seller a conversation, or a draft of one, is with. */
export function toChatSeller(
  vendorId: string,
  name: string | undefined,
  logos: SellerLogos,
): ChatSeller {
  const logo = logos.get(vendorId);
  return {
    id: vendorId,
    ...(name ? { name } : {}),
    ...(logo ? { logo } : {}),
  };
}

export function toChatConversation(
  conversation: ConversationDTO,
  logos: SellerLogos,
): ChatConversation {
  const canReply = !NO_REPLY_STATUSES.has(conversation.status);
  const attachments = canReply
    ? conversationAttachmentPolicy(conversation.channel, CHAT_ATTACHMENT_CEILING)
    : undefined;
  return {
    id: conversation._id,
    subject: conversation.subject,
    ...(conversation.ownerVendorId
      ? { seller: toChatSeller(conversation.ownerVendorId, conversation.ownerName, logos) }
      : {}),
    ...(conversation.productContext ? { product: toChatProduct(conversation.productContext) } : {}),
    status: SHOPPER_STATUS[conversation.status] ?? conversation.status,
    canReply,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: conversation.unreadForCustomer,
    ...(attachments?.types.length ? { attachments } : {}),
    createdAt: conversation.createdAt,
  };
}

/** A page of conversations, with their sellers' logos from one lookup. */
export async function toChatConversations(
  conversations: ConversationDTO[],
): Promise<ChatConversation[]> {
  const logos = await sellerLogos(conversations);
  return conversations.map((conversation) => toChatConversation(conversation, logos));
}

/** One conversation, as `toChatConversations` makes a page. */
export async function toChatConversationWithLogo(
  conversation: ConversationDTO,
): Promise<ChatConversation> {
  return toChatConversation(conversation, await sellerLogos([conversation]));
}

/**
 * Media an external channel delivered is streamed through a route that reads
 * the website's session (app/api/chat/messages/…/attachments): the app cannot
 * load it, so it is left out rather than sent as a link that fails.
 */
const WEB_ONLY_MEDIA = "/api/chat/";

function toChatAttachment(
  attachment: ConversationMessageDTO["attachments"][number],
): ChatAttachment | null {
  if (attachment.url.startsWith(WEB_ONLY_MEDIA)) return null;
  const url = absoluteUrl(attachment.url);
  if (!url) return null;
  const image = attachment.type === "image" ? imageSet(attachment.url, attachment.name) : undefined;
  return {
    type: attachment.type,
    url,
    ...(image ? { image } : {}),
    ...(attachment.name ? { name: attachment.name } : {}),
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(typeof attachment.size === "number" ? { size: Math.round(attachment.size) } : {}),
  };
}

/** A note the store keeps for itself, never the shopper's to read. */
export function isShopperVisible(message: ConversationMessageDTO): boolean {
  return message.direction !== "internal";
}

/** A shared product's snapshot as the message's card. */
function toChatMessageProduct(
  product: NonNullable<ConversationMessageDTO["product"]>,
): ChatMessageProduct {
  const image = imageSet(product.imageUrl, product.name);
  const currency = product.currency;
  const price = currency && typeof product.price === "number" ? product.price : undefined;
  return {
    id: product.productId,
    slug: product.slug,
    name: product.name,
    ...(image ? { image } : {}),
    ...(product.variantName ? { variantName: product.variantName } : {}),
    ...(currency && price !== undefined ? { price: toMoney(price, currency) } : {}),
    ...(currency && price !== undefined && typeof product.compareAtPrice === "number"
      ? { compareAtPrice: toMoney(product.compareAtPrice, currency) }
      : {}),
  };
}

export function toChatMessage(message: ConversationMessageDTO): ChatMessage {
  const fromShopper = message.direction === "inbound";
  return {
    id: message._id,
    fromShopper,
    senderName: message.senderName,
    body: message.body,
    attachments: message.attachments
      .map(toChatAttachment)
      .filter((attachment): attachment is ChatAttachment => attachment !== null),
    ...(message.product ? { product: toChatMessageProduct(message.product) } : {}),
    ...(message.product && message.bodyIsFallback ? { bodyIsFallback: true } : {}),
    ...(fromShopper && message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
    createdAt: message.createdAt,
  };
}

function badCursor(): MobileApiError {
  return new MobileApiError(400, "VALIDATION_ERROR", "The cursor is not one this list gave out.", {
    errors: { cursor: ["Send back the nextCursor of the previous page."] },
  });
}

/** The service's own cursor, opaque to the app. */
export function encodeChatCursor(value: string | undefined): string | null {
  return value ? Buffer.from(value).toString("base64url") : null;
}

/** The service's cursor inside one the app sent back, checked by `valid`; anything else is a 400. */
export function decodeChatCursor(
  cursor: string | undefined,
  valid: (value: string) => boolean,
): string | undefined {
  if (!cursor) return undefined;
  const value = Buffer.from(cursor, "base64url").toString("utf8");
  if (!valid(value)) throw badCursor();
  return value;
}
