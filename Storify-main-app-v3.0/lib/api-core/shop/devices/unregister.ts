import { DeviceRemoval } from "@/contracts/mobile/shop/v1/devices";
import { defineRoute } from "@/lib/api-core/registry";
import { unregisterNativeDevice } from "@/lib/notifications/push-devices";

/** The token as the app sent it, percent-encoded or not (`[` and `]` are). */
function tokenFromPath(raw: string): string {
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * DELETE /devices/{token}: the app signs out on this device. Only this
 * device stops receiving the shopper's notifications; there is deliberately
 * no form without a token, which on the website's push route silences every
 * device the shopper has.
 *
 * Open on a demo store: signing out must stop the device's notifications
 * there too (the website's push route allows it as well).
 */
export const deviceUnregisterRoute = defineRoute({
  id: "devices.unregister",
  method: "DELETE",
  path: "/devices/{token}",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "devices:unregister", preset: "moderate" },
  demo: "allow",
  output: DeviceRemoval,
  handler: async ({ params, session }) => ({
    removed: await unregisterNativeDevice(session.user.id, tokenFromPath(params.token).trim()),
  }),
});
