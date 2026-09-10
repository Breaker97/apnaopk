import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { sanitizeSearchString } from "@/lib/api/validate";
import { BlogCategory, BlogPost } from "@/models";

export interface BlogListItem {
  _id: string;
  title: string;
  slug: string;
  excerpt: string;
  featuredImage?: { url?: string; alt?: string };
  publishedAt: string;
  authorName: string;
  authorImage: string;
}

interface BlogCategoryItem {
  _id: string;
  name: string;
  slug: string;
}

interface BlogPagination {
  total: number;
  totalPages: number;
  page: number;
  limit: number;
}

interface StorefrontBlogIndexResult {
  categories: BlogCategoryItem[];
  items: BlogListItem[];
  pagination: BlogPagination;
}

type StorefrontBlogIndexQuery = {
  page?: number;
  search?: string;
  categorySlug?: string;
  tag?: string;
};

interface BlogPostDetailResponse {
  post: {
    _id: string;
    title: string;
    slug: string;
    excerpt?: string;
    content: string;
    featuredImage?: { url?: string; alt?: string };
    publishedAt?: string;
    readingTime?: number;
    viewCount?: number;
    commentCount?: number;
    allowComments?: boolean;
    authorName?: string;
    author?: { name?: string; image?: string };
    blog?: { title?: string; slug?: string };
    categories?: { _id: string; name: string; slug: string }[];
    tags?: string[];
    seo?: { pageTitle?: string; metaDescription?: string };
  };
  related: {
    _id: string;
    title: string;
    slug: string;
    excerpt?: string;
    featuredImage?: { url?: string };
    publishedAt?: string;
    readingTime?: number;
    authorName?: string;
    author?: { name?: string; image?: string };
  }[];
}

export const PUBLIC_BLOG_FILTER = {
  status: "published",
  visibility: { $ne: "private" },
} as const;

/**
 * Scheduled posts stay out of public listings until their time comes. A
 * function, not a constant, so the cutoff is the moment of the query rather
 * than the moment the module was first imported. Exported alongside the
 * filter above so the sitemap advertises exactly the posts the blog serves.
 */
export function publishedBlogDateCondition() {
  return {
    $or: [{ publishedAt: { $lte: new Date() } }, { publishedAt: null }],
  };
}

const BLOG_INDEX_LIMIT = 7;

function toIsoDate(value: unknown) {
  return value instanceof Date ? value.toISOString() : "";
}

function serializePost(post: unknown): BlogListItem {
  const data = post as Record<string, unknown>;
  const author = data.author as { name?: string; image?: string } | undefined;
  const featuredImage = data.featuredImage as
    | { url?: string; alt?: string }
    | undefined;

  return {
    _id: String(data._id),
    title: typeof data.title === "string" ? data.title : "",
    slug: typeof data.slug === "string" ? data.slug : "",
    excerpt: typeof data.excerpt === "string" ? data.excerpt : "",
    featuredImage,
    publishedAt: toIsoDate(data.publishedAt) || toIsoDate(data.createdAt),
    authorName:
      author?.name ||
      (typeof data.authorName === "string" ? data.authorName : "") ||
      "Author",
    authorImage: author?.image || "",
  };
}

function normalizeBlogIndexQuery(
  query: StorefrontBlogIndexQuery = {},
): Required<StorefrontBlogIndexQuery> {
  return {
    page: Number.isFinite(query.page) && (query.page || 0) > 0 ? query.page! : 1,
    search: query.search?.trim() || "",
    categorySlug: query.categorySlug?.trim() || "",
    tag: query.tag?.trim() || "",
  };
}

function serializeDetail(
  data: BlogPostDetailResponse | null,
): BlogPostDetailResponse | null {
  if (!data) return null;
  return JSON.parse(JSON.stringify(data)) as BlogPostDetailResponse;
}

export const getPublishedBlogPostDetail = unstable_cache(
  async (slug: string): Promise<BlogPostDetailResponse | null> => {
    await connectDB();

    const publishFilter = {
      ...PUBLIC_BLOG_FILTER,
      $or: [{ publishedAt: { $lte: new Date() } }, { publishedAt: null }],
    };

    const post = await BlogPost.findOne({ slug, ...publishFilter })
      .populate("author", "name image email")
      .populate("categories", "name slug")
      .lean();

    if (!post) return null;

    const postRecord = post as unknown as {
      _id: unknown;
      categoryIds?: unknown[];
      tags?: string[];
    };

    const relatedFilter: Record<string, unknown> = {
      _id: { $ne: postRecord._id },
      ...PUBLIC_BLOG_FILTER,
      $and: [
        { $or: [{ publishedAt: { $lte: new Date() } }, { publishedAt: null }] },
        {
          $or: [
            { categoryIds: { $in: postRecord.categoryIds || [] } },
            { tags: { $in: postRecord.tags || [] } },
          ],
        },
      ],
    };

    const related = await BlogPost.find(relatedFilter)
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(3)
      .select("title slug excerpt featuredImage publishedAt readingTime authorName")
      .populate("author", "name image")
      .lean();

    return serializeDetail({ post, related } as unknown as BlogPostDetailResponse);
  },
  ["published-blog-post-detail"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.blogPosts, CACHE_TAGS.blogCategories],
  },
);

const getStorefrontBlogIndexCached = unstable_cache(
  async (
    query: Required<StorefrontBlogIndexQuery>,
  ): Promise<StorefrontBlogIndexResult> => {
    await connectDB();

    const rawCategories = await BlogCategory.find({ isActive: true })
      .sort({ order: 1, name: 1 })
      .select("name slug")
      .lean();
    const categories: BlogCategoryItem[] = rawCategories.map((category) => ({
      _id: String(category._id),
      name: category.name,
      slug: category.slug,
    }));
    const selectedCategory = categories.find(
      (category) => category.slug === query.categorySlug,
    );

    const postQuery: Record<string, unknown> = {
      ...PUBLIC_BLOG_FILTER,
      $or: [{ publishedAt: { $lte: new Date() } }, { publishedAt: null }],
    };

    if (query.search)
      postQuery.title = {
        $regex: sanitizeSearchString(query.search),
        $options: "i",
      };
    if (selectedCategory) postQuery.categoryIds = selectedCategory._id;
    if (query.tag) postQuery.tags = query.tag;

    const skip = (query.page - 1) * BLOG_INDEX_LIMIT;
    const [posts, total] = await Promise.all([
      BlogPost.find(postQuery)
        .populate("author", "name image")
        .sort({ publishedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(BLOG_INDEX_LIMIT)
        .lean(),
      BlogPost.countDocuments(postQuery),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / BLOG_INDEX_LIMIT));

    return JSON.parse(
      JSON.stringify({
        categories,
        items: posts.map(serializePost),
        pagination: {
          total,
          totalPages,
          page: query.page,
          limit: BLOG_INDEX_LIMIT,
        },
      }),
    ) as StorefrontBlogIndexResult;
  },
  ["storefront-blog-index"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.blogPosts, CACHE_TAGS.blogCategories],
  },
);

export function getStorefrontBlogIndex(query: StorefrontBlogIndexQuery = {}) {
  return getStorefrontBlogIndexCached(normalizeBlogIndexQuery(query));
}

export async function incrementBlogPostView(slug: string) {
  await connectDB();
  await BlogPost.updateOne(
    {
      slug,
      ...PUBLIC_BLOG_FILTER,
      $or: [{ publishedAt: { $lte: new Date() } }, { publishedAt: null }],
    },
    { $inc: { viewCount: 1 } },
  );
}
