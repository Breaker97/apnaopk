/**
 * The signed-in operator: who they are, and what they may do where.
 *
 * Signing in, the second step, changing the password, turning two-step
 * verification on or off and signing out are not here: they go through
 * `/api/auth/*` with `@better-auth/expo`'s client and the business app's own
 * scheme, where the store's lockout, password policy and rate limits live.
 * Every endpoint of this API needs a session signed in that way: a session
 * from the store's website, or from the shopper app, is refused with 401.
 *
 * Only people who run the store sign in: a shopper's account is refused at
 * sign-in itself (`BIZ_APP_OPERATORS_ONLY`), so the app never holds a session
 * it cannot use.
 *
 * After sign-in, GET /me. With one workspace the app opens it; with two it
 * asks which, remembers the choice, and sends it as `X-Workspace` on every
 * call; switching clears everything cached. `capabilities` is what the app
 * shows: a tab, a tile or a button without its capability stays hidden. The
 * API refuses anyway, so a stale answer only costs a 403.
 *
 * GET /me is read again on returning to the foreground: a role, a permission
 * or a seller's status changed by somebody else applies at once.
 */
import * as z from "zod";

import { ImageSet, Workspace } from "./common";

/**
 * Codes a sign-in under `/api/auth` can refuse with (the `code` of Better
 * Auth's error body), next to its HTTP status:
 *
 * - `BIZ_APP_OPERATORS_ONLY` (403): the account is a shopper's. Say the app is
 *   for people who run the store; the shopper app is theirs.
 * - `INVALID_EMAIL_OR_PASSWORD` (401), with `attemptsRemaining` near the end.
 * - `ACCOUNT_LOCKED` (429), with `retryAfterSeconds` and `Retry-After`.
 * - `EMAIL_NOT_VERIFIED` (403), `ACCOUNT_INACTIVE_OR_BANNED` (403).
 * - `INVALID_ORIGIN` (403): the store has the business app switched off, or
 *   the app's scheme is not the one set in Settings → Mobile app.
 * - A sign-in that answers `{ twoFactorRedirect: true }` needs the second
 *   step (`twoFactor.verifyTotp` / `verifyBackupCode`): an account with
 *   two-step verification on, which administrators often have.
 */
export const SIGN_IN_CODES = [
  "BIZ_APP_OPERATORS_ONLY",
  "INVALID_EMAIL_OR_PASSWORD",
  "ACCOUNT_LOCKED",
  "EMAIL_NOT_VERIFIED",
  "ACCOUNT_INACTIVE_OR_BANNED",
  "INVALID_ORIGIN",
] as const;

/**
 * What an operator may do in a workspace, worked out on the server from their
 * role, permissions and the seller's plan, with the same rules the endpoints
 * enforce. One per screen or action the app gates:
 *
 * - `VIEW_ORDERS`: the Orders tab, an order, the order tiles at home.
 * - `EDIT_ORDERS`: an order's workflow actions (processing, shipped, delivered).
 * - `CANCEL_ORDERS`: cancelling an order or a consignment.
 * - `VIEW_PRODUCTS`, `EDIT_PRODUCTS`: the Products tab; price and status.
 * - `VIEW_STOCK`, `ADJUST_STOCK`: a product's stock; adding or removing units.
 * - `VIEW_INBOX`, `REPLY_INBOX`: the Inbox tab; replying, internal notes,
 *   taking a conversation oneself.
 * - `MANAGE_INBOX`: assigning conversations to anyone, resolving and
 *   reopening them (each conversation's `actions` says which apply to it).
 * - `VIEW_PAYOUTS`: a seller's balance and payouts.
 * - `REVIEW_VENDOR_APPLICATIONS`: sellers' applications, approving and
 *   rejecting them (administrators).
 * - `VIEW_ORDER_CUSTOMERS`: the customers (customers.ts), and choosing one in
 *   the order builder.
 * - `MANAGE_CUSTOMER_NOTES`: reading and writing the business's own notes
 *   about a customer (it comes with `VIEW_ORDER_CUSTOMERS`).
 *
 * Unknown values are later additions: ignore them.
 */
export const CAPABILITIES = [
  "VIEW_ORDERS",
  "EDIT_ORDERS",
  "CANCEL_ORDERS",
  "CREATE_ORDERS",
  "RECORD_ORDER_PAYMENTS",
  "VIEW_ORDER_CUSTOMERS",
  "CREATE_ORDER_CONTACTS",
  "VIEW_PRODUCTS",
  "EDIT_PRODUCTS",
  "CREATE_PRODUCTS",
  "DELETE_PRODUCTS",
  "VIEW_STOCK",
  "ADJUST_STOCK",
  "VIEW_INBOX",
  "REPLY_INBOX",
  "VIEW_PAYOUTS",
  "REVIEW_VENDOR_APPLICATIONS",
  "VIEW_RETURNS",
  "HANDLE_RETURNS",
  "OVERRIDE_RETURN_ELIGIBILITY",
  "ISSUE_REFUNDS",
  "RECORD_REFUND_SETTLEMENT",
  "MANAGE_CUSTOMER_NOTES",
  "MANAGE_INBOX",
] as const;
export const Capability = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof Capability>;

