import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { setOwnPosPin } from "@/lib/pos/operator";

const PinSchema = z.object({ pin: z.string().min(1).max(16) });

/**
 * POST /api/pos/operator/pin — set the signed-in person's own register PIN.
 * Always the session's account, never a switched-in colleague: a PIN is set
 * by its owner.
 */
export const POST = withApi(
  { auth: "user", rateLimit: { action: "pos:operator:pin", preset: "strict" } },
  async ({ request, session }) => {
    const body = await validateBody(request, PinSchema);
    await setOwnPosPin(session.user, body.pin);
    return successResponse({ hasPin: true });
  },
);
