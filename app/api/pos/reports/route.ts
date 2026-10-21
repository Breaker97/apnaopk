import { getSettingsLean } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { buildPOSReport, parseReportPeriod } from "@/lib/pos/pos-reports";

/**
 * GET /api/pos/reports?from=&to=&locationId= — till sales by cashier, by
 * counter and by tender, and the drawers opened in the period
 * (lib/pos/pos-reports.ts says who sees what).
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "pos:reports", preset: "lenient" } },
  async ({ request, session }) => {
    const { searchParams } = new URL(request.url);
    const settings = await getSettingsLean();
    return successResponse(
      await buildPOSReport({
        user: session.user,
        period: parseReportPeriod(searchParams.get("from"), searchParams.get("to")),
        locationId: searchParams.get("locationId") || undefined,
        currency: settings.general?.defaultCurrency || "USD",
      }),
    );
  },
);