/** The seller whose shop a vendor workspace is. */
export const WorkspaceVendor = z.object({
  id: z.string(),
  name: z.string(),
  logo: ImageSet.optional(),
  /**
   * The store's own word: `approved`, `payment_required`, `pending`,
   * `suspended`, `rejected`. Anything but `approved` limits what the
   * workspace can do (`active`); a shop awaiting payment is settled on the
   * website, never in the app.
   */
  status: z.string(),
  /** The shop is open: orders, payouts and the inbox work. */
  active: z.boolean(),
  /**
   * The capability packs the seller's plan gives them (`catalog`, `orders`,
   * `inbox`, …). Empty for a seller's staff, whose own permissions decide.
   */
  packs: z.array(z.string()),
});
export type WorkspaceVendor = z.infer<typeof WorkspaceVendor>;

/** One workspace this person can work in, and what they may do there. */
export const WorkspaceAccess = z.object({
  workspace: Workspace,
  /**
   * Their part in it, the store's own word: `admin`, `staff` (the store's own,
   * or a seller's) or `vendor` (the seller).
   */
  role: z.string(),
  capabilities: z.array(Capability),
  /**
   * Their effective permissions, by the store's own names (`view_orders`,
   * `edit_products`, …), for display. Decide with `capabilities`.
   */
  permissions: z.array(z.string()),
  /**
   * Limited to some of the store: a staff member scoped to certain sellers,
   * locations or regions, or a seller's staff (their seller's orders only).
   * Lists show only what is in scope.
   */
  scoped: z.boolean(),
  /** The vendor workspace's seller. */
  vendor: WorkspaceVendor.optional(),
});
export type WorkspaceAccess = z.infer<typeof WorkspaceAccess>;

/** GET /me */
export const Me = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  imageUrl: z.string().optional(),
  /** The account's role, the store's own word: `admin`, `staff` or `vendor`. */
  role: z.string(),
  /** An administrator who owns the store (Team → Owner): nobody else can change them. */
  isOwner: z.boolean(),
  twoFactorEnabled: z.boolean(),
  /**
   * Where they can work. Empty when they can work nowhere right now (a staff
   * member whose access was switched off): say so and offer sign-out.
   */
  workspaces: z.array(WorkspaceAccess),
  /**
   * The workspace this request was for: `X-Workspace`, or the only one. Left
   * out when there is none, or two and no header.
   */
  currentWorkspace: Workspace.optional(),
});
export type Me = z.infer<typeof Me>;

/**
 * The operator's profile picture, changed from the app.
 *
 * PUT /me/picture (account): a photo taken or chosen on the phone, as
 * `multipart/form-data`, the file in the field `file` with its Content-Type
 * (one of `PICTURE_TYPES`), at most `PICTURE_MAX_BYTES` (less when the store
 * sets a smaller image limit). It is stored as the shopper app's profile
 * photos are and becomes the picture at once, on the website too. Answers the
 * whole `Me`, with the new `imageUrl`. Shrink a camera photo before sending it.
 *
 * DELETE /me/picture (account): no picture. Answers the whole `Me`.
 *
 * Both change only the person's own account, in every workspace, and are
 * refused on a demo store, as the website's profile form is. Not keyed: a
 * repeated photo sets the same picture again. Refusals, with `reason`
 * (`PICTURE_REASONS`):
 * - 400 VALIDATION_ERROR `UPLOAD_MISSING`: no file in the field `file`.
 * - 413 VALIDATION_ERROR `UPLOAD_TOO_LARGE`: over the size limit.
 * - 400 VALIDATION_ERROR `UPLOAD_TYPE_NOT_ALLOWED`: not a photo type the
 *   store takes.
 * - 400 VALIDATION_ERROR `UPLOAD_UNREADABLE`: the bytes are not a picture
 *   that can be read.
 */
export const PICTURE_REASONS = [
  "UPLOAD_MISSING",
  "UPLOAD_TOO_LARGE",
  "UPLOAD_TYPE_NOT_ALLOWED",
  "UPLOAD_UNREADABLE",
] as const;
export type PictureReason = (typeof PICTURE_REASONS)[number];

/** The most bytes a profile photo from the app may have, whatever the store allows. */
export const PICTURE_MAX_BYTES = 8 * 1024 * 1024;

/** The photo types a profile picture may be. */
export const PICTURE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;

/**
 * The store's password rules (Settings → Security), so a password change on
 * the account screen can be checked before it is sent (GET /config).
 */
export const PasswordPolicy = z.object({
  minLength: z.number().int(),
  maxLength: z.number().int(),
  requireUppercase: z.boolean(),
  requireNumber: z.boolean(),
  requireSpecialCharacter: z.boolean(),
});
export type PasswordPolicy = z.infer<typeof PasswordPolicy>;
