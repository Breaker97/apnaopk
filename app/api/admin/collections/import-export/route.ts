import { NextRequest } from "next/server";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { AuthenticationError, AuthorizationError } from "@/lib/api/errors";
import { errorResponse, successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { sanitizeSearchString } from "@/lib/api/validate";
import { USER_ROLES } from "@/config/app.config";
import { Collection } from "@/models";
import {
  collectionsCsvResponse,
  importCollectionsCsv,
} from "@/lib/admin/catalog-import-export";
import { headers } from "next/headers";
import type { SortOrder } from "mongoose";
import { withApi } from "@/lib/api/handler";

function buildCollectionQuery(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawSearch = searchParams.get("search")?.trim();
  const search = rawSearch ? sanitizeSearchString(rawSearch) : rawSearch;
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  const channel = searchParams.get("channel");
  const query: Record<string, unknown> = {};

  if (search) {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { slug: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  if (status === "active" || status === "draft") {
    query.status = status;
  }

  if (type === "manual" || type === "automated") {
    query.collectionType = type;
  }

  if (channel === "onlineStore" || channel === "pointOfSale") {
    query[`publishing.${channel}`] = true;
  }

  return query;
}

function buildCollectionSort(request: NextRequest): Record<string, SortOrder> {
  const searchParams = request.nextUrl.searchParams;
  const sortBy = searchParams.get("sortBy");
  const sortOrder: SortOrder = searchParams.get("sortOrder") === "asc" ? 1 : -1;

  if (sortBy === "collection" || sortBy === "title") {
    return { title: sortOrder };
  }
  if (sortBy === "products") {
    return { productCount: sortOrder, title: 1 as SortOrder };
  }
  if (sortBy === "position") {
    return { position: sortOrder, title: 1 as SortOrder };
  }

  return { position: 1 as SortOrder, createdAt: sortOrder };
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
    await assertAdmin(request, "admin:collections:export");
    await connectDB();

    const collections = await Collection.find(buildCollectionQuery(request))
      .sort(buildCollectionSort(request))
      .limit(5000)
      .lean();

    return collectionsCsvResponse(collections, "collections");
  },
);

export const POST = withApi(
  {},
  async ({ request }) => {
    await assertAdmin(request, "admin:collections:import");
    await connectDB();

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return errorResponse("CSV file is required.", 400);
    }

    const result = await importCollectionsCsv(await file.text());
    return successResponse(result);
  },
);
