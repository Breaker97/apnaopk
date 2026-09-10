import type { ISettings } from "@/models/settings.model";
import type {
  BillingSyncResult,
  BillingTransitionNotification,
} from "@/lib/vendors/vendor-billing-sync";
import { User, Vendor, VendorApplication, VendorSubscription } from "@/models";
import { sendVendorApprovedEmail } from "@/lib/email/vendor-emails";
import {
  createNotification,
  notifyVendorApplicationStatus,
} from "@/lib/notifications/notifications";
import { normalizeNotificationSettings } from "@/lib/notifications/notification-settings";
import { NotificationType } from "@/models/notification.model";

export interface BillingNotificationDependencies {
  claim(
    key: string,
    result: BillingSyncResult,
  ): Promise<boolean>;
  deliver(
    notification: BillingTransitionNotification,
    result: BillingSyncResult,
    settings: Partial<ISettings>,
  ): Promise<void>;
  release(
    key: string,
    result: BillingSyncResult,
    error: unknown,
  ): Promise<void>;
}

function notificationCopy(type: BillingTransitionNotification["type"]) {
  if (type === "renewal_payment_failed") {
    return {
      title: "Subscription payment failed",
      message:
        "Your renewal payment could not be collected. Renew or update your payment before the seven-day grace period ends.",
    };
  }
  if (type === "renewal_due") {
    return {
      title: "Subscription renewal due soon",
      message:
        "Your vendor plan period ends soon. Renew from your dashboard to keep selling without interruption.",
    };
  }
  if (type === "trial_ending") {
    return {
      title: "Your free trial ends soon",
      message:
        "Your vendor plan trial ends shortly. Pay for your first billing period from your dashboard to keep your store open.",
    };
  }
  if (type === "trial_ended") {
    return {
      title: "Your free trial has ended",
      message:
        "Your trial is over and your store is hidden from shoppers. Pay for your first billing period to reopen it — your plan, products and orders are all still here.",
    };
  }
  if (type === "subscription_expired") {
    return {
      title: "Vendor subscription ended",
      message:
        "Your paid vendor plan ended. Selling is disabled until a verified payment activates a plan.",
    };
  }
  if (type === "upgrade_applied") {
    return {
      title: "Vendor plan upgraded",
      message: "Your paid upgrade is active.",
    };
  }
  if (type === "downgrade_applied") {
    return {
      title: "Vendor plan changed",
      message: "Your scheduled vendor plan change is now active.",
    };
  }
  return {
    title: "Subscription payment confirmed",
    message: "Your vendor subscription payment is confirmed.",
  };
}

function createMongoBillingNotificationDependencies(): BillingNotificationDependencies {
  return {
    async claim(key, result) {
      if (!result.subscriptionId) return false;
      const claimed = await VendorSubscription.updateOne(
        {
          _id: result.subscriptionId,
          notificationKeys: { $ne: key },
        },
        { $addToSet: { notificationKeys: key } },
      );
      return (claimed.modifiedCount ?? 0) > 0;
    },

    async deliver(notification, result, settings) {
      // Initial payments carry an application; renewals and one-shot period
      // payments may not, so fall back to the vendor's owning user.
      let userId: string | null = null;
      if (result.applicationId) {
        const application = await VendorApplication.findById(
          result.applicationId,
        )
          .select("userId")
          .lean<{ userId?: unknown } | null>();
        if (application?.userId) userId = String(application.userId);
      }
      if (!userId && result.vendorId) {
        const vendor = await Vendor.findById(result.vendorId)
          .select("userId")
          .lean<{ userId?: unknown } | null>();
        if (vendor?.userId) userId = String(vendor.userId);
      }
      if (!userId) return;

      if (notification.type === "plan_activated") {
        const [vendor, user] = await Promise.all([
          result.vendorId
            ? Vendor.findById(result.vendorId)
                .select("storeName")
                .lean<{ storeName?: string } | null>()
            : null,
          User.findById(userId)
            .select("name email")
            .lean<{ name?: string; email?: string } | null>(),
        ]);
        const typedSettings = settings as ISettings;
        const channels = normalizeNotificationSettings(
          typedSettings.notifications,
        ).vendor.applicationStatus;
        await Promise.all([
          channels.email && user?.email
            ? sendVendorApprovedEmail({
                vendorEmail: user.email,
                vendorName: user.name,
                storeName: vendor?.storeName || "Vendor store",
                settings: typedSettings,
              })
            : Promise.resolve(false),
          notifyVendorApplicationStatus(userId, "approved", {
            settings: typedSettings,
            channels,
          }),
        ]);
        return;
      }

      const copy = notificationCopy(notification.type);
      await createNotification({
        userId,
        type: NotificationType.VENDOR_APPLICATION,
        title: copy.title,
        message: copy.message,
        link: "/vendor/dashboard",
        data: {
          billingNotificationKey: notification.key,
          billingType: notification.type,
        },
        dedupe: {
          "data.billingNotificationKey": notification.key,
        },
      });
    },

    async release(key, result, error) {
      if (!result.subscriptionId) return;
      await VendorSubscription.updateOne(
        { _id: result.subscriptionId },
        {
          $pull: { notificationKeys: key },
          $set: {
            lastReconcileError: `Notification delivery failed: ${
              error instanceof Error ? error.message : String(error)
            }`.slice(0, 2000),
          },
        },
      );
    },
  };
}

export async function dispatchVendorBillingNotifications(
  result: BillingSyncResult,
  settings: Partial<ISettings>,
  dependencies: BillingNotificationDependencies =
    createMongoBillingNotificationDependencies(),
): Promise<void> {
  for (const notification of result.notifications) {
    const claimed = await dependencies.claim(notification.key, result);
    if (!claimed) continue;
    try {
      await dependencies.deliver(notification, result, settings);
    } catch (error) {
      await dependencies.release(notification.key, result, error);
    }
  }
}
