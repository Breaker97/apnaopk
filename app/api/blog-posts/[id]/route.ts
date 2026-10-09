import { PUBLIC_BLOG_FILTER } from "@/lib/blog/storefront-blog-posts";
import { isAdmin } from "@/lib/access/rbac";
import mongoose from "mongoose";
import { BlogPost } from "@/models";
import { revalidateBlogContent } from "@/lib/cache-invalidation";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { UpdateBlogPostSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";
import { createAuditContext } from "@/lib/audit";
import {
  BLOG_POST_CONTENT,
  auditContentDeleted,
  auditContentUpdated,
} from "@/lib/site-config/audit-content";
import { pickSubmittedKeys } from "@/lib/api/validate";
import { slugify } from "@/lib/strings";

function calcReadingTime(html: string) {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export const GET = withApi<{ id: string }>(
  { auth: "optional" },
  async ({ params, session }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid post id");
    }
    // A draft, a private or a scheduled post is the editor's until it goes
    // out; anyone else reads what the blog itself shows.
    const post = await BlogPost.findOne({
      _id: id,
      ...(session && isAdmin(session.user)
        ? {}
        : {
            ...PUBLIC_BLOG_FILTER,
            $or: [{ publishedAt: { $lte: new Date() } }, { publishedAt: null }],
          }),
    })
      .populate("author", "name image")
      .populate("categories", "name slug")
      .lean();
    if (!post) throw new NotFoundError("Post");
    return successResponse(post);
  },
);

export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid post id");
    }
    // Everything the audit row compares the save against, besides what the
    // write itself needs.
    const before = await BlogPost.findById(id)
      .select(
        "slug publishedAt title excerpt content status visibility isFeatured allowComments scheduledFor tags categoryIds featuredImage seo",
      )
      .lean();
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

    const post = await BlogPost.findByIdAndUpdate(
      id,
      // A password left by the old "password" option goes with the next save.
      { ...updates, $unset: { password: "" } },
      { returnDocument: "after" },
    ).lean();
    if (!post) throw new NotFoundError("Post");
    await auditContentUpdated(
      createAuditContext(request, session),
      BLOG_POST_CONTENT,
      { id: String(post._id), name: post.title },
      before,
      // Publishing stamps the date itself; only a date the editor sent is an edit.
      data.publishedAt === undefined
        ? { ...post, publishedAt: before.publishedAt }
        : post,
    );
    revalidateBlogContent({ slugs: [before.slug, post.slug] });
    return successResponse(post);
  },
);

export const DELETE = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid post id");
    }
    const post = await BlogPost.findByIdAndDelete(id)
      .select("slug title status")
      .lean();
    // Deleting a post that is already gone answers success and changed nothing.
    if (post) {
      await auditContentDeleted(
        createAuditContext(request, session),
        BLOG_POST_CONTENT,
        { id: String(post._id), name: post.title },
        { title: post.title, slug: post.slug, status: post.status },
      );
    }
    revalidateBlogContent({ slugs: [post?.slug] });
    return successResponse({ deleted: true });
  },
);
