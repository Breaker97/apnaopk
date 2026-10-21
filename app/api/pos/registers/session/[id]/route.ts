import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import {
  loadSession,
  registerSessionTotals,
  registerVendorScope,
} from "@/lib/pos/register-session";
import { registerSessionView } from "@/lib/pos/register-session-dto";

/**
 * GET /api/pos/registers/session/[id] — a drawer's report: running totals
 * while open (X), the figures written down at closing once closed (Z).
 */
export const GET = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "pos:registers", preset: "lenient" } },
  async ({ params, session }) => {
    const vendorId = await registerVendorScope(session.user);
    const found = await loadSession(vendorId, params.id);
    return successResponse(
      await registerSessionView(found, found.status === "open" ? await registerSessionTotals(found) : null),
    );
  },
);
