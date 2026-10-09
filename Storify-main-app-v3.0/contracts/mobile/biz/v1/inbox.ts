/**
 * The inbox: conversations with customers, their messages, replying, and
 * marking them read; and the team's own work on a conversation: internal
 * notes, who it is assigned to, resolving and reopening it.
 *
 * The same conversations as the website's dashboard inbox: an administrator
 * and the store's staff (with the inbox permission) see the store's own; a
 * seller and their staff see the seller's. A reply is text, a product (a
 * card), or a file (POST …/attachments, where the conversation's
 * `attachments` says what it takes); a WhatsApp conversation past its 24-hour
 * window needs a template, which is sent from the website.
 *
 * GET /conversations and GET …/messages answer 304 to a matching
 * `If-None-Match`: ask again on a `chat_message` push, on returning to the
 * foreground, and every few seconds while a thread is open.
 *
 * Session B5.
 */
import * as z from "zod";

import { ImageSet, ListQuery, Money, listOf } from "./common";

/** The store's conversation statuses. */
export const CONVERSATION_STATUSES = ["open", "pending", "resolved", "closed"] as const;

/**
 * Whose conversations, by who they are assigned to:
 * - `me`: the operator's own;
 * - `none`: nobody's yet.
 */
export const CONVERSATION_ASSIGNEE_FILTERS = ["me", "none"] as const;

/** GET /conversations. Most recent message first. */
export const ConversationListQuery = ListQuery.extend({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  unreadOnly: z.boolean().optional(),
  /** The contact's name, email or phone, or the subject. */
  search: z.string().trim().min(1).max(100).optional(),
  /**
   * One customer's conversations: their `id` from GET /customers (or a
   * conversation's `customerId`). An account's are those they wrote signed
   * in; a guest's, those under the email of their customer record.
   */
  customerId: z.string().min(1).max(64).optional(),
  /** Only those assigned to the operator (`me`), or to nobody (`none`). */
  assignee: z.enum(CONVERSATION_ASSIGNEE_FILTERS).optional(),
});
export type ConversationListQuery = z.infer<typeof ConversationListQuery>;

/**
 * What an operator may do to a conversation besides replying (`canReply`),
 * as of the answer. Offer only these; the API refuses the rest anyway.
 *
 * - `note`: write an internal note (POST …/notes), which only the team reads.
 *   Whatever the conversation's status or channel window: a note goes to
 *   nobody.
 * - `assign`: give it to anyone GET …/assignees lists, or to nobody
 *   (PUT …/assignment).
 * - `claim`: take it themselves (PUT …/assignment with their own `id` from
 *   GET /me); offered while it is not already theirs.
 * - `resolve`: mark it resolved (PUT …/status `resolved`); offered while it
 *   is open or pending.
 * - `reopen`: open it again (PUT …/status `open`); offered while it is
 *   resolved.
 *
 * Closing a conversation and marking it spam stay on the website. Unknown
 * values are later additions: ignore them.
 */
export const CONVERSATION_ACTIONS = ["note", "assign", "claim", "resolve", "reopen"] as const;
export const ConversationAction = z.enum(CONVERSATION_ACTIONS);
export type ConversationAction = z.infer<typeof ConversationAction>;

/** A person in the team a conversation is, or may be, assigned to. */
export const ConversationAssignee = z.object({
  /** Their account's id: GET /me's `id` is the operator's own. */
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().optional(),
});
export type ConversationAssignee = z.infer<typeof ConversationAssignee>;

/** Who the conversation is with. */
export const ConversationContact = z.object({
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  imageUrl: z.string().optional(),
});
export type ConversationContact = z.infer<typeof ConversationContact>;

/** The product a conversation is about. */
export const ConversationProduct = z.object({
  id: z.string(),
  name: z.string(),
  image: ImageSet.optional(),
  variantName: z.string().optional(),
});
export type ConversationProduct = z.infer<typeof ConversationProduct>;

