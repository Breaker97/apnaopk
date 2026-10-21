import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { MAX_QUICK_KEYS, readQuickKeys, saveQuickKeys } from "@/lib/pos/quick-keys";
import { resolvePosOperator } from "@/lib/pos/operator";

/**
 * GET /api/pos/quick-keys?locationId= — the till's Favourites: this
 * merchant's quick keys as products this register may sell, and whether the
 * person working it may change them.
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "pos:quick-keys", preset: "lenient" } },
  async ({ request, session }) => {
    const operator = await resolvePosOperator(session.user, request.cookies);
    const locationId = new URL(request.url).searchParams.get("locationId") || undefined;
    return successResponse(await readQuickKeys(operator, locationId));
  },
);

const SaveSchema = z.object({
  productIds: z.array(z.string().max(64)).max(MAX_QUICK_KEYS),
});

/** PUT /api/pos/quick-keys — replace the merchant's quick keys, in order. */
export const PUT = withApi(
  { auth: "user", rateLimit: { action: "pos:quick-keys:write", preset: "moderate" } },
  async ({ request, session }) => {
    const operator = await resolvePosOperator(session.user, request.cookies);
    const body = await validateBody(request, SaveSchema);
    return successResponse({ productIds: await saveQuickKeys(operator, body.productIds) });
  },
);
