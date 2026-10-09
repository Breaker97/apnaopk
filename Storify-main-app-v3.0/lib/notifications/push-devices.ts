import { connectDB } from "@/lib/db";
import { PushSubscription } from "@/models";

/**
 * Native app installs, as push registrations: one row per device token
 * (models/push-subscription.model.ts). Shared by the website's push route and
 * the mobile API's /devices, so both register and retire a device the same
 * way.
 */

export type NativePlatform = "ios" | "android";

/**
 * Register (or re-register) a device for a user. A token is one device: when
 * it was another user's (a shared phone, a sign-out without unregistering),
 * the row moves to this user rather than reaching both.
 */
export async function registerNativeDevice(device: {
  userId: string;
  role?: string;
  deviceToken: string;
  platform: NativePlatform;
  locale?: string;
  userAgent?: string;
  app: "shop" | "biz";
  /** The session registering it: revoking that session retires the device. */
  sessionId?: string;
}) {
  await connectDB();
  // Native delivery goes through the mobile push service, which needs no
  // VAPID keys — so a store with browser push switched off can still register
  // app installs.
  await PushSubscription.findOneAndUpdate(
    { deviceToken: device.deviceToken },
    {
      $set: {
        userId: device.userId,
        role: device.role,
        platform: device.platform,
        deviceToken: device.deviceToken,
        app: device.app,
        sessionId: device.sessionId,
        locale: device.locale,
        userAgent: device.userAgent,
        isActive: true,
        lastSeenAt: new Date(),
        failedAt: undefined,
        failureReason: undefined,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
}

/**
 * Stop notifying the device on the user's own say-so (signing out of the
 * app). Only that device: the user's other phones and browsers keep theirs.
 * Returns whether one of the user's active devices had this token.
 */
export async function unregisterNativeDevice(userId: string, deviceToken: string): Promise<boolean> {
  await connectDB();
  const result = await PushSubscription.updateMany(
    { userId, deviceToken, isActive: true },
    { $set: { isActive: false, failedAt: new Date(), failureReason: "Disabled by user" } },
  );
  return result.modifiedCount > 0;
}

/**
 * Retire the devices registered by sessions that were just revoked: a phone
 * signed out from somewhere else ("sign out other devices", a password reset)
 * stops receiving the account's notifications at once, not when someone
 * remembers to open the app.
 */
export async function deactivateDevicesOfSessions(sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await connectDB();
  await PushSubscription.updateMany(
    { sessionId: { $in: sessionIds }, isActive: true },
    { $set: { isActive: false, failedAt: new Date(), failureReason: "Signed out" } },
  );
}