/**
 * The files this operator may send into a conversation (POST …/attachments):
 * how many one message carries, and each type taken with its largest size,
 * in bytes. The channel's own limits (WhatsApp takes no GIF, Instagram no
 * PDF), capped at what the app's upload carries. Pick only these; a file
 * outside them is refused with `ATTACHMENT_NOT_ACCEPTED`.
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

export const Conversation = z.object({
  id: z.string(),
  /** Where it came from, the store's own word: `web`, `whatsapp`, `messenger`, `instagram`, … */
  channel: z.string(),
  subject: z.string(),
  /**
   * `open`, `pending`, `resolved`, `closed`, or `spam` (the store's own
   * words; a closed or spam conversation takes no replies).
   */
  status: z.string(),
  contact: ConversationContact,
  /**
   * The customer it is with, for GET /customers/{id}: sent to an operator who
   * may see customers (`VIEW_ORDER_CUSTOMERS`), when the contact is a
   * shopper account (they wrote signed in), or a guest whose email has a
   * customer record and who is among this operator's customers
   * (customers.ts: for a seller, one who ordered from them).
   */
  customerId: z.string().optional(),
  product: ConversationProduct.optional(),
  /** The seller it belongs to, for the store's own operators. */
  vendorName: z.string().optional(),
  /** Who in the team it is assigned to: their name (`assignee` says who). */
  assignedTo: z.string().optional(),
  /** Who in the team it is assigned to; absent when nobody. */
  assignee: ConversationAssignee.optional(),
  /** What this operator may do to it now, besides replying. */
  actions: z.array(ConversationAction),
  lastMessagePreview: z.string(),
  lastMessageAt: z.string(),
  /** The customer's messages nobody in the team has read. */
  unreadCount: z.number().int(),
  /**
   * A text reply can be sent: the conversation is not closed, this operator
   * may reply, and the channel's reply window is open. As of the answer: a
   * window that closes afterwards is `replyWindowEndsAt` against the device's
   * clock, and a send refused with `REPLY_WINDOW_CLOSED` is final.
   */
  canReply: z.boolean(),
  /**
   * A WhatsApp-style window that closes: text replies stop then. Absent on a
   * channel with none (live chat, Telegram).
   */
  replyWindowEndsAt: z.string().optional(),
  /**
   * What files may be sent into it (POST …/attachments). Absent when none
   * may: the conversation takes no replies now (`canReply` false), or its
   * channel takes no files.
   */
  attachments: AttachmentPolicy.optional(),
  createdAt: z.string(),
});
export type Conversation = z.infer<typeof Conversation>;

export const ConversationList = listOf(Conversation).extend({
  /** For the tab's badge: unread messages in every conversation, not only this page. */
  unreadCount: z.number().int(),
});
export type ConversationList = z.infer<typeof ConversationList>;

