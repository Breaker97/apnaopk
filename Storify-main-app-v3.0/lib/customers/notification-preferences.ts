import {
  MARKETING_CONSENT_SOURCE,
  MARKETING_CONSENT_STATE,
  MARKETING_OPT_IN_LEVEL,
} from "@/config/app.config";
import { ensureCustomerProfile } from "@/lib/customers/customer";
import { setMarketingConsent } from "@/lib/customers/marketing-consent";
import { connectDB } from "@/lib/db";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";
import { isSmsDeliveryConfigured } from "@/lib/sms/sms";
import { CustomerProfile, getSettingsLean } from "@/models";
import { NotificationType } from "@/models/notification.model";

/**
 * A shopper's notification switches, the ones the website's Account →
 * Preferences keeps and the shopper app's push topics, as one list of
 * switches by stable key. The website and the app write the same fields:
 * `emailNotifications` and `smsNotifications` on the customer profile, the
 * marketing consent through `setMarketingConsent`, and `pushNotifications`
 * for the app.
 */

export type PreferenceGroupKey = "EMAIL" | "SMS" | "MARKETING" | "PUSH";

export const NOTIFICATION_PREFERENCES = [
  { key: "ORDER_UPDATES", group: "EMAIL", field: "emailNotifications.orderUpdates", byDefault: true },
  { key: "PROMOTIONS", group: "EMAIL", field: "emailNotifications.promotions", byDefault: false },
  { key: "NEWSLETTER", group: "EMAIL", field: "emailNotifications.newsletter", byDefault: false },
  { key: "PRICE_DROPS", group: "EMAIL", field: "emailNotifications.priceDrops", byDefault: false },
  { key: "BACK_IN_STOCK", group: "EMAIL", field: "emailNotifications.backInStock", byDefault: false },
  { key: "SMS_ORDER_UPDATES", group: "SMS", field: "smsNotifications.orderUpdates", byDefault: true },
  { key: "MARKETING_EMAILS", group: "MARKETING", field: "marketingOptIn", byDefault: false },
  { key: "PUSH_ORDER_UPDATES", group: "PUSH", field: "pushNotifications.orderUpdates", byDefault: true },
  { key: "PUSH_MESSAGES", group: "PUSH", field: "pushNotifications.messages", byDefault: true },
] as const satisfies ReadonlyArray<{
  key: string;
  group: PreferenceGroupKey;
  field: string;
  byDefault: boolean;
}>;

export type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCES)[number]["key"];

export interface NotificationPreferenceState {
  /** Each switch, by key: on or off. */
  values: Record<NotificationPreferenceKey, boolean>;
  /** The store texts its customers at all; the SMS switch is offered only then. */
  smsAvailable: boolean;
}

function readPath(source: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((value, part) => (value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined), source);
}

async function smsAvailable(): Promise<boolean> {
  const settings = await getSettingsLean();
  const channels = normalizeNotificationSettings(settings.notifications).customer;
  // The website's rule (app/api/user/customer-profile): a switch for texts
  // nobody sends would save and do nothing.
  return isSmsDeliveryConfigured(settings) && (channels.orderUpdates.sms || channels.returnUpdates.sms);
}

export async function readNotificationPreferences(userId: string): Promise<NotificationPreferenceState> {
  await connectDB();
  const [profile, sms] = await Promise.all([ensureCustomerProfile(userId), smsAvailable()]);
  const values = Object.fromEntries(
    NOTIFICATION_PREFERENCES.map((preference) => {
      const stored = readPath(profile, preference.field);
      return [preference.key, typeof stored === "boolean" ? stored : preference.byDefault];
    }),
  ) as Record<NotificationPreferenceKey, boolean>;
  return { values, smsAvailable: sms };
}

export class NotificationPreferenceError extends Error {
  constructor(
    readonly reason: "PREFERENCE_UNKNOWN" | "PREFERENCE_UNAVAILABLE",
    readonly key: string,
  ) {
    super(
      reason === "PREFERENCE_UNKNOWN"
        ? `There is no notification setting called ${key}.`
        : `${key} is not offered by this store right now.`,
    );
    this.name = "NotificationPreferenceError";
  }
}

/**
 * Sets the switches named, and nothing else. Every key is checked before
 * anything is written, so a refused request changes nothing.
 */
export async function setNotificationPreferences(
  userId: string,
  changes: ReadonlyArray<{ key: string; enabled: boolean }>,
): Promise<void> {
  const known = new Map<string, (typeof NOTIFICATION_PREFERENCES)[number]>(
    NOTIFICATION_PREFERENCES.map((preference) => [preference.key, preference]),
  );
  const resolved = changes.map((change) => {
    const preference = known.get(change.key);
    if (!preference) throw new NotificationPreferenceError("PREFERENCE_UNKNOWN", change.key);
    return { preference, enabled: change.enabled };
  });
  if (resolved.some(({ preference }) => preference.group === "SMS") && !(await smsAvailable())) {
    const sms = resolved.find(({ preference }) => preference.group === "SMS")!;
    throw new NotificationPreferenceError("PREFERENCE_UNAVAILABLE", sms.preference.key);
  }

  await connectDB();
  await ensureCustomerProfile(userId);
  const fields: Record<string, boolean> = {};
  let consent: boolean | undefined;
  for (const { preference, enabled } of resolved) {
    // Consent is not a plain field: it carries a state, a time and where it
    // came from, which only `setMarketingConsent` writes.
    if (preference.key === "MARKETING_EMAILS") consent = enabled;
    else fields[preference.field] = enabled;
  }
  if (consent !== undefined) {
    await setMarketingConsent({
      state: consent ? MARKETING_CONSENT_STATE.SUBSCRIBED : MARKETING_CONSENT_STATE.UNSUBSCRIBED,
      optInLevel: consent ? MARKETING_OPT_IN_LEVEL.SINGLE : undefined,
      source: MARKETING_CONSENT_SOURCE.ACCOUNT,
      userId,
    });
  }
  if (Object.keys(fields).length > 0) {
    await CustomerProfile.updateOne({ userId }, { $set: { ...fields, lastActiveAt: new Date() } });
  }
}

/**
 * The shopper app's push topics, by the notification types each covers. A
 * type in neither (a system notice) is always sent.
 */
const PUSH_TOPICS: Record<"orderUpdates" | "messages", readonly string[]> = {
  orderUpdates: [
    NotificationType.ORDER_PLACED,
    NotificationType.ORDER_STATUS,
    NotificationType.ORDER_DELIVERED,
    NotificationType.PAYMENT_RECEIVED,
    NotificationType.RETURN_REQUEST,
    NotificationType.STORE_CREDIT,
    NotificationType.QUOTE_OFFER,
  ],
  messages: [NotificationType.CHAT_MESSAGE, NotificationType.SUPPORT_MESSAGE],
};

/**
 * Whether the shopper switched off, in the app, the push topic a
 * notification of this type belongs to. Read by the push sender before it
 * sends to the shopper app's devices; never throws (a failed read sends).
 */
export async function isAppPushMuted(userId: string, type: string | undefined): Promise<boolean> {
  if (!type) return false;
  const topic = (Object.keys(PUSH_TOPICS) as Array<keyof typeof PUSH_TOPICS>).find((name) =>
    PUSH_TOPICS[name].includes(type),
  );
  if (!topic) return false;
  try {
    const profile = await CustomerProfile.findOne({ userId })
      .select(`pushNotifications.${topic}`)
      .lean<{ pushNotifications?: Record<string, boolean> } | null>();
    return profile?.pushNotifications?.[topic] === false;
  } catch {
    return false;
  }
}
