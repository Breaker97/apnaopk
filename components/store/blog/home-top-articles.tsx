import { unstable_cache } from "next/cache";
import { connectDB } from "@/lib/db";
import { BlogPost } from "@/models";
import { type Locale } from "@/config/i18n.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import {
  TOP_ARTICLES_COLUMNS_MAX,
  TOP_ARTICLES_COLUMNS_MIN,
} from "@/lib/site-config/home-page-config";
import { TopArticlesCarousel, type TopArticle } from "./top-articles-carousel";

const fetchTopArticles = unstable_cache(
  async (limit: number): Promise<TopArticle[]> => {
    try {
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
    } catch {
      return [];
    }
  },
  ["home-top-articles"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.blogPosts],
  },
);

export async function HomeTopArticles({
  locale,
  title = "Top Articles",
  limit = 9,
  desktopColumns = 4,
  themedHeading = false,
}: {
  locale: Locale;
  title?: string;
  limit?: number;
  desktopColumns?: number;
  themedHeading?: boolean;
}) {
  const articles = await fetchTopArticles(limit);
  if (articles.length === 0) return null;

  const normalizedDesktopColumns = Number.isFinite(desktopColumns)
    ? Math.floor(desktopColumns)
    : 4;
  const safeDesktopColumns = Math.min(
    TOP_ARTICLES_COLUMNS_MAX,
    Math.max(TOP_ARTICLES_COLUMNS_MIN, normalizedDesktopColumns),
  );

  return (
    <section className="py-5 lg:py-10">
      <div className="container mx-auto px-4">
        <TopArticlesCarousel
          articles={articles}
          locale={locale}
          title={title}
          desktopColumns={safeDesktopColumns}
          themedHeading={themedHeading}
        />
      </div>
    </section>
  );
}
