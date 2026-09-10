import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import {
  getPlatformMessagingConfiguration,
  updatePlatformMessagingConfiguration,
} from "@/lib/notifications/platform-messaging";

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const MessagingSettingsSchema = z.object({
  liveChatEnabled: z.boolean(),
  availabilityMode: z.enum(["always", "business_hours"]),
  timezone: z.string().trim().min(1).max(100),
  businessHours: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        enabled: z.boolean(),
        start: TimeSchema,
        end: TimeSchema,
      }),
    )
    .length(7)
    .refine(
      (entries) => new Set(entries.map((entry) => entry.day)).size === 7,
      "Business hours must contain every weekday exactly once",
    ),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  offlineMessage: z.string().trim().min(1).max(500),
  escalationEnabled: z.boolean(),
  escalationAfterMinutes: z.number().int().min(5).max(1440),
  escalationEmail: z.union([
    z.literal(""),
    z.string().trim().email().max(320),
  ]),
});

export const GET = withApi(
  {
    auth: "admin",
    rateLimit: {
      action: "admin:messaging-settings:read",
      preset: "lenient",
    },
  },
  async () =>
    successResponse(await getPlatformMessagingConfiguration()),
);

export const PUT = withApi(
  {
    auth: "admin",
    rateLimit: {
      action: "admin:messaging-settings:update",
      preset: "moderate",
    },
  },
  async ({ request, session }) => {
    const body = await validateBody(request, MessagingSettingsSchema);
    return successResponse(
      await updatePlatformMessagingConfiguration({
        ...body,
        userId: session.user.id,
      }),
      "Live-chat settings updated",
    );
  },
);
