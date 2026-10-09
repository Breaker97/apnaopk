/**
 * The signed-in shopper.
 *
 * Signing in, signing up and signing out are not here: they go through
 * `/api/auth/*`, where the store's lockout, password policy and rate limits
 * live.
 *
 * Every endpoint here needs the shopper app's own session: a session signed
 * in from the app (the `expo-origin` header). A session from the store's
 * website is refused with 401, as the app's session is on the website.
 *
 * A screen asks for the public data and for the shopper's own data as two
 * requests at once: the public answer can be cached for everybody, the private
 * one is small. `MeProduct` is the private half of the product page.
 */
import * as z from "zod";

import { ImageSet, Money } from "./common";
import { ReviewLimits } from "./reviews";

/** GET /me, and the answer to PATCH /me */
export const Me = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  /** The profile picture as a plain URL. Prefer `image`. */
  imageUrl: z.string().optional(),
  /** The profile picture in the three sizes. Left out when there is none. */
  image: ImageSet.optional(),
  phone: z.string().optional(),
  /** `YYYY-MM-DD`. */
  birthday: z.string().optional(),
  /** `male`, `female` or `other`. */
  gender: z.string().optional(),
});
export type Me = z.infer<typeof Me>;

export const GENDERS = ["male", "female", "other"] as const;

/**
 * PATCH /me: change the profile. Only the fields sent change; `null` clears
 * an optional one. Answers the whole `Me`.
 *
 * `imageUploadId` sets the profile picture: the `Upload.id` of a photo the
 * shopper uploaded (POST /uploads); `null` removes the picture. An id that is
 * not theirs is refused with `UPLOAD_NOT_FOUND`.
 *
 * `email` is the login email. Only an account that runs the store may change
 * it here, as on the website (a shopper's is refused with
 * `EMAIL_CHANGE_NOT_ALLOWED`), and only on a sign-in from the last ten minutes
 * (`RECENT_SIGN_IN_REQUIRED`); it then needs verifying again, and every other
 * device is signed out. The app does not offer it to shoppers.
 */
export const UpdateMeRequest = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.email().max(254).optional(),
  phone: z.string().max(40).nullable().optional(),
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Send the date as YYYY-MM-DD.")
    .nullable()
    .optional(),
  gender: z.enum(GENDERS).nullable().optional(),
  imageUploadId: z.string().max(64).nullable().optional(),
});
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

/**
 * `reason` values of `POST /me/password`, `DELETE /me` and `PATCH /me`.
 *
 * - `PASSWORD_POLICY`: the new password breaks the store's rules, which are
 *   in `details` (`PasswordPolicy`) so the app can say which in its own words.
 * - `SAME_PASSWORD`: the new password is the current one.
 * - `CURRENT_PASSWORD_REQUIRED`, `CURRENT_PASSWORD_INCORRECT`: about
 *   `currentPassword`.
 * - `PASSWORD_INCORRECT`: `DELETE /me`'s `password` is wrong.
 * - `PASSWORD_NOT_SET`: `DELETE /me` was sent a password, but the account has
 *   none (it signs in another way): sign in again, then delete without one.
 * - `RECENT_SIGN_IN_REQUIRED` (403): the change needs a sign-in from the last
 *   ten minutes. Sign out, sign in, and try again.
 * - `NOT_A_CUSTOMER` (403): the account also runs or helps run the store and
 *   is closed by the store, not from the app.
 * - `EMAIL_CHANGE_NOT_ALLOWED` (403): `PATCH /me` was sent an `email`, and a
 *   shopper's login email is not changed here.
 * - `EMAIL_TAKEN` (409): another account signs in with that email.
 * - `UPLOAD_NOT_FOUND` (400): `imageUploadId` is not one of the shopper's
 *   uploads.
 */
export const ME_REASONS = [
  "PASSWORD_POLICY",
  "SAME_PASSWORD",
  "CURRENT_PASSWORD_REQUIRED",
  "CURRENT_PASSWORD_INCORRECT",
  "PASSWORD_INCORRECT",
  "PASSWORD_NOT_SET",
  "RECENT_SIGN_IN_REQUIRED",
  "NOT_A_CUSTOMER",
  "EMAIL_CHANGE_NOT_ALLOWED",
  "EMAIL_TAKEN",
  "UPLOAD_NOT_FOUND",
] as const;
export type MeReason = (typeof ME_REASONS)[number];

