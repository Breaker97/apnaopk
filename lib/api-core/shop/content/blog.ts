import {
  BlogArticle,
  BlogArticleList,
  BlogArticleListQuery,
  type BlogArticleSummary,
} from "@/contracts/mobile/shop/v1/content";
import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/shop/v1/common";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import {
  getPublishedBlogPostDetail,
  getStorefrontBlogIndex,
} from "@/lib/blog/storefront-blog-posts";
import { imageSet } from "../images";
import { nextPageCursor, pageFromCursor } from "../page-cursor";
import { appHtml } from "./html";

function isoTime(value: unknown): string | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };

/** An article as the readers of lib/blog hand it, list item or detail. */
interface ArticleSource {
  _id: unknown;
  slug: string;
  title: string;
  excerpt?: string;
  featuredImage?: { url?: string; alt?: string };
  publishedAt?: string;
  authorName?: string;
  author?: { name?: string; image?: string };
}

function toSummary(article: ArticleSource): BlogArticleSummary {
  const image = imageSet(article.featuredImage?.url, article.featuredImage?.alt || article.title);
  return {
    id: String(article._id),
    slug: article.slug,
    title: article.title,
    ...optional("excerpt", text(article.excerpt)),
    ...(image ? { image } : {}),
    ...optional("authorName", text(article.author?.name) ?? text(article.authorName)),
    ...optional("publishedAt", isoTime(article.publishedAt)),
  };
}

/**
 * GET /blog: the blog's published articles, newest first, as the website's
 * /blog lists them (lib/blog: published, public, not scheduled for later),
 * with its categories for the chips above the list.
 */
export const blogListRoute = defineRoute({
  id: "content.blog.list",
  method: "GET",
  path: "/blog",
  auth: "none",
  cache: { kind: "public", sMaxAge: 60, swr: 120 },
  etag: true,
  rateLimit: { bucket: "content:blog", preset: "browse" },
  input: BlogArticleListQuery,
  output: BlogArticleList,
  handler: async ({ input }) => {
    const page = pageFromCursor(input.cursor);
    const { categories, items, pagination } = await getStorefrontBlogIndex({
      page,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
      categorySlug: input.category,
      tag: input.tag,
    });
    return {
      items: items.map((item) =>
        toSummary({
          ...item,
          // The list reader names a post with no author "Author", in English.
          authorName: item.authorImage || item.authorName !== "Author" ? item.authorName : undefined,
        }),
      ),
      nextCursor: nextPageCursor(page, pagination.totalPages),
      categories: categories.map((category) => ({ slug: category.slug, name: category.name })),
    };
  },
});

/**
 * GET /blog/{slug}: one published article, as the website's /blog/{slug}
 * shows it, with the related articles under it. Static: expired by the
 * blog's tags.
 */
export const blogArticleRoute = defineRoute({
  id: "content.blog.detail",
  method: "GET",
  path: "/blog/{slug}",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: BlogArticle,
  handler: async ({ params }) => {
    const detail = await getPublishedBlogPostDetail(params.slug);
    if (!detail) throw new MobileApiError(404, "NOT_FOUND", "This article is not available.");
    const { post, related } = detail;
    const authorImage = imageSet(post.author?.image, post.author?.name ?? post.authorName);
    const updatedAt = isoTime((post as { updatedAt?: unknown }).updatedAt);
    const minutes = Math.round(Number(post.readingTime) || 0);
    return {
      ...toSummary(post),
      html: appHtml(post.content),
      ...(authorImage ? { authorImage } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(minutes > 0 ? { readingMinutes: minutes } : {}),
      categories: (post.categories ?? [])
        .filter((category) => category?.slug && category.name)
        .map((category) => ({ slug: category.slug, name: category.name })),
      tags: (post.tags ?? []).filter((tag): tag is string => typeof tag === "string" && tag.length > 0),
      related: related.map(toSummary),
    };
  },
});
