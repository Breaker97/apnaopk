import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { requireConversationViewer } from "@/lib/conversations/service";
import { resolveConversationViewer } from "@/lib/conversations/viewer";
import {
  listFailedDeliveries,
  retryFailedDelivery,
} from "@/lib/conversations/providers/delivery-monitor";

const RetrySchema = z.object({
  outboxId: z.string().trim().min(1),
});

export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  await rateLimitByUser(
    request,
    session.user.id,
    "chat:deliveries:list",
    "lenient",
    session.user.role,
  );
  const viewer = requireConversationViewer(
    await resolveConversationViewer({ session }),
  );
  const limit = Number.parseInt(
    request.nextUrl.searchParams.get("limit") || "50",
    10,
  );
  return successResponse({
    deliveries: await listFailedDeliveries({ viewer, limit }),
  });
});

export const POST = withApi({ auth: "user" }, async ({ request, session }) => {
  await rateLimitByUser(
    request,
    session.user.id,
    "chat:deliveries:retry",
    "strict",
    session.user.role,
  );
  const body = await validateBody(request, RetrySchema);
  const viewer = requireConversationViewer(
    await resolveConversationViewer({ session }),
  );
  return successResponse(
    await retryFailedDelivery({
      viewer,
      outboxId: body.outboxId,
    }),
    "Delivery retry processed",
  );
});
