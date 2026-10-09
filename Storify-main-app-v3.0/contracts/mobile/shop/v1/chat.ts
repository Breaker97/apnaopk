/**
 * Chat with the store: the shopper's conversations, their messages, starting
 * one from a product or a seller's page, replying and marking read.
 *
 * The same conversations as the website's Account → Inbox, answered by the
 * store (or by the seller whose product or store the chat is about) from
 * their dashboard inbox. The shopper sends text, a product (a card), or a
 * file (POST …/attachments, where the conversation's `attachments` says what
 * it takes); a store's reply can carry attachments and products too.
 *
 * - Before the first message: GET /chat/draft with the product (or the
 *   seller) on screen. It names who will answer, says whether they take chats
 *   now, and hands back the shopper's open conversation about it when there is
 *   one: open that and reply there.
 * - Sending, in either endpoint, carries a `clientMessageId` the app makes per
 *   message (a UUID). A retry with the same id answers the message already
 *   sent, never a second one; show the message at once and settle it by that
 *   id.
 * - New replies: a store's reply sends a push notification whose `url` is
 *   `/{locale}/account/inbox?view=chat&conversation={id}` (links.ts). While a
 *   conversation is on screen, ask for GET …/messages again (on a push, on
 *   returning to the foreground, every few seconds) with the last `ETag` as
 *   `If-None-Match`: an unchanged conversation answers 304 before the server
 *   reads its messages.
 * - The badge: `unreadCount` in GET /chat/conversations, or
 *   `unreadChatMessageCount` in GET /me/overview. Opening a conversation
 *   does not mark it read: POST …/read does.
 *
 * A store owner or seller signed in to the shopper app chats here as a
 * shopper; their store's inbox stays on the dashboard.
 */
import * as z from "zod";

import { ImageSet, ListQuery, Money, listOf } from "./common";

/** The seller a conversation is with. Left out when the store itself answers. */
export const ChatSeller = z.object({
  id: z.string(),
  /** Left out when the seller's store is gone; the app names it generically. */
  name: z.string().optional(),
  /** The seller's store logo, for an avatar. Left out when they have none. */
  logo: ImageSet.optional(),
});
export type ChatSeller = z.infer<typeof ChatSeller>;

/** The product a conversation is about, as it was when it began. */
export const ChatProduct = z.object({
  id: z.string(),
  /** Opens it: GET /products/{slug}. */
  slug: z.string(),
  name: z.string(),
  image: ImageSet.optional(),
  /** The variant the shopper had chosen, when the product has variants. */
  variantId: z.string().optional(),
  variantName: z.string().optional(),
});
export type ChatProduct = z.infer<typeof ChatProduct>;

/**
 * The files the shopper may send into a conversation (POST …/attachments):
 * how many one message carries, and each type taken with its largest size,
 * in bytes. Pick only these; a file outside them is refused with
 * `ATTACHMENT_NOT_ACCEPTED`.
 */
export const AttachmentPolicy = z.object({
  maxFiles: z.number().int().positive(),
  types: z.array(
    z.object({
      mimeType: z.string(),
      maxBytes: z.number().int().positive(),
    }),
  ),
});
export type AttachmentPolicy = z.infer<typeof AttachmentPolicy>;

export const ChatConversation = z.object({
  id: z.string(),
  /** The store's line for it: "Question about …", "Message to …", "Store support". */
  subject: z.string(),
  seller: ChatSeller.optional(),
  product: ChatProduct.optional(),
  /**
   * The store's own word, passed through: `open` (waiting for the store),
   * `pending` (the store replied), `resolved`, `closed`. Show another value
   * as it is.
   */
  status: z.string(),
  /**
   * False once the store closed it: the shopper starts a new one instead. A
   * `resolved` conversation can still be replied to, which opens it again.
   */
  canReply: z.boolean(),
  /** The last message, shortened, for the list. */
  lastMessagePreview: z.string(),
  lastMessageAt: z.string(),
  /** The store's messages the shopper has not read. */
  unreadCount: z.number().int(),
  /**
   * What files may be sent into it (POST …/attachments). Absent when none
   * may (`canReply` false).
   */
  attachments: AttachmentPolicy.optional(),
  createdAt: z.string(),
});
export type ChatConversation = z.infer<typeof ChatConversation>;

