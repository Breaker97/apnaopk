import Link from "@/components/language/link";
import { FolderOpen } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import {
  loadCategoryMosaic,
  type MosaicCategory,
  type MosaicSource,
} from "@/lib/storefront/section-data/categories";

interface CategoryMosaicProps {
  title: string;
  source: MosaicSource;
  limit: number;
  categoryIds: string[];
  /**
   * A vendor's landing page: the same sources as the marketplace's mosaic,
   * read among the categories that store sells in, each tile opening its
   * own Products tab filtered to it.
   */
  vendor?: { id: string; slug: string };
  /** Drawn instead of nothing when too few categories fill the mosaic. */
  emptyState?: React.ReactNode;
}

function MosaicTile({
  category,
  className,
  large,
}: {
  category: MosaicCategory;
  className?: string;
  large?: boolean;
}) {
  return (
    <Link
      href={category.href ?? `/categories/${category.slug}`}
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
  title,
  source,
  limit,
  categoryIds,
  vendor,
  emptyState = null,
}: CategoryMosaicProps) {
  const categories = await loadCategoryMosaic({
    source,
    limit,
    categoryIds,
    ...(vendor ? { vendor } : {}),
  });
  if (categories.length === 0) return <>{emptyState}</>;

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
            category={lead}
            large
            className="col-span-2 aspect-[4/3] lg:row-span-2 lg:aspect-auto"
          />
          {rest.map((category) => (
            <MosaicTile
              key={category._id}
              category={category}
              className="aspect-[4/3]"
            />
          ))}
        </div>
      </div>
    </section>
  );
}
