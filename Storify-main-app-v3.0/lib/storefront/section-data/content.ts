import "server-only";

import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { withFallback } from "@/lib/storefront/cached-read";
import { BlogPost, Review } from "@/models";

/**
 * The home page's content rows that read the database: the latest articles
 * and the customer testimonials. The `read…` readers throw on a failed read;
 * the `fetch…` readers are the storefront's, which answer an empty row.
 */

/** A blog post as an article card shows it. */
interface HomeArticle {
  _id: string;
  title: string;
  slug: string;
  excerpt: string;
  image: string;
  imageAlt: string;
  authorName: string;
  authorImage: string;
  /** The publication date (else the creation date) as `Date#toString()`. */
  publishedAt: string;
}

/** The newest published, public articles. */
export const readTopArticles = unstable_cache(
  async (limit: number): Promise<HomeArticle[]> => {
    await connectDB();
    const posts = await BlogPost.find({
      status: "published",
      visibility: { $ne: "private" },
      $or: [{ publishedAt: { $lte: new Date() } }, { publishedAt: null }],
    })
      .populate("author", "name image")
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return posts.map((post) => {
      const data = post as unknown as Record<string, unknown>;
      const author = data.author as { name?: string; image?: string } | undefined;
      const featured = data.featuredImage as
        | { url?: string; alt?: string }
        | undefined;
      const title = typeof data.title === "string" ? data.title : "";
      const publishedAt =
        data.publishedAt instanceof Date
          ? data.publishedAt
          : data.createdAt instanceof Date
            ? data.createdAt
            : "";

      return {
        _id: String(data._id),
        title,
        slug: String(data.slug),
        excerpt: typeof data.excerpt === "string" ? data.excerpt : "",
        image: featured?.url || "",
        imageAlt: featured?.alt || title,
        authorName:
          (author?.name as string | undefined) ||
          (typeof data.authorName === "string" ? data.authorName : "") ||
          "Author",
        authorImage: author?.image || "",
        publishedAt: publishedAt.toString(),
      };
    });
  },
  ["home-top-articles"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.blogPosts],
  },
);

export const fetchTopArticles = withFallback(readTopArticles, () => []);

export interface TestimonialEntry {
  id: string;
  rating: number;
  title?: string;
  comment: string;
  reviewerName?: string;
}

/**
 * Approved storefront reviews, best-and-newest first. No entity tag exists
 * for reviews, so this leans on time-based revalidation alone — fine for a
 * social-proof strip.
 */
export const readTestimonials = unstable_cache(
  async (minRating: number, limit: number): Promise<TestimonialEntry[]> => {
    await connectDB();
    const reviews = await Review.find({
      isApproved: true,
      rating: { $gte: minRating },
      comment: { $exists: true, $nin: ["", null] },
    })
      .select("rating title comment userId createdAt")
      .populate("userId", "name")
      .sort({ rating: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    return reviews.map((review) => {
      const user = review.userId as { name?: string } | null;
      return {
        id: String(review._id),
        rating: Number(review.rating) || 0,
        title: typeof review.title === "string" ? review.title : undefined,
        comment: String(review.comment ?? ""),
        reviewerName: user?.name || undefined,
      };
    });
  },
  ["section-testimonials"],
  { revalidate: 300 },
);

export const fetchTestimonials = withFallback(readTestimonials, () => []);
