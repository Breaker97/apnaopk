import { Cart } from "@/models";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

const DetectCartsSchema = z.object({ hours: z.number().optional() });

export const POST = withApi({ auth: "admin" }, async ({ request }) => {
  const body = await validateOptionalBody(request, DetectCartsSchema);
  const hours = typeof body?.hours === "number" ? body.hours : 24;
  const threshold = new Date(Date.now() - hours * 60 * 60 * 1000);

  const result = await Cart.updateMany(
    {
      status: "active",
      lastActionAt: { $lt: threshold },
      "items.0": { $exists: true },
    },
    { $set: { status: "abandoned" } },
  );

  return successResponse(
    { matched: (result as unknown as { matchedCount?: number }).matchedCount ?? undefined },
    "Abandoned carts marked",
  );
});
