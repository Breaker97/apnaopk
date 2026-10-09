/**
 * The app's push token: registered after sign-in, removed at sign-out. Only
 * the device that signs out stops receiving notifications.
 *
 * - After sign-in, and whenever Expo hands the app a new token: POST /devices.
 *   The locale in the path is the device's: a notification's link opens in
 *   it. Register again after the shopper changes the app's language.
 * - Before signing out: DELETE /devices/{token}, while the session is still
 *   valid. The shopper's other phones and browsers keep their notifications.
 * - Signing the device out from somewhere else (another device's "sign out
 *   other devices", a password reset) stops its notifications on the server.
 *
 * A notification arrives with `data: { url, type, notificationId }`: `url` is
 * a web path with the locale in front, opened through the link table
 * (links.ts).
 */
import * as z from "zod";

export const DEVICE_PLATFORMS = ["ios", "android"] as const;
export const DevicePlatform = z.enum(DEVICE_PLATFORMS);
export type DevicePlatform = z.infer<typeof DevicePlatform>;

/** POST /devices */
export const RegisterDeviceRequest = z.object({
  /** Expo's push token, as `getExpoPushTokenAsync()` gives it: `ExponentPushToken[…]`. */
  token: z.string().min(1).max(200),
  platform: DevicePlatform,
});
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>;

/** The answer to POST /devices. */
export const Device = z.object({
  token: z.string(),
  platform: DevicePlatform,
  /** The locale its notifications' links open in. */
  locale: z.string(),
});
export type Device = z.infer<typeof Device>;

/** The answer to DELETE /devices/{token}: false when it was not registered (nothing to do). */
export const DeviceRemoval = z.object({
  removed: z.boolean(),
});
export type DeviceRemoval = z.infer<typeof DeviceRemoval>;
