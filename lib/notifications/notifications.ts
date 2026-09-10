/**
 * Notification Helper Functions
 * Create notifications for various events
 */

import { connectDB } from "@/lib/db";
import { Notification, StaffProfile, User, Vendor } from "@/models";
import { NotificationType } from "@/models/notification.model";
import { sendPushToUser } from "@/lib/notifications/push-notifications";
import { sendEmail } from "@/lib/email/email";
import {
  hasOrderStatusEmail,
  sendOrderStatusEmailForOrder,
} from "@/lib/email/order-emails";
import {
  ORDER_STATUS,
  USER_ACCOUNT_STATUS,
  USER_ROLES,
} from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import {
  STAFF_PERMISSIONS,
  type StaffPermission,
} from "@/config/permissions.config";
import { sendReturnRequestOwnerEmail } from "@/lib/email/return-emails";
import { getSettings, type ISettings } from "@/models/settings.model";
import { RETURN_STATUS } from "@/lib/returns/returns";
import {
  hasAnyNotificationChannel,
  normalizeNotificationSettings,
  type NotificationChannelSettings,
} from "@/lib/notifications/notification-settings";
import { appBaseUrl } from "@/lib/app-url";

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  data?: Record<string, unknown>;
  dedupe?: Record<string, unknown>;
  sendPush?: boolean;
}

/**
 * Create a notification for a user
 */
export async function createNotification(params: CreateNotificationParams) {
  try {
    await connectDB();
    if (params.dedupe) {
      const existing = await Notification.findOne({
        userId: params.userId,
        ...params.dedupe,
      });
      if (existing) return existing;
    }

    const notificationParams = {
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      data: params.data,
    };
    const notification = await Notification.create(notificationParams);

    if (params.sendPush !== false) {
      await sendPushToUser(params.userId, {
        title: params.title,
        body: params.message,
        url: params.link,
        tag: String(notification._id),
        type: params.type,
        notificationId: String(notification._id),
      }).catch((error) => {
        console.error("Failed to send browser push notification:", error);
      });
    }

    return notification;
  } catch (error) {
    console.error("Failed to create notification:", error);
    return null;
  }
}

async function createConfiguredNotification(
  params: CreateNotificationParams,
  channels: NotificationChannelSettings,
) {
  if (channels.inApp) {
    return createNotification({
      ...params,
      sendPush: channels.browserPush,
    });
  }

  if (channels.browserPush) {
    await sendPushToUser(params.userId, {
      title: params.title,
      body: params.message,
      url: params.link,
      tag: `${params.type}:${params.userId}:${Date.now()}`,
      type: params.type,
    }).catch((error) => {
      console.error("Failed to send browser push notification:", error);
    });
  }

  return null;
}

async function sendNotificationEmailToUser(params: {
  to?: string;
  recipientName?: string;
  title: string;
  message: string;
  link?: string;
  settings?: ISettings;
}) {
  if (!params.to) return false;
  return sendEmail({
    to: params.to,
    subject: params.title,
    html: buildCustomerNotificationEmailHtml({
      title: params.title,
      message: params.message,
      customerName: params.recipientName,
      link: params.link,
      settings: params.settings,
    }),
    settings: params.settings,
  });
}

async function notifyStaffUsers(params: {
  permissions: StaffPermission[];
  channels: NotificationChannelSettings;
  type: NotificationType;
  title: string;
  message: string;
  link: string;
  data: Record<string, unknown>;
  dedupe: Record<string, unknown>;
  settings: ISettings;
}) {
  if (!hasAnyNotificationChannel(params.channels)) return;

  const staffUsers = await getStaffNotificationUsers(params.permissions);
  await Promise.allSettled(
    staffUsers.map(async (staffUser) => {
      const staffUserId = getIdString(staffUser._id);
      if (!staffUserId) return;

      await createConfiguredNotification(
        {
          userId: staffUserId,
          type: params.type,
          title: params.title,
          message: params.message,
          link: params.link,
          data: {
            ...params.data,
            recipientRole: USER_ROLES.STAFF,
          },
          dedupe: {
            ...params.dedupe,
            "data.recipientRole": USER_ROLES.STAFF,
          },
        },
        params.channels,
      );

      if (params.channels.email && staffUser.email) {
        await sendNotificationEmailToUser({
          to: staffUser.email,
          recipientName: staffUser.name,
          title: params.title,
          message: params.message,
          link: params.link,
          settings: params.settings,
        });
      }
    }),
  );
}

/**
 * Create new order notification for admins
 */
async function notifyAdminNewOrder(
  adminUserId: string,
  orderNumber: string,
  options: {
    orderId?: string;
    itemCount?: number;
    total?: number;
    channel?: string;
    adminEmail?: string;
    adminName?: string;
    settings?: ISettings;
    channels?: NotificationChannelSettings;
  } = {},
) {
  const channels =
    options.channels ||
    normalizeNotificationSettings(options.settings?.notifications).admin
      .newOrders;
  if (!hasAnyNotificationChannel(channels)) return null;

  const itemCountText =
    typeof options.itemCount === "number" && options.itemCount > 0
      ? ` with ${options.itemCount} item${options.itemCount === 1 ? "" : "s"}`
      : "";
  const channelText = options.channel === "pos" ? " from POS" : "";
  const totalText =
    typeof options.total === "number" && Number.isFinite(options.total)
      ? ` Total: $${options.total.toFixed(2)}.`
      : "";
  const title = "New Order Received";
  const message = `A new order #${orderNumber}${itemCountText} was placed${channelText}.${totalText}`;
  const link = options.orderId ? `/admin/orders/${options.orderId}` : "/admin/orders";

  const notification = await createConfiguredNotification({
    userId: adminUserId,
    type: NotificationType.ORDER_PLACED,
    title,
    message,
    link,
    data: {
      orderNumber,
      orderId: options.orderId,
      itemCount: options.itemCount,
      total: options.total,
      channel: options.channel,
      recipientRole: USER_ROLES.ADMIN,
    },
    dedupe: {
      type: NotificationType.ORDER_PLACED,
      "data.orderNumber": orderNumber,
      "data.recipientRole": USER_ROLES.ADMIN,
    },
  }, channels);

  if (channels.email && options.adminEmail) {
    await sendNotificationEmailToUser({
      to: options.adminEmail,
      recipientName: options.adminName,
      title,
      message,
      link,
      settings: options.settings,
    });
  }

  return notification;
}

/**
 * Create order placed notification for customer
 */
