import { Device, RegisterDeviceRequest } from "@/contracts/mobile/biz/v1/devices";
import { BIZ_ACCESS } from "@/lib/api-core/biz/access";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import { registerNativeDevice } from "@/lib/notifications/push-devices";
import { isExpoPushToken } from "@/lib/notifications/push-native";

/**
 * POST /devices: this install of the business app, for push. Registered as
 * the business app's (`app: "biz"`), so it hears the store's notifications
 * and none of the operator's own as a shopper. A token is one device:
 * registering it here takes it from whoever had it.
 */
export const bizDeviceRegisterRoute = defineBizRoute({
  id: "devices.register",
  method: "POST",
  path: "/devices",
  auth: "user",
  ...BIZ_ACCESS.account,
  cache: { kind: "private" },
  rateLimit: { bucket: "biz:devices:register", preset: "moderate" },
  demo: "default",
  input: RegisterDeviceRequest,
  output: Device,
  handler: async ({ input, session, locale, client }) => {
    const token = input.token.trim();
    if (!isExpoPushToken(token)) {
      throw new MobileApiError(400, "VALIDATION_ERROR", "This is not an Expo push token.", {
        errors: { token: ["Send the token getExpoPushTokenAsync() gave: ExponentPushToken[…]."] },
      });
    }
    await registerNativeDevice({
      userId: session.user.id,
      role: session.user.role,
      deviceToken: token,
      platform: input.platform,
      locale,
      userAgent: ["Storify business app", client.platform, client.appVersion].filter(Boolean).join(" "),
      app: "biz",
      sessionId: session.sessionId,
    });
    return { token, platform: input.platform, locale };
  },
});
