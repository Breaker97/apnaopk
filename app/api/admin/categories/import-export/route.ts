import { NextRequest } from "next/server";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { AuthenticationError, AuthorizationError } from "@/lib/api/errors";
import { errorResponse, successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { sanitizeSearchString } from "@/lib/api/validate";
import { USER_ROLES } from "@/config/app.config";
import { Category } from "@/models";
import {
  categoriesCsvResponse,
  importCategoriesCsv,
} from "@/lib/admin/catalog-import-export";
import { headers } from "next/headers";
import type { SortOrder } from "mongoose";
import { withApi } from "@/lib/api/handler";

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

async function assertAdmin(request: NextRequest, scope: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new AuthenticationError();
  if (session.user.role !== USER_ROLES.ADMIN) throw new AuthorizationError();

  await rateLimitByUser(
    request,
    session.user.id,
    scope,
    "moderate",
    session.user.role,
  );
}

export const GET = withApi(
  {},
  async ({ request }) => {
    await assertAdmin(request, "admin:categories:export");
    await connectDB();

    const categories = await Category.find(buildCategoryQuery(request))
      .sort(buildCategorySort(request))
      .limit(5000)
      .lean();

    return categoriesCsvResponse(categories, "categories");
  },
);

export const POST = withApi(
  {},
  async ({ request }) => {
    await assertAdmin(request, "admin:categories:import");
    await connectDB();

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return errorResponse("CSV file is required.", 400);
    }

    const result = await importCategoriesCsv(await file.text());
    return successResponse(result);
  },
);
