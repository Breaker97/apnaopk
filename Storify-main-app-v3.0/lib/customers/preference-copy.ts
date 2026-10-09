import "server-only";

import { getTranslations } from "next-intl/server";
import type { NotificationPreferenceKey, PreferenceGroupKey } from "@/lib/customers/notification-preferences";

/** The words of the notification switches, as Account → Preferences prints them. */
export interface PreferenceCopy {
  group(key: PreferenceGroupKey): string;
  title(key: NotificationPreferenceKey): string;
  description(key: NotificationPreferenceKey): string;
}

const GROUPS: Record<PreferenceGroupKey, [string, string]> = {
  EMAIL: ["customerProfile.emailNotifications", "Email Notifications"],
  SMS: ["customerProfile.smsNotifications", "Text Messages"],
  MARKETING: ["customerProfile.marketingPreferences", "Marketing Preferences"],
  PUSH: ["customerProfile.pushNotifications", "App Notifications"],
};

const ITEMS: Record<NotificationPreferenceKey, [string, string, string]> = {
  ORDER_UPDATES: ["orderUpdates", "Order Updates", "Get notified about your order status changes"],
  PROMOTIONS: ["promotions", "Promotions & Deals", "Receive exclusive offers and promotional emails"],
  NEWSLETTER: ["newsletter", "Newsletter", "Weekly updates on new products and trends"],
  PRICE_DROPS: ["priceDrops", "Price Drop Alerts", "Get notified when items in your wishlist go on sale"],
  BACK_IN_STOCK: ["backInStock", "Back in Stock Alerts", "Get notified when out-of-stock items become available"],
  SMS_ORDER_UPDATES: ["smsOrderUpdates", "Order & Return Updates", "Get a text when your order or return status changes"],
  MARKETING_EMAILS: ["marketingOptIn", "Marketing Emails", "Receive marketing communications and special offers"],
  PUSH_ORDER_UPDATES: ["pushOrderUpdates", "Orders & Returns", "Your orders, payments, returns, quotes and store credit"],
  PUSH_MESSAGES: ["pushMessages", "Messages", "Replies from the store in chat"],
};

/**
 * The words in one language, from the store's message catalogue, each falling
 * back to the English the website ships where a language lacks the key.
 */
export async function getPreferenceCopy(locale: string): Promise<PreferenceCopy> {
  const t = await getTranslations({ locale });
  const say = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  return {
    group: (key) => say(...GROUPS[key]),
    title: (key) => say(`customerProfile.${ITEMS[key][0]}`, ITEMS[key][1]),
    description: (key) => say(`customerProfile.${ITEMS[key][0]}Desc`, ITEMS[key][2]),
  };
}