async function notifyOrderPlaced(
  userId: string,
  orderNumber: string,
  orderId?: string,
  options: {
    settings?: ISettings;
    channels?: NotificationChannelSettings;
    status?: string;
    channel?: string;
    recipientRole?: string;
  } = {},
) {
  const channels =
    options.channels ||
    normalizeNotificationSettings(options.settings?.notifications).customer
      .orderUpdates;
  if (!hasAnyNotificationChannel(channels)) return null;

  const copy = buildOrderPlacedNotificationCopy({
    orderNumber,
    orderId,
    status: options.status,
    channel: options.channel,
    recipientRole: options.recipientRole,
  });
  const notification = await createConfiguredNotification({
    userId,
    type: copy.type,
    title: copy.title,
    message: copy.message,
    link: copy.link,
    data: {
      orderNumber,
      orderId,
      status: copy.status,
      channel: options.channel,
      recipientRole: copy.recipientRole,
    },
    dedupe: {
      type: copy.type,
      "data.orderNumber": orderNumber,
      "data.recipientRole": copy.recipientRole,
    },
  }, channels);

  if (channels.email) {
    await sendCustomerNotificationEmail({
      userId,
      title: copy.title,
      message: copy.message,
      link: copy.link,
      settings: options.settings,
    });
  }

  return notification;
}

export function buildOrderPlacedNotificationCopy(params: {
  orderNumber: string;
  orderId?: string;
  status?: string;
  channel?: string;
  recipientRole?: string;
}) {
  const recipientRole = params.recipientRole || USER_ROLES.CUSTOMER;
  const status = params.status || ORDER_STATUS.PENDING;
  const isPosComplete =
    params.channel === "pos" && status === ORDER_STATUS.DELIVERED;
  const link = buildOrderNotificationLink(recipientRole, params.orderId);

  if (isPosComplete) {
    const isCustomerRecipient = recipientRole === USER_ROLES.CUSTOMER;
    return {
      type: NotificationType.ORDER_DELIVERED,
      title: isCustomerRecipient ? "Order Complete" : "POS Order Complete",
      message: isCustomerRecipient
        ? `Your POS order #${params.orderNumber} is complete.`
        : `POS order #${params.orderNumber} has been completed.`,
      link,
      status,
      recipientRole,
    };
  }

  return {
    type: NotificationType.ORDER_PLACED,
    title: "Order Pending",
    message: `Your order #${params.orderNumber} has been placed and is now pending.`,
    link,
    status,
    recipientRole,
  };
}

function buildOrderNotificationLink(recipientRole: string, orderId?: string) {
  if (recipientRole === USER_ROLES.ADMIN) {
    return orderId ? `/admin/orders/${orderId}` : "/admin/orders";
  }
  if (isStaffRole(recipientRole)) {
    return orderId ? `/staff/orders/${orderId}` : "/staff/orders";
  }
  if (recipientRole === USER_ROLES.VENDOR) {
    return orderId ? `/vendor/orders/${orderId}` : "/vendor/orders";
  }
  return orderId ? `/account/orders/${orderId}` : "/account/orders";
}

async function resolveOrderNotificationRecipientRole(
  userId: string,
  adminUserIds: Set<string>,
) {
  if (adminUserIds.has(userId)) return USER_ROLES.ADMIN;

  await connectDB();
  const user = await User.findById(userId).select("role").lean();
  const role = (user as { role?: string } | null)?.role;
  if (role === USER_ROLES.ADMIN) return USER_ROLES.ADMIN;
  if (role === USER_ROLES.VENDOR) return USER_ROLES.VENDOR;
  if (isStaffRole(role)) return role;
  return USER_ROLES.CUSTOMER;
}

/**
 * Create order status update notification
 */
export async function notifyOrderStatus(
  userId: string,
  orderNumber: string,
  status: string,
  orderId?: string,
  options: {
    settings?: ISettings;
    channels?: NotificationChannelSettings;
  } = {},
) {
  const settings = options.settings || (await getSettings());
  const channels =
    options.channels ||
    normalizeNotificationSettings(settings.notifications).customer.orderUpdates;
  if (!hasAnyNotificationChannel(channels)) return null;

  const statusMessages: Record<string, string> = {
    pending: `Your order #${orderNumber} is now pending.`,
    processing: `Your order #${orderNumber} is now processing.`,
    shipped: `Your order #${orderNumber} has been shipped.`,
    delivered: `Your order #${orderNumber} has been delivered.`,
    cancelled: `Your order #${orderNumber} has been cancelled.`,
  };
  const statusTitle = status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const title = `Order ${statusTitle}`;
  const message =
    statusMessages[status] || `Order #${orderNumber} status: ${status}`;
  const link = orderId ? `/account/orders/${orderId}` : `/account/orders`;

  const notification = await createConfiguredNotification({
    userId,
    type:
      status === "delivered"
        ? NotificationType.ORDER_DELIVERED
        : NotificationType.ORDER_STATUS,
    title,
    message,
    link,
    data: { orderNumber, orderId, status, recipientRole: USER_ROLES.CUSTOMER },
    dedupe: {
      type:
        status === "delivered"
          ? NotificationType.ORDER_DELIVERED
          : NotificationType.ORDER_STATUS,
      "data.orderNumber": orderNumber,
      "data.status": status,
      "data.recipientRole": USER_ROLES.CUSTOMER,
    },
  }, channels);

  if (channels.email) {
    // Statuses with a purpose-built template get it — "shipped" is the one that
    // matters, since it is the only email that can carry the tracking number.
    // Everything else falls through to the generic notice.
    let sentRichEmail = false;
    if (orderId && hasOrderStatusEmail(status)) {
      // An order stores only a customerId, so the address is resolved here
      // rather than inside the mailer.
      await connectDB();
      const customer = await User.findById(userId).select("email").lean();
      const customerEmail = (customer as { email?: string } | null)?.email;
      if (customerEmail) {
        sentRichEmail = await sendOrderStatusEmailForOrder({
          orderId,
          status,
          customerEmail,
          settings,
        });
      }
    }

    if (!sentRichEmail) {
      await sendCustomerNotificationEmail({
        userId,
        title,
        message,
        link,
        settings,
      });
    }
  }

  return notification;
}

