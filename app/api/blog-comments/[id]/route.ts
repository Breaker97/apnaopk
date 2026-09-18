import mongoose from "mongoose";
import { BlogComment, BlogPost } from "@/models";
import { revalidateBlogContent } from "@/lib/cache-invalidation";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { UpdateBlogCommentSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";

export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid id");
    }
    const body = await request.json();
    const parsed = UpdateBlogCommentSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }
    const data = parsed.data;

    const before = await BlogComment.findById(id);
    if (!before) throw new NotFoundError("Comment");

    const after = await BlogComment.findByIdAndUpdate(id, data, { returnDocument: "after" });
    if (!after) throw new NotFoundError("Comment");

    if (data.status && data.status !== before.status) {
      const wasCounted = before.status === "approved";
      const isCounted = after.status === "approved";
      if (wasCounted !== isCounted) {
        const post = await BlogPost.findByIdAndUpdate(
          after.postId,
          {
            $inc: { commentCount: isCounted ? 1 : -1 },
          },
          { returnDocument: "after" },
        )
          .select("slug")
          .lean();
        revalidateBlogContent({ slugs: [post?.slug] });
      }
    }

    return successResponse(after);
  },
);

export const DELETE = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid id");
    }
    const comment = await BlogComment.findByIdAndDelete(id);
    if (comment && comment.status === "approved") {
      const post = await BlogPost.findByIdAndUpdate(
        comment.postId,
        {
          $inc: { commentCount: -1 },
        },
        { returnDocument: "after" },
      )
        .select("slug")
        .lean();
      revalidateBlogContent({ slugs: [post?.slug] });
    }
    return successResponse({ deleted: true });
  },
);