export const MessageAttachment = z.object({
  /** `image`, `video`, `audio` or `document`. */
  type: z.string(),
  url: z.string(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  size: z.number().int().optional(),
});
export type MessageAttachment = z.infer<typeof MessageAttachment>;

/**
 * A product shared in a message, as it was when it was sent: draw it as a
 * card. `price` is absent for a product sold on request.
 */
export const MessageProduct = z.object({
  id: z.string(),
  name: z.string(),
  image: ImageSet.optional(),
  variantName: z.string().optional(),
  price: Money.optional(),
});
export type MessageProduct = z.infer<typeof MessageProduct>;

export const ConversationMessage = z.object({
  id: z.string(),
  /** `inbound` (the customer's), `outbound` (the team's) or `internal` (a note). */
  direction: z.string(),
  /** `customer`, `guest`, `admin`, `staff`, `vendor` or `system`. */
  senderType: z.string(),
  senderName: z.string(),
  /**
   * Who in the team wrote it, a reply or a note: their account's id (GET /me's
   * `id` is the operator's own). Absent on the customer's messages and the
   * store's own lines.
   */
  senderId: z.string().optional(),
  body: z.string(),
  attachments: z.array(MessageAttachment),
  /**
   * Attachments only the website can open: media an external channel (WhatsApp,
   * Messenger…) delivered is streamed through a route that wants the website's
   * session, so `attachments` leaves it out. Show "N attachments, open them on
   * the website". Absent when there are none.
   */
  webOnlyAttachments: z.number().int().optional(),
  /** The product the message shares. */
  product: MessageProduct.optional(),
  /**
   * True: `body` is only the product's name and link, written for readers
   * that show no card (the website's widget, WhatsApp…). Show the card
   * without the body. Absent otherwise.
   */
  bodyIsFallback: z.boolean().optional(),
  /** `queued`, `sent`, `delivered`, `read`, `failed`. */
  deliveryStatus: z.string(),
  /** Why it failed, when it did. */
  error: z.string().optional(),
  createdAt: z.string(),
});
export type ConversationMessage = z.infer<typeof ConversationMessage>;

/** GET /conversations/{id}/messages: newest first; `cursor` pages back in time. */
export const ConversationMessagesQuery = ListQuery;
export type ConversationMessagesQuery = z.infer<typeof ConversationMessagesQuery>;

export const ConversationMessages = listOf(ConversationMessage).extend({
  conversation: Conversation,
});
export type ConversationMessages = z.infer<typeof ConversationMessages>;

/**
 * POST /conversations/{id}/messages: a reply, text or a product or both. Send
 * `Idempotency-Key`.
 *
 * `productId` shares a product a customer can open in the store (in a
 * seller's conversation, one of that seller's); the message carries it as
 * `product`. With no `body`, the message's body is the product's name and
 * link (`bodyIsFallback`). Refused with `PRODUCT_NOT_AVAILABLE` otherwise.
 */
export const SendMessageRequest = z
  .object({
    body: z.string().trim().max(4000),
    productId: z.string().min(1).max(64).optional(),
  })
  .refine((request) => request.body.length > 0 || request.productId !== undefined, {
    message: "Write a message or share a product.",
    path: ["body"],
  });
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

/**
 * POST /conversations/{id}/attachments: one file, sent as
 * `multipart/form-data`. Send `Idempotency-Key`: it is also the message's
 * own id, so a retry never sends the file twice. Answers `SentMessage`.
 *
 * - `file`: the file, with its Content-Type. One of the conversation's
 *   `attachments.types`, no larger than its `maxBytes`.
 * - `body` (optional): text sent with it, up to 4000 characters. Messenger
 *   and Instagram take no caption: send the text as its own message there.
 *
 * Refused with `ATTACHMENT_NOT_ACCEPTED` (400) when the channel does not
 * take the file, 413 `UPLOAD_TOO_LARGE` when the upload is over the app's
 * ceiling, and as POST …/messages is otherwise.
 */
export const ATTACHMENT_FORM_FIELDS = { file: "file", body: "body" } as const;

/** The answer to POST /conversations/{id}/messages and …/attachments. */
export const SentMessage = z.object({
  message: ConversationMessage,
  conversation: Conversation,
});
export type SentMessage = z.infer<typeof SentMessage>;

/** The answer to POST /conversations/{id}/read. */
export const ConversationReadResult = z.object({
  /** Unread messages left in every conversation, for the badge. */
  unreadCount: z.number().int(),
});
export type ConversationReadResult = z.infer<typeof ConversationReadResult>;

/**
 * POST /conversations/{id}/notes: an internal note, offered as the
 * conversation's `note` action (`REPLY_INBOX`). Send `Idempotency-Key`: it is
 * also the note's own id, so a retry never writes it twice. Answers
 * `SentMessage`, the note as `direction: "internal"`.
 *
 * A note is the team's alone. It goes to no channel and the customer is never
 * told of it: no notification, no change to their unread count or to the
 * conversation's last message, status or reply window. It can be written
 * whatever the conversation's status, and after its channel's window has
 * closed.
 */
export const ConversationNoteRequest = z.object({
  body: z.string().trim().min(1).max(4000),
});
export type ConversationNoteRequest = z.infer<typeof ConversationNoteRequest>;

/**
 * GET /conversations/{id}/assignees: who the conversation may be given to,
 * by name, for the `assign` action (`MANAGE_INBOX`). The store's
 * conversations go to its administrators and its staff with the inbox; a
 * seller's to the seller, the seller's staff with the inbox, and the store's
 * administrators. Inactive accounts are left out. Not paged: a team.
 */
export const ConversationAssignees = z.object({
  items: z.array(
    ConversationAssignee.extend({
      email: z.string().optional(),
      /** Their part, the store's own word: `admin`, `staff` or `vendor`. */
      role: z.string(),
    }),
  ),
});
export type ConversationAssignees = z.infer<typeof ConversationAssignees>;

/**
 * PUT /conversations/{id}/assignment: who the conversation is assigned to.
 * `assigneeId` is someone GET …/assignees lists (the `assign` action), the
 * operator's own `id` (`claim`), or `null` for nobody (`assign`). Setting what
 * is already set changes nothing, so a retry is safe without a key. Answers
 * the `Conversation`. Refused with `ASSIGNEE_NOT_AVAILABLE` (409) when the
 * person cannot take it (no longer on the team, or without the inbox).
 */
export const ConversationAssignmentRequest = z.object({
  assigneeId: z.string().trim().min(1).max(64).nullable(),
});
export type ConversationAssignmentRequest = z.infer<typeof ConversationAssignmentRequest>;

/**
 * PUT /conversations/{id}/status (`MANAGE_INBOX`): `resolved` (the `resolve`
 * action) or `open` (`reopen`). Setting the status it already has changes
 * nothing (a pending conversation counts as open), so a retry is safe without
 * a key. Answers the `Conversation`. Refused with `STATUS_CHANGE_NOT_ALLOWED`
 * (409) when the conversation is no longer where that step starts (closed or
 * marked spam on the website meanwhile): read it again.
 */
export const CONVERSATION_STATUS_CHANGES = ["open", "resolved"] as const;
export const ConversationStatusRequest = z.object({
  status: z.enum(CONVERSATION_STATUS_CHANGES),
});
export type ConversationStatusRequest = z.infer<typeof ConversationStatusRequest>;

/**
 * `reason` values of the inbox's changes:
 * - `REPLY_WINDOW_CLOSED` (409): past the channel's reply window; a template
 *   is needed, sent from the website.
 * - `CONVERSATION_CLOSED` (409): closed conversations take no replies.
 * - `ATTACHMENT_NOT_ACCEPTED` (400): the conversation's channel does not take
 *   this file (its type, its size); see the conversation's `attachments`.
 * - `PRODUCT_NOT_AVAILABLE` (409): the product cannot be shared here: it is
 *   gone, not on sale in the store, or (in a seller's conversation) another
 *   seller's.
 * - `ASSIGNEE_NOT_AVAILABLE` (409, PUT …/assignment): that person cannot take
 *   this conversation now; read GET …/assignees again.
 * - `STATUS_CHANGE_NOT_ALLOWED` (409, PUT …/status): the conversation is no
 *   longer where that step starts; read it again.
 */
export const INBOX_REASONS = [
  "REPLY_WINDOW_CLOSED",
  "CONVERSATION_CLOSED",
  "ATTACHMENT_NOT_ACCEPTED",
  "PRODUCT_NOT_AVAILABLE",
  "ASSIGNEE_NOT_AVAILABLE",
  "STATUS_CHANGE_NOT_ALLOWED",
] as const;
export type InboxReason = (typeof INBOX_REASONS)[number];