export async function notifyPreorderCustomerUpdate(
  userId: string,
  orderNumber: string,
  status:
    | "reserved"
    | "payment_due"
    | "delayed"
    | "partially_ready"
    | "ready"
    | "cancelled"
    | "fulfilled"
    | "expired",
  orderId?: string,
  options: {
    releaseDate?: Date | string;
    previousReleaseDate?: Date | string;
    reason?: string;
    outstandingAmount?: number;
    settings?: ISettings;
    channels?: NotificationChannelSettings;
  } = {},
) {
  const settings = options.settings || (await getSettings());
  const channels =
    options.channels ||
    normalizeNotificationSettings(settings.notifications).customer.orderUpdates;
  if (!hasAnyNotificationChannel(channels)) return null;

  const formatDate = (value?: Date | string) => {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };
  const releaseDate = formatDate(options.releaseDate);
  const previousReleaseDate = formatDate(options.previousReleaseDate);
  const reason = options.reason?.trim();
  const outstandingAmount =
    typeof options.outstandingAmount === "number" &&
    Number.isFinite(options.outstandingAmount) &&
    options.outstandingAmount > 0
      ? options.outstandingAmount
      : undefined;

  const copy: Record<typeof status, { title: string; message: string }> = {
    reserved: {
      title: "Pre-order Reserved",
      message: `Your pre-order #${orderNumber} has been reserved${
        releaseDate ? ` and is expected around ${releaseDate}` : ""
      }.`,
    },
    ready: {
      title: "Pre-order Ready",
      message: `Your pre-order #${orderNumber} is ready for fulfillment.`,
    },
    payment_due: {
      title: "Pre-order Payment Due",
      message: `Your pre-order #${orderNumber} is ready. Please pay the remaining balance${
        outstandingAmount ? ` of ${outstandingAmount.toFixed(2)}` : ""
      } before fulfillment.`,
    },
    partially_ready: {
      title: "Pre-order Partially Ready",
      message: `Part of your pre-order #${orderNumber} is ready. We will update you when the rest is available.`,
    },
    delayed: {
      title: "Pre-order Date Updated",
      message: `Your pre-order #${orderNumber} expected date changed${
        previousReleaseDate ? ` from ${previousReleaseDate}` : ""
      }${releaseDate ? ` to ${releaseDate}` : ""}.${
        reason ? ` Reason: ${reason}` : ""
      }`,
    },
    cancelled: {
      title: "Pre-order Cancelled",
      message: `Your pre-order #${orderNumber} has been cancelled.`,
    },
    fulfilled: {
      title: "Pre-order Fulfilled",
      message: `Your pre-order #${orderNumber} has been fulfilled.`,
    },
    expired: {
      title: "Pre-order Expired",
      message: `Your pre-order #${orderNumber} expired because the required payment was not completed in time.`,
    },
  };

  const link = orderId ? `/account/orders/${orderId}` : "/account/orders";
  const notification = await createConfiguredNotification({
    userId,
    type: NotificationType.ORDER_STATUS,
    title: copy[status].title,
    message: copy[status].message,
    link,
    data: {
      orderNumber,
      orderId,
      status,
      releaseDate,
      previousReleaseDate,
      outstandingAmount,
      recipientRole: USER_ROLES.CUSTOMER,
    },
    dedupe: {
      type: NotificationType.ORDER_STATUS,
      "data.orderNumber": orderNumber,
      "data.status": status,
      "data.releaseDate": releaseDate,
      "data.recipientRole": USER_ROLES.CUSTOMER,
    },
  }, channels);

  if (channels.email) {
    await sendCustomerNotificationEmail({
      userId,
      title: copy[status].title,
      message: copy[status].message,
      link,
      settings,
    });
  }

  return notification;
}

/**
 * Create new order notification for vendor
 */
async function notifyVendorNewOrder(
  vendorUserId: string,
  orderNumber: string,
  itemCount: number,
  options: {
    vendorEmail?: string;
    vendorName?: string;
    settings?: ISettings;
    channels?: NotificationChannelSettings;
  } = {},
) {
  const channels =
    options.channels ||
    normalizeNotificationSettings(options.settings?.notifications).vendor
      .newOrders;
  if (!hasAnyNotificationChannel(channels)) return null;

  const title = "New Order Received";
  const message = `You have a new order #${orderNumber} with ${itemCount} item(s).`;
  const link = "/vendor/orders";

  const notification = await createConfiguredNotification({
    userId: vendorUserId,
    type: NotificationType.ORDER_PLACED,
    title,
    message,
    link,
    data: { orderNumber, itemCount, recipientRole: USER_ROLES.VENDOR },
    dedupe: {
      type: NotificationType.ORDER_PLACED,
      "data.orderNumber": orderNumber,
      "data.recipientRole": USER_ROLES.VENDOR,
    },
  }, channels);

  if (channels.email && options.vendorEmail) {
    await sendNotificationEmailToUser({
      to: options.vendorEmail,
      recipientName: options.vendorName,
      title,
      message,
      link,
      settings: options.settings,
    });
  }

  return notification;
}

/**
 * Create vendor application status notification
 */
export async function notifyVendorApplicationStatus(
  userId: string,
  status: "approved" | "rejected" | "payment_required" | "payment_expired",
  options: {
    settings?: ISettings;
    channels?: NotificationChannelSettings;
    /** Rejection only: what the admin wrote, so the re-application is informed. */
    reason?: string | null;
  } = {},
) {
  const channels =
    options.channels ||
    normalizeNotificationSettings(options.settings?.notifications).vendor
      .applicationStatus;
  if (!channels.inApp && !channels.browserPush) return null;

  const reason = options.reason?.trim();
  return createConfiguredNotification({
    userId,
    type: NotificationType.VENDOR_APPLICATION,
    title:
      status === "approved"
        ? "Vendor Account Activated"
        : status === "payment_required"
          ? "Vendor Verification Approved"
          : status === "payment_expired"
            ? "Vendor Setup Access Ended"
            : "Vendor Application Update",
    message:
      status === "approved"
        ? "Your subscription is active and your vendor store can now start selling."
        : status === "payment_required"
          ? "Your application passed review. You have 7 days of setup access. Complete payment to activate selling."
          : status === "payment_expired"
            ? "Your setup access ended because payment was not completed. You can still complete payment to reactivate your vendor dashboard."
            : `Your vendor application was not approved.${reason ? ` Reason: ${reason}` : ""} You can update your details and apply again.`,
    link:
      status === "rejected" ? "/become-vendor" : "/vendor/dashboard",
    data: { status },
  }, channels);
}

/**
 * Create a pending vendor application notification for an admin.
 */
export async function notifyAdminVendorApplicationPending(
  adminUserId: string,
  application: {
    vendorId: string;
    storeName: string;
    vendorName?: string;
    vendorEmail?: string;
  },
  options: {
    settings?: ISettings;
    channels?: NotificationChannelSettings;
  } = {},
) {
  const channels =
    options.channels ||
    normalizeNotificationSettings(options.settings?.notifications).admin
      .newVendors;
  if (!channels.inApp && !channels.browserPush) return null;

  return createConfiguredNotification({
    userId: adminUserId,
    type: NotificationType.VENDOR_APPLICATION,
    title: "New Vendor Application Pending",
    message: `${application.storeName} has submitted a new vendor application. Status: pending.`,
    link: `/admin/vendors/${application.vendorId}`,
    data: {
      vendorId: application.vendorId,
      storeName: application.storeName,
      vendorName: application.vendorName,
      vendorEmail: application.vendorEmail,
      status: "pending",
      recipientRole: USER_ROLES.ADMIN,
    },
    dedupe: {
      type: NotificationType.VENDOR_APPLICATION,
      "data.vendorId": application.vendorId,
      "data.status": "pending",
      "data.recipientRole": USER_ROLES.ADMIN,
    },
  }, channels);
}

