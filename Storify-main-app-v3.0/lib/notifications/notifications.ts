/**
 * Notification Helper Functions
 * Create notifications for various events
 *
 * Every event reaches each recipient through one function,
 * `dispatchNotification`: the in-app row (and browser/mobile push), then the
 * email, then the text message — each only where the admin switched that
 * channel on for the event (Settings → Notifications).
 */

import { connectDB } from "@/lib/db";
import {
  CustomerProfile,
  Notification,
  Order,
  StaffProfile,
  User,
  Vendor,
} from "@/models";
import { NotificationType } from "@/models/notification.model";
import { SmsDelivery } from "@/models/sms-delivery.model";
import { sendPushToUser } from "@/lib/notifications/push-notifications";
import {
  isEmailDeliveryConfigured,
  queueEmailWithEvidence,
  sendEmail,
  type EmailDeliveryOutcome,
} from "@/lib/email/email";
import {
  orderAddressLinkPath,
  preorderBalanceLinkPath,
  preorderManageLinkPath,
} from "@/lib/payments/preorder-balance-link";
import {
  hasOrderStatusEmail,
  resolveOrderTracking,
  sendOrderStatusEmail,
} from "@/lib/email/order-emails";
import {
  ORDER_STATUS,
  USER_ACCOUNT_STATUS,
  USER_ROLES,
} from "@/config/app.config";
import { isAdmin } from "@/lib/access/rbac";
import { isStaffRole } from "@/lib/access/staff-role";
import { DEFAULT_CURRENCY } from "@/config/branding.config";
import type { StaffPermission } from "@/config/permissions.config";
import {
  sendReturnApprovedEmail,
  sendReturnRequestOwnerEmail,
} from "@/lib/email/return-emails";
import {
  DEFAULT_GUEST_RETURN_INSTRUCTIONS,
  DEFAULT_RETURN_INSTRUCTIONS,
  describeReturnDestination,
  renderReturnInstructions,
  returnMethodOf,
} from "@/lib/returns/return-shipping";
import { getSettings, type ISettings } from "@/models/settings.model";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";
import {
  hasAnyNotificationChannel,
  normalizeNotificationSettings,
  STAFF_NOTIFICATION_PERMISSIONS,
  type NotificationChannelSettings,
  type NotificationSettings,
} from "@/lib/notifications/notification-settings";
import { appBaseUrl } from "@/lib/app-url";
import { isPosWalkIn } from "@/lib/orders/pos-walk-in";
import {
  PREORDER_ACCESS_REVIEW_PATH,
  sendAdminPreorderAccessRequestEmail,
  sendVendorPreorderAccessDecisionEmail,
} from "@/lib/email/vendor-emails";
import {
  resolvePreorderPolicy,
  type PreorderAccessDecision,
} from "@/lib/orders/preorder-gating";
import { getPreorderBalanceDeadline } from "@/lib/orders/order-payment-status";
import { formatCurrency } from "@/lib/intl/money";
import { isValidObjectId } from "@/lib/api/validate";
import { normalizePhoneNumber } from "@/lib/sms/phone";
import {
  buildNotificationSmsBody,
  isSmsDeliveryConfigured,
  notificationDedupeKey,
  sendSms,
} from "@/lib/sms/sms";
import { smsStoreName } from "@/lib/sms/sms-text";
import { orderStatusMessage } from "@/lib/notifications/order-status-messages";

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
 * Create the in-app row, reporting whether it is new. `duplicate` means this
 * exact event already reached this user — which is what stops the email and
 * the text going out a second time when an event fires twice.
 */
async function recordNotification(params: CreateNotificationParams) {
  try {
    await connectDB();
    if (params.dedupe) {
      const existing = await Notification.findOne({
        userId: params.userId,
        ...params.dedupe,
      });
      if (existing) return { notification: existing, duplicate: true };
    }

    const notification = await Notification.create({
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      data: params.data,
    });

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

    return { notification, duplicate: false };
  } catch (error) {
    console.error("Failed to create notification:", error);
    return { notification: null, duplicate: false };
  }
}

type RecordedNotification = Awaited<ReturnType<typeof recordNotification>>;

/**
 * Create a notification for a user
 */
export async function createNotification(params: CreateNotificationParams) {
  return (await recordNotification(params)).notification;
}

