import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { connectDB } from "@/lib/db";
import { Menu } from "@/models";
import { auth } from "@/lib/auth/auth";
import { USER_ROLES } from "@/config/app.config";
import {
  successResponse,
  createdResponse,
  paginatedResponse,
} from "@/lib/api/response";
import { handleApiError, ValidationError } from "@/lib/api/errors";
import { sanitizeSearchString } from "@/lib/api/validate";
import { CreateMenuSchema } from "@/lib/validations";
import { ensureDefaultMenus } from "@/lib/site-config/menu-helpers";
import { formatMenuValidationErrors } from "@/lib/site-config/menu-validation-errors";
import { MAX_MEGA_MENU_DEPTH, trimMenuTreeDepth } from "@/lib/site-config/menu-depth";
import { revalidateMenuContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import { slugify } from "@/lib/strings";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const sp = request.nextUrl.searchParams;
    const search = sanitizeSearchString(sp.get("search") || "");
    const location = sp.get("location") || "";
    const handle = sp.get("handle") || "";
    const status = sp.get("status") || "all";
    const page = parseInt(sp.get("page") || "0");
    const limit = parseInt(sp.get("limit") || "0");
    const usePagination = page > 0 && limit > 0;

    const session = await auth.api.getSession({ headers: await headers() });
    const isAdmin = session?.user?.role === USER_ROLES.ADMIN;

    if (isAdmin) {
      await ensureDefaultMenus();
    }

    const query: Record<string, unknown> = {};
    if (!isAdmin) query.isActive = true;
    else if (status === "active") query.isActive = true;
    else if (status === "inactive") query.isActive = false;

    if (search) query.name = { $regex: search, $options: "i" };
    if (location) query.location = location;
    if (handle) query.handle = handle;

    if (usePagination) {
      const skip = (page - 1) * limit;
      const [items, total] = await Promise.all([
        Menu.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
        Menu.countDocuments(query),
      ]);
      return paginatedResponse(items, page, limit, total);
    }

    // Cap the non-paginated branch. A store has at most a handful of menus, so
    // 200 is never hit in practice but bounds the worst case.
    const items = await Menu.find(query)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    return successResponse(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withApi(
  { auth: "admin" },
  async ({ request }) => {
    const body = await request.json();
    const parsed = CreateMenuSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(formatMenuValidationErrors(parsed.error));
    }
    const data = parsed.data;
    if (data.location === "header-mega") {
      data.items = trimMenuTreeDepth(data.items, MAX_MEGA_MENU_DEPTH).items;
    }
    let handle = slugify(data.handle || data.name);
    const exists = await Menu.findOne({ handle });
    if (exists) handle = `${handle}-${Date.now()}`;
    const menu = await Menu.create({ ...data, handle });
    revalidateMenuContent();
    return createdResponse(menu);
  },
);