/**
 * The store's password rules (Settings → Security): the `details` of a
 * `PASSWORD_POLICY` refusal.
 */
export const PasswordPolicy = z.object({
  minLength: z.number().int(),
  maxLength: z.number().int(),
  requireUppercase: z.boolean(),
  requireNumber: z.boolean(),
  requireSpecialCharacter: z.boolean(),
});
export type PasswordPolicy = z.infer<typeof PasswordPolicy>;

/**
 * POST /me/password: change the password, or set a first one on an account
 * that has none (that needs a sign-in from the last ten minutes). Every other
 * device is signed out; this one stays signed in.
 */
export const ChangePasswordRequest = z.object({
  /** Required when the account has a password. */
  currentPassword: z.string().max(256).optional(),
  newPassword: z.string().max(256),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>;

/** The answer to POST /me/password: whether a password was changed or set. */
export const PasswordChange = z.object({
  mode: z.enum(["CHANGED", "SET"]),
});
export type PasswordChange = z.infer<typeof PasswordChange>;

/**
 * DELETE /me: delete the account, for good. Orders stay with the store as its
 * financial records; the profile, addresses, cart, wishlist, reviews,
 * notifications and devices go, and every session ends.
 *
 * Send the password. Without one the session must be from the last ten
 * minutes (`RECENT_SIGN_IN_REQUIRED` otherwise). After a success the app
 * forgets its session cookie.
 */
export const DeleteAccountRequest = z.object({
  password: z.string().max(256).optional(),
});
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

export const AccountDeleted = z.object({
  deleted: z.literal(true),
});
export type AccountDeleted = z.infer<typeof AccountDeleted>;

/**
 * GET /me/overview: the shopper's badges and saved products, for the home
 * screen and the tab bar, in one small request beside the public `GET /home`.
 * Send the last `ETag` back as `If-None-Match`.
 */
export const MeOverview = z.object({
  /** The account cart's quantities added up: GET /cart's `itemCount`. */
  cartItemCount: z.number().int(),
  /** Unread notifications: GET /notifications' `unreadCount`. */
  unreadNotificationCount: z.number().int(),
  /** Unread messages from the store: GET /chat/conversations' `unreadCount`. */
  unreadChatMessageCount: z.number().int(),
  /** Every saved product, in the order saved: fill the hearts on any list from it. */
  wishlistProductIds: z.array(z.string()),
  /** The profile picture, as `Me.image`. Left out when there is none. */
  image: ImageSet.optional(),
});
export type MeOverview = z.infer<typeof MeOverview>;

/**
 * A price the store quoted this shopper for the product (or one variant of
 * it). It is for the lot: put exactly `quantity` in the cart and the cart
 * charges `unitPrice` each; any other quantity is refused (`QUOTED_QUANTITY`).
 */
export const MeQuoteOffer = z.object({
  quoteId: z.string(),
  /** Left out when the quote is for the product as a whole. */
  variantId: z.string().optional(),
  unitPrice: Money,
  quantity: z.number().int(),
  /** The offer lapses then. */
  expiresAt: z.string().optional(),
  /** What the store wrote with the price. */
  note: z.string().optional(),
});
export type MeQuoteOffer = z.infer<typeof MeQuoteOffer>;

/**
 * GET /me/products/{id}: the private half of the product page, asked for
 * beside the public `GET /products/{slug}` with the product's `id`.
 */
export const MeProduct = z.object({
  inWishlist: z.boolean(),
  /** Delivered to the shopper on an order they have not reviewed it on yet. */
  canReview: z.boolean(),
  /** Sent with `canReview` true: what the review may hold, and when it shows. */
  reviewLimits: ReviewLimits.optional(),
  /** The live prices quoted to this shopper; empty when there are none. */
  quoteOffers: z.array(MeQuoteOffer),
});
export type MeProduct = z.infer<typeof MeProduct>;

/** PUT /wishlist/{productId} and DELETE /wishlist/{productId} */
export const WishlistChange = z.object({
  inWishlist: z.boolean(),
});
export type WishlistChange = z.infer<typeof WishlistChange>;
