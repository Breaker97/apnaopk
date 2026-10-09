import { Device, RegisterDeviceRequest } from "@/contracts/mobile/shop/v1/devices";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { registerNativeDevice } from "@/lib/notifications/push-devices";
import { isExpoPushToken } from "@/lib/notifications/push-native";

/**
 * POST /devices: this install of the shopper app, for push. A token is one
 * device: registering it for this shopper takes it from whoever had it.
 */
export const deviceRegisterRoute = defineRoute({
  id: "devices.register",
  method: "POST",
  path: "/devices",
  auth: "user",
  cache: { kind: "private" },
  rateLimit: { bucket: "devices:register", preset: "moderate" },
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
      userAgent: ["Storify shop app", client.platform, client.appVersion].filter(Boolean).join(" "),
      app: "shop",
      sessionId: session.sessionId,
    });
    return { token, platform: input.platform, locale };
  },
});
