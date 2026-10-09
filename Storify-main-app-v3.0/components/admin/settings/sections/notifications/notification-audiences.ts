import {
  DEFAULT_NOTIFICATION_SETTINGS,
  type NotificationChannelSettings,
  type NotificationSettings,
} from "@/lib/notifications/notification-settings";

/** Who an event is for: one tab of Settings → Notifications each. */
export type NotificationAudience = keyof NotificationSettings;
/** How it reaches them: one column each. */
export type NotificationChannel = keyof NotificationChannelSettings;

export const NOTIFICATION_AUDIENCES: readonly NotificationAudience[] = [
  "admin",
  "staff",
  "vendor",
  "customer",
];

export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "inApp",
  "email",
  "browserPush",
  "sms",
];

/** What else on the store decides whether an event can happen at all. */
export interface NotificationStoreContext {
  multiVendor: boolean;
  /** Pre-orders are on and a vendor must be approved to sell them. */
  preorderApproval: boolean;
}

/**
 * Whether an event can happen on this store, and so whether its row shows.
 *
 * Vendors apply, ask for pre-order access and hear about their own orders only
 * with Multi-Vendor Mode on (the apply and access routes answer 404 without
 * it). Pre-order access is asked for and decided only while the store reviews
 * vendors before they sell pre-orders.
 */
export function eventShows(
  audience: NotificationAudience,
  event: string,
  store: NotificationStoreContext,
): boolean {
  if (audience === "vendor" && !store.multiVendor) return false;
  if (audience === "admin" && event === "newVendors") return store.multiVendor;
  if (
    (audience === "admin" && event === "preorderAccessRequests") ||
    (audience === "vendor" && event === "preorderAccess")
  ) {
    return store.multiVendor && store.preorderApproval;
  }
  return true;
}

/** The audiences with a tab: vendors only while there can be any. */
export function visibleAudiences(
  store: NotificationStoreContext,
): NotificationAudience[] {
  return NOTIFICATION_AUDIENCES.filter(
    (audience) => audience !== "vendor" || store.multiVendor,
  );
}

/** An audience's events, in the order the settings define them. */
export function eventsOf(audience: NotificationAudience): string[] {
  return Object.keys(DEFAULT_NOTIFICATION_SETTINGS[audience]);
}

/** One event's switches from a settings copy. */
export function channelsOf(
  settings: NotificationSettings,
  audience: NotificationAudience,
  event: string,
): NotificationChannelSettings {
  const group = settings[audience] as Record<string, NotificationChannelSettings>;
  return group[event] ?? (
    DEFAULT_NOTIFICATION_SETTINGS[audience] as Record<string, NotificationChannelSettings>
  )[event];
}

/** Whether any of an audience's switches differ between two copies. */
export function audienceChanged(
  draft: NotificationSettings,
  saved: NotificationSettings,
  audience: NotificationAudience,
): boolean {
  return eventsOf(audience).some((event) => {
    const now = channelsOf(draft, audience, event);
    const before = channelsOf(saved, audience, event);
    return NOTIFICATION_CHANNELS.some((channel) => now[channel] !== before[channel]);
  });
}

/** The recommended switches: the defaults every new store starts from. */
export function recommendedNotificationSettings(): NotificationSettings {
  return structuredClone(DEFAULT_NOTIFICATION_SETTINGS);
}

/**
 * Whether a guest would hear of this customer event at all. A guest has no
 * account, so in-app and push never reach them; only the email and a text do.
 */
export function guestsHearOf(
  channels: NotificationChannelSettings,
  smsReady: boolean,
): boolean {
  return channels.email || (channels.sms && smsReady);
}
