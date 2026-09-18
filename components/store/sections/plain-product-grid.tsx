import { type Locale } from "@/config/i18n.config";
import {
  ModernProductCard,
  type ModernProduct,
} from "@/components/products/modern-product-card";
import {
  clampDesktopColumns,
  PRODUCT_GRID_DESKTOP_COLUMN_CLASSES,
  CARD_BROWSER_GRID_GAP,
} from "@/components/store/product-grid-columns";
import { cn } from "@/lib/utils";

/**
 * The catalogue browser's second layout: the products, and nothing else.
 *
 * The browser layout earns its category chips, filter panel and endless
 * scroll on a page that IS the catalogue. Dropped between other home
 * sections it competes with them — three filter affordances above the fold,
 * and a section that never ends. This layout is the same cards in a plain
 * grid of a fixed number of rows, so the section takes the room it is given
 * and hands the shopper on to the next one.
 *
 * A server component with no state: there is nothing here to interact with,
 * which is the point.
 */
export function PlainProductGrid({
  locale,
  title,
  products,
  desktopColumns = 4,
}: {
  locale: Locale;
  title?: string;
  products: ModernProduct[];
  desktopColumns?: number;
}) {
  if (products.length === 0) return null;
  const safeDesktopColumns = clampDesktopColumns(desktopColumns);

  return (
    // No title: no top padding, so a Heading block above sits flush.
    <section className={title ? "py-6 lg:py-12" : "pb-6 lg:pb-12"}>
      <div className="container mx-auto px-4">
        {title ? (
          <h2 className="text-[length:var(--sec-title,1.125rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.5rem)]">
            {title}
          </h2>
        ) : null}
        <div
          className={cn(
            // The browser layout's own grid metrics, so switching layouts
            // changes the chrome and not the cards.
            "grid grid-cols-2 md:grid-cols-3",
            CARD_BROWSER_GRID_GAP,
            title ? "mt-5 sm:mt-8" : "",
            PRODUCT_GRID_DESKTOP_COLUMN_CLASSES[safeDesktopColumns],
          )}
        >
          {products.map((product) => (
            <ModernProductCard
              key={String(product._id)}
              product={product}
              locale={locale}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
