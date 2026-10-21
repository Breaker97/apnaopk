import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { posReturnPreview } from "@/lib/pos/pos-returns";
import { POSReturnLineSchema } from "@/lib/pos/pos-return-schema";

const PreviewSchema = z.object({
  orderId: z.string().min(1).max(64),
  lines: z.array(POSReturnLineSchema).min(1).max(250),
  reason: z.string().min(1).max(100),
});

/** POST /api/pos/returns/preview — what the store refunds for these lines, by its policy. */
export const POST = withApi(
  { auth: "user", rateLimit: { action: "pos:returns:read", preset: "lenient" } },
  async ({ request, session }) => {
    const body = await validateBody(request, PreviewSchema);
    return successResponse(await posReturnPreview(session.user, body));
  },
);