/**
 * Notify admins when a customer profile is created.
 */
export async function notifyAdminsNewCustomer(
  customer: {
    customerId?: string;
    name?: string;
    email?: string;
    createdBy?: string;
  },
  options: {
    settings?: ISettings;
  } = {},
) {
  try {
    await connectDB();
    const settings = options.settings || (await getSettings());
    const notificationSettings = normalizeNotificationSettings(
      settings.notifications,
    );
    const channels = notificationSettings.admin.newCustomers;
    const staffChannels = notificationSettings.staff.newCustomers;
    if (
      !hasAnyNotificationChannel(channels) &&
      !hasAnyNotificationChannel(staffChannels)
    ) {
      return;
    }

    const admins = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      status: { $ne: USER_ACCOUNT_STATUS.BANNED },
    })
      .select("_id name email")
      .lean();

    const customerLabel = customer.name || customer.email || "A customer";
    const title = "New Customer Created";
    const message = `${customerLabel} has been added as a customer.`;
    const link = customer.customerId
      ? `/admin/customers/${customer.customerId}`
      : "/admin/customers";

    await Promise.allSettled(
      [
        ...admins.map(async (admin) => {
          const adminUserId = getIdString(admin._id);
          if (!adminUserId) return;

          await createConfiguredNotification(
            {
              userId: adminUserId,
              type: NotificationType.SYSTEM,
              title,
              message,
              link,
              data: {
                event: "new_customer",
                customerId: customer.customerId,
                customerName: customer.name,
                customerEmail: customer.email,
                createdBy: customer.createdBy,
                recipientRole: USER_ROLES.ADMIN,
              },
              dedupe: {
                type: NotificationType.SYSTEM,
                "data.event": "new_customer",
                "data.customerId": customer.customerId,
                "data.recipientRole": USER_ROLES.ADMIN,
              },
            },
            channels,
          );

          if (channels.email && admin.email) {
            await sendNotificationEmailToUser({
              to: admin.email,
              recipientName: admin.name,
              title,
              message,
              link,
              settings,
            });
          }
        }),
        notifyStaffUsers({
          permissions: [
            STAFF_PERMISSIONS.VIEW_CUSTOMERS,
            STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
            STAFF_PERMISSIONS.CREATE_CUSTOMERS,
            STAFF_PERMISSIONS.EDIT_CUSTOMERS,
          ],
          channels: staffChannels,
          type: NotificationType.SYSTEM,
          title,
          message,
          link,
          data: {
            event: "new_customer",
            customerId: customer.customerId,
            customerName: customer.name,
            customerEmail: customer.email,
            createdBy: customer.createdBy,
          },
          dedupe: {
            type: NotificationType.SYSTEM,
            "data.event": "new_customer",
            "data.customerId": customer.customerId,
          },
          settings,
        }),
      ],
    );
  } catch (error) {
    console.error("Failed to notify admins about new customer:", error);
  }
}

/**
 * Notify admins when a payment charge is recorded.
 */
export async function notifyAdminsPaymentReceived(
  payment: {
    orderId?: string;
    orderNumber?: string;
    amount?: number;
    currency?: string;
    paymentMethod?: string;
  },
  options: {
    settings?: ISettings;
  } = {},
) {
  try {
    await connectDB();
    const settings = options.settings || (await getSettings());
    const notificationSettings = normalizeNotificationSettings(
      settings.notifications,
    );
    const channels = notificationSettings.admin.payments;
    const staffChannels = notificationSettings.staff.payments;
    if (
      !hasAnyNotificationChannel(channels) &&
      !hasAnyNotificationChannel(staffChannels)
    ) {
      return;
    }

    const admins = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      status: { $ne: USER_ACCOUNT_STATUS.BANNED },
    })
      .select("_id name email")
      .lean();

    const amount = Number(payment.amount || 0);
    const formattedAmount = Number.isFinite(amount)
      ? `${payment.currency || "USD"} ${amount.toFixed(2)}`
      : payment.currency || "Payment";
    const orderNumber = payment.orderNumber || "unknown";
    const title = "Payment Received";
    const message = `Payment ${formattedAmount} was recorded for order #${orderNumber}.`;
    const link = payment.orderId
      ? `/admin/orders/${payment.orderId}`
      : "/admin/payments";

    await Promise.allSettled(
      [
        ...admins.map(async (admin) => {
          const adminUserId = getIdString(admin._id);
          if (!adminUserId) return;

          await createConfiguredNotification(
            {
              userId: adminUserId,
              type: NotificationType.PAYMENT_RECEIVED,
              title,
              message,
              link,
              data: {
                orderId: payment.orderId,
                orderNumber: payment.orderNumber,
                amount: payment.amount,
                currency: payment.currency,
                paymentMethod: payment.paymentMethod,
                recipientRole: USER_ROLES.ADMIN,
              },
              dedupe: {
                type: NotificationType.PAYMENT_RECEIVED,
                "data.orderId": payment.orderId,
                "data.recipientRole": USER_ROLES.ADMIN,
              },
            },
            channels,
          );

          if (channels.email && admin.email) {
            await sendNotificationEmailToUser({
              to: admin.email,
              recipientName: admin.name,
              title,
              message,
              link,
              settings,
            });
          }
        }),
        notifyStaffUsers({
          permissions: [
            STAFF_PERMISSIONS.ACCESS_POS,
            STAFF_PERMISSIONS.MANAGE_POS,
            STAFF_PERMISSIONS.VIEW_ORDERS,
            STAFF_PERMISSIONS.MANAGE_ORDERS,
          ],
          channels: staffChannels,
          type: NotificationType.PAYMENT_RECEIVED,
          title,
          message,
          link,
          data: {
            orderId: payment.orderId,
            orderNumber: payment.orderNumber,
            amount: payment.amount,
            currency: payment.currency,
            paymentMethod: payment.paymentMethod,
          },
          dedupe: {
            type: NotificationType.PAYMENT_RECEIVED,
            "data.orderId": payment.orderId,
          },
          settings,
        }),
      ],
    );
  } catch (error) {
    console.error("Failed to notify admins about payment:", error);
  }
}

/**
 * Alert admins that a captured payment was NOT fulfilled and needs eyes —
 * e.g. a Stripe payment rejected by the cart-tamper guard (auto-refund
 * attempted). Money moved without an order, so this must never be silent.
 */
