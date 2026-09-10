import mongoose from "mongoose";
import { BlogPost } from "@/models";
import { revalidateBlogContent } from "@/lib/cache-invalidation";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { UpdateBlogPostSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";
import { pickSubmittedKeys } from "@/lib/api/validate";
import { slugify } from "@/lib/strings";

function calcReadingTime(html: string) {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export const GET = withApi<{ id: string }>(
  {},
  async ({ params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid post id");
    }
    const post = await BlogPost.findById(id)
      .populate("author", "name image email")
      .populate("categories", "name slug")
      .lean();
    if (!post) throw new NotFoundError("Post");
    return successResponse(post);
  },
);

export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid post id");
    }
    const before = await BlogPost.findById(id).select("slug publishedAt").lean();
    if (!before) throw new NotFoundError("Post");

    const body = await request.json();
    const parsed = UpdateBlogPostSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }
    // Only write back what the caller sent — `.partial()` keeps the
    // base schema's `.default()` values, which would otherwise overwrite
    // untouched fields on a partial update.
    const data = pickSubmittedKeys(body, parsed.data);

    const updates: Record<string, unknown> = { ...data };

    if (data.slug || data.title) {
      const candidate = slugify(data.slug || data.title || "");
      if (candidate) {
        const exists = await BlogPost.findOne({
          slug: candidate,
          _id: { $ne: id },
        });
        updates.slug = exists ? `${candidate}-${Date.now()}` : candidate;
      }
    }
    if (data.content !== undefined) {
      updates.readingTime = calcReadingTime(data.content);
    }
    if (data.publishedAt !== undefined) {
      updates.publishedAt = data.publishedAt ? new Date(data.publishedAt) : null;
    }
    if (data.scheduledFor !== undefined) {
      updates.scheduledFor = data.scheduledFor ? new Date(data.scheduledFor) : null;
    }
    if (data.status === "published" && !data.publishedAt) {
      if (!before.publishedAt) {
        updates.publishedAt = new Date();
      }
    }

    const post = await BlogPost.findByIdAndUpdate(id, updates, {
      new: true,
    }).lean();
    if (!post) throw new NotFoundError("Post");
    revalidateBlogContent({ slugs: [before.slug, post.slug] });
    return successResponse(post);
  },
);

export const DELETE = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid post id");
    }
    const post = await BlogPost.findByIdAndDelete(id).select("slug").lean();
    revalidateBlogContent({ slugs: [post?.slug] });
    return successResponse({ deleted: true });
  },
);
