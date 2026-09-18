import { successResponse } from "@/lib/api/response";
import { markAbandonedCheckouts } from "@/lib/orders/abandoned-checkouts";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

const DetectCheckoutsSchema = z.object({
  minutes: z.number().optional(),
  locale: z.string().max(10).optional(),
});

export const POST = withApi(
  { auth: "admin" },
  async ({ request }) => {
    const body = await validateOptionalBody(request, DetectCheckoutsSchema);
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const matched = await markAbandonedCheckouts({
      minutes: typeof body.minutes === "number" ? body.minutes : 10,
      origin,
      locale: body.locale,
    });

    return successResponse(
      { matched, modified: matched },
      "Abandoned checkouts marked",
    );
  },
);