export async function notifyAdminsPaymentAnomaly(anomaly: {
  title: string;
  message: string;
  paymentIntentId?: string;
  cartId?: string;
}) {
  try {
    await connectDB();
    const settings = await getSettings();

    const admins = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      status: { $ne: USER_ACCOUNT_STATUS.BANNED },
    })
      .select("_id name email")
      .lean();

    // The in-app copy below is deduped by createNotification, but the email
    // has no memory of its own — without this check it would go out again on
    // every call while the anomaly persists (the cron-health check runs on
    // every admin dashboard load). One query for all admins, not one each.
    const alreadyNotifiedAdminIds = new Set<string>();
    if (anomaly.paymentIntentId) {
      const priorNotifications = await Notification.find({
        userId: { $in: admins.map((admin) => String(admin._id)) },
        type: NotificationType.SYSTEM,
        "data.paymentIntentId": anomaly.paymentIntentId,
        "data.recipientRole": USER_ROLES.ADMIN,
      })
        .select("userId")
        .lean();
      for (const notification of priorNotifications) {
        alreadyNotifiedAdminIds.add(String(notification.userId));
      }
    }

    await Promise.allSettled(
      admins.map(async (admin) => {
        const adminUserId = getIdString(admin._id);
        if (!adminUserId) return;
        if (alreadyNotifiedAdminIds.has(adminUserId)) return;

        // Bypass channel preferences: an unfulfilled captured payment is an
        // operational incident, not a routine payment notification.
        await createNotification({
          userId: adminUserId,
          type: NotificationType.SYSTEM,
          title: anomaly.title,
          message: anomaly.message,
          link: "/admin/payments",
          data: {
            paymentIntentId: anomaly.paymentIntentId,
            cartId: anomaly.cartId,
            recipientRole: USER_ROLES.ADMIN,
          },
          dedupe: anomaly.paymentIntentId
            ? {
                type: NotificationType.SYSTEM,
                "data.paymentIntentId": anomaly.paymentIntentId,
                "data.recipientRole": USER_ROLES.ADMIN,
              }
            : undefined,
        });

        if (admin.email) {
          await sendNotificationEmailToUser({
            to: admin.email,
            recipientName: admin.name,
            title: anomaly.title,
            message: anomaly.message,
            link: "/admin/payments",
            settings,
          });
        }
      }),
    );
  } catch (error) {
    console.error("Failed to notify admins about payment anomaly:", error);
  }
}

/**
 * Create low stock notification for vendor
 */
export async function notifyLowStock(
  vendorUserId: string,
  productName: string,
  currentStock: number,
) {
  return createNotification({
    userId: vendorUserId,
    type: NotificationType.PRODUCT_LOW_STOCK,
    title: "Low Stock Alert",
    message: `"${productName}" is running low with only ${currentStock} items left.`,
    link: `/vendor/products`,
    data: { productName, currentStock },
  });
}

/**
 * Notify staff with inventory access about a low-stock product.
 */
export async function notifyStaffLowStock(
  productName: string,
  currentStock: number,
  options: {
    productId?: string;
    settings?: ISettings;
  } = {},
) {
  const settings = options.settings || (await getSettings());
  const channels = normalizeNotificationSettings(settings.notifications).staff
    .lowStock;
  const link = options.productId
    ? `/staff/products/${options.productId}/edit`
    : "/staff/inventory";

  await notifyStaffUsers({
    permissions: [
      STAFF_PERMISSIONS.VIEW_INVENTORY,
      STAFF_PERMISSIONS.MANAGE_INVENTORY,
      STAFF_PERMISSIONS.EDIT_INVENTORY,
    ],
    channels,
    type: NotificationType.PRODUCT_LOW_STOCK,
    title: "Low Stock Alert",
    message: `"${productName}" is running low with only ${currentStock} items left.`,
    link,
    data: {
      productId: options.productId,
      productName,
      currentStock,
    },
    dedupe: {
      type: NotificationType.PRODUCT_LOW_STOCK,
      "data.productId": options.productId,
    },
    settings,
  });
}

type ReturnRequestLikeForNotification = {
  _id?: unknown;
  returnNumber?: string;
  orderNumber?: string;
  orderId?: unknown;
  customerId?: unknown;
  ownerType?: "admin" | "vendor";
  ownerVendorId?: unknown;
  status?: string;
  reason?: string;
  customerNote?: string;
  items?: Array<{
    name?: string;
    quantityRequested?: number;
    unitPrice?: number;
  }>;
  estimatedRefund?: {
    total?: number;
    currency?: string;
  };
};

type OrderLikeForNotification = {
  _id?: unknown;
  orderNumber?: string;
  customerId?: unknown;
  total?: number;
  status?: string;
  channel?: string;
  staffId?: unknown;
  subOrders?: Array<{
    vendorId?: unknown;
    items?: unknown[];
  }>;
  items?: unknown[];
};

function getIdString(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const maybeObject = value as {
    _id?: unknown;
    toHexString?: () => string;
    toString?: () => string;
  };
  if (typeof maybeObject.toHexString === "function") {
    return maybeObject.toHexString();
  }
  if (typeof maybeObject.toString === "function") {
    const text = maybeObject.toString();
    if (text && text !== "[object Object]") return text;
  }
  if (maybeObject._id && maybeObject._id !== value) {
    return getIdString(maybeObject._id);
  }
  return "";
}

