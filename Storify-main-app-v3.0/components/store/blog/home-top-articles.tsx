import {
  TOP_ARTICLES_COLUMNS_MAX,
  TOP_ARTICLES_COLUMNS_MIN,
} from "@/lib/site-config/home-page-config";
import { fetchTopArticles } from "@/lib/storefront/section-data/content";
import { TopArticlesCarouselLazy as TopArticlesCarousel } from "./top-articles-carousel-lazy";

export async function HomeTopArticles({
  title = "Top Articles",
  limit = 9,
  desktopColumns = 4,
  themedHeading = false,
}: {
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
          title={title}
          desktopColumns={safeDesktopColumns}
          themedHeading={themedHeading}
        />
      </div>
    </section>
  );
}
