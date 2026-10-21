import { NextRequest } from "next/server";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { AuthenticationError } from "@/lib/api/errors";
import { errorResponse, successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { sanitizeSearchString } from "@/lib/api/validate";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { staffResourcePermissions } from "@/lib/access/staff-resource-actions";
import { Category } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { taxClassOptions } from "@/lib/tax/tax-settings";
import {
  categoriesCsvResponse,
  importCategoriesCsv,
} from "@/lib/admin/catalog-import-export";
import { headers } from "next/headers";
import type { SortOrder } from "mongoose";
import { withApi } from "@/lib/api/handler";
import { createAuditContext } from "@/lib/audit";
import { auditCatalogExport, auditCatalogImport } from "@/lib/catalog/catalog-audit";

function buildCategoryQuery(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawSearch = searchParams.get("search")?.trim();
  const search = rawSearch ? sanitizeSearchString(rawSearch) : rawSearch;
  const status = searchParams.get("status");
  const query: Record<string, unknown> = {};

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { slug: { $regex: search, $options: "i" } },
    ];
  }

  if (status === "active") {
    query.isActive = true;
  } else if (status === "inactive") {
    query.isActive = false;
  } else if (status === "featured") {
    query.featured = true;
  }

  return query;
}

function buildCategorySort(request: NextRequest): Record<string, SortOrder> {
  const searchParams = request.nextUrl.searchParams;
  const sortBy = searchParams.get("sortBy");
  const sortOrder: SortOrder = searchParams.get("sortOrder") === "desc" ? -1 : 1;

  if (sortBy === "products") {
    return { productCount: sortOrder, name: 1 as SortOrder };
  }
  if (sortBy === "createdAt" || sortBy === "updatedAt" || sortBy === "order") {
    return { [sortBy]: sortOrder, name: 1 as SortOrder };
  }
  return { name: sortOrder };
}

async function assertCatalogAccess(request: NextRequest, scope: string, importing = false) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AuthenticationError();
  await assertAdminOrStaffPermissions(session, importing
    ? [STAFF_PERMISSIONS.CREATE_CATEGORIES, STAFF_PERMISSIONS.MANAGE_CATEGORIES]
    : staffResourcePermissions("categories"));
  if (importing) await assertAdminOrStaffPermissions(session, [STAFF_PERMISSIONS.EDIT_CATEGORIES, STAFF_PERMISSIONS.MANAGE_CATEGORIES]);

  await rateLimitByUser(
    request,
    session.user.id,
    scope,
    "moderate",
    session.user.role,
  );
  return session;
}

export const GET = withApi(
  {},
  async ({ request }) => {
    const session = await assertCatalogAccess(request, "admin:categories:export");
    await connectDB();

    const categories = await Category.find(buildCategoryQuery(request))
      .sort(buildCategorySort(request))
      .limit(5000)
      .lean();

    const response = await categoriesCsvResponse(categories, "categories");
    // Recorded once the file is built: the row is the only trace that a copy of
    // the catalog was taken, and it says how much and what narrowed it.
    const searchParams = request.nextUrl.searchParams;
    await auditCatalogExport(createAuditContext(request, session), "category", {
      rowCount: categories.length,
      filters: {
        search: searchParams.get("search")?.trim() || undefined,
        status: searchParams.get("status") || undefined,
      },
    });
    return response;
  },
);

export const POST = withApi(
  {},
  async ({ request }) => {
    const session = await assertCatalogAccess(request, "admin:categories:import", true);
    await connectDB();

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return errorResponse("CSV file is required.", 400);
    }

    // A row naming a tax class the store does not have fails, rather than
    // silently charging the standard rate.
    const taxClasses = new Set(taxClassOptions((await getSettingsLean()).tax).map((entry) => entry.key));
    const result = await importCategoriesCsv(await file.text(), { taxClasses });
    await auditCatalogImport(
      createAuditContext(request, session),
      "category",
      file.name,
      result,
    );
    return successResponse(result);
  },
);
