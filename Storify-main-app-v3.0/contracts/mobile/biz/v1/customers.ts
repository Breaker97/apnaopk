/**
 * Customers: the people who buy from the store, as far as the operator may
 * see them; one customer's contact details, addresses and figures; and the
 * business's own notes about them.
 *
 * Who is a customer here, by workspace (`VIEW_ORDER_CUSTOMERS`):
 * - the store's administrators and its staff limited to nothing: the store's
 *   customers, as the website's Customers page lists them: every shopper
 *   account, and every guest the store keeps a customer record for (one per
 *   checkout email, made by their first guest order);
 * - a seller, their staff, and the store's staff limited to some sellers,
 *   locations or regions: the customers of the orders they can see, and, for
 *   those who may read the inbox, the signed-in customers who wrote to them.
 *   Their figures count those orders only: a seller never learns what a
 *   customer bought from another seller.
 * A customer out of reach answers 404, never 403.
 *
 * A customer's `id` is opaque: send back what you got. The same id is an
 * order's `customer.id` (orders.ts) and a conversation's `customerId`
 * (inbox.ts), and it filters GET /orders and GET /conversations
 * (`customerId`) to that customer's.
 *
 * Nothing here changes a customer: their account, contact details and
 * addresses are the store's and the customer's own, kept on the website by
 * the store's team. A seller's staff never change them anywhere. What the app
 * may write is a business note (`CustomerNote`).
 *
 * Session F3.
 */
import * as z from "zod";

import { ListQuery, Money, listOf } from "./common";
import { OrderAddress } from "./orders";

/**
 * - `account`: signs in to the store.
 * - `guest`: checked out without an account, known by the email they gave.
 */
export const CUSTOMER_KINDS = ["account", "guest"] as const;

/**
 * GET /customers: newest customers first, a page at a time. `search` is part
 * of a name, an email or a phone number; case does not matter.
 */
export const CustomerListQuery = ListQuery.extend({
  search: z.string().trim().min(1).max(100).optional(),
});
export type CustomerListQuery = z.infer<typeof CustomerListQuery>;

/** One customer, as the list shows them. */
export const CustomerListItem = z.object({
  id: z.string(),
  kind: z.enum(CUSTOMER_KINDS),
  /** Their account's name, else the name of their last checkout, else their email. */
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  /** The picture an account holder set for themselves. */
  imageUrl: z.string().optional(),
  /**
   * Their orders this operator can see (abandoned checkouts are no orders):
   * for a seller, the orders with a consignment of theirs. The length of GET
   * /orders?customerId=.
   */
  orderCount: z.number().int(),
});
export type CustomerListItem = z.infer<typeof CustomerListItem>;

export const CustomerList = listOf(CustomerListItem);
export type CustomerList = z.infer<typeof CustomerList>;

/**
 * A customer's figures, worked out by the store from the orders this
 * operator can see, never from the customer's business elsewhere.
 */
export const CustomerSummary = z.object({
  /** Their orders this operator can see, cancelled ones included. */
  orderCount: z.number().int(),
  /**
   * What they paid, one amount per currency they paid in, largest first;
   * empty when they paid nothing yet. Counted as the website's customer
   * pages count it: orders paid (refunded ones too: the money came in
   * before it went back) or delivered, not cancelled. For a seller, what
   * their items in those orders came to, a cancelled consignment left out.
   * Never add the amounts up.
   */
  totalSpent: z.array(Money),
  /** When the first and the latest of those orders were placed. */
  firstOrderAt: z.string().optional(),
  lastOrderAt: z.string().optional(),
});
export type CustomerSummary = z.infer<typeof CustomerSummary>;

/** GET /customers/{id} */
export const CustomerDetail = z.object({
  id: z.string(),
  kind: z.enum(CUSTOMER_KINDS),
  name: z.string(),
  email: z.string().optional(),
  phone: z.string().optional(),
  imageUrl: z.string().optional(),
  /**
   * Where they have things delivered, as the order builder offers them: for
   * the store's operators the account's saved addresses (a guest's last
   * one); for everyone else the delivery address of their latest order this
   * operator can see. Empty when there is none.
   */
  addresses: z.array(OrderAddress),
  summary: CustomerSummary,
});
export type CustomerDetail = z.infer<typeof CustomerDetail>;

/** The longest note, in characters. */
export const CUSTOMER_NOTE_MAX_LENGTH = 2000;

/**
 * Who wrote a note: their name as it was then, and their part in the store
 * (the store's own word: `admin`, `staff`, or `vendor` for a seller).
 */
export const CustomerNoteAuthor = z.object({
  name: z.string(),
  role: z.enum(["admin", "staff", "vendor"]).optional(),
});
export type CustomerNoteAuthor = z.infer<typeof CustomerNoteAuthor>;

/**
 * A business note about a customer (`MANAGE_CUSTOMER_NOTES`, which reads and
 * writes them). Internal: the customer never sees it, nor does anybody
 * outside the business that wrote it. The store's team share the store's
 * notes; a seller and their staff share the seller's; the two never see each
 * other's. A note is kept as written: there is no editing or deleting it in
 * the app.
 */
export const CustomerNote = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  author: CustomerNoteAuthor,
});
export type CustomerNote = z.infer<typeof CustomerNote>;

/** GET /customers/{id}/notes: newest first, a page at a time. */
export const CustomerNotesQuery = ListQuery;
export type CustomerNotesQuery = z.infer<typeof CustomerNotesQuery>;

export const CustomerNoteList = listOf(CustomerNote);
export type CustomerNoteList = z.infer<typeof CustomerNoteList>;

/**
 * POST /customers/{id}/notes: a new note, answered with it (201). Send
 * `Idempotency-Key`: a retry with the same key answers the same note, and
 * never writes a second one.
 */
export const CustomerNoteRequest = z.object({
  body: z.string().trim().min(1).max(CUSTOMER_NOTE_MAX_LENGTH),
});
export type CustomerNoteRequest = z.infer<typeof CustomerNoteRequest>;