async function getStaffNotificationUsers(requiredPermissions: StaffPermission[]) {
  await connectDB();
  const profiles = await StaffProfile.find({
    isActive: true,
    permissions: { $in: requiredPermissions },
  })
    .select("userId permissions")
    .populate("userId", "name email status")
    .lean();

  const users = new Map<
    string,
    { _id?: unknown; name?: string; email?: string; status?: string }
  >();

  for (const profile of profiles) {
    const user = profile.userId as
      | { _id?: unknown; name?: string; email?: string; status?: string }
      | undefined;
    const userId = getIdString(user || profile.userId);
    if (
      !userId ||
      (user?.status && user.status !== USER_ACCOUNT_STATUS.ACTIVE)
    ) {
      continue;
    }
    users.set(userId, user || { _id: profile.userId });
  }

  return Array.from(users.values());
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCustomerNotificationEmailHtml(params: {
  title: string;
  message: string;
  customerName?: string;
  link?: string;
  settings?: ISettings;
}) {
  const storeName =
    params.settings?.general?.storeName ||
    process.env.NEXT_PUBLIC_APP_NAME ||
    DEFAULT_STORE_NAME;
  const logoUrl = params.settings?.general?.logoUrl;
  const href = params.link
    ? `${appBaseUrl()}${params.link.startsWith("/") ? params.link : `/${params.link}`}`
    : appBaseUrl();

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(params.title)}</title>
</head>
<body style="margin:0; padding:0; background:#f4f4f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="max-width:600px; margin:0 auto; padding:24px;">
    <div style="text-align:center; padding:16px 0 24px;">
      ${
        logoUrl
          ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(storeName)}" style="max-height:42px; max-width:180px;" />`
          : `<div style="font-size:24px; font-weight:700; color:#18181b;">${escapeHtml(storeName)}</div>`
      }
    </div>
    <div style="background:#ffffff; border-radius:8px; padding:32px; box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <p style="margin:0 0 16px; color:#52525b; font-size:14px;">Hi ${escapeHtml(params.customerName || "there")},</p>
      <h1 style="margin:0 0 10px; color:#18181b; font-size:22px; line-height:1.3;">${escapeHtml(params.title)}</h1>
      <p style="margin:0; color:#52525b; font-size:15px; line-height:1.6;">${escapeHtml(params.message)}</p>
      <div style="height:1px; background:#e4e4e7; margin:24px 0;"></div>
      <a href="${escapeHtml(href)}" style="display:inline-block; padding:12px 18px; background:#18181b; color:#ffffff; text-decoration:none; border-radius:6px; font-size:14px; font-weight:600;">View details</a>
    </div>
    <div style="text-align:center; padding:20px; color:#71717a; font-size:12px;">
      <p style="margin:0 0 6px;">You're receiving this email because this update is available in your ${escapeHtml(storeName)} notifications.</p>
      <p style="margin:0;">&copy; ${new Date().getFullYear()} ${escapeHtml(storeName)}. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
}

async function sendCustomerNotificationEmail(params: {
  userId: string;
  title: string;
  message: string;
  link?: string;
  settings?: ISettings;
}) {
  try {
    await connectDB();
    const user = await User.findById(params.userId).select("name email").lean();
    if (!user?.email) return false;

    const settings = params.settings || (await getSettings());
    return sendEmail({
      to: user.email,
      subject: params.title,
      html: buildCustomerNotificationEmailHtml({
        title: params.title,
        message: params.message,
        customerName: user.name,
        link: params.link,
        settings,
      }),
      settings,
    });
  } catch (error) {
    console.error("Failed to send customer notification email:", error);
    return false;
  }
}

function buildReturnRequestOwnerNotification(
  returnRequest: ReturnRequestLikeForNotification,
  recipientRole: typeof USER_ROLES.ADMIN | typeof USER_ROLES.VENDOR,
) {
  const returnNumber = returnRequest.returnNumber || "new return";
  const orderNumber = returnRequest.orderNumber || "unknown";
  const itemCount = Array.isArray(returnRequest.items)
    ? returnRequest.items.reduce(
        (sum, item) => sum + Number(item.quantityRequested || 0),
        0,
      )
    : 0;
  const itemText =
    itemCount > 0 ? ` with ${itemCount} item${itemCount === 1 ? "" : "s"}` : "";
  const link =
    recipientRole === USER_ROLES.VENDOR ? "/vendor/returns" : "/admin/returns";

  return {
    title: "New Return Request",
    message: `Return request #${returnNumber}${itemText} was submitted for order #${orderNumber}.`,
    link,
    data: {
      returnNumber,
      returnRequestId: getIdString(returnRequest._id),
      orderNumber,
      customerId: getIdString(returnRequest.customerId),
      recipientRole,
    },
  };
}

async function notifyReturnRequestOwnerUser(
  user: { _id?: unknown; name?: string; email?: string },
  returnRequest: ReturnRequestLikeForNotification,
  recipientRole: typeof USER_ROLES.ADMIN | typeof USER_ROLES.VENDOR,
  settings?: ISettings,
  customer?: { name?: string; email?: string },
) {
  const userId = getIdString(user._id);
  if (!userId) return;

  const notification = buildReturnRequestOwnerNotification(
    returnRequest,
    recipientRole,
  );
  const notificationSettings = normalizeNotificationSettings(
    settings?.notifications,
  );
  const channels =
    recipientRole === USER_ROLES.ADMIN
      ? notificationSettings.admin.returns
      : notificationSettings.vendor.returns;
  if (!hasAnyNotificationChannel(channels)) return;

  const jobs: Promise<unknown>[] = [
    createConfiguredNotification({
      userId,
      type: NotificationType.RETURN_REQUEST,
      ...notification,
      dedupe: {
        type: NotificationType.RETURN_REQUEST,
        "data.returnRequestId": notification.data.returnRequestId,
        "data.recipientRole": recipientRole,
      },
    }, channels),
  ];

  if (channels.email && user.email) {
    jobs.push(
      sendReturnRequestOwnerEmail(
        {
          to: user.email,
          recipientName: user.name || "there",
          returnNumber: returnRequest.returnNumber || "new return",
          orderNumber: returnRequest.orderNumber || "",
          customerName: customer?.name || "Customer",
          customerEmail: customer?.email,
          reason: returnRequest.reason || "Return requested",
          customerNote: returnRequest.customerNote,
          items: (returnRequest.items || []).map((item) => ({
            name: item.name || "Item",
            quantity: Number(item.quantityRequested || 0),
            unitPrice: Number(item.unitPrice || 0),
          })),
          estimatedRefundTotal: Number(returnRequest.estimatedRefund?.total || 0),
          currency: returnRequest.estimatedRefund?.currency || "USD",
          dashboardUrl: `${appBaseUrl()}${notification.link}`,
        },
        settings,
      )
        .then((sent) => {
          if (!sent) {
            console.error(
              `Failed to send return request owner email to ${user.email}`,
            );
          }
          return sent;
        })
        .catch((error: unknown) => {
          console.error("Failed to send return request owner email:", error);
        }),
    );
  }

  await Promise.allSettled(jobs);
}

