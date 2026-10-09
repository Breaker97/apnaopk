import { NextRequest } from "next/server";
import * as z from "zod";
import { successResponse } from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
} from "@/lib/api/errors";
import { validateQuery } from "@/lib/api/validate";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import {
  assertAdminOrStaffPermissions,
  assertUnscopedStaff,
} from "@/lib/access/staff-authz";
import {
  loadRealtimeVisitors,
  loadTrafficOverview,
} from "@/lib/analytics/plausible";
import {
  DEFAULT_TRAFFIC_PERIOD,
  TRAFFIC_PERIODS,
  type TrafficQuery,
} from "@/lib/analytics/traffic-overview";

const DateParam = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), {
    message: "Invalid date",
  });

const QuerySchema = z
  .object({
    metric: z.enum(["overview", "realtime"]).default("overview"),
    period: z
      .union([z.enum(TRAFFIC_PERIODS), z.literal("custom")])
      .default(DEFAULT_TRAFFIC_PERIOD),
    from: DateParam.optional(),
    to: DateParam.optional(),
  })
  .transform(({ metric, period, from, to }, ctx) => {
    if (period !== "custom") {
      return { metric, traffic: { period } satisfies TrafficQuery };
    }
    if (!from || !to || from > to) {
      ctx.addIssue({
        code: "custom",
        message: "A custom range needs from on or before to",
        path: ["from"],
      });
      return z.NEVER;
    }
    return { metric, traffic: { from, to } satisfies TrafficQuery };
  });

/**
 * GET /api/admin/analytics/plausible
 * The traffic page's Plausible stats, proxied so the API key stays server-side.
 * Query params:
 *   - metric: overview (default) | realtime
 *   - period: day | 7d | 30d | month | 6mo | 12mo | all | custom (default: 30d)
 *   - from/to: YYYY-MM-DD, required when period is custom
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    const { staffScope } = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_ANALYTICS],
    );
    // Plausible reports the whole site's traffic; it cannot be narrowed to the
    // vendors or locations a scoped staff member is limited to.
    assertUnscopedStaff(
      staffScope,
      "Store-wide traffic is only available to platform staff",
    );

    const { metric, traffic } = validateQuery(request, QuerySchema);

    if (metric === "realtime") {
      return successResponse({ visitors: await loadRealtimeVisitors() });
    }

    return successResponse(await loadTrafficOverview(traffic));
  } catch (error) {
    return handleApiError(error);
  }
}
