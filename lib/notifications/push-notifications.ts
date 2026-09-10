import * as webpush from "web-push";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { PushSubscription } from "@/models";
import { getSettings } from "@/models/settings.model";
import { resolveFaviconUrl } from "@/config/branding.config";
import { locales, defaultLocale, type Locale } from "@/config/i18n.config";
import { sendNativePush, type NativePushMessage } from "@/lib/notifications/push-native";

interface BrowserPushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  type?: string;
  notificationId?: string;
}

type StoredPushSubscription = {
  _id: Types.ObjectId | string;
  platform?: "web" | "ios" | "android";
  endpoint?: string;
  deviceToken?: string;
  expirationTime?: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  locale?: string;
};

let vapidInitialized = false;

function getVapidPublicKey() {
  return (
    process.env.WEB_PUSH_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ||
    ""
  ).trim();
}

function getVapidPrivateKey() {
  return (process.env.WEB_PUSH_PRIVATE_KEY || "").trim();
}

function normalizeVapidSubject(value: string | undefined) {
  const subject = (value || "").trim();
  if (subject.startsWith("mailto:") || subject.startsWith("https://")) {
    return subject;
  }
  if (subject.includes("@")) return `mailto:${subject}`;
  return "mailto:admin@example.com";
}

export function getWebPushStatus() {
  const publicKey = getVapidPublicKey();
  const privateKey = getVapidPrivateKey();

  return {
    configured: Boolean(publicKey && privateKey),
    publicKey: publicKey || null,
  };
}

function configureWebPush() {
  const publicKey = getVapidPublicKey();
  const privateKey = getVapidPrivateKey();
  if (!publicKey || !privateKey) return false;

  if (!vapidInitialized) {
    webpush.setVapidDetails(
      normalizeVapidSubject(
        process.env.WEB_PUSH_SUBJECT || process.env.NEXT_PUBLIC_APP_URL,
      ),
      publicKey,
      privateKey,
    );
    vapidInitialized = true;
  }

  return true;
}

function isLocale(value: string | undefined): value is Locale {
  return Boolean(value && locales.includes(value as Locale));
}

function withLocalePrefix(url: string | undefined, locale: string | undefined) {
  const fallbackLocale = isLocale(locale) ? locale : defaultLocale;
  const target = url && url.trim() ? url.trim() : `/${fallbackLocale}`;

  if (/^https?:\/\//i.test(target)) return target;
  if (!target.startsWith("/")) return `/${fallbackLocale}/${target}`;

  const firstSegment = target.split("/").filter(Boolean)[0];
  if (isLocale(firstSegment)) return target;

  return `/${fallbackLocale}${target === "/" ? "" : target}`;
}

function toWebPushSubscription(subscription: StoredPushSubscription) {
  // `endpoint`/`keys` are optional on the model now that native registrations
  // share the collection, so a web row missing either is unusable.
  if (!subscription.endpoint) return null;
  if (!subscription.keys?.p256dh || !subscription.keys?.auth) return null;

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  } satisfies webpush.PushSubscription;
}

/**
 * The notification icon is the store's configured favicon — the same image the
 * PWA installs with. No bundled icon backs this up: when a store has no
 * favicon the payload carries no `icon` and the browser draws its own default.
 */
async function getStoreNotificationIcon() {
  try {
    const settings = await getSettings();
    return resolveFaviconUrl(settings.general?.faviconUrl);
  } catch {
    return undefined;
  }
}

async function deactivateSubscription(
  subscriptionId: Types.ObjectId | string,
  failureReason: string,
) {
  await PushSubscription.updateOne(
    { _id: subscriptionId },
    {
      $set: {
        isActive: false,
        failedAt: new Date(),
        failureReason,
      },
    },
  );
}

