import mongoose from "mongoose";
import { BlogComment, BlogPost } from "@/models";
import { revalidateBlogContent } from "@/lib/cache-invalidation";
import { successResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { UpdateBlogCommentSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";
import { audit, createAuditContext } from "@/lib/audit";

/**
 * The post a comment is on, for the audit rows: they are filed under the post
 * (there is no resource for a comment), and named as a reader of the log would
 * look for them. Neither the commenter's name nor their words go in a row: the
 * log outlives the comment, and a deleted comment should stay deleted.
 */
async function postOf(postId: unknown) {
  const post = await BlogPost.findById(postId).select("title").lean();
  const title = post?.title;
  return {
    resourceId: String(postId),
    resourceName: title,
    onPost: title ? `the blog post "${title}"` : "a blog post",
  };
}

export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params, session }) => {
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

    // The moderation form posts both fields back on every save, so each row is
    // written for what differs, not for what was sent.
    const moved = Boolean(data.status) && data.status !== before.status;
    const reworded = data.content !== undefined && data.content !== before.content;
    if (moved || reworded) {
      const { onPost, ...target } = await postOf(after.postId);
      const context = createAuditContext(request, session);
      if (moved) {
        await audit(context, {
          action: "STATUS_CHANGE",
          resource: "blogPost",
          ...target,
          changes: {
            before: { status: before.status },
            after: { status: after.status },
            fields: ["status"],
            summary: `Moved a comment on ${onPost} from ${before.status} to ${after.status}`,
          },
          metadata: { commentId: id },
        });
      }
      if (reworded) {
        await audit(context, {
          action: "UPDATE",
          resource: "blogPost",
          ...target,
          changes: {
            fields: ["content"],
            summary: `Edited the text of a comment on ${onPost}`,
          },
          metadata: { commentId: id },
        });
      }
    }

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
  async ({ request, params, session }) => {
    const { id } = params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ValidationError("Invalid id");
    }
    const comment = await BlogComment.findByIdAndDelete(id);
    // Deleting a comment that is already gone answers success and changed nothing.
    if (comment) {
      const { onPost, ...target } = await postOf(comment.postId);
      await audit(createAuditContext(request, session), {
        action: "DELETE",
        resource: "blogPost",
        ...target,
        changes: {
          before: { status: comment.status },
          summary: `Deleted a comment on ${onPost} (it was ${comment.status})`,
        },
        metadata: { commentId: id },
      });
    }
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
