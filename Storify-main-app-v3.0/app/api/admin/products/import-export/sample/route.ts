import { connectDB } from "@/lib/db";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { productImportSampleResponse } from "@/lib/products/import-sample";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/admin/products/import-export/sample?format=csv|json
 * A sample import file filled with example products and this store's own
 * categories, for merchants to copy the format from.
 */
export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [
        STAFF_PERMISSIONS.CREATE_PRODUCTS,
        STAFF_PERMISSIONS.EDIT_PRODUCTS,
        STAFF_PERMISSIONS.MANAGE_PRODUCTS,
      ],
    );

    await rateLimitByUser(
      request,
      session.user.id,
      "admin:products:import-sample",
      "lenient",
      session.user.role,
    );

    await connectDB();
    return productImportSampleResponse(
      request.nextUrl.searchParams.get("format") === "json" ? "json" : "csv",
      "admin",
    );
  },
);
