import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import {
  getPublishedBlogPostDetail,
  incrementBlogPostView,
} from "@/lib/blog/storefront-blog-posts";
import { withApi } from "@/lib/api/handler";

export const GET = withApi<{ slug: string }>(
  {},
  async ({ params }) => {
    const { slug } = params;
    const data = await getPublishedBlogPostDetail(slug);
    if (!data) throw new NotFoundError("Post");

    await incrementBlogPostView(slug);
    return successResponse(data);
  },
);
