import { withApi } from "@/lib/api/handler";
import { createAuditContext } from "@/lib/audit";
import {
  auditAbandonedCheckoutsExported,
  buildAbandonedCheckoutExport,
} from "@/lib/orders/abandoned-checkout-export";

/**
 * GET /api/admin/abandoned-checkouts/export
 * The Abandoned checkouts page as a CSV file: every checkout matching the
 * `search`, `view`, `emailStatus`, `date` and sort the page was showing, not
 * one page of them.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:abandoned-checkouts:export", preset: "moderate" },
  },
  async ({ request, session }) => {
    const { response, rowCount, truncated, filters } =
      await buildAbandonedCheckoutExport(request);

    // Recorded once the file is built: the row is the only trace that a copy
    // of the shoppers' contact details left the store.
    await auditAbandonedCheckoutsExported(createAuditContext(request, session), {
      rowCount,
      truncated,
      filters,
    });
    return response;
  },
);
