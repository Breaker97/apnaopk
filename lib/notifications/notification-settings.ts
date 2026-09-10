import { isRecord } from "@/lib/utils";
export interface NotificationChannelSettings {
  inApp: boolean;
  email: boolean;
  browserPush: boolean;
}

export interface NotificationSettings {
  admin: {
    newOrders: NotificationChannelSettings;
    newCustomers: NotificationChannelSettings;
    newVendors: NotificationChannelSettings;
    returns: NotificationChannelSettings;
    payments: NotificationChannelSettings;
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
  };
  customer: {
    orderUpdates: NotificationChannelSettings;
    returnUpdates: NotificationChannelSettings;
  };
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  admin: {
    newOrders: { inApp: true, email: false, browserPush: true },
    newCustomers: { inApp: true, email: false, browserPush: true },
    newVendors: { inApp: true, email: true, browserPush: true },
    returns: { inApp: true, email: true, browserPush: true },
    payments: { inApp: true, email: false, browserPush: true },
  },
  staff: {
    newOrders: { inApp: true, email: false, browserPush: true },
    newCustomers: { inApp: true, email: false, browserPush: true },
    returns: { inApp: true, email: false, browserPush: true },
    payments: { inApp: true, email: false, browserPush: true },
    lowStock: { inApp: true, email: false, browserPush: true },
  },
  vendor: {
    applicationStatus: { inApp: true, email: true, browserPush: true },
    newOrders: { inApp: true, email: true, browserPush: true },
    returns: { inApp: true, email: true, browserPush: true },
  },
  customer: {
    orderUpdates: { inApp: true, email: true, browserPush: true },
    returnUpdates: { inApp: true, email: true, browserPush: true },
  },
};

function normalizeChannelSettings(
  value: unknown,
  fallback: NotificationChannelSettings,
): NotificationChannelSettings {
  if (!isRecord(value)) return { ...fallback };
  return {
    inApp:
      typeof value.inApp === "boolean" ? value.inApp : fallback.inApp,
    email:
      typeof value.email === "boolean" ? value.email : fallback.email,
    browserPush:
      typeof value.browserPush === "boolean"
        ? value.browserPush
        : fallback.browserPush,
  };
}

export function normalizeNotificationSettings(
  value: unknown,
): NotificationSettings {
  const input = isRecord(value) ? value : {};
  const admin = isRecord(input.admin) ? input.admin : {};
  const staff = isRecord(input.staff) ? input.staff : {};
  const vendor = isRecord(input.vendor) ? input.vendor : {};
  const customer = isRecord(input.customer) ? input.customer : {};

  return {
    admin: {
      newOrders: normalizeChannelSettings(
        admin.newOrders,
        DEFAULT_NOTIFICATION_SETTINGS.admin.newOrders,
      ),
      newCustomers: normalizeChannelSettings(
        admin.newCustomers,
        DEFAULT_NOTIFICATION_SETTINGS.admin.newCustomers,
      ),
      newVendors: normalizeChannelSettings(
        admin.newVendors,
        DEFAULT_NOTIFICATION_SETTINGS.admin.newVendors,
      ),
      returns: normalizeChannelSettings(
        admin.returns,
        DEFAULT_NOTIFICATION_SETTINGS.admin.returns,
      ),
      payments: normalizeChannelSettings(
        admin.payments,
        DEFAULT_NOTIFICATION_SETTINGS.admin.payments,
      ),
    },
    staff: {
      newOrders: normalizeChannelSettings(
        staff.newOrders,
        DEFAULT_NOTIFICATION_SETTINGS.staff.newOrders,
      ),
      newCustomers: normalizeChannelSettings(
        staff.newCustomers,
        DEFAULT_NOTIFICATION_SETTINGS.staff.newCustomers,
      ),
      returns: normalizeChannelSettings(
        staff.returns,
        DEFAULT_NOTIFICATION_SETTINGS.staff.returns,
      ),
      payments: normalizeChannelSettings(
        staff.payments,
        DEFAULT_NOTIFICATION_SETTINGS.staff.payments,
      ),
      lowStock: normalizeChannelSettings(
        staff.lowStock,
        DEFAULT_NOTIFICATION_SETTINGS.staff.lowStock,
      ),
    },
    vendor: {
      applicationStatus: normalizeChannelSettings(
        vendor.applicationStatus,
        DEFAULT_NOTIFICATION_SETTINGS.vendor.applicationStatus,
      ),
      newOrders: normalizeChannelSettings(
        vendor.newOrders,
        DEFAULT_NOTIFICATION_SETTINGS.vendor.newOrders,
      ),
      returns: normalizeChannelSettings(
        vendor.returns,
        DEFAULT_NOTIFICATION_SETTINGS.vendor.returns,
      ),
    },
    customer: {
      orderUpdates: normalizeChannelSettings(
        customer.orderUpdates,
        DEFAULT_NOTIFICATION_SETTINGS.customer.orderUpdates,
      ),
      returnUpdates: normalizeChannelSettings(
        customer.returnUpdates,
        DEFAULT_NOTIFICATION_SETTINGS.customer.returnUpdates,
      ),
    },
  };
}

export function hasAnyNotificationChannel(
  channels: NotificationChannelSettings,
) {
  return channels.inApp || channels.email || channels.browserPush;
}