async function createConfiguredNotification(
  params: CreateNotificationParams,
  channels: NotificationChannelSettings,
): Promise<RecordedNotification> {
  if (channels.inApp) {
    return recordNotification({
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

  return { notification: null, duplicate: false };
}

// ============================================
// Recipients
// ============================================

/**
 * Who a notification is for, as each channel needs them. `userId` files the
 * in-app row and the push; a guest has none and is reached only by the email
 * and phone their order was placed with.
 */
interface NotificationRecipient {
  userId?: string;
  name?: string;
  email?: string;
  phone?: string;
  /** Where `phone` was entered (ISO-2 or a country name), to read a national number. */
  phoneCountry?: string;
}

type ContactAddress = { phone?: string; country?: string; isDefault?: boolean };

type UserContact = {
  name?: string;
  email?: string;
  phone?: string;
  role?: string;
  roles?: string[];
  addresses?: ContactAddress[];
};

const USER_CONTACT_FIELDS =
  "name email phone role roles addresses.phone addresses.country addresses.isDefault";

/**
 * An account's phone for texts: the profile's own, else the default saved
 * address's — which is also the best guess at the country a profile phone
 * typed without its code belongs to.
 */
function accountPhone(
  user: UserContact | null | undefined,
): Pick<NotificationRecipient, "phone" | "phoneCountry"> {
  if (!user) return {};
  const addresses = user.addresses ?? [];
  const home =
    addresses.find((address) => address.isDefault) ?? addresses[0];
  if (user.phone?.trim()) return { phone: user.phone, phoneCountry: home?.country };
  const withPhone =
    addresses.find((address) => address.isDefault && address.phone?.trim()) ??
    addresses.find((address) => address.phone?.trim());
  return withPhone ? { phone: withPhone.phone, phoneCountry: withPhone.country } : {};
}

async function loadUserContact(userId: string) {
  if (!isValidObjectId(userId)) return null;
  await connectDB();
  return User.findById(userId).select(USER_CONTACT_FIELDS).lean<UserContact | null>();
}

/**
 * Every admin, read the way `isAdmin` reads a role (`role` or `roles`). The
 * new-order alert used to match `role` alone, so an admin whose admin role
 * lived in `roles` got every admin notification except new orders.
 */
async function findAdminRecipients(): Promise<NotificationRecipient[]> {
  await connectDB();
  const admins = await User.find({
    $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
    status: { $ne: USER_ACCOUNT_STATUS.BANNED },
  })
    .select("_id name email phone")
    .lean<Array<{ _id: unknown; name?: string; email?: string; phone?: string }>>();

  return admins.flatMap((admin) => {
    const userId = getIdString(admin._id);
    return userId
      ? [{ userId, name: admin.name, email: admin.email, phone: admin.phone }]
      : [];
  });
}

/**
 * Staff who hear of an event: active, holding one of the permissions, and
 * able to see it. Platform staff scoped to sellers hear of those sellers'
 * orders, stock and returns; a vendor's own staff only of events wholly their
 * vendor's, the orders their staff area shows (`wholeOrdersOnly`); and
 * neither hears anything store-wide. Every order, every product and every new
 * customer went to them all, other sellers' included. A vendor's staff member
 * with no vendor left hears nothing (see `effectiveStaffPermissions`).
 */
async function getStaffNotificationRecipients(
  requiredPermissions: StaffPermission[],
  vendorIds: string[],
): Promise<NotificationRecipient[]> {
  await connectDB();
  const profiles = await StaffProfile.find({
    isActive: true,
    permissions: { $in: requiredPermissions },
    $or: [
      { "vendorIds.0": { $exists: false }, managedBy: { $ne: "vendor" } },
      ...(vendorIds.length > 0
        ? [
            { managedBy: "platform", vendorIds: { $in: vendorIds } },
            // Explicitly vendor-owned, or written before `managedBy` with
            // vendorIds — the legacy reading of a vendor's staff.
            { managedBy: { $ne: "platform" }, vendorIds: { $all: vendorIds } },
          ]
        : []),
    ],
  })
    .select("userId permissions")
    .populate("userId", "name email phone status")
    .lean();

  const recipients = new Map<string, NotificationRecipient>();
  for (const profile of profiles) {
    const user = profile.userId as
      | { _id?: unknown; name?: string; email?: string; phone?: string; status?: string }
      | undefined;
    const userId = getIdString(user || profile.userId);
    if (!userId || (user?.status && user.status !== USER_ACCOUNT_STATUS.ACTIVE)) {
      continue;
    }
    recipients.set(userId, {
      userId,
      name: user?.name,
      email: user?.email,
      phone: user?.phone,
    });
  }

  return Array.from(recipients.values());
}

type StaffEvent = keyof NotificationSettings["staff"];

/**
 * Who each staff event can reach at all, for Settings → Notifications: a row
 * that reaches nobody says so there. Counted the way the query above picks
 * recipients — active profiles of active users holding one of the event's
 * permissions — in any seller's scope, since that seller's events reach them.
 * A new customer belongs to no seller, so only staff without one hear of it,
 * and a vendor's staff member with no vendor left hears of nothing.
 */
export async function countStaffNotificationAudience(): Promise<{
  total: number;
  events: Record<StaffEvent, number>;
}> {
  await connectDB();
  const profiles = await StaffProfile.find({ isActive: true })
    .select("userId permissions vendorIds managedBy")
    .populate("userId", "status")
    .lean<
      Array<{
        userId?: { status?: string } | null;
        permissions?: string[];
        vendorIds?: unknown[];
        managedBy?: string;
      }>
    >();

  const reachable = profiles.filter((profile) => {
    const user = profile.userId;
    if (!user || (user.status && user.status !== USER_ACCOUNT_STATUS.ACTIVE)) {
      return false;
    }
    const sellers = profile.vendorIds?.length ?? 0;
    return !(profile.managedBy === "vendor" && sellers === 0);
  });

  const events = {} as Record<StaffEvent, number>;
  for (const event of Object.keys(STAFF_NOTIFICATION_PERMISSIONS) as StaffEvent[]) {
    const wanted: readonly string[] = STAFF_NOTIFICATION_PERMISSIONS[event];
    events[event] = reachable.filter((profile) => {
      if (!(profile.permissions ?? []).some((permission) => wanted.includes(permission))) {
        return false;
      }
      if (event !== "newCustomers") return true;
      return (profile.vendorIds?.length ?? 0) === 0 && profile.managedBy !== "vendor";
    }).length;
  }
  return { total: reachable.length, events };
}

type VendorContactDoc = {
  _id?: unknown;
  address?: { phone?: string; country?: string };
  userId?: unknown;
};

/**
 * A vendor's owner, reached at the store's own phone when it has one — the
 * number a vendor gives for their business — else at their account's.
 */
function vendorRecipient(vendor: VendorContactDoc): NotificationRecipient | null {
  const user = vendor.userId as
    | ({ _id?: unknown } & UserContact)
    | undefined;
  const userId = getIdString(user || vendor.userId);
  if (!userId) return null;
  const storePhone = vendor.address?.phone?.trim()
    ? { phone: vendor.address.phone, phoneCountry: vendor.address.country }
    : accountPhone(user);
  return { userId, name: user?.name, email: user?.email, ...storePhone };
}

type OrderContactLike = {
  _id?: unknown;
  orderNumber?: string;
  customerId?: unknown;
  guestEmail?: string;
  contactPhone?: string;
  currency?: string;
  channel?: string;
  staffId?: unknown;
  shippingAddress?: { fullName?: string; phone?: string; country?: string };
  billingAddress?: { fullName?: string; phone?: string; country?: string };
};

const ORDER_CONTACT_FIELDS =
  "orderNumber customerId guestEmail contactPhone currency channel staffId shippingAddress.fullName shippingAddress.phone shippingAddress.country billingAddress.fullName billingAddress.phone billingAddress.country";

type OrderCustomer = NotificationRecipient & {
  /**
   * Who the "customer" really is: a staff-side account that placed an order
   * for itself (before checkout refused them) is answered as staff. A walk-in
   * POS sale has no customer at all.
   */
  role: string;
};

function notificationRoleOf(user: UserContact) {
  if (isAdmin(user)) return USER_ROLES.ADMIN;
  if (user.role === USER_ROLES.VENDOR) return USER_ROLES.VENDOR;
  if (isStaffRole(user.role)) return user.role as string;
  return USER_ROLES.CUSTOMER;
}

/**
 * The shopper an order belongs to, on every channel.
 *
 * `customerId` is a User on an account order but the CART on a guest one, so
 * looking the recipient up by it alone found nobody for any guest — which is
 * how a guest was never told their order had shipped. The order's own contact
 * fills that gap, and its phone is preferred to the profile's: it is the one
 * given for this delivery.
 */
async function resolveOrderCustomer(
  order: OrderContactLike,
): Promise<OrderCustomer | null> {
  // A walk-in POS sale is filed under its cashier, who hears of it as staff
  // ("New Order Received") and never as its buyer — not even at a number
  // typed at the till. See lib/orders/pos-walk-in.ts.
  if (isPosWalkIn(order)) return null;
  const customerId = getIdString(order.customerId);
  const user = customerId ? await loadUserContact(customerId) : null;
  const orderAddress = order.shippingAddress?.phone?.trim()
    ? order.shippingAddress
    : order.billingAddress?.phone?.trim()
      ? order.billingAddress
      : undefined;
  // The phone the shopper asked to be reached on wins over the delivery one.
  const contactPhone = order.contactPhone?.trim();
  const orderPhone = contactPhone
    ? {
        phone: contactPhone,
        phoneCountry: (order.shippingAddress ?? order.billingAddress)?.country,
      }
    : orderAddress
      ? { phone: orderAddress.phone, phoneCountry: orderAddress.country }
      : undefined;

  if (user) {
    return {
      userId: customerId,
      name: user.name,
      email: user.email,
      ...(orderPhone ?? accountPhone(user)),
      role: notificationRoleOf(user),
    };
  }

  const guestEmail = order.guestEmail?.trim();
  if (!guestEmail && !orderPhone) return null;
  return {
    name: order.shippingAddress?.fullName || order.billingAddress?.fullName,
    email: guestEmail,
    ...orderPhone,
    role: USER_ROLES.CUSTOMER,
  };
}

/** Whether an order, known only by its id, is a walk-in POS sale. */
async function isWalkInOrder(orderId: unknown): Promise<boolean> {
  const id = getIdString(orderId);
  if (!id || !isValidObjectId(id)) return false;
  await connectDB();
  const order = await Order.findById(id)
    .select("channel staffId customerId")
    .lean<OrderContactLike | null>();
  return isPosWalkIn(order);
}

async function loadOrderCustomer(orderId: string) {
  if (!isValidObjectId(orderId)) return null;
  await connectDB();
  const order = await Order.findById(orderId)
    .select(ORDER_CONTACT_FIELDS)
    .lean<OrderContactLike | null>();
  return order ? { order, customer: await resolveOrderCustomer(order) } : null;
}

/**
 * A shopper's own switches (Account → Preferences). Only an account has them;
 * a guest is reached through what the order recorded, and can reply STOP.
 */
async function customerOptOuts(userId: string | undefined) {
  if (!userId) return { orderEmail: false, sms: false };
  const profile = await CustomerProfile.findOne({ userId })
    .select("emailNotifications.orderUpdates smsNotifications.orderUpdates")
    .lean<{
      emailNotifications?: { orderUpdates?: boolean };
      smsNotifications?: { orderUpdates?: boolean };
    } | null>();
  return {
    orderEmail: profile?.emailNotifications?.orderUpdates === false,
    sms: profile?.smsNotifications?.orderUpdates === false,
  };
}

/** A guest has no account page; the public tracking page is theirs. */
function trackOrderLink(orderNumber: string) {
  return `/track-order?orderNumber=${encodeURIComponent(orderNumber)}`;
}

// ============================================
// Dispatch
// ============================================

interface DispatchOptions {
  /** Durable business operations require every configured channel's outbox receipt. */
  requireOutbox?: boolean;
  recipient: NotificationRecipient;
  channels: NotificationChannelSettings;
  /** The in-app row; its `dedupe` also keys the text, so an event is texted once. */
  notification: Omit<CreateNotificationParams, "userId" | "sendPush">;
  settings: ISettings;
  /**
   * The event's purpose-built email, sent instead of the generic notice.
   * Resolves whether it went; `false` falls back to the generic notice. Pass
   * `dedupeKey` on to `sendEmail` so a repeat of the event is not mailed.
   */
  email?: (
    contact: NotificationRecipient,
    dedupeKey: string | undefined,
  ) => Promise<boolean>;
  /** Channels this recipient must not get for this event, whatever the matrix says. */
  skip?: { email?: boolean; sms?: boolean };
  /** The text's wording and link, when they should differ from the in-app copy. */
  sms?: { message?: string; link?: string };
}

function storeNameOf(settings?: ISettings) {
  return smsStoreName(settings?.general?.storeName);
}

function absoluteLink(link?: string) {
  if (!link) return appBaseUrl();
  if (/^https?:\/\//i.test(link)) return link;
  return `${appBaseUrl()}${link.startsWith("/") ? link : `/${link}`}`;
}

/**
 * The key both outboxes deliver an event once by: the in-app row's own dedupe
 * fields plus who it went to — the account, or for a guest the address or
 * number itself. Undefined for an event that is not deduplicated at all.
 */
function deliveryKey(
  options: DispatchOptions,
  channel: "email" | "sms",
  address: string,
) {
  const { dedupe } = options.notification;
  if (!dedupe) return undefined;
  return notificationDedupeKey({
    ...dedupe,
    channel,
    recipient: options.recipient.userId || address.toLowerCase(),
  });
}

async function deliverNotificationEmail(
  options: DispatchOptions,
  contact: NotificationRecipient,
) {
  const dedupeKey = contact.email
    ? deliveryKey(options, "email", contact.email)
    : undefined;
  if (
    options.email &&
    (await options.email(contact, dedupeKey).catch(() => false))
  ) {
    return;
  }
  if (!contact.email) return;
  if (options.requireOutbox) {
    if (!dedupeKey) throw new Error("A durable notification needs a channel identity");
    const receipt = await queueEmailWithEvidence({
      to: contact.email, subject: options.notification.title,
      html: buildCustomerNotificationEmailHtml({ title: options.notification.title, message: options.notification.message, customerName: contact.name, link: options.notification.link, settings: options.settings }),
      settings: options.settings, category: "notification", dedupeKey,
    });
    if (!receipt.jobId) throw new Error("The order email could not be durably queued");
    return;
  }
  await sendEmail({
    to: contact.email,
    subject: options.notification.title,
    html: buildCustomerNotificationEmailHtml({
      title: options.notification.title,
      message: options.notification.message,
      customerName: contact.name,
      link: options.notification.link,
      settings: options.settings,
    }),
    settings: options.settings,
    category: "notification",
    dedupeKey,
  });
}

async function deliverNotificationSms(
  options: DispatchOptions,
  contact: NotificationRecipient,
) {
  const { settings, notification } = options;
  const to = normalizePhoneNumber(contact.phone, {
    country: contact.phoneCountry,
    defaultCountry: settings.sms?.defaultCountry || settings.shipping?.origin?.country,
  });
  if (!to) return;

  const link = options.sms?.link ?? notification.link;
  await sendSms({
    to,
    body: buildNotificationSmsBody({
      storeName: storeNameOf(settings),
      message: options.sms?.message ?? notification.message,
      link:
        link && settings.sms?.includeLinks !== false
          ? absoluteLink(link)
          : undefined,
    }),
    category: notification.type,
    dedupeKey: deliveryKey(options, "sms", to),
    settings,
  });
  if (options.requireOutbox) {
    const dedupeKey = deliveryKey(options, "sms", to);
    if (!dedupeKey || !(await SmsDelivery.exists({ dedupeKey }))) throw new Error("The order text could not be durably queued");
  }
}

/**
 * One event to one recipient, on every channel the event is configured for.
 *
 * A repeat of an event that already reached this user — a carrier webhook
 * racing a merchant's own "mark shipped", an admin re-saving a status — stops
 * at the in-app row. The email used to go out again regardless: only the row
 * was deduped, never the mail, and with SMS every repeat would be billed. A
 * guest has no row to remember by, so both outboxes also carry the event's
 * key themselves (`deliveryKey`).
 */
async function dispatchNotification(options: DispatchOptions) {
  const { recipient, channels, notification, settings } = options;

  let record: RecordedNotification = { notification: null, duplicate: false };
  if (recipient.userId) {
    record = await createConfiguredNotification(
      { ...notification, userId: recipient.userId },
      channels,
    );
    if (options.requireOutbox && channels.inApp && !record.notification) throw new Error("The order notification could not be recorded");
    if (record.duplicate && !options.requireOutbox) return record.notification;
  }

  const wantsEmail = channels.email && !options.skip?.email && (!options.requireOutbox || isEmailDeliveryConfigured(settings));
  const wantsSms =
    channels.sms && !options.skip?.sms && isSmsDeliveryConfigured(settings);
  if (!wantsEmail && !wantsSms) return record.notification;

  // One lookup serves both channels, and only when the caller lacked a field.
  const missingContact =
    (wantsEmail && !recipient.email) || (wantsSms && !recipient.phone);
  const user =
    recipient.userId && missingContact
      ? await loadUserContact(recipient.userId)
      : null;
  const contact: NotificationRecipient = {
    ...recipient,
    name: recipient.name ?? user?.name,
    email: recipient.email ?? user?.email,
    ...(recipient.phone ? {} : accountPhone(user)),
  };

  const deliveries = await Promise.allSettled([
    wantsEmail ? deliverNotificationEmail(options, contact) : undefined,
    wantsSms ? deliverNotificationSms(options, contact) : undefined,
  ]);
  if (options.requireOutbox) {
    const failures = deliveries.filter((result) => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Order notification channels were not durably queued");
  }
  return record.notification;
}

async function notifyStaffUsers(params: {
  requireOutbox?: boolean;
  permissions: StaffPermission[];
  /** The vendors the event belongs to; empty for a store-wide one. */
  vendorIds: string[];
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

  const staff = await getStaffNotificationRecipients(
    params.permissions,
    params.vendorIds,
  );
  const deliveries = await Promise.allSettled(
    staff.map((recipient) =>
      dispatchNotification({
        requireOutbox: params.requireOutbox,
        recipient,
        channels: params.channels,
        settings: params.settings,
        notification: {
          type: params.type,
          title: params.title,
          message: params.message,
          link: params.link,
          data: { ...params.data, recipientRole: USER_ROLES.STAFF },
          dedupe: {
            ...params.dedupe,
            "data.recipientRole": USER_ROLES.STAFF,
          },
        },
      }),
    ),
  );
  if (params.requireOutbox) {
    const failures = deliveries.filter((result) => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Staff order notifications were not durably queued");
  }
}

// ============================================
// Orders
// ============================================

/**
 * "A new order #X with 2 items was placed from POS. Total: ৳1,250.00." — for
 * admins and staff. The total used to be printed as `$` whatever the store's
 * currency, which in a text message is the whole message being wrong.
 */
function newOrderAlertMessage(
  order: {
    orderNumber: string;
    itemCount: number;
    total?: number;
    channel?: string;
    currency?: string;
  },
  settings: ISettings,
) {
  const itemCountText =
    order.itemCount > 0
      ? ` with ${order.itemCount} item${order.itemCount === 1 ? "" : "s"}`
      : "";
  const channelText = order.channel === "pos" ? " from POS" : "";
  const totalText =
    typeof order.total === "number" && Number.isFinite(order.total)
      ? ` Total: ${formatCurrency(
          order.total,
          order.currency || settings.general?.defaultCurrency || DEFAULT_CURRENCY,
        )}.`
      : "";
  return `A new order #${order.orderNumber}${itemCountText} was placed${channelText}.${totalText}`;
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

  // Sent when the order is placed, which for a gateway is when the money
  // arrives: the order is `processing` (or `preordered`) by then, and telling
  // a shopper who has just paid that it "is now pending" read as a payment
  // that had not gone through. Pending is for orders still waiting on it —
  // cash on delivery, pay later, a bank transfer.
  if (status !== ORDER_STATUS.PENDING) {
    return {
      type: NotificationType.ORDER_PLACED,
      title: "Order Confirmed",
      message: `Your order #${params.orderNumber} has been placed and confirmed.`,
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

/**
 * Tell the order's customer it was placed.
 *
 * A walk-in POS sale never gets here: it has no customer (see
 * `resolveOrderCustomer`). A staff-side account answered as staff is never
 * texted.
 */
async function notifyOrderPlaced(
  customer: OrderCustomer,
  order: { orderNumber: string; orderId?: string; status?: string; channel?: string },
  options: {
    settings: ISettings;
    channels: NotificationChannelSettings;
    customerEmailSent?: boolean;
    requireOutbox?: boolean;
  },
) {
  const { settings, channels } = options;
  if (!hasAnyNotificationChannel(channels)) return null;

  const copy = buildOrderPlacedNotificationCopy({
    ...order,
    recipientRole: customer.role,
  });
  const isShopper = customer.role === USER_ROLES.CUSTOMER;
  const optOuts =
    isShopper && (channels.email || channels.sms)
      ? await customerOptOuts(customer.userId)
      : { orderEmail: false, sms: false };

  return dispatchNotification({
    requireOutbox: options.requireOutbox,
    recipient: customer,
    channels,
    settings,
    notification: {
      type: copy.type,
      title: copy.title,
      message: copy.message,
      link: customer.userId ? copy.link : trackOrderLink(order.orderNumber),
      data: {
        orderNumber: order.orderNumber,
        orderId: order.orderId,
        status: copy.status,
        channel: order.channel,
        recipientRole: copy.recipientRole,
      },
      dedupe: {
        type: copy.type,
        "data.orderNumber": order.orderNumber,
        "data.recipientRole": copy.recipientRole,
      },
    },
    skip: {
      // The checkout already mailed the confirmation with the invoice, so the
      // generic "Order Pending" notice was a second email for the same order.
      email: optOuts.orderEmail || options.customerEmailSent === true,
      sms: optOuts.sms || !isShopper,
    },
  });
}

/**
 * Create order status update notification
 */
export async function notifyOrderStatus(params: {
  orderId: string;
  status: string;
  settings?: ISettings;
}) {
  const { orderId, status } = params;
  const settings = params.settings || (await getSettings());
  const channels = normalizeNotificationSettings(settings.notifications).customer
    .orderUpdates;
  if (!hasAnyNotificationChannel(channels) || !isValidObjectId(orderId)) {
    return null;
  }

  await connectDB();
  const order = await Order.findById(orderId)
    .select(
      `${ORDER_CONTACT_FIELDS} trackingNumber carrier subOrders.trackingNumber subOrders.carrier`,
    )
    .lean<
      | (OrderContactLike & {
          _id: unknown;
          orderNumber?: string;
          trackingNumber?: string;
          carrier?: string;
          subOrders?: Array<{ trackingNumber?: string; carrier?: string }>;
        })
      | null
    >();
  if (!order?.orderNumber) return null;
  const customer = await resolveOrderCustomer(order);
  if (!customer) return null;

  const orderNumber = order.orderNumber;
  const statusTitle = status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const title = `Order ${statusTitle}`;
  const message = orderStatusMessage(status, orderNumber);
  const link = customer.userId
    ? `/account/orders/${orderId}`
    : trackOrderLink(orderNumber);
  const type =
    status === ORDER_STATUS.DELIVERED
      ? NotificationType.ORDER_DELIVERED
      : NotificationType.ORDER_STATUS;

  const isShopper = customer.role === USER_ROLES.CUSTOMER;
  const optOuts =
    isShopper && (channels.email || channels.sms)
      ? await customerOptOuts(customer.userId)
      : { orderEmail: false, sms: false };
  // "Shipped" is the one update that can carry the parcel, by email and text.
  const tracking =
    status === ORDER_STATUS.SHIPPED && (channels.email || channels.sms)
      ? await resolveOrderTracking(order)
      : undefined;
  const trackingLabel = [tracking?.carrier, tracking?.trackingNumber]
    .filter(Boolean)
    .join(" ");

  return dispatchNotification({
    recipient: customer,
    channels,
    settings,
    notification: {
      type,
      title,
      message,
      link,
      data: { orderNumber, orderId, status, recipientRole: USER_ROLES.CUSTOMER },
      dedupe: {
        type,
        "data.orderNumber": orderNumber,
        "data.status": status,
        "data.recipientRole": USER_ROLES.CUSTOMER,
      },
    },
    // Statuses with a purpose-built template get it; everything else falls
    // through to the generic notice.
    email: hasOrderStatusEmail(status)
      ? (contact, dedupeKey) =>
          contact.email
            ? sendOrderStatusEmail({
                orderNumber,
                orderUrl: absoluteLink(link),
                status,
                customerEmail: contact.email,
                tracking,
                settings,
                dedupeKey,
              })
            : Promise.resolve(false)
      : undefined,
    skip: { email: optOuts.orderEmail, sms: optOuts.sms || !isShopper },
    // The number itself goes in the text, so it survives "links off"; the
    // courier's own page replaces the order page as the link.
    sms: tracking?.trackingNumber
      ? {
          message: `${message} Tracking: ${trackingLabel}.`,
          link: tracking.trackingUrl,
        }
      : undefined,
  });
}

/**
 * Tell a shopper that part of an order they paid for will not come.
 *
 * On a split order, one seller's items can sell out between checkout and the
 * payment landing, or the seller can call them off first. Their share is
 * refunded and the rest of the order goes ahead — and the shopper was told
 * nothing: the confirmation email listed every item, including the ones that
 * would never ship, at the original total. Only the admins heard.
 */
export async function notifyOrderItemsDropped(params: {
  orderId: string;
  /** What went back to the shopper, in the order's currency. */
  refundedAmount: number;
  currency?: string | null;
  cause: "sold_out" | "seller_cancelled";
  /** False when the money could not be sent back automatically yet. */
  refundSent?: boolean;
  settings?: ISettings;
}) {
  const settings = params.settings || (await getSettings());
  const channels = normalizeNotificationSettings(settings.notifications).customer
    .orderUpdates;
  if (!hasAnyNotificationChannel(channels) || !isValidObjectId(params.orderId)) {
    return null;
  }

  await connectDB();
  const order = await Order.findById(params.orderId)
    .select(`${ORDER_CONTACT_FIELDS} currency`)
    .lean<(OrderContactLike & { _id: unknown; orderNumber?: string; currency?: string }) | null>();
  if (!order?.orderNumber) return null;
  const customer = await resolveOrderCustomer(order);
  if (!customer) return null;

  const orderNumber = order.orderNumber;
  const currency = String(params.currency || order.currency || settings.general?.defaultCurrency || "USD");
  const amount = formatCurrency(Math.max(0, params.refundedAmount), currency);
  const why =
    params.cause === "sold_out"
      ? "Some items in your order sold out while your payment was going through"
      : "A seller could not supply some items in your order";
  const refundLine =
    params.refundSent === false
      ? `We are refunding ${amount} for them.`
      : `We have refunded ${amount} for them.`;
  const message = `${why}. ${refundLine} The rest of order #${orderNumber} is on its way.`;
  const link = customer.userId
    ? `/account/orders/${params.orderId}`
    : trackOrderLink(orderNumber);
  const type = NotificationType.ORDER_STATUS;
  const isShopper = customer.role === USER_ROLES.CUSTOMER;
  const optOuts =
    isShopper && (channels.email || channels.sms)
      ? await customerOptOuts(customer.userId)
      : { orderEmail: false, sms: false };

  return dispatchNotification({
    recipient: customer,
    channels,
    settings,
    notification: {
      type,
      title: "Part of your order could not be supplied",
      message,
      link,
      data: {
        orderNumber,
        orderId: params.orderId,
        status: "items_dropped",
        recipientRole: USER_ROLES.CUSTOMER,
      },
      dedupe: {
        type,
        "data.orderNumber": orderNumber,
        "data.status": "items_dropped",
        "data.recipientRole": USER_ROLES.CUSTOMER,
      },
    },
    skip: { email: optOuts.orderEmail, sms: optOuts.sms || !isShopper },
  });
}

/**
 * The dedupe stage for a balance request someone repeated by hand ("Send
 * balance reminder"). Minute-grained, so a double click still sends one.
 */
export function manualBalanceReminderStage(now = new Date()): string {
  return `manual:${now.toISOString().slice(0, 16)}`;
}

export async function notifyPreorderCustomerUpdate(
  userId: string,
  orderNumber: string,
  status:
    | "reserved"
    | "payment_due"
    | "payment_failed"
    | "address_changed"
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
    /**
     * When the store asked for the balance, so the payment-due message can
     * name the day it runs out. Falls back to the release date, which is what
     * the expiry job does for an order stamped before the field existed.
     */
    balanceRequestedAt?: Date | string;
    /**
     * On a failed card-on-file charge: true when the bank wants the shopper
     * present (3-D Secure) rather than the card having been refused. The two
     * need different words — one is "your card said no", the other is "your
     * bank wants to see you" — and only the second is the shopper's to fix by
     * simply confirming.
     */
    chargeNeedsShopper?: boolean;
    /**
     * On an address change: the new address, one line. Written into the
     * message itself so the shopper can see at a glance whether it is right —
     * the change may not have been theirs.
     */
    addressSummary?: string;
    /**
     * On a failed card-on-file charge: which attempt this was. Part of the
     * dedupe key, because the retries are separate events the shopper should
     * hear about — keyed only on status and release date, every failure after
     * the first matched the first and was silently dropped.
     */
    chargeAttempt?: number;
    /**
     * Which balance reminder this is (`t-7`, `t-1`), or a stamp for a reminder
     * someone sent by hand. Part of the dedupe key for the same reason as
     * `chargeAttempt`: a reminder carries the same status and release date as
     * the request before it, so the gate matched the request and every
     * reminder after it was dropped before its email went out.
     */
    reminderStage?: string;
    /**
     * Set when the order was placed without an account, whose `userId` is
     * then the shopper's CART. Only used when `orderId` is absent — with it,
     * the order itself says who the shopper is and how to reach them.
     */
    guestEmail?: string;
    /**
     * On a cancellation or expiry: what became of the shopper's money, so the
     * message never claims a refund that has not happened — `processing`
     * while it is on its way, `manual` when a person is sending it.
     */
    refundOutcome?: "refunded" | "processing" | "manual" | "none";
    /** Only part of the order was called off; the rest is still coming. */
    partOfOrder?: boolean;
    /**
     * The balance request this message belongs to. Part of the dedupe key, so
     * a NEW request after the old one was withdrawn is announced rather than
     * swallowed as a repeat of the first.
     */
    balanceCycleId?: string;
    /** The cycle's deadline basis — see `getPreorderBalanceDeadline`. */
    preorderCollection?: {
      cycleId?: string | null;
      notice?: { acceptedAt?: Date | string | null } | null;
    } | null;
    /** Channels this one message must not use — see the balance notice. */
    skip?: { email?: boolean; sms?: boolean };
    settings?: ISettings;
    channels?: NotificationChannelSettings;
  } = {},
) {
  const settings = options.settings || (await getSettings());
  const channels =
    options.channels ||
    normalizeNotificationSettings(settings.notifications).customer.orderUpdates;
  if (!hasAnyNotificationChannel(channels)) return null;

  const loaded = orderId ? await loadOrderCustomer(orderId) : null;
  const guestEmail = options.guestEmail?.trim();
  const customer: OrderCustomer | null = loaded
    ? loaded.customer
    : guestEmail
      ? { email: guestEmail, role: USER_ROLES.CUSTOMER }
      : { userId, role: USER_ROLES.CUSTOMER };
  if (!customer) return null;
  const currency =
    loaded?.order.currency ||
    settings.general?.defaultCurrency ||
    DEFAULT_CURRENCY;

  const formatDate = (value?: Date | string) => {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      // The release date is a UTC calendar day; see `formatPreorderReleaseDate`.
      timeZone: "UTC",
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
  const balanceDeadline =
    status === "payment_due" || status === "payment_failed"
      ? formatDate(
          getPreorderBalanceDeadline(
            {
              preorderReleaseDate: options.releaseDate,
              preorderBalanceRequestedAt: options.balanceRequestedAt,
              preorderCollection: options.preorderCollection,
            },
            resolvePreorderPolicy(settings.preorder).expiryGraceDays,
          ) ?? undefined,
        )
      : "";
  // What a cancellation or expiry did with the money — only what is true.
  const refundSentence =
    options.refundOutcome === "refunded"
      ? " Anything you paid towards it has been refunded."
      : options.refundOutcome === "processing"
        ? " We are returning anything you paid towards it and will confirm once the refund is on its way."
        : options.refundOutcome === "manual"
          ? " We will return anything you paid towards it by hand and will be in touch about it."
          : options.refundOutcome === "none"
            ? " Nothing was charged for it."
            : "";
  const scopeLead = options.partOfOrder
    ? `Part of your pre-order #${orderNumber}`
    : `Your pre-order #${orderNumber}`;
  const scopeTail = options.partOfOrder
    ? " The rest of your order is not affected."
    : "";

  /** Present only where there is a balance to collect — see the link below. */
  const balanceLink =
    (status === "payment_due" || status === "payment_failed") && orderId
      ? preorderBalanceLinkPath(orderId)
      : undefined;
  /**
   * Where a guest goes to act on a delay — cancel, or fix the address the
   * order ships to. A signed-in shopper's account page already does both, so
   * only a guest, whose order no account can open, is given a manage link.
   */
  const manageLink =
    status === "delayed" && orderId
      ? preorderManageLinkPath(orderId)
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
      // The deadline is the half that was missing. The expiry job cancels and
      // refunds a balance that has not arrived within the grace period, so a
      // message asking for money without saying by when leaves the shopper to
      // guess the date their pre-order dies on.
      message: `Your pre-order #${orderNumber} is ready. Please pay the remaining balance${
        outstandingAmount ? ` of ${formatCurrency(outstandingAmount, currency)}` : ""
      }${
        balanceDeadline
          ? ` by ${balanceDeadline}, or the pre-order will be cancelled and anything you have paid refunded`
          : " before fulfillment"
      }.`,
    },
    payment_failed: {
      title: "Pre-order Payment Could Not Be Taken",
      // Says what happened, whose move it is, and by when. A shopper who
      // authorised a card-on-file charge is not expecting to hear from us at
      // all, so the one message they do get has to be enough on its own.
      message: `We could not take the ${
        outstandingAmount
          ? `${formatCurrency(outstandingAmount, currency)} `
          : ""
      }balance for pre-order #${orderNumber} from your saved card${
        options.chargeNeedsShopper
          ? ", because your bank needs you to confirm it"
          : ""
      }. Please pay it from your order page${
        balanceDeadline
          ? ` by ${balanceDeadline}, or the pre-order will be cancelled and anything you have paid refunded`
          : " before fulfillment"
      }.`,
    },
    address_changed: {
      title: "Pre-order Delivery Address Updated",
      // Sent to the order's own address every time, whoever made the change.
      // A manage link can be forwarded, and this is how its owner finds out
      // if someone else used it to point their parcel somewhere new.
      message: `The delivery address for pre-order #${orderNumber} was changed${
        options.addressSummary ? ` to ${options.addressSummary}` : ""
      }. If you did not make this change, contact us straight away.`,
    },
    partially_ready: {
      title: "Pre-order Partially Ready",
      message: `Part of your pre-order #${orderNumber} is ready. We will update you when the rest is available.`,
    },
    delayed: {
      title: "Pre-order Date Updated",
      // The choice is the half that was missing. A slipped date changes the
      // deal the shopper agreed to, and the rules that govern it — the US Mail
      // Order Rule, and most consumer law like it — say the shopper must be
      // offered the way out, not left to discover one. The link is theirs to
      // use: the account order page for a signed-in shopper, the signed manage
      // link for a guest, both of which cancel and refund on the spot.
      message: `Your pre-order #${orderNumber} expected date changed${
        previousReleaseDate ? ` from ${previousReleaseDate}` : ""
      }${releaseDate ? ` to ${releaseDate}` : ""}.${
        reason ? ` Reason: ${reason}` : ""
      } If the new date does not work for you, you can cancel the pre-order for a full refund of anything you have paid.`,
    },
    cancelled: {
      title: "Pre-order Cancelled",
      message: `${scopeLead} has been cancelled.${refundSentence}${scopeTail}`,
    },
    fulfilled: {
      title: "Pre-order Fulfilled",
      message: `Your pre-order #${orderNumber} has been fulfilled.`,
    },
    expired: {
      title: "Pre-order Expired",
      message: `${scopeLead} expired because the required payment was not completed in time.${refundSentence}${scopeTail}`,
    },
  };

  const isShopper = customer.role === USER_ROLES.CUSTOMER;
  const optOuts =
    isShopper && (channels.email || channels.sms)
      ? await customerOptOuts(customer.userId)
      : { orderEmail: false, sms: false };

  return dispatchNotification({
    recipient: customer,
    channels,
    settings,
    notification: {
      type: NotificationType.ORDER_STATUS,
      title: copy[status].title,
      message: copy[status].message,
      // A shopper asked for money gets taken straight to the form that takes
      // it. The signed balance link works with or without an account, which is
      // the only thing that makes this message useful to a guest at all — the
      // account page it would otherwise point at is one they cannot open.
      link:
        balanceLink ||
        (!customer.userId
          ? manageLink || trackOrderLink(orderNumber)
          : orderId
            ? `/account/orders/${orderId}`
            : "/account/orders"),
      data: {
        orderNumber,
        orderId,
        status,
        releaseDate,
        previousReleaseDate,
        outstandingAmount,
        balanceDeadline: balanceDeadline || undefined,
        recipientRole: USER_ROLES.CUSTOMER,
        ...(options.addressSummary ? { addressSummary: options.addressSummary } : {}),
        ...(options.chargeAttempt ? { chargeAttempt: options.chargeAttempt } : {}),
        ...(options.reminderStage ? { reminderStage: options.reminderStage } : {}),
        ...(options.balanceCycleId ? { balanceCycleId: options.balanceCycleId } : {}),
        ...(options.refundOutcome ? { refundOutcome: options.refundOutcome } : {}),
      },
      // Status and release date alone cannot tell two DIFFERENT events of the
      // same kind apart, and the dedupe gate returns before email is sent — so
      // a second address change (the one a leaked link would make) and every
      // charge retry after the first were swallowed. Each carries what makes it
      // a new event; everything else keeps its key exactly as it was.
      dedupe: {
        type: NotificationType.ORDER_STATUS,
        "data.orderNumber": orderNumber,
        "data.status": status,
        "data.releaseDate": releaseDate,
        "data.recipientRole": USER_ROLES.CUSTOMER,
        ...(options.addressSummary
          ? { "data.addressSummary": options.addressSummary }
          : {}),
        ...(options.chargeAttempt
          ? { "data.chargeAttempt": options.chargeAttempt }
          : {}),
        ...(options.reminderStage
          ? { "data.reminderStage": options.reminderStage }
          : {}),
        ...(options.balanceCycleId
          ? { "data.balanceCycleId": options.balanceCycleId }
          : {}),
      },
    },
    skip: {
      email: optOuts.orderEmail || options.skip?.email === true,
      sms: optOuts.sms || !isShopper || options.skip?.sms === true,
    },
  });
}

/**
 * What happened to a pre-order balance notice's email — the evidence the
 * notice window starts from. `blocked` means no email could be attempted at
 * all, and why; the caller treats that exactly like a failure: no automatic
 * charge, and a person is asked to look.
 */
export type PreorderBalanceNoticeDelivery =
  | { status: "blocked"; reason: "no_contact" | "email_channel_disabled" | "customer_opted_out" | "email_unconfigured" }
  | EmailDeliveryOutcome;

/**
 * The advance notice of a pre-order balance — the one message whose delivery
 * is evidence rather than courtesy.
 *
 * It says how much, in what currency, for which goods and when they are
 * expected; the earliest moment a saved card may be charged ("on or after",
 * because the daily job may run later, never earlier); the payment deadline;
 * and where to pay now or, for a guest, separately where to cancel. The email
 * goes through the outbox with a key per request and attempt, and what the
 * outbox did with it is returned — the caller records `sentAt` as the moment
 * the notice was accepted, and nothing less starts the notice window. The
 * in-app row and the text message go out through the usual dispatch, never
 * an email of their own beside this one.
 */
export async function deliverPreorderBalanceNotice(params: {
  orderId: string;
  cycleId: string;
  attempt: number;
  amount: number;
  currency: string;
  releaseDate?: Date | string | null;
  /** The earliest the card may be charged, if this notice went out now. */
  chargeNotBefore?: Date | null;
  /** The last day to pay, if this notice went out now. */
  payBy?: Date | null;
  /** A saved card and mandate exist, so an automatic charge is planned. */
  autoCharge: boolean;
  settings?: ISettings;
}): Promise<PreorderBalanceNoticeDelivery> {
  const settings = params.settings || (await getSettings());
  const channels = normalizeNotificationSettings(settings.notifications).customer.orderUpdates;
  const loaded = await loadOrderCustomer(params.orderId);
  if (!loaded?.customer) return { status: "blocked", reason: "no_contact" };
  const { order, customer } = loaded;
  const orderNumber = String(order.orderNumber || "");
  const amount = formatCurrency(params.amount, params.currency || DEFAULT_CURRENCY);
  const day = (value?: Date | string | null, withTime = false) => {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", timeZoneName: "short" } : {}),
      timeZone: "UTC",
    }).format(date);
  };
  const release = day(params.releaseDate);
  const chargeAt = day(params.chargeNotBefore, true);
  const payBy = day(params.payBy);
  const guest = !customer.userId;
  const accountLink = guest ? undefined : `/account/orders/${params.orderId}`;
  const payLink =
    preorderBalanceLinkPath(params.orderId) || accountLink || trackOrderLink(orderNumber);
  const manageLink = guest ? preorderManageLinkPath(params.orderId) : undefined;

  const title = "Your pre-order is ready — balance due";
  const message = [
    `Your pre-order #${orderNumber}${release ? `, expected around ${release},` : ""} is ready.`,
    `The remaining balance is ${amount}.`,
    params.autoCharge && chargeAt
      ? `As you authorised at checkout, we will charge it to your saved card on or after ${chargeAt}, unless you pay it yourself first.`
      : "Please pay it from the link below.",
    payBy
      ? `If it has not been paid by ${payBy}, the pre-order will be cancelled and anything you have paid refunded.`
      : "",
    "You can pay now, or cancel the pre-order for a refund of anything you have paid, until it is released for fulfilment.",
  ]
    .filter(Boolean)
    .join(" ");

  // The in-app row and any text message: the usual dispatch, without email.
  const isShopper = customer.role === USER_ROLES.CUSTOMER;
  const optOuts =
    isShopper && (channels.email || channels.sms)
      ? await customerOptOuts(customer.userId)
      : { orderEmail: false, sms: false };
  await dispatchNotification({
    recipient: customer,
    channels,
    settings,
    notification: {
      type: NotificationType.ORDER_STATUS,
      title,
      message,
      link: guest ? payLink : accountLink,
      data: {
        orderNumber,
        orderId: params.orderId,
        status: "payment_due",
        balanceCycleId: params.cycleId,
        outstandingAmount: params.amount,
        recipientRole: USER_ROLES.CUSTOMER,
      },
      dedupe: {
        type: NotificationType.ORDER_STATUS,
        "data.orderNumber": orderNumber,
        "data.status": "payment_due",
        "data.balanceCycleId": params.cycleId,
        "data.recipientRole": USER_ROLES.CUSTOMER,
      },
    },
    skip: { email: true, sms: optOuts.sms || !isShopper },
  }).catch((error) => console.error("Failed to post a balance notice in-app:", error));

  // The email is the evidence, so every reason it cannot go is named.
  if (!channels.email) return { status: "blocked", reason: "email_channel_disabled" };
  if (optOuts.orderEmail) return { status: "blocked", reason: "customer_opted_out" };
  const contact =
    customer.email || (customer.userId ? (await loadUserContact(customer.userId))?.email : undefined);
  if (!contact) return { status: "blocked", reason: "no_contact" };
  if (!isEmailDeliveryConfigured(settings)) {
    return { status: "blocked", reason: "email_unconfigured" };
  }
  return queueEmailWithEvidence({
    to: contact,
    subject: `${title} (#${orderNumber})`,
    html: buildPreorderBalanceNoticeHtml({
      title,
      message,
      customerName: customer.name,
      payLink,
      manageLink,
      accountLink,
      settings,
    }),
    settings,
    category: "notification",
    dedupeKey: `preorder-balance-notice:${params.cycleId}:${params.attempt}`,
  });
}

function buildPreorderBalanceNoticeHtml(params: {
  title: string;
  message: string;
  customerName?: string;
  payLink: string;
  manageLink?: string;
  accountLink?: string;
  settings?: ISettings;
}) {
  const button = (href: string, label: string, primary: boolean) =>
    `<a href="${escapeHtml(absoluteLink(href))}" style="display:inline-block; margin:0 8px 8px 0; padding:12px 18px; background:${primary ? "#18181b" : "#ffffff"}; color:${primary ? "#ffffff" : "#18181b"}; border:1px solid #18181b; text-decoration:none; border-radius:6px; font-size:14px; font-weight:600;">${escapeHtml(label)}</a>`;
  const base = buildCustomerNotificationEmailHtml({
    title: params.title,
    message: params.message,
    customerName: params.customerName,
    link: params.accountLink || params.payLink,
    settings: params.settings,
  });
  const buttons = [
    button(params.payLink, "Pay the balance now", true),
    params.manageLink ? button(params.manageLink, "Manage or cancel", false) : "",
    params.accountLink ? button(params.accountLink, "View your order", false) : "",
  ].join("");
  // Swap the generic single button for the notice's own.
  return base.replace(
    /<a href="[^"]*" style="display:inline-block; padding:12px 18px; background:#18181b;[^>]*>View details<\/a>/,
    buttons,
  );
}

/**
 * The customer's side of an address hold.
 *
 * `request` and `reminder` carry the signed address link, which works with or
 * without an account — a guest has no other way to reach their order. `changed`
 * goes to the order's own contact whoever made the change, so a forwarded link
 * used by someone else is seen by the person it belongs to. `cancelled` says
 * why, which "your order was cancelled" alone would not.
 */
export async function notifyAddressHoldCustomer(params: {
  orderId: string;
  kind: "request" | "reminder" | "changed" | "cancelled";
  /** Why the address can't be delivered to. */
  reason?: string;
  deadline?: Date | string;
  addressSummary?: string;
  /** Which reminder this is — part of the dedupe key, as each is its own event. */
  reminderNumber?: number;
  /** A cancellation whose refund did not go through: the store sends it by hand. */
  refundOwed?: boolean;
  settings?: ISettings;
}) {
  const settings = params.settings || (await getSettings());
  const channels = normalizeNotificationSettings(settings.notifications).customer
    .orderUpdates;
  if (!hasAnyNotificationChannel(channels)) return null;

  const loaded = await loadOrderCustomer(params.orderId);
  if (!loaded?.customer) return null;
  const orderNumber = String((loaded.order as { orderNumber?: string }).orderNumber || "");

  const deadline = params.deadline
    ? new Intl.DateTimeFormat("en", { month: "long", day: "numeric" }).format(
        new Date(params.deadline),
      )
    : "";
  const reason = params.reason?.trim();
  const link = orderAddressLinkPath(params.orderId);
  const sentAt = new Date().toISOString();

  const copy = {
    request: {
      title: `Action needed: confirm your delivery address for #${orderNumber}`,
      message: `The courier can't deliver to the address on order #${orderNumber}${
        reason ? ` (${reason})` : ""
      }, so we've paused shipping. Please confirm or correct it${
        deadline ? ` by ${deadline}` : ""
      }. It takes a minute and no sign-in is needed.`,
    },
    reminder: {
      title: `Reminder: confirm your delivery address for #${orderNumber}`,
      message: `We still can't deliver order #${orderNumber} to the address you gave${
        reason ? ` (${reason})` : ""
      }. Please confirm or correct it${deadline ? ` by ${deadline}` : ""}, or the store will review the order.`,
    },
    changed: {
      title: `Delivery address updated for #${orderNumber}`,
      message: `The delivery address for order #${orderNumber} was changed${
        params.addressSummary ? ` to ${params.addressSummary}` : ""
      }. If you did not make this change, contact us straight away.`,
    },
    cancelled: {
      title: `Order #${orderNumber} cancelled`,
      message: `We cancelled order #${orderNumber} because the delivery address couldn't be confirmed in time. ${
        params.refundOwed
          ? "Your refund could not be sent automatically, so the store will return what you paid."
          : "Anything you paid is being refunded."
      }`,
    },
  }[params.kind];

  const customer = loaded.customer;
  const isShopper = customer.role === USER_ROLES.CUSTOMER;
  const optOuts =
    isShopper && (channels.email || channels.sms)
      ? await customerOptOuts(customer.userId)
      : { orderEmail: false, sms: false };

  return dispatchNotification({
    recipient: customer,
    channels,
    settings,
    notification: {
      type: NotificationType.ORDER_STATUS,
      title: copy.title,
      message: copy.message,
      link:
        params.kind === "request" || params.kind === "reminder"
          ? link ||
            (customer.userId ? `/account/orders/${params.orderId}` : trackOrderLink(orderNumber))
          : customer.userId
            ? `/account/orders/${params.orderId}`
            : trackOrderLink(orderNumber),
      data: {
        orderNumber,
        orderId: params.orderId,
        addressHold: params.kind,
        ...(params.kind === "request" ? { sentAt } : {}),
        recipientRole: USER_ROLES.CUSTOMER,
        ...(params.reminderNumber ? { reminderNumber: params.reminderNumber } : {}),
        ...(params.addressSummary ? { addressSummary: params.addressSummary } : {}),
      },
      dedupe: {
        type: NotificationType.ORDER_STATUS,
        "data.orderNumber": orderNumber,
        "data.addressHold": params.kind,
        "data.recipientRole": USER_ROLES.CUSTOMER,
        // A second request after a store resend, each reminder and each change
        // is its own event; keyed on the kind alone they would be swallowed.
        ...(params.kind === "request" ? { "data.sentAt": sentAt } : {}),
        ...(params.reminderNumber ? { "data.reminderNumber": params.reminderNumber } : {}),
        ...(params.addressSummary ? { "data.addressSummary": params.addressSummary } : {}),
      },
    },
    skip: { email: optOuts.orderEmail, sms: optOuts.sms || !isShopper },
  });
}

/** The store's side of an address hold: something needs a person. */
export async function notifyAdminsAddressHold(params: {
  orderId: string;
  orderNumber: string;
  /** `deadline_confirmed`: the deadline passed on a customer who said the address is right. */
  kind: "customer_confirmed" | "deadline" | "deadline_confirmed";
}) {
  try {
    const settings = await getSettings();
    const admins = await findAdminRecipients();
    const copy = {
      customer_confirmed: {
        title: `Customer confirmed the address on #${params.orderNumber}`,
        message: `The customer says the delivery address on order #${params.orderNumber} is correct as it is, but the courier could not deliver to it. Check it, then ship anyway or cancel.`,
      },
      deadline: {
        title: `Address deadline passed on #${params.orderNumber}`,
        message: `The customer did not correct the undeliverable address on order #${params.orderNumber} in time. The order is still open — cancel and refund it, edit the address, or give more time.`,
      },
      deadline_confirmed: {
        title: `Address deadline passed on #${params.orderNumber}`,
        message: `The customer says the delivery address on order #${params.orderNumber} is correct as it is, and the deadline has passed. The order stays open until you decide — ship anyway, edit the address, or cancel and refund it.`,
      },
    }[params.kind];
    await Promise.allSettled(
      admins.map((recipient) =>
        dispatchNotification({
          recipient,
          channels: { inApp: true, browserPush: true, email: true, sms: false },
          settings,
          notification: {
            type: NotificationType.SYSTEM,
            title: copy.title,
            message: copy.message,
            link: `/admin/orders/${params.orderId}`,
            data: {
              orderId: params.orderId,
              orderNumber: params.orderNumber,
              dedupeKey: `address-hold:${params.kind}:${params.orderId}`,
              recipientRole: USER_ROLES.ADMIN,
            },
            dedupe: {
              type: NotificationType.SYSTEM,
              "data.dedupeKey": `address-hold:${params.kind}:${params.orderId}`,
              "data.recipientRole": USER_ROLES.ADMIN,
            },
          },
        }),
      ),
    );
  } catch (error) {
    console.error("Failed to notify admins about an address hold:", error);
  }
}

/**
 * Create vendor application status notification. The vendor's email is sent
 * by the caller (each status has its own template), so this owns the in-app
 * row, the push and the text — except for a suspension and a reinstatement,
 * which have no template of their own and go out as the generic notice.
 */
export async function notifyVendorApplicationStatus(
  userId: string,
  status:
    | "approved"
    | "rejected"
    | "payment_required"
    | "payment_expired"
    | "suspended"
    | "reinstated",
  options: {
    settings?: ISettings;
    channels?: NotificationChannelSettings;
    /** Rejection only: what the admin wrote, so the re-application is informed. */
    reason?: string | null;
  } = {},
) {
  const settings = options.settings || (await getSettings());
  const channels =
    options.channels ||
    normalizeNotificationSettings(settings.notifications).vendor
      .applicationStatus;
  const sendsOwnEmail = status === "suspended" || status === "reinstated";
  if (
    !channels.inApp &&
    !channels.browserPush &&
    !channels.sms &&
    !(sendsOwnEmail && channels.email)
  ) {
    return null;
  }

  const vendor =
    channels.sms && isValidObjectId(userId)
      ? await Vendor.findOne({ userId })
          .select("userId address.phone address.country")
          .populate("userId", USER_CONTACT_FIELDS)
          .lean<VendorContactDoc | null>()
      : null;

  const reason = options.reason?.trim();
  return dispatchNotification({
    recipient: (vendor && vendorRecipient(vendor)) || { userId },
    channels,
    settings,
    skip: { email: !sendsOwnEmail },
    notification: {
      type: NotificationType.VENDOR_APPLICATION,
      title:
        status === "approved"
          ? "Vendor Account Activated"
          : status === "payment_required"
            ? "Vendor Verification Approved"
            : status === "payment_expired"
              ? "Vendor Setup Access Ended"
              : status === "suspended"
                ? "Vendor Store Suspended"
                : status === "reinstated"
                  ? "Vendor Store Reactivated"
                  : "Vendor Application Update",
      message:
        status === "approved"
          ? "Your subscription is active and your vendor store can now start selling."
          : status === "payment_required"
            ? "Your application passed review. You have 7 days of setup access. Complete payment to activate selling."
            : status === "payment_expired"
              ? "Your setup access ended because payment was not completed. You can still complete payment to reactivate your vendor dashboard."
              : status === "suspended"
                ? "Your vendor store has been suspended. Your products are hidden from the store and you can't sell until it is reactivated. If you think this is a mistake, please contact us."
                : status === "reinstated"
                  ? "Your vendor store has been reactivated. Your products are visible again and you can start selling."
                  : `Your vendor application was not approved.${reason ? ` Reason: ${reason}` : ""} You can update your details and apply again.`,
      link:
        status === "rejected"
          ? "/become-vendor"
          : status === "suspended"
            ? "/contact"
            : "/vendor/dashboard",
      data: { status },
    },
  });
}

// ============================================
// Account status
// ============================================

/**
 * Every channel but the text: an account that loses (or gets back) its
 * sign-in is told whatever the event matrix says, like a password reset —
 * the owner of a banned account would otherwise learn of it only at the
 * login form. A text is billed, so it is never sent unasked.
 */
const ACCOUNT_STATUS_CHANNELS: NotificationChannelSettings = {
  inApp: true,
  email: true,
  browserPush: true,
  sms: false,
};

type AccountStatusNotice = "banned" | "deactivated" | "reactivated";

function accountStatusNotice(
  from: string | null | undefined,
  to: string | null | undefined,
): AccountStatusNotice | null {
  const before = from || USER_ACCOUNT_STATUS.ACTIVE;
  if (!to || to === before) return null;
  if (to === USER_ACCOUNT_STATUS.BANNED) return "banned";
  if (to === USER_ACCOUNT_STATUS.INACTIVE) return "deactivated";
  if (to === USER_ACCOUNT_STATUS.ACTIVE) return "reactivated";
  return null;
}

/** Where a reactivated account starts again. */
function accountHomeLink(role: string) {
  if (role === USER_ROLES.ADMIN) return "/admin";
  if (role === USER_ROLES.VENDOR) return "/vendor/dashboard";
  if (isStaffRole(role)) return "/staff";
  return "/account";
}

/**
 * Tell an account's owner that an admin banned, deactivated or reactivated
 * it. `from` is the status before the save (missing reads as active); a save
 * that left the status where it was sends nothing.
 *
 * A team member's "banned" reads "suspended", the word the Team page uses.
 * Call it after the account write, so the row and the mail never announce a
 * change that was refused.
 */
export async function notifyAccountStatusChange(params: {
  userId: string;
  from: string | null | undefined;
  to: string | null | undefined;
  settings?: ISettings;
}) {
  const notice = accountStatusNotice(params.from, params.to);
  if (!notice) return null;
  const user = await loadUserContact(params.userId);
  if (!user) return null;

  const settings = params.settings || (await getSettings());
  const storeName = storeNameOf(settings);
  const role = notificationRoleOf(user);
  const isTeam = role === USER_ROLES.ADMIN || isStaffRole(role);
  const banWord = isTeam ? "suspended" : "banned";

  const copy =
    notice === "banned"
      ? {
          title: `Your Account Has Been ${isTeam ? "Suspended" : "Banned"}`,
          message: `Your ${storeName} account has been ${banWord}. You can no longer sign in. If you think this is a mistake, please contact us.`,
          link: isTeam ? undefined : "/contact",
        }
      : notice === "deactivated"
        ? {
            title: "Your Account Has Been Deactivated",
            message: `Your ${storeName} account has been deactivated. You can't sign in until it is reactivated. If you have questions, please contact us.`,
            link: isTeam ? undefined : "/contact",
          }
        : {
            title: "Your Account Has Been Reactivated",
            message: `Your ${storeName} account is active again. You can sign in now.`,
            link: accountHomeLink(role),
          };

  return dispatchNotification({
    recipient: {
      userId: params.userId,
      name: user.name,
      email: user.email,
      ...accountPhone(user),
    },
    channels: ACCOUNT_STATUS_CHANNELS,
    settings,
    notification: {
      type: NotificationType.SYSTEM,
      title: copy.title,
      message: copy.message,
      link: copy.link,
      data: { accountStatus: params.to, notice, recipientRole: role },
    },
  });
}

/**
 * Create a pending vendor application notification for an admin. The admin
 * email is sent by the application route, to every admin at once.
 */
export async function notifyAdminVendorApplicationPending(
  adminUserId: string,
  application: {
    vendorId: string;
    storeName: string;
    vendorName?: string;
    vendorEmail?: string;
    /**
     * Part of the dedupe key: a vendor who re-applies keeps their vendor id,
     * so without it a re-application within 30 days reached no admin.
     */
    submittedAt?: Date;
  },
  options: {
    settings?: ISettings;
    channels?: NotificationChannelSettings;
  } = {},
) {
  const settings = options.settings || (await getSettings());
  const channels =
    options.channels ||
    normalizeNotificationSettings(settings.notifications).admin.newVendors;
  if (!channels.inApp && !channels.browserPush && !channels.sms) return null;

  const submittedAt = application.submittedAt?.toISOString();
  return dispatchNotification({
    recipient: { userId: adminUserId },
    channels,
    settings,
    skip: { email: true },
    notification: {
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
        submittedAt,
        recipientRole: USER_ROLES.ADMIN,
      },
      dedupe: {
        type: NotificationType.VENDOR_APPLICATION,
        "data.vendorId": application.vendorId,
        "data.status": "pending",
        "data.submittedAt": submittedAt,
        "data.recipientRole": USER_ROLES.ADMIN,
      },
    },
  });
}

/**
 * Tell every admin a vendor is waiting on pre-order access.
 *
 * Asking used to do nothing but stamp the vendor record, so a request sat
 * unseen until an admin happened to scroll to the bottom of Marketplace
 * settings — while the vendor waited on an answer nobody knew was owed.
 *
 * Keyed on `requestedAt`, so asking again after a decline is a new request
 * with its own notification rather than a duplicate of the old one.
 */
export async function notifyAdminsPreorderAccessRequest(
  request: {
    vendorId: string;
    storeName: string;
    ownerName?: string;
    ownerEmail?: string;
    requestedAt: Date;
  },
  options: { settings?: ISettings } = {},
) {
  try {
    await connectDB();
    const settings = options.settings || (await getSettings());
    const channels = normalizeNotificationSettings(settings.notifications).admin
      .preorderAccessRequests;
    if (!hasAnyNotificationChannel(channels)) return;

    const admins = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      status: { $ne: USER_ACCOUNT_STATUS.BANNED },
    })
      .select("_id email")
      .lean();

    const requestKey = request.requestedAt.toISOString();
    const data = {
      event: "preorder_access_request",
      vendorId: request.vendorId,
      storeName: request.storeName,
      requestedAt: requestKey,
      recipientRole: USER_ROLES.ADMIN,
    };

    await Promise.allSettled([
      ...admins.map(async (admin) => {
        const adminUserId = getIdString(admin._id);
        if (!adminUserId) return;

        // The email goes once to every admin below, not per recipient here.
        await dispatchNotification({
          recipient: { userId: adminUserId },
          channels,
          settings,
          skip: { email: true },
          notification: {
            type: NotificationType.VENDOR_ACCESS_REQUEST,
            title: "Pre-order access request",
            message: `${request.storeName} is asking to sell pre-orders.`,
            link: PREORDER_ACCESS_REVIEW_PATH,
            data,
            dedupe: {
              type: NotificationType.VENDOR_ACCESS_REQUEST,
              "data.event": data.event,
              "data.vendorId": data.vendorId,
              "data.requestedAt": requestKey,
            },
          },
        });
      }),
      channels.email
        ? sendAdminPreorderAccessRequestEmail({
            // The store inbox too, as for a new vendor application: it is
            // often the address somebody actually reads.
            adminEmails: [
              ...admins.map((admin) => String(admin.email || "")),
              settings.general?.storeEmail || "",
            ],
            vendorEmail: request.ownerEmail,
            vendorName: request.ownerName,
            storeName: request.storeName,
            limits: resolvePreorderPolicy(settings.preorder),
            settings,
          })
        : Promise.resolve(false),
    ]);
  } catch (error) {
    console.error(
      "Failed to notify admins about a pre-order access request:",
      error,
    );
  }
}

/** The in-app wording for each decision. Kept under the model's 500 chars. */
export function buildPreorderAccessDecisionCopy(
  decision: PreorderAccessDecision,
  note: string | null | undefined,
  limits: { maxLeadDays: number; maxDepositPercent: number },
) {
  const trimmed = note?.trim() || "";
  const reason = trimmed
    ? ` Reason: ${trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed}`
    : "";

  if (decision === "approved") {
    return {
      title: "Pre-order access approved",
      message: `You can now open pre-orders. Release dates can be up to ${limits.maxLeadDays} days out, and deposits up to ${limits.maxDepositPercent}% of the price.`,
      link: "/vendor/products",
    };
  }
  if (decision === "declined") {
    return {
      title: "Pre-order access request declined",
      message: `Your request to sell pre-orders was not approved.${reason} You can ask again from the Pre-orders page.`,
      link: "/vendor/preorders",
    };
  }
  return {
    title: "Pre-order access withdrawn",
    message: `You can no longer open new pre-orders.${reason} Pre-orders already selling are not affected.`,
    link: "/vendor/preorders",
  };
}

/**
 * Tell a vendor what an admin decided about their pre-order access.
 *
 * A decline used to be silent: the request stamp was cleared, and the vendor's
 * Pre-orders page quietly went back to offering "Request access" as though
 * they had never asked.
 */
export async function notifyVendorPreorderAccessDecision(
  params: {
    vendorUserId: string;
    storeName: string;
    decision: PreorderAccessDecision;
    /** What the admin wrote when deciding. Shared with the vendor. */
    note?: string | null;
  },
  options: { settings?: ISettings } = {},
) {
  try {
    await connectDB();
    const settings = options.settings || (await getSettings());
    const channels = normalizeNotificationSettings(settings.notifications).vendor
      .preorderAccess;
    if (!hasAnyNotificationChannel(channels)) return;

    const limits = resolvePreorderPolicy(settings.preorder);
    const copy = buildPreorderAccessDecisionCopy(
      params.decision,
      params.note,
      limits,
    );

    // The decision has its own email, sent below.
    await dispatchNotification({
      recipient: { userId: params.vendorUserId },
      channels,
      settings,
      skip: { email: true },
      notification: {
        type: NotificationType.VENDOR_ACCESS_REQUEST,
        title: copy.title,
        message: copy.message,
        link: copy.link,
        data: {
          event: "preorder_access_decision",
          decision: params.decision,
          recipientRole: USER_ROLES.VENDOR,
        },
      },
    });

    if (channels.email) {
      const owner = await User.findById(params.vendorUserId)
        .select("name email")
        .lean<{ name?: string; email?: string } | null>();
      if (owner?.email) {
        await sendVendorPreorderAccessDecisionEmail({
          vendorEmail: owner.email,
          vendorName: owner.name,
          storeName: params.storeName,
          decision: params.decision,
          note: params.note,
          limits,
          settings,
        });
      }
    }
  } catch (error) {
    console.error(
      "Failed to notify vendor about a pre-order access decision:",
      error,
    );
  }
}

/**
 * Notify admins (and staff who can see customers) of a new customer: one the
 * admin, a till or a vendor added, or — `signedUp` — one who made their own
 * account on the store. Sign-ups used to tell nobody, though the switch read
 * "when a customer profile is created".
 */
export async function notifyAdminsNewCustomer(
  customer: {
    customerId?: string;
    name?: string;
    email?: string;
    createdBy?: string;
    /** They made the account themselves: sign-up, social login, checkout. */
    signedUp?: boolean;
  },
  options: {
    settings?: ISettings;
  } = {},
) {
  try {
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

    const admins = hasAnyNotificationChannel(channels)
      ? await findAdminRecipients()
      : [];
    const customerLabel = customer.name || customer.email || "A customer";
    const title = customer.signedUp ? "New Customer Sign-up" : "New Customer Created";
    const message = customer.signedUp
      ? `${customerLabel} created a customer account.`
      : `${customerLabel} has been added as a customer.`;
    const link = customer.customerId
      ? `/admin/customers/${customer.customerId}`
      : "/admin/customers";
    const data = {
      event: "new_customer",
      customerId: customer.customerId,
      customerName: customer.name,
      customerEmail: customer.email,
      createdBy: customer.createdBy,
      signedUp: customer.signedUp === true,
    };
    const dedupe = {
      type: NotificationType.SYSTEM,
      "data.event": "new_customer",
      "data.customerId": customer.customerId,
    };

    await Promise.allSettled([
      ...admins.map((recipient) =>
        dispatchNotification({
          recipient,
          channels,
          settings,
          notification: {
            type: NotificationType.SYSTEM,
            title,
            message,
            link,
            data: { ...data, recipientRole: USER_ROLES.ADMIN },
            dedupe: { ...dedupe, "data.recipientRole": USER_ROLES.ADMIN },
          },
        }),
      ),
      notifyStaffUsers({
        permissions: STAFF_NOTIFICATION_PERMISSIONS.newCustomers,
        // A new account has bought nothing yet, so it is in no seller's scope.
        vendorIds: [],
        channels: staffChannels,
        type: NotificationType.SYSTEM,
        title,
        message,
        link,
        data,
        dedupe,
        settings,
      }),
    ]);
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
    /**
     * Which payment of the order this is. Payments are deduped per order, so
     * a pre-order's balance ("preorder_balance") collided with its deposit
     * and never reached anyone.
     */
    kind?: "charge" | "preorder_balance";
  },
  options: {
    settings?: ISettings;
  } = {},
) {
  try {
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

    const admins = hasAnyNotificationChannel(channels)
      ? await findAdminRecipients()
      : [];
    const amount = Number(payment.amount || 0);
    const currency =
      payment.currency || settings.general?.defaultCurrency || DEFAULT_CURRENCY;
    const formattedAmount = Number.isFinite(amount)
      ? formatCurrency(amount, currency)
      : currency;
    const orderNumber = payment.orderNumber || "unknown";
    const kind = payment.kind || "charge";
    const title = "Payment Received";
    const message = `Payment ${formattedAmount} was recorded for order #${orderNumber}.`;
    const link = payment.orderId
      ? `/admin/orders/${payment.orderId}`
      : "/admin/payments";
    const data = {
      orderId: payment.orderId,
      orderNumber: payment.orderNumber,
      amount: payment.amount,
      currency: payment.currency,
      paymentMethod: payment.paymentMethod,
      kind,
    };
    const dedupe = {
      type: NotificationType.PAYMENT_RECEIVED,
      "data.orderId": payment.orderId,
      "data.kind": kind,
    };
    const staffVendorIds =
      payment.orderId && hasAnyNotificationChannel(staffChannels)
        ? vendorIdsOfOrder(
            await Order.findById(payment.orderId)
              .select("items.vendorId subOrders.vendorId")
              .lean(),
          )
        : [];

    await Promise.allSettled([
      ...admins.map((recipient) =>
        dispatchNotification({
          recipient,
          channels,
          settings,
          notification: {
            type: NotificationType.PAYMENT_RECEIVED,
            title,
            message,
            link,
            data: { ...data, recipientRole: USER_ROLES.ADMIN },
            dedupe: { ...dedupe, "data.recipientRole": USER_ROLES.ADMIN },
          },
        }),
      ),
      notifyStaffUsers({
        permissions: STAFF_NOTIFICATION_PERMISSIONS.payments,
        vendorIds: staffVendorIds,
        channels: staffChannels,
        type: NotificationType.PAYMENT_RECEIVED,
        title,
        message,
        link,
        data,
        dedupe,
        settings,
      }),
    ]);
  } catch (error) {
    console.error("Failed to notify admins about payment:", error);
  }
}

/**
 * Alert admins that a captured payment was NOT fulfilled and needs eyes —
 * e.g. a Stripe payment rejected by the cart-tamper guard (auto-refund
 * attempted). Money moved without an order, so this must never be silent.
 *
 * In-app, push and email regardless of the admin's notification preferences:
 * this is an operational incident, not a routine payment notification. Not a
 * text — nothing in the matrix lets an admin decide what an incident costs.
 * The dedupe key is what keeps a persisting incident (the cron-health check
 * runs on every admin dashboard load) from mailing the team on every call.
 */
export async function notifyAdminsPaymentAnomaly(anomaly: {
  title: string;
  message: string;
  paymentIntentId?: string;
  cartId?: string;
  /**
   * What makes this notice the same notice.
   *
   * Without one, a notice naming a payment intent is sent once per intent,
   * ever — so a second, different event on the same payment (a dispute
   * opening, then the chargeback landing) was swallowed as a repeat of the
   * first. Given, it replaces the intent as the key.
   */
  dedupeKey?: string;
  /** Where the notice takes an admin. The payments screen when unset. */
  link?: string;
}) {
  try {
    const settings = await getSettings();
    const admins = await findAdminRecipients();

    await Promise.allSettled(
      admins.map((recipient) =>
        dispatchNotification({
          recipient,
          channels: { inApp: true, browserPush: true, email: true, sms: false },
          settings,
          notification: {
            type: NotificationType.SYSTEM,
            title: anomaly.title,
            message: anomaly.message,
            link: anomaly.link || "/admin/payments",
            data: {
              paymentIntentId: anomaly.paymentIntentId,
              cartId: anomaly.cartId,
              ...(anomaly.dedupeKey ? { dedupeKey: anomaly.dedupeKey } : {}),
              recipientRole: USER_ROLES.ADMIN,
            },
            dedupe: anomaly.dedupeKey
              ? {
                  type: NotificationType.SYSTEM,
                  "data.dedupeKey": anomaly.dedupeKey,
                  "data.recipientRole": USER_ROLES.ADMIN,
                }
              : anomaly.paymentIntentId
                ? {
                    type: NotificationType.SYSTEM,
                    "data.paymentIntentId": anomaly.paymentIntentId,
                    "data.recipientRole": USER_ROLES.ADMIN,
                  }
                : undefined,
          },
        }),
      ),
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
 * Tell admins one of the store's own products is running low (Settings →
 * Notifications → Admins → Low stock). A vendor's product is that vendor's to
 * restock; they and the staff who can see them hear of it instead.
 */
export async function notifyAdminsLowStock(
  productName: string,
  currentStock: number,
  options: { productId?: string; settings?: ISettings } = {},
) {
  const settings = options.settings || (await getSettings());
  const channels = normalizeNotificationSettings(settings.notifications).admin
    .lowStock;
  if (!hasAnyNotificationChannel(channels)) return;

  const admins = await findAdminRecipients();
  const link = options.productId
    ? `/admin/products/${options.productId}/edit`
    : "/admin/products";
  await Promise.allSettled(
    admins.map((recipient) =>
      dispatchNotification({
        recipient,
        channels,
        settings,
        notification: {
          type: NotificationType.PRODUCT_LOW_STOCK,
          title: "Low Stock Alert",
          message: `"${productName}" is running low with only ${currentStock} items left.`,
          link,
          data: {
            productId: options.productId,
            productName,
            currentStock,
            recipientRole: USER_ROLES.ADMIN,
          },
          dedupe: {
            type: NotificationType.PRODUCT_LOW_STOCK,
            "data.productId": options.productId,
            "data.recipientRole": USER_ROLES.ADMIN,
          },
        },
      }),
    ),
  );
}

/**
 * Notify staff with inventory access about a low-stock product.
 */
export async function notifyStaffLowStock(
  productName: string,
  currentStock: number,
  options: {
    productId?: string;
    /** The product's seller; staff limited to other sellers are not told. */
    vendorId?: string;
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
    permissions: STAFF_NOTIFICATION_PERMISSIONS.lowStock,
    vendorIds: options.vendorId ? [options.vendorId] : [],
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

/**
 * A product just dropped to the low-stock line (inventory.ts): everyone who
 * looks after it hears once.
 *
 * - Staff who can see inventory, scoped to the product's seller.
 * - Admins, for the store's own stock: a product with no seller, or the house
 *   store every product falls back to. A vendor's product is that vendor's to
 *   restock, so admins are not told of every seller's shelves.
 * - The vendor's owner, under their own "Low stock alerts" switch — which was
 *   saved and never read, so switching it off changed nothing. An admin who
 *   owns the house store has just heard as an admin, under the switch the
 *   store set for admins, and is not told twice.
 */
export async function notifyLowStockCrossing(product: {
  productId: string;
  productName: string;
  stock: number;
  vendorId?: string;
}) {
  const { productId, productName, stock, vendorId } = product;
  await notifyStaffLowStock(productName, stock, { productId, vendorId }).catch(
    (error) => console.error("Failed to notify staff low stock:", error),
  );

  await connectDB();
  const vendor = vendorId && isValidObjectId(vendorId)
    ? await Vendor.findById(vendorId)
        .select("userId isDefault slug notificationPreferences.lowStock")
        .lean<{
          userId?: unknown;
          isDefault?: boolean;
          slug?: string;
          notificationPreferences?: { lowStock?: boolean };
        } | null>()
    : null;
  const { isDefaultVendorRecord } = await import("@/lib/vendors/multi-vendor");
  const storeOwned = !vendorId || isDefaultVendorRecord(vendor);

  if (storeOwned) {
    await notifyAdminsLowStock(productName, stock, { productId }).catch(
      (error) => console.error("Failed to notify admins low stock:", error),
    );
  }

  const ownerId = getIdString(vendor?.userId);
  if (!ownerId || vendor?.notificationPreferences?.lowStock === false) return;
  if (storeOwned) {
    const owner = await User.findById(ownerId)
      .select("role roles")
      .lean<{ role?: string; roles?: string[] } | null>();
    if (owner && isAdmin(owner)) return;
  }
  await notifyLowStock(ownerId, productName, stock).catch((error) =>
    console.error("Failed to notify vendor low stock:", error),
  );
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
    discountAdjustment?: number;
    tax?: number;
    shipping?: number;
    restockingFee?: number;
    returnShippingFee?: number;
  };
  /** Why the store said no — the shopper was never told. */
  rejectionReason?: string;
  /**
   * Whether the money has actually gone. A refund no gateway can carry sits on
   * `manual_required` until somebody sends it and records that they did — and
   * the shopper must not be told they have been paid before then.
   */
  refundStatus?: string;
  actualRefund?: {
    amount?: number;
    settledAt?: unknown;
    storeCredit?: number;
    exchange?: number;
  };
  /** The exchange order the return became (R7). */
  exchange?: {
    orderNumber?: string;
    credit?: number;
    owed?: number;
    undoneAt?: unknown;
  } | null;
  /** The checkout email of a guest order — the only way to reach its shopper. */
  guestEmail?: string | null;
  /** How the parcel comes back, and where — see lib/returns/return-shipping.ts. */
  returnMethod?: string | null;
  returnTo?: { name?: string | null; address?: string | null } | null;
  returnInstructions?: string | null;
  shipment?: {
    carrier?: string | null;
    trackingNumber?: string | null;
    labelUrl?: string | null;
    labelFileKey?: string | null;
  } | null;
};

type OrderLikeForNotification = OrderContactLike & {
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

/** The sellers an order's consignments and lines name, each once. */
function vendorIdsOfOrder(
  order: {
    subOrders?: Array<{ vendorId?: unknown } | null> | null;
    items?: unknown[] | null;
  } | null,
): string[] {
  if (!order) return [];
  const ids = [
    ...(order.subOrders ?? []).map((subOrder) => subOrder?.vendorId),
    ...(order.items ?? []).map(
      (item) => (item as { vendorId?: unknown } | null)?.vendorId,
    ),
  ]
    .map(getIdString)
    .filter(Boolean);
  return Array.from(new Set(ids));
}

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
  const storeName = storeNameOf(params.settings);
  const logoUrl = params.settings?.general?.logoUrl;
  const href = absoluteLink(params.link);

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
  recipient: NotificationRecipient,
  returnRequest: ReturnRequestLikeForNotification,
  recipientRole: typeof USER_ROLES.ADMIN | typeof USER_ROLES.VENDOR,
  settings: ISettings,
  customer?: { name?: string; email?: string },
) {
  const notificationSettings = normalizeNotificationSettings(
    settings.notifications,
  );
  const channels =
    recipientRole === USER_ROLES.ADMIN
      ? notificationSettings.admin.returns
      : notificationSettings.vendor.returns;
  if (!hasAnyNotificationChannel(channels)) return;

  const notification = buildReturnRequestOwnerNotification(
    returnRequest,
    recipientRole,
  );

  await dispatchNotification({
    recipient,
    channels,
    settings,
    notification: {
      type: NotificationType.RETURN_REQUEST,
      ...notification,
      dedupe: {
        type: NotificationType.RETURN_REQUEST,
        "data.returnRequestId": notification.data.returnRequestId,
        "data.recipientRole": recipientRole,
      },
    },
    email: async (contact, dedupeKey) => {
      if (!contact.email) return false;
      const sent = await sendReturnRequestOwnerEmail(
        {
          to: contact.email,
          recipientName: contact.name || "there",
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
          estimate: returnRequest.estimatedRefund,
          currency: returnRequest.estimatedRefund?.currency || "USD",
          dashboardUrl: absoluteLink(notification.link),
        },
        settings,
        dedupeKey,
      );
      if (!sent) {
        console.error(`Failed to send return request owner email to ${contact.email}`);
      }
      // Queued for retry either way; the generic notice must not follow it.
      return true;
    },
  });
}

/**
 * Tell a vendor that a refund is theirs to send.
 *
 * On a cash-on-delivery sale the vendor's own van took the notes at the door,
 * so the store is holding nothing to give back — the books have always posted
 * such a refund as the vendor's (`resolveRefundPayer`). What nobody ever said
 * was so out loud: the return sat on `manual_required` addressed to an admin
 * who had never held the money, and the shopper waited on a transfer nobody
 * had been asked to make.
 *
 * Sent once the refund is issued, because until then there is no figure to
 * name. Deliberately not an admin notice: an admin who sends it as well is the
 * shopper being paid twice.
 */
export async function notifyVendorRefundOwed(params: {
  returnRequest: ReturnRequestLikeForNotification & {
    ownerVendorId?: unknown;
    refundDestination?: { method?: string } | null;
  };
  amount: number;
  currency: string;
  settings?: ISettings;
}) {
  try {
    await connectDB();
    const settings = params.settings || (await getSettings());
    const channels = normalizeNotificationSettings(settings.notifications)
      .vendor.returns;
    if (!hasAnyNotificationChannel(channels)) return null;

    const ownerVendorId = getIdString(params.returnRequest.ownerVendorId);
    if (!ownerVendorId) return null;
    const vendor = await Vendor.findById(ownerVendorId)
      .select("userId address.phone address.country")
      .populate("userId", `${USER_CONTACT_FIELDS} status`)
      .lean<VendorContactDoc | null>();
    const vendorStatus = (vendor?.userId as { status?: string } | undefined)
      ?.status;
    const recipient = vendor ? vendorRecipient(vendor) : null;
    if (!recipient || vendorStatus === USER_ACCOUNT_STATUS.BANNED) return null;

    const returnNumber = params.returnRequest.returnNumber || "a return";
    const orderNumber = params.returnRequest.orderNumber || "";
    const returnRequestId = getIdString(params.returnRequest._id);
    const amount = `${Math.max(0, Number(params.amount) || 0).toFixed(2)} ${String(
      params.currency || "",
    ).toUpperCase()}`.trim();

    return dispatchNotification({
      recipient,
      channels,
      settings,
      notification: {
        type: NotificationType.RETURN_REQUEST,
        title: "You owe a refund on a returned order",
        message: `Return ${returnNumber}${
          orderNumber ? ` on order #${orderNumber}` : ""
        }: you collected this order's money at the door, so the ${amount} refund is yours to send. Pay the shopper and record it on the return — the commission on those goods comes off what you owe the store.`,
        link: "/vendor/returns",
        data: {
          returnNumber,
          returnRequestId,
          orderNumber,
          recipientRole: USER_ROLES.VENDOR,
          refundOwed: true,
        },
        dedupe: {
          type: NotificationType.RETURN_REQUEST,
          "data.returnRequestId": returnRequestId,
          "data.refundOwed": true,
          "data.recipientRole": USER_ROLES.VENDOR,
        },
      },
    });
  } catch (error) {
    console.error("Failed to tell a vendor a refund is theirs:", error);
    return null;
  }
}

/**
 * Tell a seller a refund sent from the order screen is theirs to pay.
 *
 * The fact `notifyVendorRefundOwed` gives them about a return: they took this
 * order's cash at the door, so the store holds none of it to send. The order
 * screen never said so, and the store paid the shopper itself.
 */
export async function notifyVendorOrderRefundOwed(params: {
  vendorId: string;
  orderId: string;
  orderNumber: string;
  /** The refund row, so one refund is announced once. */
  transactionId: string;
  amount: number;
  currency: string;
  settings?: ISettings;
}) {
  try {
    await connectDB();
    const settings = params.settings || (await getSettings());
    // Refunds a seller owes are one kind of thing, whichever screen raised
    // them, so they go wherever the seller hears about returns.
    const channels = normalizeNotificationSettings(settings.notifications)
      .vendor.returns;
    if (!hasAnyNotificationChannel(channels)) return null;

    const vendor = await Vendor.findById(params.vendorId)
      .select("userId address.phone address.country")
      .populate("userId", `${USER_CONTACT_FIELDS} status`)
      .lean<VendorContactDoc | null>();
    const vendorStatus = (vendor?.userId as { status?: string } | undefined)
      ?.status;
    const recipient = vendor ? vendorRecipient(vendor) : null;
    if (!recipient || vendorStatus === USER_ACCOUNT_STATUS.BANNED) return null;

    const amount = `${Math.max(0, Number(params.amount) || 0).toFixed(2)} ${String(
      params.currency || "",
    ).toUpperCase()}`.trim();

    return dispatchNotification({
      recipient,
      channels,
      settings,
      notification: {
        type: NotificationType.ORDER_STATUS,
        title: "You owe a refund on an order",
        message: `Order #${params.orderNumber}: you collected this order's money at the door, so the ${amount} refund is yours to send. Pay the shopper and let the store know it has gone — the commission on those goods comes off what you owe the store.`,
        link: `/vendor/orders/${params.orderId}`,
        data: {
          orderId: params.orderId,
          orderNumber: params.orderNumber,
          transactionId: params.transactionId,
          recipientRole: USER_ROLES.VENDOR,
          refundOwed: true,
        },
        dedupe: {
          type: NotificationType.ORDER_STATUS,
          "data.transactionId": params.transactionId,
          "data.refundOwed": true,
          "data.recipientRole": USER_ROLES.VENDOR,
        },
      },
    });
  } catch (error) {
    console.error("Failed to tell a vendor an order refund is theirs:", error);
    return null;
  }
}

/**
 * Tell whoever is handling a return what the shopper just did with it: the
 * seller holding the queue, and the store's admins.
 */
async function announceToReturnOwners(
  returnRequest: ReturnRequestLikeForNotification,
  settings: ISettings | undefined,
  content: {
    title: string;
    message: string;
    /** Marks the notification, and keeps one per return per event. */
    event: "cancelledByShopper" | "shippedByShopper" | "openedOnBehalf";
    /** Who hears: the seller holding the return, the store's admins, or both. */
    audience?: "all" | "vendor" | "admins";
  },
) {
  const audience = content.audience ?? "all";
  await connectDB();
  const resolvedSettings = settings || (await getSettings());
  const notificationSettings = normalizeNotificationSettings(
    resolvedSettings.notifications,
  );
  const returnNumber = returnRequest.returnNumber || "a return";
  const orderNumber = returnRequest.orderNumber || "";
  const returnRequestId = getIdString(returnRequest._id);

  const notice = (
    recipient: NotificationRecipient,
    recipientRole: typeof USER_ROLES.ADMIN | typeof USER_ROLES.VENDOR,
  ) =>
    dispatchNotification({
      recipient,
      channels:
        recipientRole === USER_ROLES.ADMIN
          ? notificationSettings.admin.returns
          : notificationSettings.vendor.returns,
      settings: resolvedSettings,
      notification: {
        type: NotificationType.RETURN_REQUEST,
        title: content.title,
        message: content.message,
        link: recipientRole === USER_ROLES.ADMIN ? "/admin/returns" : "/vendor/returns",
        data: {
          returnNumber,
          returnRequestId,
          orderNumber,
          recipientRole,
          [content.event]: true,
        },
        dedupe: {
          type: NotificationType.RETURN_REQUEST,
          "data.returnRequestId": returnRequestId,
          [`data.${content.event}`]: true,
          "data.recipientRole": recipientRole,
        },
      },
    });

  const jobs: Promise<unknown>[] = [];
  if (returnRequest.ownerType === "vendor" && audience !== "admins") {
    const ownerVendorId = getIdString(returnRequest.ownerVendorId);
    const vendor = ownerVendorId
      ? await Vendor.findById(ownerVendorId)
          .select("userId address.phone address.country")
          .populate("userId", `${USER_CONTACT_FIELDS} status`)
          .lean<VendorContactDoc | null>()
      : null;
    const vendorStatus = (vendor?.userId as { status?: string } | undefined)
      ?.status;
    const recipient = vendor ? vendorRecipient(vendor) : null;
    if (recipient && vendorStatus !== USER_ACCOUNT_STATUS.BANNED) {
      jobs.push(notice(recipient, USER_ROLES.VENDOR));
    }
  }
  if (
    audience !== "vendor" &&
    hasAnyNotificationChannel(notificationSettings.admin.returns)
  ) {
    const admins = await findAdminRecipients();
    jobs.push(...admins.map((admin) => notice(admin, USER_ROLES.ADMIN)));
  }
  await Promise.allSettled(jobs);
}

/**
 * A return opened on the shopper's behalf, told to whoever did not open it:
 * the seller whose goods are coming back when the store opened it, the store's
 * admins when a seller did.
 */
export async function notifyReturnOpenedOnBehalf(
  returnRequest: ReturnRequestLikeForNotification,
  settings: ISettings | undefined,
  openedBy: "staff" | "vendor",
) {
  try {
    if (openedBy === "staff" && returnRequest.ownerType !== "vendor") return;
    const returnNumber = returnRequest.returnNumber || "a return";
    const orderNumber = returnRequest.orderNumber || "";
    const onOrder = orderNumber ? ` on order #${orderNumber}` : "";
    await announceToReturnOwners(returnRequest, settings, {
      title: "Return opened for a shopper",
      message:
        openedBy === "staff"
          ? `The store opened return ${returnNumber} for your items${onOrder}. Record what comes back when it arrives.`
          : `A seller opened return ${returnNumber}${onOrder} for a shopper.`,
      event: "openedOnBehalf",
      audience: openedBy === "staff" ? "vendor" : "admins",
    });
  } catch (error) {
    console.error("Failed to announce a return opened for a shopper:", error);
  }
}

/**
 * Tell whoever was handling a return that the shopper called it off.
 *
 * The seller holding the queue, and the store's admins, were never told: a
 * return they had approved and were waiting on simply turned "cancelled".
 */
export async function notifyReturnCancelledByShopper(
  returnRequest: ReturnRequestLikeForNotification,
  settings?: ISettings,
) {
  try {
    const returnNumber = returnRequest.returnNumber || "a return";
    const orderNumber = returnRequest.orderNumber || "";
    await announceToReturnOwners(returnRequest, settings, {
      title: "Return cancelled by the shopper",
      message: `The shopper cancelled return ${returnNumber}${
        orderNumber ? ` on order #${orderNumber}` : ""
      }. Nothing is coming back, and its items are returnable again.`,
      event: "cancelledByShopper",
    });
  } catch (error) {
    console.error("Failed to announce a return the shopper cancelled:", error);
  }
}

/**
 * Tell whoever is waiting on a return's parcel that the shopper has posted it,
 * with the tracking number they gave.
 */
export async function notifyReturnShippedByShopper(
  returnRequest: ReturnRequestLikeForNotification,
  settings?: ISettings,
) {
  try {
    const returnNumber = returnRequest.returnNumber || "a return";
    const orderNumber = returnRequest.orderNumber || "";
    const tracking = [
      returnRequest.shipment?.carrier,
      returnRequest.shipment?.trackingNumber,
    ]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ");
    await announceToReturnOwners(returnRequest, settings, {
      title: "Return parcel sent by the shopper",
      message: `The shopper sent return ${returnNumber}${
        orderNumber ? ` on order #${orderNumber}` : ""
      } back${tracking ? ` (${tracking})` : ""}. Record what came back when it arrives.`,
      event: "shippedByShopper",
    });
  } catch (error) {
    console.error("Failed to announce a return the shopper posted:", error);
  }
}

export async function notifyReturnRequestSubmitted(
  returnRequest: ReturnRequestLikeForNotification,
  settings?: ISettings,
) {
  try {
    await connectDB();
    const resolvedSettings = settings || (await getSettings());

    const customerId = getIdString(returnRequest.customerId);
    const customer = customerId ? await loadUserContact(customerId) : null;
    const customerNotificationJob = customerId
      ? notifyReturnRequestCustomer(
          returnRequest,
          RETURN_STATUS.REQUESTED,
          resolvedSettings,
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
            .select("userId address.phone address.country")
            .populate("userId", `${USER_CONTACT_FIELDS} status`)
            .lean<VendorContactDoc | null>()
        : null;
      const vendorStatus = (vendor?.userId as { status?: string } | undefined)
        ?.status;
      const recipient = vendor ? vendorRecipient(vendor) : null;

      if (recipient && vendorStatus !== USER_ACCOUNT_STATUS.BANNED) {
        ownerJobs.push(
          notifyReturnRequestOwnerUser(
            recipient,
            returnRequest,
            USER_ROLES.VENDOR,
            resolvedSettings,
            customer || undefined,
          ),
        );
      }
    }

    const admins = await findAdminRecipients();
    const returnNumber = returnRequest.returnNumber || "new return";
    const orderNumber = returnRequest.orderNumber || "unknown";
    const returnRequestId = getIdString(returnRequest._id);

    await Promise.allSettled([
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
        permissions: STAFF_NOTIFICATION_PERMISSIONS.returns,
        // A store-owned return is the store's, whoever else sold on the order.
        vendorIds:
          returnRequest.ownerType === "vendor" &&
          getIdString(returnRequest.ownerVendorId)
            ? [getIdString(returnRequest.ownerVendorId)]
            : [],
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
          customerId,
        },
        dedupe: {
          type: NotificationType.RETURN_REQUEST,
          "data.returnRequestId": returnRequestId,
        },
        settings: resolvedSettings,
      }),
    ]);
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
  options: {
    /**
     * How the parcel comes back changed after approval — a label added, the
     * address changed. The shopper hears again, with the same details the
     * approval carried, rather than finding out from a label they never saw.
     */
    shippingUpdated?: boolean;
    /** The store or a seller opened it for the shopper, approved at once. */
    openedForShopper?: boolean;
    /** The return has just become its exchange order (R7). */
    exchanged?: boolean;
  } = {},
) {
  const customerId = getIdString(returnRequest.customerId);
  // A guest's return is reached through what its order recorded, account or not.
  if (!customerId && !returnRequest.guestEmail) return null;

  const resolvedSettings = settings || (await getSettings());
  const channels = normalizeNotificationSettings(resolvedSettings.notifications)
    .customer.returnUpdates;
  if (!hasAnyNotificationChannel(channels)) return null;
  // A return on a walk-in POS sale is filed under the cashier, who rang the
  // sale up and is not its buyer: there is no shopper to tell.
  if (await isWalkInOrder(returnRequest.orderId)) return null;

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

  // What the shopper is owed, and whether it has actually reached them.
  //
  // A refund no gateway can carry — cash on delivery, a bank transfer — is
  // marked `manual_required` and stays there until someone sends the money and
  // records it. The return's STATUS says `refunded` the moment it is issued,
  // so telling the shopper from the status alone told them they had been paid
  // while the transfer had not even been started.
  const refundStatus = String(returnRequest.refundStatus || "");
  const awaitingHandPayment = refundStatus === RETURN_REFUND_STATUS.MANUAL_REQUIRED;
  // Asked of the payment provider, which sends it only once it approves —
  // Pesapal's refunds work this way. Not yet money in the shopper's hands.
  const awaitingProvider = refundStatus === RETURN_REFUND_STATUS.PROCESSING;
  const refundAmount = Number(returnRequest.actualRefund?.amount || 0);
  const refundCurrency = String(
    returnRequest.estimatedRefund?.currency || "",
  ).toUpperCase();
  const refundText =
    refundAmount > 0
      ? ` of ${refundAmount.toFixed(2)}${refundCurrency ? ` ${refundCurrency}` : ""}`
      : "";
  // The part the shopper holds as store credit (R8) rather than back where
  // they paid: already theirs to spend, so said as that.
  const creditRefunded = Number(returnRequest.actualRefund?.storeCredit || 0);
  const creditText =
    creditRefunded > 0
      ? creditRefunded >= refundAmount - 0.001
        ? " as store credit, ready to spend at checkout"
        : `, ${creditRefunded.toFixed(2)}${refundCurrency ? ` ${refundCurrency}` : ""} of it as store credit`
      : "";

  // Texted at the phone the order was delivered to, as order updates are. A
  // guest order's shopper has no account at all, so they are reached through
  // what the order recorded, whatever the channel — asked of the order, so a
  // guest who has since signed up is an account holder again.
  const isGuestReturn = Boolean(returnRequest.guestEmail);
  const loaded =
    (channels.sms || isGuestReturn) && orderId
      ? await loadOrderCustomer(orderId)
      : null;
  const guestContact =
    loaded?.customer && !loaded.customer.userId ? loaded.customer : null;
  // A guest's label can only be the link the store gave: the public tracking
  // page they have instead of an order page shows no label.
  const guestLabelLink = guestContact ? returnRequest.shipment?.labelUrl || "" : "";

  // What the shopper now needs to do, which "approved" alone never said: where
  // the parcel goes, that a label is waiting, or that nothing needs sending.
  const returnMethod = returnMethodOf(returnRequest.returnMethod);
  const destination = describeReturnDestination(returnRequest.returnTo);
  const approvedLead = `Return request #${returnNumber} for order #${orderNumber} has been approved.`;
  const approvedMessage =
    returnMethod === "no_shipping"
      ? `${approvedLead} You don't need to send anything back.`
      : returnMethod === "label"
        ? guestContact
          ? guestLabelLink
            ? `${approvedLead} We've emailed you a link to the return label.`
            : `${approvedLead} Contact us for the return label.`
          : `${approvedLead} Your return label is on your order page.`
        : destination
          ? `${approvedLead} Send it to ${destination}.`
          : approvedLead;

  const statusCopy: Record<string, { title: string; message: string }> = {
    [RETURN_STATUS.REQUESTED]: {
      title: "Return Request Pending",
      message: `Return request #${returnNumber}${itemText} for order #${orderNumber} is pending review.`,
    },
    [RETURN_STATUS.APPROVED]: {
      title: "Return Request Approved",
      message: approvedMessage,
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
    [RETURN_STATUS.PARTIALLY_REFUNDED]: awaitingHandPayment
      ? {
          title: "Return Refund On Its Way",
          message: `A partial refund${refundText} has been approved for return request #${returnNumber}. It cannot go back the way you paid, so we are sending it to the account you gave us — we will let you know once it has gone.`,
        }
      : awaitingProvider
      ? {
          title: "Return Refund Requested",
          message: `A partial refund${refundText} for return request #${returnNumber} has been requested from your payment provider. It reaches you once they approve it — we will let you know when it has gone.`,
        }
      : {
          title: "Return Partially Refunded",
          message: `A partial refund${refundText} has been issued for return request #${returnNumber}${creditText}.`,
        },
    [RETURN_STATUS.REFUNDED]: awaitingHandPayment
      ? {
          title: "Return Refund On Its Way",
          message: `Return request #${returnNumber} has been accepted and a refund${refundText} approved. It cannot go back the way you paid, so we are sending it to the account you gave us — we will let you know once it has gone.`,
        }
      : awaitingProvider
      ? {
          title: "Return Refund Requested",
          message: `Return request #${returnNumber} has been accepted and a refund${refundText} requested from your payment provider. It reaches you once they approve it — we will let you know when it has gone.`,
        }
      : {
          title: "Return Refunded",
          message: `Return request #${returnNumber} has been accepted and refunded${refundText}${creditText}.`,
        },
    [RETURN_STATUS.REJECTED]: {
      title: "Return Request Rejected",
      // With the store's reason, which the shopper was never shown anywhere.
      message: `Return request #${returnNumber} for order #${orderNumber} was rejected.${
        returnRequest.rejectionReason ? ` Reason: ${returnRequest.rejectionReason}` : ""
      }`,
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

  const shippingUpdated = Boolean(options.shippingUpdated);
  const openedForShopper = Boolean(options.openedForShopper);
  const shippingUpdatedAt = shippingUpdated ? new Date().toISOString() : undefined;
  // What the exchange order still asks of them, and what of the return is
  // still to come back as a refund.
  const exchange =
    options.exchanged && returnRequest.exchange?.orderNumber && !returnRequest.exchange.undoneAt
      ? returnRequest.exchange
      : null;
  const money = (value: number) =>
    `${value.toFixed(2)}${refundCurrency ? ` ${refundCurrency}` : ""}`;
  const exchangeRest = Math.max(
    0,
    Number(returnRequest.estimatedRefund?.total || 0) - refundAmount,
  );
  const notification = exchange
    ? {
        title: "Return Exchanged",
        message: `Return request #${returnNumber} has been accepted and exchanged for order #${exchange.orderNumber}.${
          Number(exchange.owed || 0) > 0
            ? ` Your return covered ${money(Number(exchange.credit || 0))} of it — we've emailed you a link to pay the remaining ${money(Number(exchange.owed))}.`
            : " Your return paid for it in full."
        }${
          exchangeRest > 0.005
            ? ` The other ${money(exchangeRest)} of your return is refunded separately.`
            : ""
        }`,
      }
    : shippingUpdated
    ? {
        title: "Return Details Updated",
        message: approvedMessage.replace(
          approvedLead,
          `The store updated how to send back return request #${returnNumber}.`,
        ),
      }
    : openedForShopper
      ? {
          title: "Return Opened For You",
          message: approvedMessage.replace(
            approvedLead,
            `We opened return request #${returnNumber} for order #${orderNumber}.`,
          ),
        }
      : statusCopy[nextStatus] || {
          title: "Return Request Updated",
          message: `Return request #${returnNumber} status is now ${nextStatus}.`,
        };

  const optOuts = channels.sms
    ? await customerOptOuts(guestContact ? undefined : customerId)
    : { orderEmail: false, sms: false };
  // A guest has no account page; the public tracking page is theirs.
  const shopperLink = guestContact
    ? trackOrderLink(orderNumber)
    : orderId
      ? `/account/orders/${orderId}`
      : "/account/orders";

  return dispatchNotification({
    recipient:
      guestContact ??
      (loaded?.customer?.userId === customerId
        ? loaded.customer
        : { userId: customerId }),
    channels,
    settings: resolvedSettings,
    notification: {
      type: NotificationType.RETURN_REQUEST,
      ...notification,
      link: shopperLink,
      data: {
        returnNumber,
        returnRequestId,
        orderNumber,
        orderId,
        status: nextStatus,
        refundStatus: refundStatus || undefined,
        refundedAmount: refundAmount > 0 ? refundAmount : undefined,
        recipientRole: USER_ROLES.CUSTOMER,
        shippingUpdatedAt,
        ...(exchange ? { exchangeOrderNumber: exchange.orderNumber } : {}),
      },
      dedupe: {
        type: NotificationType.RETURN_REQUEST,
        "data.returnRequestId": returnRequestId,
        "data.status": nextStatus,
        // Two different things to say about the same status: the refund is
        // coming, and the refund has gone. Keyed on the status alone, the
        // second was dropped as a repeat of the first — which is how a shopper
        // waiting on a bank transfer was never told it had been sent.
        "data.refundStatus": refundStatus || undefined,
        // And a second partial refund is news of its own: keyed without the
        // amount, it read as a repeat of the first and was never sent.
        "data.refundedAmount": refundAmount > 0 ? refundAmount : undefined,
        "data.recipientRole": USER_ROLES.CUSTOMER,
        // Each change is news of its own.
        "data.shippingUpdatedAt": shippingUpdatedAt,
        "data.exchangeOrderNumber": exchange?.orderNumber,
      },
    },
    skip: { sms: optOuts.sms },
    email:
      nextStatus === RETURN_STATUS.APPROVED || shippingUpdated || openedForShopper
        ? async (contact, dedupeKey) => {
            if (!contact.email) return false;
            const orderUrl = absoluteLink(shopperLink);
            // The default wording points at the address above it, so it is
            // only used when there is an address to point at.
            const template =
              returnRequest.returnInstructions ||
              (destination
                ? guestContact
                  ? DEFAULT_GUEST_RETURN_INSTRUCTIONS
                  : DEFAULT_RETURN_INSTRUCTIONS
                : "");
            const sent = await sendReturnApprovedEmail(
              {
                to: contact.email,
                customerName: contact.name || "there",
                returnNumber,
                orderNumber,
                method: returnMethod,
                destination: returnRequest.returnTo,
                instructions: template
                  ? renderReturnInstructions(template, {
                      returnNumber,
                      address: destination,
                    })
                  : undefined,
                labelLink: guestContact
                  ? guestLabelLink || undefined
                  : returnRequest.shipment?.labelUrl || orderUrl,
                orderUrl,
                guest: Boolean(guestContact),
                variant: shippingUpdated
                  ? "updated"
                  : openedForShopper
                    ? "opened"
                    : "approved",
              },
              resolvedSettings,
              dedupeKey,
            );
            if (!sent) {
              console.error(`Failed to send return approved email to ${contact.email}`);
            }
            // Queued for retry either way; the generic notice must not follow it.
            return true;
          }
        : undefined,
  });
}

/**
 * Notify admins, staff, the customer, and vendor owners when an order is
 * created.
 */
export async function notifyOrderCreatedParticipants(
  order: OrderLikeForNotification,
  options: {
    /**
     * The checkout already mailed the customer the order confirmation (with
     * its invoice), so the generic "Order Pending" email is not sent too.
     */
    customerEmailSent?: boolean;
    requireOutbox?: boolean;
  } = {},
) {
  const orderNumber = order.orderNumber || "new order";
  const orderId = getIdString(order._id);
  const itemCount = Array.isArray(order.items)
    ? order.items.length
    : (order.subOrders || []).reduce(
        (sum, subOrder) =>
          sum + (Array.isArray(subOrder.items) ? subOrder.items.length : 0),
        0,
      );
  const settings = await getSettings();
  const notificationSettings = normalizeNotificationSettings(
    settings.notifications,
  );
  const jobs: Promise<unknown>[] = [];

  const admins = await findAdminRecipients();
  const adminUserIds = new Set(admins.map((admin) => admin.userId));
  const alertMessage = newOrderAlertMessage(
    {
      orderNumber,
      itemCount,
      total: order.total,
      channel: order.channel,
      currency: order.currency,
    },
    settings,
  );
  const alertData = {
    orderNumber,
    orderId,
    itemCount,
    total: order.total,
    channel: order.channel,
  };

  const adminChannels = notificationSettings.admin.newOrders;
  if (hasAnyNotificationChannel(adminChannels)) {
    for (const recipient of admins) {
      jobs.push(
        dispatchNotification({
          requireOutbox: options.requireOutbox,
          recipient,
          channels: adminChannels,
          settings,
          notification: {
            type: NotificationType.ORDER_PLACED,
            title: "New Order Received",
            message: alertMessage,
            link: orderId ? `/admin/orders/${orderId}` : "/admin/orders",
            data: { ...alertData, recipientRole: USER_ROLES.ADMIN },
            dedupe: {
              type: NotificationType.ORDER_PLACED,
              "data.orderNumber": orderNumber,
              "data.recipientRole": USER_ROLES.ADMIN,
            },
          },
        }),
      );
    }
  }

  const customerChannels = notificationSettings.customer.orderUpdates;
  if (hasAnyNotificationChannel(customerChannels)) {
    jobs.push(
      resolveOrderCustomer(order).then((customer) =>
        customer
          ? notifyOrderPlaced(
              customer,
              {
                orderNumber,
                orderId,
                status: order.status,
                channel: order.channel,
              },
              {
                settings,
                channels: customerChannels,
                customerEmailSent: options.customerEmailSent,
                requireOutbox: options.requireOutbox,
              },
            )
          : null,
      ),
    );
  }

  jobs.push(
    notifyStaffUsers({
      requireOutbox: options.requireOutbox,
      permissions: STAFF_NOTIFICATION_PERMISSIONS.newOrders,
      vendorIds: vendorIdsOfOrder(order),
      channels: notificationSettings.staff.newOrders,
      type: NotificationType.ORDER_PLACED,
      title: "New Order Received",
      message: alertMessage,
      link: orderId ? `/staff/orders/${orderId}` : "/staff/orders",
      data: alertData,
      dedupe: {
        type: NotificationType.ORDER_PLACED,
        "data.orderNumber": orderNumber,
      },
      settings,
    }),
  );

  const vendorChannels = notificationSettings.vendor.newOrders;
  const vendorIds = Array.from(
    new Set(
      (order.subOrders || [])
        .map((subOrder) => getIdString(subOrder.vendorId))
        .filter(Boolean),
    ),
  );
  if (vendorIds.length > 0 && hasAnyNotificationChannel(vendorChannels)) {
    await connectDB();
    const vendors = await Vendor.find({ _id: { $in: vendorIds } })
      .select("_id userId notificationPreferences address.phone address.country")
      .populate("userId", USER_CONTACT_FIELDS)
      .lean<Array<VendorContactDoc & { notificationPreferences?: { newOrders?: boolean } }>>();
    const itemCounts = new Map(
      (order.subOrders || []).map((subOrder) => [
        getIdString(subOrder.vendorId),
        Array.isArray(subOrder.items) ? subOrder.items.length : 0,
      ]),
    );

    for (const vendor of vendors) {
      if (vendor.notificationPreferences?.newOrders === false) continue;
      const recipient = vendorRecipient(vendor);
      // An admin selling from their own store already heard as the admin.
      if (!recipient?.userId || adminUserIds.has(recipient.userId)) continue;
      const vendorItemCount = itemCounts.get(getIdString(vendor._id)) || 1;

      jobs.push(
        dispatchNotification({
          requireOutbox: options.requireOutbox,
          recipient,
          channels: vendorChannels,
          settings,
          notification: {
            type: NotificationType.ORDER_PLACED,
            title: "New Order Received",
            message: `You have a new order #${orderNumber} with ${vendorItemCount} item(s).`,
            link: orderId ? `/vendor/orders/${orderId}` : "/vendor/orders",
            data: {
              orderNumber,
              itemCount: vendorItemCount,
              recipientRole: USER_ROLES.VENDOR,
            },
            dedupe: {
              type: NotificationType.ORDER_PLACED,
              "data.orderNumber": orderNumber,
              "data.recipientRole": USER_ROLES.VENDOR,
            },
          },
        }),
      );
    }
  }

  const deliveries = await Promise.allSettled(jobs);
  if (options.requireOutbox) {
    const failures = deliveries.filter((result) => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Order recipients were not durably notified");
  }
}

/**
 * The merchant answered a quote with a price.
 *
 * Only ever sent to the account the request belongs to — a signed-out request
 * has none until its sender logs in with the same address, at which point
 * claimGuestCustomerData attaches it and the next offer reaches them. The
 * price itself stays out of the notification body on purpose: an in-app
 * notification is read over a shoulder as often as not, and the shopper's own
 * quote page is one tap away.
 */
export async function notifyQuoteOffer(offer: {
  quoteId: string;
  userId: string;
  productName: string;
}) {
  try {
    await createNotification({
      userId: offer.userId,
      type: NotificationType.QUOTE_OFFER,
      title: "Your quote is ready",
      message: `A price for ${offer.productName} is waiting in your account.`,
      link: "/account/quotes",
      data: { quoteId: offer.quoteId },
    });
  } catch (error) {
    console.error("Failed to notify customer of quote offer:", error);
  }
}

/**
 * The merchant pulled back a price the shopper was holding — withdrawn, or the
 * quote closed as lost. Same audience and the same type as the offer itself:
 * it is the other half of the same conversation.
 */
export async function notifyQuoteWithdrawn(offer: {
  quoteId: string;
  userId: string;
  productName: string;
}) {
  try {
    await createNotification({
      userId: offer.userId,
      type: NotificationType.QUOTE_OFFER,
      title: "Your quoted price was withdrawn",
      message: `The price for ${offer.productName} is no longer available.`,
      link: "/account/quotes",
      data: { quoteId: offer.quoteId },
    });
  } catch (error) {
    console.error("Failed to notify customer of withdrawn quote:", error);
  }
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
    const admins = await findAdminRecipients();
    const title = "New quote request";
    const message = `${quote.customerName} asked for a price on ${quote.productName} (qty ${quote.quantity}).`;

    await Promise.allSettled(
      admins.map((admin) =>
        createNotification({
          userId: admin.userId as string,
          type: NotificationType.QUOTE_REQUEST,
          title,
          message,
          link: `/admin/quotes?quote=${quote.quoteId}`,
          data: { quoteId: quote.quoteId, recipientRole: USER_ROLES.ADMIN },
        }),
      ),
    );
  } catch (error) {
    console.error("Failed to notify admins of quote request:", error);
  }
}

/**
 * The owner of the store a quote's product belongs to, to tell about it — or
 * null when there is nobody to tell: a marketplace that is switched off, a
 * vendor that is gone, an owner who is banned, or an owner who is an admin
 * (the store's own products; the admins already heard).
 *
 * Decided by the owner's role, not the vendor's `isDefault` flag, as the
 * low-stock alert does: a store can carry the flag on a vendor whose owner is
 * an ordinary seller with a dashboard of their own, and that seller must hear
 * of requests for their products.
 */
async function quoteVendorRecipient(
  vendorId: unknown,
  settings: ISettings,
): Promise<NotificationRecipient | null> {
  if (!settings.multiVendorMode?.enabled) return null;
  const id = getIdString(vendorId);
  if (!id || !isValidObjectId(id)) return null;
  await connectDB();
  const vendor = await Vendor.findById(id)
    .select("userId address.phone address.country")
    .populate("userId", `${USER_CONTACT_FIELDS} status`)
    .lean<VendorContactDoc | null>();
  if (!vendor) return null;
  const owner = vendor.userId as
    | { status?: string; role?: string; roles?: string[] }
    | undefined;
  if (owner?.status === USER_ACCOUNT_STATUS.BANNED) return null;
  if (isAdmin(owner)) return null;
  return vendorRecipient(vendor);
}

/**
 * Tell a vendor a shopper has asked for a price on one of its products.
 *
 * Rides the vendor's "new orders" channels: a quote is the step before an
 * order, and a vendor who switched order alerts off asked for quiet, not for a
 * second switch. Names the shopper and the product and nothing else — the
 * shopper's email and phone stay on the Quotes page, where the store decides
 * whether a vendor may see them.
 *
 * Best-effort, like the admins' alert: the quote is already saved.
 */
export async function notifyVendorQuoteRequest(quote: {
  quoteId: string;
  vendorId: unknown;
  productName: string;
  customerName: string;
  quantity: number;
}) {
  try {
    const settings = await getSettings();
    const channels = normalizeNotificationSettings(settings.notifications)
      .vendor.newOrders;
    if (!hasAnyNotificationChannel(channels)) return null;
    const recipient = await quoteVendorRecipient(quote.vendorId, settings);
    if (!recipient) return null;

    return dispatchNotification({
      recipient,
      channels,
      settings,
      notification: {
        type: NotificationType.QUOTE_REQUEST,
        title: "New quote request",
        message: `${quote.customerName} asked for a price on ${quote.productName} (qty ${quote.quantity}).`,
        link: `/vendor/quotes?quote=${quote.quoteId}`,
        data: { quoteId: quote.quoteId, recipientRole: USER_ROLES.VENDOR },
        dedupe: {
          type: NotificationType.QUOTE_REQUEST,
          "data.quoteId": quote.quoteId,
          "data.recipientRole": USER_ROLES.VENDOR,
        },
      },
    });
  } catch (error) {
    console.error("Failed to notify vendor of quote request:", error);
    return null;
  }
}

const VENDOR_QUOTE_CHANGE_COPY = {
  replaced: {
    title: "The store changed your quoted price",
    message: (product: string) =>
      `The store sent its own price for ${product}, replacing yours. The store now sets this quote's price.`,
  },
  withdrawn: {
    title: "The store withdrew your quoted price",
    message: (product: string) =>
      `The store withdrew the price you sent for ${product}. The store now sets this quote's price.`,
  },
  closed: {
    title: "The store closed a quote you priced",
    message: (product: string) =>
      `The store closed the quote for ${product} and withdrew the price you sent.`,
  },
} as const;

/**
 * Tell a vendor the store overrode the price it sent on a quote: replaced it
 * with the store's own, pulled it back, or closed the quote under it. The
 * store's price is final, so from here the vendor only reads the quote — and
 * hears why, rather than finding the price changed under them.
 */
export async function notifyVendorQuotePriceChanged(change: {
  quoteId: string;
  vendorId: unknown;
  productName: string;
  kind: keyof typeof VENDOR_QUOTE_CHANGE_COPY;
}) {
  try {
    const settings = await getSettings();
    const channels = normalizeNotificationSettings(settings.notifications)
      .vendor.newOrders;
    if (!hasAnyNotificationChannel(channels)) return null;
    const recipient = await quoteVendorRecipient(change.vendorId, settings);
    if (!recipient) return null;

    const copy = VENDOR_QUOTE_CHANGE_COPY[change.kind];
    return dispatchNotification({
      recipient,
      channels,
      settings,
      notification: {
        type: NotificationType.QUOTE_OFFER,
        title: copy.title,
        message: copy.message(change.productName || "a product"),
        link: `/vendor/quotes?quote=${change.quoteId}`,
        data: {
          quoteId: change.quoteId,
          quoteChange: change.kind,
          recipientRole: USER_ROLES.VENDOR,
        },
      },
    });
  } catch (error) {
    console.error("Failed to tell a vendor the store changed its quote:", error);
    return null;
  }
}

/**
 * Tell a shopper on a pre-order waitlist that a spot has opened.
 *
 * Always emailed, whatever the store's order-update matrix says: the shopper
 * asked for exactly this message by joining the list, and it is worthless if
 * it arrives after the spot has gone. In-app and push only when they joined
 * signed in, since a guest has no inbox in the app.
 *
 * No dedupe key. The waitlist row's `notifiedAt` claim is what stops a second
 * invitation for the same wait (`lib/orders/preorder-waitlist.ts`), and a key
 * built from the shopper and product would silently drop the invitation for a
 * LATER wait on the same product — the one they rejoined to get.
 */
export async function notifyPreorderWaitlistSpot(params: {
  email: string;
  userId?: string;
  productName: string;
  productPath: string;
  settings?: ISettings;
}) {
  try {
    const settings = params.settings || (await getSettings());
    const signedIn = Boolean(params.userId);
    return await dispatchNotification({
      recipient: { userId: params.userId, email: params.email },
      channels: { inApp: signedIn, browserPush: signedIn, email: true, sms: false },
      settings,
      notification: {
        type: NotificationType.SYSTEM,
        title: "A pre-order spot just opened",
        // Honest about the race: an invitation is not a reservation, and a
        // shopper who assumes it is will find the spot gone and feel misled.
        message: `A spot opened on ${params.productName}. Pre-orders go to whoever checks out first, so reserve yours while it lasts.`,
        link: params.productPath,
        data: {
          kind: "preorder_waitlist",
          productName: params.productName,
          recipientRole: USER_ROLES.CUSTOMER,
        },
      },
    });
  } catch (error) {
    console.error("Failed to invite a shopper from a pre-order waitlist:", error);
    return null;
  }
}
