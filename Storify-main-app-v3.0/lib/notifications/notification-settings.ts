import { isRecord } from "@/lib/utils";
import {
  STAFF_PERMISSIONS,
  type StaffPermission,
} from "@/config/permissions.config";

export interface NotificationChannelSettings {
  inApp: boolean;
  email: boolean;
  browserPush: boolean;
  /** A text message through the SMS provider (Settings → SMS). */
  sms: boolean;
}

export interface NotificationSettings {
  admin: {
    newOrders: NotificationChannelSettings;
    newCustomers: NotificationChannelSettings;
    newVendors: NotificationChannelSettings;
    returns: NotificationChannelSettings;
    payments: NotificationChannelSettings;
    preorderAccessRequests: NotificationChannelSettings;
    /** The store's own products only; each vendor hears of theirs. */
    lowStock: NotificationChannelSettings;
  };
  staff: {
    newOrders: NotificationChannelSettings;
    newCustomers: NotificationChannelSettings;
    returns: NotificationChannelSettings;
    payments: NotificationChannelSettings;
    lowStock: NotificationChannelSettings;
  };
  vendor: {
    applicationStatus: NotificationChannelSettings;
    newOrders: NotificationChannelSettings;
    returns: NotificationChannelSettings;
    preorderAccess: NotificationChannelSettings;
  };
  customer: {
    orderUpdates: NotificationChannelSettings;
    returnUpdates: NotificationChannelSettings;
  };
}

/**
 * SMS starts off for every event: each text is billed by the provider, so a
 * store opts into exactly the ones worth paying for — and an upgraded store
 * sends nothing new until someone decides it should.
 */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  admin: {
    newOrders: { inApp: true, email: false, browserPush: true, sms: false },
    newCustomers: { inApp: true, email: false, browserPush: true, sms: false },
    newVendors: { inApp: true, email: true, browserPush: true, sms: false },
    returns: { inApp: true, email: true, browserPush: true, sms: false },
    payments: { inApp: true, email: false, browserPush: true, sms: false },
    preorderAccessRequests: { inApp: true, email: true, browserPush: true, sms: false },
    lowStock: { inApp: true, email: false, browserPush: true, sms: false },
  },
  staff: {
    newOrders: { inApp: true, email: false, browserPush: true, sms: false },
    newCustomers: { inApp: true, email: false, browserPush: true, sms: false },
    returns: { inApp: true, email: false, browserPush: true, sms: false },
    payments: { inApp: true, email: false, browserPush: true, sms: false },
    lowStock: { inApp: true, email: false, browserPush: true, sms: false },
  },
  vendor: {
    applicationStatus: { inApp: true, email: true, browserPush: true, sms: false },
    newOrders: { inApp: true, email: true, browserPush: true, sms: false },
    returns: { inApp: true, email: true, browserPush: true, sms: false },
    preorderAccess: { inApp: true, email: true, browserPush: true, sms: false },
  },
  customer: {
    orderUpdates: { inApp: true, email: true, browserPush: true, sms: false },
    returnUpdates: { inApp: true, email: true, browserPush: true, sms: false },
  },
};

function normalizeChannelSettings(
  value: unknown,
  fallback: NotificationChannelSettings,
): NotificationChannelSettings {
  if (!isRecord(value)) return { ...fallback };
  const pickBoolean = (key: keyof NotificationChannelSettings) =>
    typeof value[key] === "boolean" ? (value[key] as boolean) : fallback[key];
  return {
    inApp: pickBoolean("inApp"),
    email: pickBoolean("email"),
    browserPush: pickBoolean("browserPush"),
    sms: pickBoolean("sms"),
  };
}

/** One audience's events, each read over its default. */
function normalizeGroup<Group extends Record<string, NotificationChannelSettings>>(
  value: unknown,
  defaults: Group,
): Group {
  const input = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.entries(defaults).map(([event, fallback]) => [
      event,
      normalizeChannelSettings(input[event], fallback),
    ]),
  ) as Group;
}

export function normalizeNotificationSettings(
  value: unknown,
): NotificationSettings {
  const input = isRecord(value) ? value : {};
  return {
    admin: normalizeGroup(input.admin, DEFAULT_NOTIFICATION_SETTINGS.admin),
    staff: normalizeGroup(input.staff, DEFAULT_NOTIFICATION_SETTINGS.staff),
    vendor: normalizeGroup(input.vendor, DEFAULT_NOTIFICATION_SETTINGS.vendor),
    customer: normalizeGroup(
      input.customer,
      DEFAULT_NOTIFICATION_SETTINGS.customer,
    ),
  };
}

export function hasAnyNotificationChannel(
  channels: NotificationChannelSettings,
) {
  return (
    channels.inApp || channels.email || channels.browserPush || channels.sms
  );
}

/** Whether any event, for any audience, is set to send a text. */
export function hasAnySmsNotification(settings: NotificationSettings): boolean {
  return countSmsNotifications(settings) > 0;
}

/** How many events, across every audience, are set to send a text. */
export function countSmsNotifications(settings: NotificationSettings): number {
  return countChannelNotifications(settings, "sms");
}

/** How many events, across every audience, use one channel. */
export function countChannelNotifications(
  settings: NotificationSettings,
  channel: keyof NotificationChannelSettings,
): number {
  return Object.values(settings).reduce(
    (total, group) =>
      total +
      Object.values(group as Record<string, NotificationChannelSettings>).filter(
        (channels) => channels[channel],
      ).length,
    0,
  );
}

/**
 * The staff who hear of each staff event: anyone holding one of these. The
 * dispatch and the settings page's "nobody can see …" note both read this, so
 * the page never says a row reaches someone the dispatch would skip.
 */
export const STAFF_NOTIFICATION_PERMISSIONS: Record<
  keyof NotificationSettings["staff"],
  StaffPermission[]
> = {
  newOrders: [
    STAFF_PERMISSIONS.VIEW_ORDERS,
    STAFF_PERMISSIONS.MANAGE_ORDERS,
    STAFF_PERMISSIONS.EDIT_ORDERS,
  ],
  newCustomers: [
    STAFF_PERMISSIONS.VIEW_CUSTOMERS,
    STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
    STAFF_PERMISSIONS.CREATE_CUSTOMERS,
    STAFF_PERMISSIONS.EDIT_CUSTOMERS,
  ],
  returns: [
    STAFF_PERMISSIONS.VIEW_ORDERS,
    STAFF_PERMISSIONS.MANAGE_ORDERS,
    STAFF_PERMISSIONS.EDIT_ORDERS,
  ],
  payments: [
    STAFF_PERMISSIONS.ACCESS_POS,
    STAFF_PERMISSIONS.MANAGE_POS,
    STAFF_PERMISSIONS.VIEW_ORDERS,
    STAFF_PERMISSIONS.MANAGE_ORDERS,
  ],
  lowStock: [
    STAFF_PERMISSIONS.VIEW_INVENTORY,
    STAFF_PERMISSIONS.MANAGE_INVENTORY,
    STAFF_PERMISSIONS.EDIT_INVENTORY,
  ],
};