/** GET /chat/conversations. Most recent activity first. */
export const ChatConversationListQuery = ListQuery.extend({});
export type ChatConversationListQuery = z.infer<typeof ChatConversationListQuery>;

export const ChatConversationList = listOf(ChatConversation).extend({
  /** For the badge: unread messages in all of the shopper's conversations. */
  unreadCount: z.number().int(),
});
export type ChatConversationList = z.infer<typeof ChatConversationList>;

/** A file on a message. */
export const ChatAttachment = z.object({
  /** `image`, `video`, `audio` or `document` today; offer another as a download. */
  type: z.string(),
  /** Where to load it from, on the store's address or its storage. */
  url: z.string(),
  /** An image's three sizes, for its thumbnail. */
  image: ImageSet.optional(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  /** In bytes. */
  size: z.number().int().optional(),
});
export type ChatAttachment = z.infer<typeof ChatAttachment>;

/**
 * A product shared in a message, as it was when it was sent: draw it as a
 * card that opens GET /products/{slug}. Prices are absent for a product sold
 * on request.
 */
export const ChatMessageProduct = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  image: ImageSet.optional(),
  variantName: z.string().optional(),
  price: Money.optional(),
  /** The price before a reduction, when there was one. */
  compareAtPrice: Money.optional(),
});
export type ChatMessageProduct = z.infer<typeof ChatMessageProduct>;

