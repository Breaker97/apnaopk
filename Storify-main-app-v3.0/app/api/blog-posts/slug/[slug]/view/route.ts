import { NextResponse } from "next/server";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { incrementBlogPostView } from "@/lib/blog/storefront-blog-posts";
import { withApi } from "@/lib/api/handler";

export const POST = withApi<{ slug: string }>(
  {},
  async ({ request, params }) => {
    await rateLimitByIP(request, "lenient");
    const { slug } = params;
    await incrementBlogPostView(slug);
    return NextResponse.json({ success: true });
  },
);
