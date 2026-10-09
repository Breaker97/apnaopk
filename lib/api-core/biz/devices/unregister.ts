import { DeviceRemoval } from "@/contracts/mobile/biz/v1/devices";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { defineBizRoute } from "@/lib/api-core/registry";
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
 * DELETE /devices/{token}: the app signs out on this device, which alone
 * stops receiving the store's notifications. Open on a demo store: signing
 * out must stop the device's notifications there too.
 */
export const bizDeviceUnregisterRoute = defineBizRoute({
  id: "devices.unregister",
  method: "DELETE",
  path: "/devices/{token}",
  auth: "user",
  ...BIZ_ACCESS.account,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:devices:unregister", preset: "moderate" },
  demo: "allow",
  output: DeviceRemoval,
  handler: async ({ params, session }) => ({
    removed: await unregisterNativeDevice(session.user.id, tokenFromPath(params.token).trim()),
  }),
});