export async function notifyReturnRequestSubmitted(
  returnRequest: ReturnRequestLikeForNotification,
  settings?: ISettings,
) {
  try {
    await connectDB();

    const customerId = getIdString(returnRequest.customerId);
    const customer = customerId
      ? await User.findById(customerId).select("name email").lean()
      : null;
    const customerNotificationJob = customerId
      ? notifyReturnRequestCustomer(
          returnRequest,
          RETURN_STATUS.REQUESTED,
          settings,
        )
      : Promise.resolve();

    // A vendor-owned return notifies the vendor AND the admin. It used to stop
    // at the vendor and return, so the party holding the money never learned a
    // refund had been asked for — and a queue nobody can see is a queue nobody
    // works. The vendor still inspects the goods; the admin still pays.
    const ownerJobs: Promise<unknown>[] = [];
    if (returnRequest.ownerType === "vendor") {
      const ownerVendorId = getIdString(returnRequest.ownerVendorId);
      const vendor = ownerVendorId
        ? await Vendor.findById(ownerVendorId)
            .select("userId")
            .populate("userId", "name email status")
            .lean()
        : null;
      const vendorUser = vendor?.userId as
        | { _id?: unknown; name?: string; email?: string; status?: string }
        | undefined;

      if (vendorUser && vendorUser.status !== USER_ACCOUNT_STATUS.BANNED) {
        ownerJobs.push(
          notifyReturnRequestOwnerUser(
            vendorUser,
            returnRequest,
            USER_ROLES.VENDOR,
            settings,
            customer || undefined,
          ),
        );
      }
    }

    const admins = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      status: { $ne: USER_ACCOUNT_STATUS.BANNED },
    })
      .select("_id name email")
      .lean();
    const resolvedSettings = settings || (await getSettings());
    const returnNumber = returnRequest.returnNumber || "new return";
    const orderNumber = returnRequest.orderNumber || "unknown";
    const returnRequestId = getIdString(returnRequest._id);

    await Promise.allSettled(
      [
        customerNotificationJob,
        ...ownerJobs,
        ...admins.map((admin) =>
          notifyReturnRequestOwnerUser(
            admin,
            returnRequest,
            USER_ROLES.ADMIN,
            resolvedSettings,
            customer || undefined,
          ),
        ),
        notifyStaffUsers({
          permissions: [
            STAFF_PERMISSIONS.VIEW_ORDERS,
            STAFF_PERMISSIONS.MANAGE_ORDERS,
            STAFF_PERMISSIONS.EDIT_ORDERS,
          ],
          channels: normalizeNotificationSettings(resolvedSettings.notifications)
            .staff.returns,
          type: NotificationType.RETURN_REQUEST,
          title: "New Return Request",
          message: `Return request #${returnNumber} was submitted for order #${orderNumber}.`,
          link: "/staff/orders",
          data: {
            returnNumber,
            returnRequestId,
            orderNumber,
            customerId: getIdString(returnRequest.customerId),
          },
          dedupe: {
            type: NotificationType.RETURN_REQUEST,
            "data.returnRequestId": returnRequestId,
          },
          settings: resolvedSettings,
        }),
      ],
    );
  } catch (error) {
    console.error("Failed to create return request notifications:", error);
  }
}

/**
 * Create a return request lifecycle notification for the customer.
 */
export async function notifyReturnRequestCustomer(
  returnRequest: ReturnRequestLikeForNotification,
  status?: string,
  settings?: ISettings,
) {
  const customerId = getIdString(returnRequest.customerId);
  if (!customerId) return null;

  const returnNumber = returnRequest.returnNumber || "return request";
  const orderNumber = returnRequest.orderNumber || "your order";
  const returnRequestId = getIdString(returnRequest._id);
  const orderId = getIdString(returnRequest.orderId);
  const nextStatus = status || returnRequest.status || RETURN_STATUS.REQUESTED;
  const itemCount = Array.isArray(returnRequest.items)
    ? returnRequest.items.reduce(
        (sum, item) => sum + Number(item.quantityRequested || 0),
        0,
      )
    : 0;
  const itemText =
    itemCount > 0 ? ` with ${itemCount} item${itemCount === 1 ? "" : "s"}` : "";

  const statusCopy: Record<string, { title: string; message: string }> = {
    [RETURN_STATUS.REQUESTED]: {
      title: "Return Request Pending",
      message: `Return request #${returnNumber}${itemText} for order #${orderNumber} is pending review.`,
    },
    [RETURN_STATUS.APPROVED]: {
      title: "Return Request Approved",
      message: `Return request #${returnNumber} for order #${orderNumber} has been approved.`,
    },
    [RETURN_STATUS.AWAITING_SHIPMENT]: {
      title: "Return Awaiting Shipment",
      message: `Return request #${returnNumber} is approved and waiting for return shipment.`,
    },
    [RETURN_STATUS.IN_TRANSIT]: {
      title: "Return In Transit",
      message: `Return request #${returnNumber} is now in transit.`,
    },
    [RETURN_STATUS.RECEIVED]: {
      title: "Return Request Accepted",
      message: `Return request #${returnNumber} has been received and accepted for review.`,
    },
    [RETURN_STATUS.INSPECTED]: {
      title: "Return Request Inspected",
      message: `Return request #${returnNumber} has been inspected.`,
    },
    [RETURN_STATUS.REFUND_PENDING]: {
      title: "Return Refund Pending",
      message: `Refund processing has started for return request #${returnNumber}.`,
    },
    [RETURN_STATUS.PARTIALLY_REFUNDED]: {
      title: "Return Partially Refunded",
      message: `A partial refund has been issued for return request #${returnNumber}.`,
    },
    [RETURN_STATUS.REFUNDED]: {
      title: "Return Refunded",
      message: `Return request #${returnNumber} has been accepted and refunded.`,
    },
    [RETURN_STATUS.REJECTED]: {
      title: "Return Request Rejected",
      message: `Return request #${returnNumber} for order #${orderNumber} was rejected.`,
    },
    [RETURN_STATUS.CANCELLED]: {
      title: "Return Request Cancelled",
      message: `Return request #${returnNumber} for order #${orderNumber} was cancelled.`,
    },
    [RETURN_STATUS.CLOSED]: {
      title: "Return Request Closed",
      message: `Return request #${returnNumber} has been closed.`,
    },
  };

  const notification = statusCopy[nextStatus] || {
    title: "Return Request Updated",
    message: `Return request #${returnNumber} status is now ${nextStatus}.`,
  };
  const channels = normalizeNotificationSettings(settings?.notifications)
    .customer.returnUpdates;
  if (!hasAnyNotificationChannel(channels)) return null;

  const link = orderId ? `/account/orders/${orderId}` : "/account/orders";
  const createdNotification = await createConfiguredNotification({
    userId: customerId,
    type: NotificationType.RETURN_REQUEST,
    ...notification,
    link,
    data: {
      returnNumber,
      returnRequestId,
      orderNumber,
      orderId,
      status: nextStatus,
      recipientRole: USER_ROLES.CUSTOMER,
    },
    dedupe: {
      type: NotificationType.RETURN_REQUEST,
      "data.returnRequestId": returnRequestId,
      "data.status": nextStatus,
      "data.recipientRole": USER_ROLES.CUSTOMER,
    },
  }, channels);

  if (channels.email) {
    const emailSent = await sendCustomerNotificationEmail({
      userId: customerId,
      title: notification.title,
      message: notification.message,
      link,
      settings,
    });
    if (!emailSent) {
      console.error(
        `Failed to send return request customer email for ${returnNumber}`,
      );
    }
  }

  return createdNotification;
}

