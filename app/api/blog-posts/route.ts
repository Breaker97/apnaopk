import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { connectDB } from "@/lib/db";
import { BlogPost } from "@/models";
import { auth } from "@/lib/auth/auth";
import { USER_ROLES } from "@/config/app.config";
import { revalidateBlogContent } from "@/lib/cache-invalidation";
import { createdResponse, paginatedResponse } from "@/lib/api/response";
import { handleApiError, ValidationError } from "@/lib/api/errors";
import { sanitizeSearchString } from "@/lib/api/validate";
import { parsePageLimit } from "@/lib/api/list-query";
import { CreateBlogPostSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";
import { slugify } from "@/lib/strings";

function calcReadingTime(html: string) {
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const sp = request.nextUrl.searchParams;

    const search = sanitizeSearchString(sp.get("search") || "");
    const status = sp.get("status") || "all";
    const categoryId = sp.get("categoryId") || "";
    const tag = sp.get("tag") || "";
    const featured = sp.get("featured");
    const author = sp.get("author") || "";
    const sortBy = sp.get("sortBy") || "publishedAt";
    const sortOrder = sp.get("sortOrder") || "desc";
    const { page, limit, skip } = parsePageLimit(sp, {
      defaultLimit: 10,
      maxLimit: 50,
    });

    const query: Record<string, unknown> = {};

    const session = await auth.api.getSession({ headers: await headers() });
    const isAdmin = session?.user?.role === USER_ROLES.ADMIN;

    if (!isAdmin) {
      query.status = "published";
      query.visibility = { $ne: "private" };
      query.$or = [
        { publishedAt: { $lte: new Date() } },
        { publishedAt: null },
      ];
    } else if (status && status !== "all") {
      query.status = status;
    }

    if (categoryId) query.categoryIds = categoryId;
    if (tag) query.tags = tag;
    if (author) query.authorId = author;
    if (featured === "true") query.isFeatured = true;
    if (search) query.title = { $regex: search, $options: "i" };

    const allowedSort = new Set([
      "publishedAt",
      "createdAt",
      "title",
      "viewCount",
      "likeCount",
    ]);
    const sort: Record<string, 1 | -1> = {};
    sort[allowedSort.has(sortBy) ? sortBy : "publishedAt"] =
      sortOrder === "asc" ? 1 : -1;

    const [posts, total] = await Promise.all([
      BlogPost.find(query)
        .populate("author", "name image email")
        .populate("categories", "name slug")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      BlogPost.countDocuments(query),
    ]);

    return paginatedResponse(posts, page, limit, total);
  } catch (error) {
    return handleApiError(error);
  }
}

export const POST = withApi(
  { auth: "admin" },
  async ({ request, session }) => {
    const body = await request.json();
    const parsed = CreateBlogPostSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }
    const data = parsed.data;

    let slug = slugify(data.slug || data.title);
    const exists = await BlogPost.findOne({ slug });
    if (exists) slug = `${slug}-${Date.now()}`;

    const publishedAt =
      data.status === "published"
        ? data.publishedAt
          ? new Date(data.publishedAt)
          : new Date()
        : data.publishedAt
          ? new Date(data.publishedAt)
          : undefined;

    const scheduledFor =
      data.status === "scheduled" && data.scheduledFor
        ? new Date(data.scheduledFor)
        : undefined;

    const post = await BlogPost.create({
      ...data,
      slug,
      authorId: session.user.id,
      authorName: session.user.name,
      readingTime: calcReadingTime(data.content),
      publishedAt,
      scheduledFor,
    });

    revalidateBlogContent({ slugs: [post.slug] });

    return createdResponse(post);
  },
);
