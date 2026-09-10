import mongoose from "mongoose";
import { BlogCategory } from "@/models";
import { revalidateBlogContent } from "@/lib/cache-invalidation";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { UpdateBlogCategorySchema } from "@/lib/validations";
import { pickSubmittedKeys } from "@/lib/api/validate";
import { slugify } from "@/lib/strings";

type RouteParams = { id: string };

export const GET = withApi<RouteParams>({}, async ({ params }) => {
  const cat = await BlogCategory.findById(params.id).lean();
  if (!cat) throw new NotFoundError("Blog category");
  return successResponse(cat);
});

export const PUT = withApi<RouteParams>(
  { auth: "admin" },
  async ({ request, params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid id");
    }
    const body = await request.json();
    const parsed = UpdateBlogCategorySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }
    // Only write back what the caller sent — `.partial()` keeps the
    // base schema's `.default()` values, which would otherwise overwrite
    // untouched fields on a partial update.
    const data = pickSubmittedKeys(body, parsed.data);
    if (data.slug || data.name) {
      const candidate = slugify(data.slug || data.name || "");
      if (candidate) {
        const exists = await BlogCategory.findOne({
          slug: candidate,
          _id: { $ne: id },
        });
        data.slug = exists ? `${candidate}-${Date.now()}` : candidate;
      }
    }
    const cat = await BlogCategory.findByIdAndUpdate(id, data, {
      new: true,
    }).lean();
    if (!cat) throw new NotFoundError("Blog category");
    revalidateBlogContent();
    return successResponse(cat);
  },
);

export const DELETE = withApi<RouteParams>(
  { auth: "admin" },
  async ({ params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid id");
    }
    await BlogCategory.findByIdAndDelete(id);
    revalidateBlogContent();
    return successResponse({ deleted: true });
  },
);