/**
 * Notify admins, the customer, and vendor owners when an order is created.
 */
export async function notifyOrderCreatedParticipants(
  order: OrderLikeForNotification,
  options: {
    notifyAdmins?: boolean;
    notifyCustomer?: boolean;
    notifyVendors?: boolean;
  } = {},
) {
  const notifyAdmins = options.notifyAdmins ?? true;
  const notifyCustomer = options.notifyCustomer ?? true;
  const notifyVendors = options.notifyVendors ?? true;
  const orderNumber = order.orderNumber || "new order";
  const orderId = getIdString(order._id);
  const itemCount = Array.isArray(order.items)
    ? order.items.length
    : (order.subOrders || []).reduce(
        (sum, subOrder) =>
          sum + (Array.isArray(subOrder.items) ? subOrder.items.length : 0),
        0,
      );
  const jobs: Promise<unknown>[] = [];
  const adminUserIds = new Set<string>();
  const settings = await getSettings();
  const notificationSettings = normalizeNotificationSettings(
    settings.notifications,
  );

  if (notifyAdmins) {
    await connectDB();
    const admins = await User.find({
      role: USER_ROLES.ADMIN,
      status: { $ne: USER_ACCOUNT_STATUS.BANNED },
    })
      .select("_id name email")
      .lean();

    for (const admin of admins) {
      const adminUserId = getIdString(admin._id);
      if (!adminUserId) continue;

      adminUserIds.add(adminUserId);
      jobs.push(
        notifyAdminNewOrder(adminUserId, orderNumber, {
          orderId,
          itemCount,
          total: order.total,
          channel: order.channel,
          adminEmail: admin.email,
          adminName: admin.name,
          settings,
          channels: notificationSettings.admin.newOrders,
        }),
      );
    }
  }

  if (notifyCustomer) {
    const customerId = getIdString(order.customerId);
    if (customerId) {
      const recipientRole = await resolveOrderNotificationRecipientRole(
        customerId,
        adminUserIds,
      );
      jobs.push(
        notifyOrderPlaced(customerId, orderNumber, orderId, {
          settings,
          channels: notificationSettings.customer.orderUpdates,
          status: order.status,
          channel: order.channel,
          recipientRole,
        }),
      );
    }
  }

  const staffOrderChannels = notificationSettings.staff.newOrders;
  if (notifyAdmins && hasAnyNotificationChannel(staffOrderChannels)) {
    const staffItemCountText =
      itemCount > 0 ? ` with ${itemCount} item${itemCount === 1 ? "" : "s"}` : "";
    const channelText = order.channel === "pos" ? " from POS" : "";
    const totalText =
      typeof order.total === "number" && Number.isFinite(order.total)
        ? ` Total: $${order.total.toFixed(2)}.`
        : "";
    const title = "New Order Received";
    const message = `A new order #${orderNumber}${staffItemCountText} was placed${channelText}.${totalText}`;
    jobs.push(
      notifyStaffUsers({
        permissions: [
          STAFF_PERMISSIONS.VIEW_ORDERS,
          STAFF_PERMISSIONS.MANAGE_ORDERS,
          STAFF_PERMISSIONS.EDIT_ORDERS,
        ],
        channels: staffOrderChannels,
        type: NotificationType.ORDER_PLACED,
        title,
        message,
        link: orderId ? `/staff/orders/${orderId}` : "/staff/orders",
        data: {
          orderNumber,
          orderId,
          itemCount,
          total: order.total,
          channel: order.channel,
        },
        dedupe: {
          type: NotificationType.ORDER_PLACED,
          "data.orderNumber": orderNumber,
        },
        settings,
      }),
    );
  }

  if (notifyVendors) {
    const vendorIds = Array.from(
      new Set(
        (order.subOrders || [])
          .map((subOrder) => getIdString(subOrder.vendorId))
          .filter(Boolean),
      ),
    );

    if (vendorIds.length > 0) {
      await connectDB();
      const vendors = await Vendor.find({ _id: { $in: vendorIds } })
        .select("_id userId notificationPreferences")
        .populate("userId", "name email")
        .lean();
      const itemCounts = new Map(
        (order.subOrders || []).map((subOrder) => [
          getIdString(subOrder.vendorId),
          Array.isArray(subOrder.items) ? subOrder.items.length : 0,
        ]),
      );

      for (const vendor of vendors) {
        const preferences = vendor.notificationPreferences as
          | { newOrders?: boolean }
          | undefined;
        if (preferences?.newOrders === false) continue;

        const vendorUser = vendor.userId as
          | { _id?: unknown; name?: string; email?: string }
          | undefined;
        const vendorUserId = getIdString(vendorUser || vendor.userId);
        const vendorId = getIdString(vendor._id);
        if (adminUserIds.has(vendorUserId)) continue;

        if (vendorUserId) {
          jobs.push(
            notifyVendorNewOrder(
              vendorUserId,
              orderNumber,
              itemCounts.get(vendorId) || 1,
              {
                vendorEmail: vendorUser?.email,
                vendorName: vendorUser?.name,
                settings,
                channels: notificationSettings.vendor.newOrders,
              },
            ),
          );
        }
      }
    }
  }

  await Promise.allSettled(jobs);
}

/**
 * Tell the store a shopper has asked for a price on a "price on request"
 * product.
 *
 * Deliberately not routed through `normalizeNotificationSettings`: a quote
 * request is a sales lead with no price, no order and no money, so there is no
 * existing admin channel key that describes it, and inventing one would mean a
 * settings migration for a notification nobody would sensibly switch off. In-app
 * (plus browser push, which `createNotification` handles) is enough — the
 * requester's own email goes out separately from the route.
 *
 * Best-effort by design: the quote row is already saved by the time this runs,
 * so a notification failure must never lose the lead.
 */
export async function notifyAdminsQuoteRequest(quote: {
  quoteId: string;
  productName: string;
  customerName: string;
  quantity: number;
}) {
  try {
    await connectDB();
    const admins = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      status: { $ne: USER_ACCOUNT_STATUS.BANNED },
    })
      .select("_id")
      .lean();

    const title = "New quote request";
    const message = `${quote.customerName} asked for a price on ${quote.productName} (qty ${quote.quantity}).`;

    await Promise.allSettled(
      admins.map(async (admin) => {
        const adminUserId = getIdString(admin._id);
        if (!adminUserId) return;
        await createNotification({
          userId: adminUserId,
          type: NotificationType.QUOTE_REQUEST,
          title,
          message,
          link: "/admin/quotes",
          data: { quoteId: quote.quoteId, recipientRole: USER_ROLES.ADMIN },
        });
      }),
    );
  } catch (error) {
    console.error("Failed to notify admins of quote request:", error);
  }
}
