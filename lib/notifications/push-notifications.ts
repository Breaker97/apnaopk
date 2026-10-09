import { isKnownPushEndpoint } from "@/lib/notifications/push-endpoint";
import * as webpush from "web-push";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { PushSubscription, PushTicket } from "@/models";
import { getSettings, type ISettings } from "@/models/settings.model";
import { resolveFaviconUrl } from "@/config/branding.config";
import { resolveExpoAccessToken } from "@/lib/settings/credentials";
import { isAppPushMuted } from "@/lib/customers/notification-preferences";
import { notificationAppFor } from "@/lib/notifications/notification-app";
import { withLocalePrefix } from "@/lib/notifications/notification-link";
import {
  EXPO_RECEIPT_BATCH_SIZE,
  fetchNativePushReceipts,
  sendNativePush,
  type NativePushMessage,
} from "@/lib/notifications/push-native";
import {
  getVapidPrivateKey,
  getVapidPublicKey,
} from "@/lib/notifications/web-push-keys";

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
  /** Native only; missing on an install registered before the field existed: the shopper app's. */
  app?: "shop" | "biz";
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

function toWebPushSubscription(subscription: StoredPushSubscription) {
  // `endpoint`/`keys` are optional on the model now that native registrations
  // share the collection, so a web row missing either is unusable.
  if (!subscription.endpoint) return null;
  if (!subscription.keys?.p256dh || !subscription.keys?.auth) return null;
  // Registered before endpoints were checked: one that is not a browser push
  // service is never posted to (see lib/notifications/push-endpoint.ts).
  if (!isKnownPushEndpoint(subscription.endpoint)) return null;

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
async function getStoreNotificationIcon(settings: Promise<ISettings | null>) {
  return resolveFaviconUrl((await settings)?.general?.faviconUrl);
}

/**
 * The settings a send needs (the web icon, the Expo token), read once and only
 * when a device needs them. A failed read sends without them rather than not
 * at all.
 */
function lazySettings(): () => Promise<ISettings | null> {
  let read: Promise<ISettings | null> | undefined;
  return () => (read ??= getSettings().catch(() => null));
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
 *
 * A native install belongs to one app, and a notification to one audience
 * (notification-app.ts): the shopper app hears what a customer hears, never
 * the store's own news, which waits for the business app. The website serves
 * both, so every browser subscription gets everything.
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
    .select("_id platform app endpoint deviceToken expirationTime keys locale")
    .lean()) as StoredPushSubscription[];

  const app = notificationAppFor(payload.url);
  let nativeSubscriptions = subscriptions.filter(
    (item) =>
      (item.platform === "ios" || item.platform === "android") &&
      (item.app ?? "shop") === app,
  );
  // The shopper's own push topics (the app's Preferences): a topic switched
  // off reaches none of their shopper-app devices. The in-app row stays.
  if (app === "shop" && nativeSubscriptions.length > 0 && (await isAppPushMuted(userId, payload.type))) {
    nativeSubscriptions = [];
  }
  const webSubscriptions = subscriptions.filter(
    (item) => item.platform !== "ios" && item.platform !== "android",
  );

  const settings = lazySettings();
  const webPushReady = configureWebPush();
  let sent = 0;
  let failed = 0;

  const native = await sendToNativeDevices(nativeSubscriptions, payload, settings);
  sent += native.sent;
  failed += native.failed;

  if (!webPushReady) {
    return { sent, failed, skipped: webSubscriptions.length > 0 };
  }

  const notificationIcon =
    payload.icon ||
    (webSubscriptions.length > 0 ? await getStoreNotificationIcon(settings()) : undefined);

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
            timeout: 10_000,
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
  settings: () => Promise<ISettings | null>,
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

  const tickets = await sendNativePush(messages, {
    accessToken: resolveExpoAccessToken((await settings())?.mobileApp?.shop),
  });
  let sent = 0;
  let failed = 0;

  // Accepted is not delivered: Apple or Google answer later, in the receipt
  // (processPushReceipts). Kept apart from the send's own outcome — a
  // bookkeeping write must not turn a delivered push into a failed one.
  const accepted = tickets.flatMap((ticket) =>
    ticket.ok && ticket.id ? [{ ticketId: ticket.id, deviceToken: ticket.token }] : [],
  );
  if (accepted.length > 0) {
    await PushTicket.insertMany(accepted, { ordered: false }).catch((error) => {
      console.error("Failed to keep push tickets for their receipts:", error);
    });
  }

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

/** Expo has a receipt ready for most messages within 15 minutes. */
const RECEIPT_DELAY_MS = 15 * 60 * 1000;

/**
 * Read the receipts of native pushes sent at least 15 minutes ago, and retire
 * the installs Apple or Google say are gone (DeviceNotRegistered). Without
 * this an uninstalled app was sent to for ever: the ticket of a send almost
 * always says "ok", and only the receipt tells.
 *
 * Runs with the notification outboxes (/api/cron/email-deliveries). A ticket
 * whose receipt is not ready yet waits for the next run; Expo keeps receipts
 * for a day, and so does the ticket's TTL. Costs one indexed read when there
 * is nothing to do.
 */
export async function processPushReceipts(limit = EXPO_RECEIPT_BATCH_SIZE) {
  await connectDB();
  const due = await PushTicket.find({
    createdAt: { $lte: new Date(Date.now() - RECEIPT_DELAY_MS) },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select("_id ticketId deviceToken")
    .lean<Array<{ _id: Types.ObjectId; ticketId: string; deviceToken: string }>>();
  if (due.length === 0) return { checked: 0, unregistered: 0, failed: 0 };

  const settings = await getSettings().catch(() => null);
  const receipts = await fetchNativePushReceipts(
    due.map((ticket) => ticket.ticketId),
    { accessToken: resolveExpoAccessToken(settings?.mobileApp?.shop) },
  );
  // Expo could not be asked: every ticket waits for the next run.
  if (!receipts) return { checked: 0, unregistered: 0, failed: 0, unavailable: true };

  let unregistered = 0;
  let failed = 0;
  const answered: Types.ObjectId[] = [];
  for (const ticket of due) {
    const receipt = receipts.get(ticket.ticketId);
    if (!receipt) continue;
    answered.push(ticket._id);
    if (receipt.ok) continue;
    if (receipt.unregistered) {
      unregistered += 1;
      await PushSubscription.updateMany(
        { deviceToken: ticket.deviceToken, isActive: true },
        {
          $set: {
            isActive: false,
            failedAt: new Date(),
            failureReason: receipt.error || "Device not registered",
          },
        },
      );
      continue;
    }
    failed += 1;
    await PushSubscription.updateOne(
      { deviceToken: ticket.deviceToken },
      {
        $set: {
          failedAt: new Date(),
          failureReason: (receipt.error || "Push not delivered").slice(0, 500),
        },
      },
    );
  }
  if (answered.length > 0) await PushTicket.deleteMany({ _id: { $in: answered } });

  return { checked: answered.length, unregistered, failed };
}