export const ChatMessage = z.object({
  id: z.string(),
  /** True: the shopper wrote it. False: the store (or the seller) did. */
  fromShopper: z.boolean(),
  /** The shopper's name, or the name of the person at the store who replied. */
  senderName: z.string(),
  /** Empty when the message is only attachments. */
  body: z.string(),
  attachments: z.array(ChatAttachment),
  /** The product the message shares. */
  product: ChatMessageProduct.optional(),
  /**
   * True: `body` is only the product's name and link, written for readers
   * that show no card. Show the card without the body. Absent otherwise.
   */
  bodyIsFallback: z.boolean().optional(),
  /** On the shopper's own messages sent with one: the app's id for it. */
  clientMessageId: z.string().optional(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/**
 * GET /chat/conversations/{id}/messages. The newest first, so the first page
 * is the bottom of the conversation; `nextCursor` reaches further back.
 */
export const ChatMessagesQuery = ListQuery.extend({});
export type ChatMessagesQuery = z.infer<typeof ChatMessagesQuery>;

/**
 * A page of messages, with the conversation they belong to. Asking for the
 * first page again finds new ones: add the messages whose ids the app does
 * not have, and follow `nextCursor` while none of a page's are known yet.
 */
export const ChatMessagePage = listOf(ChatMessage).extend({
  conversation: ChatConversation,
});
export type ChatMessagePage = z.infer<typeof ChatMessagePage>;

/**
 * GET /chat/draft: what a chat from this screen would be. The product on
 * screen, or a seller for their store as a whole, or neither for the store's
 * own support.
 */
export const ChatDraftQuery = z.object({
  productId: z.string().optional(),
  /** Ignored with `productId`: a product's chat goes to whoever sells it. */
  vendorId: z.string().optional(),
  /** The variant chosen on screen. */
  variantId: z.string().optional(),
});
export type ChatDraftQuery = z.infer<typeof ChatDraftQuery>;

export const ChatDraft = z.object({
  /**
   * True: a first message may be sent (POST /chat/conversations). False: the
   * seller, or the store, is not taking chats; `conversation`, when there is
   * one, can still be replied to.
   */
  available: z.boolean(),
  /** Who will answer. Left out when the store itself does. */
  seller: ChatSeller.optional(),
  /** The product the conversation will be about. */
  product: ChatProduct.optional(),
  /**
   * The shopper's conversation about this that is still open. A first
   * message would be added to it anyway: open it, with its history.
   */
  conversation: ChatConversation.optional(),
});
export type ChatDraft = z.infer<typeof ChatDraft>;

/** The longest message, in characters. */
export const CHAT_MESSAGE_MAX_LENGTH = 4000;

/**
 * POST /chat/conversations/{id}/messages: text, a product, or both.
 *
 * `productId` shares a product the storefront shows (in a seller's
 * conversation, one of that seller's); the message carries it as `product`.
 * With an empty `message`, the message's body is the product's name and link
 * (`bodyIsFallback`). Refused with `PRODUCT_NOT_AVAILABLE` otherwise.
 */
export const SendChatMessageRequest = z
  .object({
    message: z.string().max(CHAT_MESSAGE_MAX_LENGTH),
    /** A UUID the app makes for this message and keeps for its retries. */
    clientMessageId: z.uuid(),
    productId: z.string().min(1).max(64).optional(),
  })
  .refine(
    (request) => request.message.trim().length > 0 || request.productId !== undefined,
    { message: "Write a message or share a product.", path: ["message"] },
  );
export type SendChatMessageRequest = z.infer<typeof SendChatMessageRequest>;

/**
 * POST /chat/conversations: the first message about a product, a seller or
 * the store (as for GET /chat/draft). When the shopper already has an open
 * conversation about the same thing, the message is added to it
 * (`created: false`). Text only: the product it is about is `productId`.
 */
export const StartChatRequest = z.object({
  message: z.string().min(1).max(CHAT_MESSAGE_MAX_LENGTH),
  /** A UUID the app makes for this message and keeps for its retries. */
  clientMessageId: z.uuid(),
  ...ChatDraftQuery.shape,
});
export type StartChatRequest = z.infer<typeof StartChatRequest>;

/**
 * POST /chat/conversations/{id}/attachments: one file, sent as
 * `multipart/form-data`. Answers `ChatSendResult`.
 *
 * - `file`: the file, with its Content-Type. One of the conversation's
 *   `attachments.types`, no larger than its `maxBytes`.
 * - `message` (optional): text sent with it, up to `CHAT_MESSAGE_MAX_LENGTH`.
 * - `clientMessageId`: a UUID the app makes for this message and keeps for
 *   its retries; a retry answers the message already sent and stores the
 *   file once.
 *
 * Refused with `ATTACHMENT_NOT_ACCEPTED` (400) when the conversation does not
 * take the file, 413 `UPLOAD_TOO_LARGE` when the upload is over the app's
 * ceiling, and as POST …/messages is otherwise.
 */
export const CHAT_ATTACHMENT_FORM_FIELDS = {
  file: "file",
  message: "message",
  clientMessageId: "clientMessageId",
} as const;

/** The answer to POST …/messages: the message as stored, and its conversation. */
export const ChatSendResult = z.object({
  conversation: ChatConversation,
  message: ChatMessage,
});
export type ChatSendResult = z.infer<typeof ChatSendResult>;

/** The answer to POST /chat/conversations. */
export const ChatStartResult = ChatSendResult.extend({
  /** False when the message went into the shopper's open conversation. */
  created: z.boolean(),
});
export type ChatStartResult = z.infer<typeof ChatStartResult>;

/** The answer to POST /chat/conversations/{id}/read. */
export const ChatReadResult = z.object({
  /** Unread messages left in all of the shopper's conversations. */
  unreadCount: z.number().int(),
});
export type ChatReadResult = z.infer<typeof ChatReadResult>;

/**
 * `reason` values of POST /chat/conversations, POST …/messages and
 * POST …/attachments.
 * - `CHAT_UNAVAILABLE` (409): the seller, or the store, is not taking chats.
 * - `CONVERSATION_CLOSED` (409): the store closed the conversation; start a
 *   new one.
 * - `ATTACHMENT_NOT_ACCEPTED` (400): the conversation does not take this file
 *   (its type, its size); see the conversation's `attachments`.
 * - `PRODUCT_NOT_AVAILABLE` (409): the product cannot be shared here: it is
 *   gone, not in the storefront, or (in a seller's conversation) another
 *   seller's.
 */
export const CHAT_REASONS = [
  "CHAT_UNAVAILABLE",
  "CONVERSATION_CLOSED",
  "ATTACHMENT_NOT_ACCEPTED",
  "PRODUCT_NOT_AVAILABLE",
] as const;
export type ChatReason = (typeof CHAT_REASONS)[number];
