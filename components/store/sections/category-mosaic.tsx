import Link from "next/link";
import { unstable_cache } from "next/cache";
import { FolderOpen } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { type Locale } from "@/config/i18n.config";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB } from "@/lib/db";
import { Category } from "@/models";

const MOSAIC_MIN = 3;
const MOSAIC_MAX = 7;

/** Same select and tags as the featured-categories strip's fetcher. */
const fetchMosaicCategories = unstable_cache(
  async (source: "featured" | "topLevel" | "manual", ids: string[], limit: number) => {
    try {
      await connectDB();
      const select = "_id name slug image";
      if (source === "manual" && ids.length > 0) {
        const categories = await Category.find({
          _id: { $in: ids },
          isActive: true,
        })
          .select(select)
          .lean();
        const order = new Map(ids.map((id, index) => [id, index]));
        categories.sort(
          (a, b) =>
            (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
        );
        return JSON.parse(JSON.stringify(categories.slice(0, limit)));
      }

      const query: Record<string, unknown> = { isActive: true };
      if (source === "featured") query.featured = true;
      else query.parent = null;
      const categories = await Category.find(query)
        .select(select)
        .sort({ order: 1, name: 1 })
        .limit(limit)
        .lean();
      return JSON.parse(JSON.stringify(categories));
    } catch {
      return [];
    }
  },
  ["section-category-mosaic"],
  {
    revalidate: 60,
    tags: [CACHE_TAGS.categories],
  },
);

interface CategoryMosaicProps {
  locale: Locale;
  title: string;
  source: "featured" | "topLevel" | "manual";
  limit: number;
  categoryIds: string[];
}

interface MosaicCategory {
  _id: string;
  name: string;
  slug: string;
  image?: string;
}

function MosaicTile({
  locale,
  category,
  className,
  large,
}: {
  locale: Locale;
  category: MosaicCategory;
  className?: string;
  large?: boolean;
}) {
  return (
    <Link
      href={`/${locale}/categories/${category.slug}`}
      className={cn(
        "group relative overflow-hidden rounded-md bg-muted",
        className,
      )}
    >
      {category.image ? (
        <AppImage
          src={category.image}
          alt={category.name}
          fill
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          sizes={large ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-muted-foreground">
          <FolderOpen className="h-6 w-6" aria-hidden />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
      <span
        className={cn(
          "absolute bottom-3 start-4 font-semibold text-white",
          large ? "text-xl sm:text-2xl" : "text-sm sm:text-base",
        )}
      >
        {category.name}
      </span>
    </Link>
  );
}

/**
 * A bento of category tiles: the first category takes the tall left slot,
 * the rest fill a two-column grid beside it — the "Category Mosaic" tile
 * from the section picker.
 */
export async function CategoryMosaic({
  locale,
  title,
  source,
  limit,
  categoryIds,
}: CategoryMosaicProps) {
  const safeLimit = Math.min(MOSAIC_MAX, Math.max(MOSAIC_MIN, limit));
  const categories = (await fetchMosaicCategories(
    source,
    categoryIds,
    safeLimit,
  )) as MosaicCategory[];
  if (categories.length < MOSAIC_MIN) return null;

  const [lead, ...rest] = categories;

  return (
    <section className="py-5 lg:py-8">
      <div className="container mx-auto px-4">
        {title ? (
          <h2 className="mb-6 text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
            {title}
          </h2>
        ) : null}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:grid-rows-2">
          <MosaicTile
            locale={locale}
            category={lead}
            large
            className="col-span-2 aspect-[4/3] lg:row-span-2 lg:aspect-auto"
          />
          {rest.map((category) => (
            <MosaicTile
              key={category._id}
              locale={locale}
              category={category}
              className="aspect-[4/3]"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
