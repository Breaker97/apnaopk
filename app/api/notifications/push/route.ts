import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import {
  AuthenticationError,
  ValidationError,
  handleApiError,
} from "@/lib/api/errors";
import { PushSubscription } from "@/models";
import { getWebPushStatus } from "@/lib/notifications/push-notifications";
import { isExpoPushToken } from "@/lib/notifications/push-native";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

// Shape only: the web/native branches below validate their own fields and
// answer with their own messages.
const PushRegistrationSchema = z.object({
  subscription: z
    .object({
      endpoint: z.unknown().optional(),
      expirationTime: z.unknown().optional(),
      keys: z
        .object({ p256dh: z.unknown().optional(), auth: z.unknown().optional() })
        .optional(),
    })
    .optional(),
  deviceToken: z.unknown().optional(),
  platform: z.unknown().optional(),
  locale: z.unknown().optional(),
});
const PushUnregisterSchema = z.object({
  endpoint: z.unknown().optional(),
  deviceToken: z.unknown().optional(),
});

type PushRegistrationBody = {
  /** Web: the browser's PushSubscription, as returned by the Push API. */
  subscription?: {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: {
      p256dh?: unknown;
      auth?: unknown;
    };
  };
  /** Native: the token the device's push service issued. */
  deviceToken?: unknown;
  platform?: unknown;
  locale?: unknown;
};

function parseNativeRegistration(body: PushRegistrationBody) {
  if (typeof body.deviceToken !== "string" || !body.deviceToken.trim()) {
    return null;
  }

  const platform = body.platform;
  if (platform !== "ios" && platform !== "android") {
    throw new ValidationError('Native push requires platform "ios" or "android"');
  }

  const deviceToken = body.deviceToken.trim();
  if (!isExpoPushToken(deviceToken)) {
    throw new ValidationError(
      "Invalid device token. Expected an Expo push token.",
    );
  }

  return { deviceToken, platform };
}

function parseSubscription(body: PushRegistrationBody) {
  const subscription = body.subscription;

  if (!subscription || typeof subscription !== "object") {
    throw new ValidationError("Push subscription is required");
  }

  const endpoint = subscription.endpoint;
  const p256dh = subscription.keys?.p256dh;
  const authSecret = subscription.keys?.auth;

  if (
    typeof endpoint !== "string" ||
    !endpoint ||
    typeof p256dh !== "string" ||
    !p256dh ||
    typeof authSecret !== "string" ||
    !authSecret
  ) {
    throw new ValidationError("Invalid push subscription");
  }

  return {
    endpoint,
    expirationTime:
      typeof subscription.expirationTime === "number"
        ? subscription.expirationTime
        : null,
    keys: {
      p256dh,
      auth: authSecret,
    },
  };
}

export const GET = withApi(
  { auth: "user" },
  async ({ session }) => {
    const [activeSubscriptions, inactiveSubscriptions] = await Promise.all([
      PushSubscription.countDocuments({
        userId: session.user.id,
        isActive: true,
      }),
      PushSubscription.countDocuments({
        userId: session.user.id,
        isActive: false,
      }),
    ]);

    return successResponse({
      ...getWebPushStatus(),
      activeSubscriptions,
      inactiveSubscriptions,
    });
  },
);

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const status = getWebPushStatus();
    const body: PushRegistrationBody = await validateBody(
      request,
      PushRegistrationSchema,
    );
    const userAgent = request.headers.get("user-agent") || undefined;
    const locale = typeof body.locale === "string" ? body.locale : undefined;
    const role =
      typeof session.user.role === "string" ? session.user.role : undefined;
    const native = parseNativeRegistration(body);

    await connectDB();

    if (native) {
      // Native delivery goes through the mobile push service, which needs no
      // VAPID keys — so a store with browser push switched off can still
      // register app installs.
      await PushSubscription.findOneAndUpdate(
        { deviceToken: native.deviceToken },
        {
          $set: {
            userId: session.user.id,
            role,
            platform: native.platform,
            deviceToken: native.deviceToken,
            locale,
            userAgent,
            isActive: true,
            lastSeenAt: new Date(),
            failedAt: undefined,
            failureReason: undefined,
          },
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
    } else {
      if (!status.configured) {
        throw new ValidationError(
          "Browser push is not configured. Add WEB_PUSH_PUBLIC_KEY and WEB_PUSH_PRIVATE_KEY.",
        );
      }

      const subscription = parseSubscription(body);
      await PushSubscription.findOneAndUpdate(
        { endpoint: subscription.endpoint },
        {
          $set: {
            userId: session.user.id,
            role,
            platform: "web",
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime,
            keys: subscription.keys,
            locale,
            userAgent,
            isActive: true,
            lastSeenAt: new Date(),
            failedAt: undefined,
            failureReason: undefined,
          },
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
      );
    }

    const activeSubscriptions = await PushSubscription.countDocuments({
      userId: session.user.id,
      isActive: true,
    });

    return successResponse({
      ...status,
      activeSubscriptions,
    });
  },
);

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();

    let endpoint: unknown;
    let deviceToken: unknown;
    try {
      const body = await validateBody(request, PushUnregisterSchema);
      endpoint = body.endpoint;
      deviceToken = body.deviceToken;
    } catch {
      endpoint = undefined;
      deviceToken = undefined;
    }

    await connectDB();

    // Sign-out on one device should not silence the user everywhere, so a
    // caller that names its own registration only retires that one.
    const query =
      typeof deviceToken === "string" && deviceToken
        ? { userId: session.user.id, deviceToken }
        : typeof endpoint === "string" && endpoint
          ? { userId: session.user.id, endpoint }
          : { userId: session.user.id };

    await PushSubscription.updateMany(query, {
      $set: {
        isActive: false,
        failedAt: new Date(),
        failureReason: "Disabled by user",
      },
    });

    const activeSubscriptions = await PushSubscription.countDocuments({
      userId: session.user.id,
      isActive: true,
    });

    return successResponse({
      ...getWebPushStatus(),
      activeSubscriptions,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