/**
 * Deliver a notification to every device a user has registered.
 *
 * Web registrations go out over Web Push (VAPID), native ones over the mobile
 * push service. The two are independent: a store with no VAPID keys still
 * reaches its mobile users, and a web-only store is unaffected by any of the
 * native code below.
 */
export async function sendPushToUser(
  userId: string,
  payload: BrowserPushPayload,
) {
  await connectDB();

  const subscriptions = (await PushSubscription.find({
    userId,
    isActive: true,
  })
    .select("_id platform endpoint deviceToken expirationTime keys locale")
    .lean()) as StoredPushSubscription[];

  const nativeSubscriptions = subscriptions.filter(
    (item) => item.platform === "ios" || item.platform === "android",
  );
  const webSubscriptions = subscriptions.filter(
    (item) => item.platform !== "ios" && item.platform !== "android",
  );

  const webPushReady = configureWebPush();
  let sent = 0;
  let failed = 0;

  const native = await sendToNativeDevices(nativeSubscriptions, payload);
  sent += native.sent;
  failed += native.failed;

  if (!webPushReady) {
    return { sent, failed, skipped: webSubscriptions.length > 0 };
  }

  const notificationIcon = payload.icon || (await getStoreNotificationIcon());

  await Promise.all(
    webSubscriptions.map(async (subscription) => {
      const webPushSubscription = toWebPushSubscription(subscription);
      if (!webPushSubscription) {
        failed += 1;
        await deactivateSubscription(subscription._id, "Invalid push keys");
        return;
      }

      const localizedPayload: BrowserPushPayload = {
        ...payload,
        ...(notificationIcon ? { icon: notificationIcon } : { icon: undefined }),
        url: withLocalePrefix(payload.url, subscription.locale),
      };

      try {
        await webpush.sendNotification(
          webPushSubscription,
          JSON.stringify(localizedPayload),
          {
            TTL: 60 * 60 * 24,
            urgency: "normal",
          },
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode =
          error instanceof webpush.WebPushError ? error.statusCode : undefined;
        const message =
          error instanceof Error ? error.message : "Push delivery failed";

        if (statusCode === 404 || statusCode === 410) {
          await deactivateSubscription(subscription._id, message);
          return;
        }

        await PushSubscription.updateOne(
          { _id: subscription._id },
          {
            $set: {
              failedAt: new Date(),
              failureReason: message.slice(0, 500),
            },
          },
        );
      }
    }),
  );

  return { sent, failed, skipped: false };
}

async function sendToNativeDevices(
  subscriptions: StoredPushSubscription[],
  payload: BrowserPushPayload,
) {
  const messages: NativePushMessage[] = [];
  const byToken = new Map<string, StoredPushSubscription>();

  for (const subscription of subscriptions) {
    if (!subscription.deviceToken) continue;
    byToken.set(subscription.deviceToken, subscription);
    messages.push({
      token: subscription.deviceToken,
      title: payload.title,
      body: payload.body,
      data: {
        url: withLocalePrefix(payload.url, subscription.locale),
        type: payload.type,
        notificationId: payload.notificationId,
      },
    });
  }

  if (messages.length === 0) return { sent: 0, failed: 0 };

  const tickets = await sendNativePush(messages);
  let sent = 0;
  let failed = 0;

  await Promise.all(
    tickets.map(async (ticket) => {
      const subscription = byToken.get(ticket.token);
      if (ticket.ok) {
        sent += 1;
        return;
      }
      failed += 1;
      if (!subscription) return;

      // An uninstalled app never comes back on the same token, so retire it
      // instead of failing against it on every future notification.
      if (ticket.unregistered) {
        await deactivateSubscription(
          subscription._id,
          ticket.error || "Device not registered",
        );
        return;
      }

      await PushSubscription.updateOne(
        { _id: subscription._id },
        {
          $set: {
            failedAt: new Date(),
            failureReason: (ticket.error || "Push delivery failed").slice(0, 500),
          },
        },
      );
    }),
  );

  return { sent, failed };
}
