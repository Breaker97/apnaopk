import {
  User,
  Vendor,
  VendorApplication,
} from "@/models";
import {
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_PAYMENT_INVITATION,
  VENDOR_STATUS,
} from "@/config/app.config";
import type { ISettings } from "@/models/settings.model";
import {
  sendVendorPaymentExpiredEmail,
  sendVendorPaymentReminderEmail,
} from "@/lib/email/vendor-emails";
import { notifyVendorApplicationStatus } from "@/lib/notifications/notifications";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";

const DAY_MS = 24 * 60 * 60 * 1000;

type PaymentInvitationAction =
  | "none"
  | "reminder3"
  | "reminder6"
  | "expire";

export function decidePaymentInvitationAction(
  invitation: {
    paymentDueAt?: Date | string | null;
    paymentReminder3SentAt?: Date | string | null;
    paymentReminder6SentAt?: Date | string | null;
    setupAccessExpiredAt?: Date | string | null;
  },
  now: Date,
): PaymentInvitationAction {
  if (invitation.setupAccessExpiredAt) return "none";
  if (!invitation.paymentDueAt) return "none";
  const dueAt = new Date(invitation.paymentDueAt);
  if (dueAt <= now) return "expire";
  if (
    !invitation.paymentReminder6SentAt &&
    now >= reminderDueAt(dueAt, 6)
  ) {
    return "reminder6";
  }
  if (
    !invitation.paymentReminder3SentAt &&
    !invitation.paymentReminder6SentAt &&
    now >= reminderDueAt(dueAt, 3)
  ) {
    return "reminder3";
  }
  return "none";
}

interface PaymentInvitationReconcileSummary {
  scanned: number;
  reminder3: number;
  reminder6: number;
  expired: number;
}

function reminderDueAt(paymentDueAt: Date, reminderDay: number) {
  return new Date(
    paymentDueAt.getTime() -
      (VENDOR_PAYMENT_INVITATION.DEADLINE_DAYS - reminderDay) * DAY_MS,
  );
}

async function paymentEmailData(application: {
  userId: unknown;
  vendorId?: unknown;
  paymentDueAt?: Date | null;
  planSnapshot?: {
    name?: string;
    price?: number;
    currency?: string;
    billingInterval?: string;
  } | null;
}) {
  const [user, vendor] = await Promise.all([
    User.findById(application.userId)
      .select("name email")
      .lean<{ name?: string; email?: string } | null>(),
    Vendor.findById(String(application.vendorId || ""))
      .select("storeName")
      .lean<{ storeName?: string } | null>(),
  ]);
  if (
    !user?.email ||
    !vendor?.storeName ||
    !application.planSnapshot
  ) {
    return null;
  }
  return {
    vendorEmail: user.email,
    vendorName: user.name,
    storeName: vendor.storeName,
    planName: application.planSnapshot.name || "Vendor plan",
    price: Number(application.planSnapshot.price || 0),
    currency: application.planSnapshot.currency || "USD",
    billingInterval:
      application.planSnapshot.billingInterval || "period",
    paymentDueAt: application.paymentDueAt || new Date(),
  };
}

export async function reconcileVendorPaymentInvitations(
  settings: ISettings,
  limit = 100,
  now = new Date(),
): Promise<PaymentInvitationReconcileSummary> {
  const applications = await VendorApplication.find({
    status: VENDOR_APPLICATION_STATUS.APPROVED,
    paymentStatus: {
      $in: [
        VENDOR_APPLICATION_PAYMENT_STATUS.PENDING,
        VENDOR_APPLICATION_PAYMENT_STATUS.FAILED,
        VENDOR_APPLICATION_PAYMENT_STATUS.EXPIRED,
      ],
    },
    paymentDueAt: { $ne: null, $lte: new Date(now.getTime() + 4 * DAY_MS) },
    setupAccessExpiredAt: null,
  })
    .sort({ paymentDueAt: 1 })
    .limit(limit)
    .select(
      "userId vendorId paymentStatus paymentDueAt planSnapshot paymentReminder3SentAt paymentReminder6SentAt setupAccessExpiredAt",
    )
    .lean<Array<{
      _id: unknown;
      userId: unknown;
      vendorId?: unknown;
      paymentStatus?: string;
      paymentDueAt?: Date | null;
      paymentReminder3SentAt?: Date | null;
      paymentReminder6SentAt?: Date | null;
      setupAccessExpiredAt?: Date | null;
      planSnapshot?: {
        name?: string;
        price?: number;
        currency?: string;
        billingInterval?: string;
      } | null;
    }>>();

  const summary: PaymentInvitationReconcileSummary = {
    scanned: applications.length,
    reminder3: 0,
    reminder6: 0,
    expired: 0,
  };
  const channels = normalizeNotificationSettings(settings.notifications).vendor
    .applicationStatus;

  for (const application of applications) {
    if (!application.paymentDueAt) continue;
    const emailData = await paymentEmailData(application);

    const action = decidePaymentInvitationAction(application, now);
    if (action === "expire") {
      const claimResult = await VendorApplication.updateOne(
        {
          _id: String(application._id),
          status: VENDOR_APPLICATION_STATUS.APPROVED,
          paymentStatus: {
            $in: [
              VENDOR_APPLICATION_PAYMENT_STATUS.PENDING,
              VENDOR_APPLICATION_PAYMENT_STATUS.FAILED,
              VENDOR_APPLICATION_PAYMENT_STATUS.EXPIRED,
            ],
          },
          paymentDueAt: { $lte: now },
          setupAccessExpiredAt: null,
        },
        {
          $set: {
            paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.PENDING,
            setupAccessExpiredAt: now,
            lastError:
              "Vendor setup access ended; subscription payment remains available",
          },
        },
      );
      if (claimResult.modifiedCount !== 1) continue;

      await Vendor.updateOne(
        { _id: String(application.vendorId || "") },
        {
          $set: {
            status: VENDOR_STATUS.PAYMENT_REQUIRED,
            storeActive: false,
          },
        },
      );
      await Promise.allSettled([
        channels.email && emailData
          ? sendVendorPaymentExpiredEmail({ ...emailData, settings })
          : Promise.resolve(false),
        notifyVendorApplicationStatus(
          String(application.userId),
          "payment_expired",
          { settings, channels },
        ),
      ]);
      summary.expired += 1;
      continue;
    }

    const reminderDay =
      action === "reminder6" ? 6 : action === "reminder3" ? 3 : null;
    if (!reminderDay) continue;

    const field =
      reminderDay === 6
        ? "paymentReminder6SentAt"
        : "paymentReminder3SentAt";
    const claimResult = await VendorApplication.updateOne(
      {
        _id: String(application._id),
        [field]: null,
        paymentStatus: {
          $in: [
            VENDOR_APPLICATION_PAYMENT_STATUS.PENDING,
            VENDOR_APPLICATION_PAYMENT_STATUS.FAILED,
          ],
        },
      },
      { $set: { [field]: now } },
    );
    if (claimResult.modifiedCount !== 1) continue;

    if (channels.email && emailData) {
      const sent = await sendVendorPaymentReminderEmail({
        ...emailData,
        finalReminder: reminderDay === 6,
        settings,
      }).catch(() => false);
      if (!sent) {
        await VendorApplication.updateOne(
          { _id: String(application._id), [field]: now },
          { $set: { [field]: null } },
        );
        continue;
      }
    }
    if (reminderDay === 6) summary.reminder6 += 1;
    else summary.reminder3 += 1;
  }

  return summary;
}
