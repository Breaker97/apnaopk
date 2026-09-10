import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { connectDB } from "@/lib/db";
import { BlogComment, BlogPost } from "@/models";
import { auth } from "@/lib/auth/auth";
import { USER_ROLES } from "@/config/app.config";
import { createdResponse, paginatedResponse } from "@/lib/api/response";
import {
  handleApiError,
  ValidationError,
  NotFoundError,
} from "@/lib/api/errors";
import { CreateBlogCommentSchema } from "@/lib/validations";
import { parsePageLimit } from "@/lib/api/list-query";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const sp = request.nextUrl.searchParams;
    const postId = sp.get("postId") || "";
    const status = sp.get("status") || "all";
    const { page, limit, skip } = parsePageLimit(sp, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const query: Record<string, unknown> = {};
    const session = await auth.api.getSession({ headers: await headers() });
    const isAdmin = session?.user?.role === USER_ROLES.ADMIN;

    if (postId) query.postId = postId;
    if (!isAdmin) {
      query.status = "approved";
    } else if (status && status !== "all") {
      query.status = status;
    }

    const [items, total] = await Promise.all([
      BlogComment.find(query)
        .populate("userId", "name image")
        .populate("postId", "title slug")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BlogComment.countDocuments(query),
    ]);

    return paginatedResponse(items, page, limit, total);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    const parsed = CreateBlogCommentSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }
    const data = parsed.data;

    const post = await BlogPost.findById(data.postId);
    if (!post) throw new NotFoundError("Post");
    if (!post.allowComments) {
      throw new ValidationError("Comments are disabled for this post");
    }

    const session = await auth.api.getSession({ headers: await headers() });
    const reqHeaders = await headers();
    const ipAddress =
      reqHeaders.get("x-forwarded-for")?.split(",")[0].trim() ||
      reqHeaders.get("x-real-ip") ||
      undefined;
    const userAgent = reqHeaders.get("user-agent") || undefined;

    const comment = await BlogComment.create({
      ...data,
      userId: session?.user?.id,
      authorName: session?.user?.name || data.authorName,
      authorEmail: session?.user?.email || data.authorEmail,
      status: "pending",
      ipAddress,
      userAgent,
    });

    return createdResponse(comment);
  } catch (error) {
    return handleApiError(error);
  }
}
