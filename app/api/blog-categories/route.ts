import { BlogCategory } from "@/models";
import { revalidateBlogContent } from "@/lib/cache-invalidation";
import {
  successResponse,
  createdResponse,
  paginatedResponse,
} from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { isAdmin } from "@/lib/access/rbac";
import { sanitizeSearchString } from "@/lib/api/validate";
import { CreateBlogCategorySchema } from "@/lib/validations";
import { slugify } from "@/lib/strings";

export const GET = withApi({ auth: "optional" }, async ({ request, session }) => {
  const sp = request.nextUrl.searchParams;
  const search = sanitizeSearchString(sp.get("search") || "");
  const status = sp.get("status") || "all";
  const page = parseInt(sp.get("page") || "0");
  const limit = parseInt(sp.get("limit") || "0");
  const usePagination = page > 0 && limit > 0;

  const query: Record<string, unknown> = {};
  if (!isAdmin(session?.user)) query.isActive = true;
  else if (status === "active") query.isActive = true;
  else if (status === "inactive") query.isActive = false;

  if (search) query.name = { $regex: search, $options: "i" };

  if (usePagination) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      BlogCategory.find(query)
        .sort({ order: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BlogCategory.countDocuments(query),
    ]);
    return paginatedResponse(items, page, limit, total);
  }

  const cats = await BlogCategory.find(query).sort({ order: 1, name: 1 }).lean();
  return successResponse(cats);
});

export const POST = withApi({ auth: "admin" }, async ({ request }) => {
  const body = await request.json();
  const parsed = CreateBlogCategorySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }
  const data = parsed.data;
  let slug = slugify(data.slug || data.name);
  const exists = await BlogCategory.findOne({ slug });
  if (exists) slug = `${slug}-${Date.now()}`;
  const cat = await BlogCategory.create({ ...data, slug });
  revalidateBlogContent();
  return createdResponse(cat);
});
