import Link from "next/link";
import { type Locale } from "@/config/i18n.config";
import { AppImage } from "@/components/ui/app-image";
import { ModernProductCard } from "@/components/products/modern-product-card";
import { AddAllToCartButton } from "@/components/store/sections/add-all-to-cart-button";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { getStorefrontLook } from "@/lib/storefront/storefront-looks";
import { cn } from "@/lib/utils";
import {
  CARD_GRID_GAP_TIGHT,
} from "@/components/store/product-grid-columns";

/**
 * Desktop columns per shelf size. Static strings — Tailwind only compiles
 * what it can see.
 */
const SHELF_GRIDS: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

/**
 * One styled Look: the campaign image beside the heading, the pieces in it
 * as the store's own product card, and one button that bags the lot. The
 * image and the shelf are the Look's (a collection); the copy is the
 * section's, so the same Look can be pitched differently on two pages.
 */
export async function GetTheLook({
  locale,
  collectionId,
  title,
  subtitle,
  image,
  imagePosition,
  limit,
  ctaLabel,
  layout,
  emptyState = null,
}: {
  locale: Locale;
  collectionId: string;
  title: string;
  subtitle: string;
  /** Overrides the Look's own picture when set. */
  image: string;
  imagePosition: "left" | "right";
  limit: number;
  ctaLabel: string;
  /** The picture's size and spacing on desktop (see the section's fields). */
  layout: {
    /** Percent of the row. */
    imageWidth: number;
    /** px, a minimum. */
    imageHeight: number;
    /** px between the picture and the pieces. */
    gap: number;
    /** Pieces across; 0 = one row for all. */
    cardsPerRow: number;
    /** A CSS length. */
    radius: string;
  };
  emptyState?: React.ReactNode;
}) {
  const look = collectionId ? await getStorefrontLook(collectionId, limit) : null;
  if (!look) return <>{emptyState}</>;

  const products = look.products.slice(0, limit);
  const shelfGrid =
    SHELF_GRIDS[layout.cardsPerRow > 0 ? layout.cardsPerRow : products.length] ??
    SHELF_GRIDS[4];
  const href = `/${locale}/collections/${look.slug}`;
  const vars = {
    "--gl-image": `${layout.imageWidth}%`,
    "--gl-image-h": `${layout.imageHeight}px`,
    "--gl-gap": `${layout.gap}px`,
    "--gl-radius": layout.radius,
  } as React.CSSProperties;

  return (
    <section className="py-6 lg:py-10">
      <div className="container mx-auto px-4">
        <div
          className="grid gap-6 lg:grid-cols-[minmax(0,var(--gl-image))_minmax(0,1fr)] lg:gap-[var(--gl-gap)]"
          style={vars}
        >
          <Link
            href={href}
            aria-label={look.title}
            className={cn(
              "relative block aspect-[4/5] overflow-hidden rounded-[var(--gl-radius)] bg-muted lg:aspect-auto lg:min-h-[var(--gl-image-h)]",
              imagePosition === "right" && "lg:order-2",
            )}
          >
            <AppImage
              src={image || look.image}
              alt={look.title}
              fill
              className="object-cover transition-transform duration-500 hover:scale-[1.02]"
              sizes="(min-width: 1024px) 40vw, 100vw"
            />
          </Link>

          <div className="flex min-w-0 flex-col">
            {/* "Get the **Look**": the last word carries the same gradient
                fade every other section heading wears, rather than a flat
                muted colour of its own. */}
            <ElectronicsSectionHeading
              as="h2"
              title={title}
              emphasis="last"
              restStyle="plain"
              className="text-left text-[length:var(--sec-title,1.5rem)] sm:text-[length:var(--sec-title-lg,2rem)]"
            />
            {subtitle ? (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            ) : null}

            <div
              className={cn(
                "mt-5 grid grid-cols-2 sm:grid-cols-3",
                CARD_GRID_GAP_TIGHT,
                shelfGrid,
              )}
            >
              {products.map((product) => (
                <ModernProductCard
                  key={product._id}
                  product={product}
                  locale={locale}
                  className="w-full self-stretch"
                />
              ))}
            </div>

            {ctaLabel ? (
              <AddAllToCartButton
                products={products}
                label={ctaLabel}
                className="mt-6"
              />
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
