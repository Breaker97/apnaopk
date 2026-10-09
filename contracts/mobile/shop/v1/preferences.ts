/**
 * What the store sends the shopper, and the switches they keep for it: the
 * website's Account → Preferences, plus the shopper app's own push topics.
 *
 * GET /me/preferences (auth user, private, `ETag`) and PATCH /me/preferences
 * (auth user; refused on a demo store). Both answer the whole list, grouped as
 * the store groups it, in the order to show: every title and description
 * already in the path's locale. The app draws one switch per `Preference` and
 * computes nothing; a group the store does not use is left out (texts, while
 * the store sends none).
 *
 * Group keys (`PREFERENCE_GROUPS`), so the app can place a group itself:
 * - `EMAIL`: the emails about the shopper's orders and the store's alerts.
 * - `SMS`: text messages about orders and returns. Sent only while the store
 *   texts its customers.
 * - `MARKETING`: news and offers by email. Turning it off is an unsubscribe,
 *   as the link in a marketing email is.
 * - `PUSH`: the shopper app's notifications, on every device the shopper is
 *   signed in on. Off for a topic: the store sends that topic to none of
 *   their devices; it still lands in GET /notifications. What the phone itself
 *   allows is the phone's: ask the OS for permission as before.
 */
import * as z from "zod";

export const PREFERENCE_GROUPS = ["EMAIL", "SMS", "MARKETING", "PUSH"] as const;

/**
 * The switches, by stable key. A key the app does not know: show it by its
 * `title` and send it back as it came.
 */
export const PREFERENCE_KEYS = [
  /** EMAIL: order confirmations and status changes. */
  "ORDER_UPDATES",
  /** EMAIL: offers and promotional emails. */
  "PROMOTIONS",
  /** EMAIL: the store's newsletter. */
  "NEWSLETTER",
  /** EMAIL: a saved product goes on sale. */
  "PRICE_DROPS",
  /** EMAIL: a sold-out product is back. */
  "BACK_IN_STOCK",
  /** SMS: order and return status texts. */
  "SMS_ORDER_UPDATES",
  /** MARKETING: news and offers by email (the marketing consent). */
  "MARKETING_EMAILS",
  /** PUSH: orders, payments, returns, quotes and store credit. */
  "PUSH_ORDER_UPDATES",
  /** PUSH: replies from the store in chat. */
  "PUSH_MESSAGES",
] as const;

export const Preference = z.object({
  /** `PREFERENCE_KEYS`: send it back in PATCH. */
  key: z.string(),
  title: z.string(),
  description: z.string(),
  /** The shopper receives it. */
  enabled: z.boolean(),
});
export type Preference = z.infer<typeof Preference>;

export const PreferenceGroup = z.object({
  /** `PREFERENCE_GROUPS`. */
  key: z.string(),
  title: z.string(),
  items: z.array(Preference),
});
export type PreferenceGroup = z.infer<typeof PreferenceGroup>;

/** GET /me/preferences, and the answer to PATCH /me/preferences. */
export const Preferences = z.object({
  groups: z.array(PreferenceGroup),
});
export type Preferences = z.infer<typeof Preferences>;

/**
 * PATCH /me/preferences: set one switch or several at once; the others stay
 * as they are. Answers the whole `Preferences`.
 *
 * Refused (400 VALIDATION_ERROR, on `errors.preferences`) with reason
 * `PREFERENCE_UNKNOWN` for a key this store does not have, and
 * `PREFERENCE_UNAVAILABLE` for one it does not offer now (an SMS switch while
 * the store sends no texts); nothing is changed then.
 */
export const UpdatePreferencesRequest = z.object({
  preferences: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(40),
});
export type UpdatePreferencesRequest = z.infer<typeof UpdatePreferencesRequest>;

/** `reason` values of PATCH /me/preferences (400 VALIDATION_ERROR). */
export const PREFERENCE_REASONS = ["PREFERENCE_UNKNOWN", "PREFERENCE_UNAVAILABLE"] as const;
export type PreferenceReason = (typeof PREFERENCE_REASONS)[number];
