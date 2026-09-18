import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { type Locale } from "@/config/i18n.config";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { ModernProductCard } from "@/components/products/modern-product-card";
import { SavedSliderLazy as SavedSlider } from "@/components/store/saved-slider-lazy";
import { fetchCollectionShelf } from "@/components/store/sections/featured-collection";
import { buildRenderSlides } from "@/lib/sliders/render";
import { resolveCellData } from "@/lib/storefront/sections/section-grid";
import type { SliderCellContent } from "@/lib/storefront/sections/slider-grids";
import {
  CARD_GRID_GAP_TIGHT,
} from "@/components/store/product-grid-columns";
import type { CollectionRowsSpacing } from "@/lib/storefront/sections/collection-rows-spacing";
import { cn } from "@/lib/utils";

/** One row's stored content — a collection block's settings, read leniently. */
export interface CollectionRowEntry {
  collection: string;
  /** Cards beside the panel — the row's shelf size. */
  limit: number;
  /** The feature slot: a static image or a saved slider, like a hero cell. */
  kind: "image" | "slider";
  image: string;
  slider: string;
}

/**
 * Desktop templates per card count: two cells — the panel at 3fr, then the
 * shelf of cards at 2fr per card. The shelf is one cell so the space after
 * the panel and the space between cards are set apart: the first is this
 * section's own, the second is the product grids'. Static strings —
 * Tailwind only compiles what it can see.
 */
const ROW_GRIDS: Record<number, string> = {
  1: "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]",
  2: "lg:grid-cols-[minmax(0,3fr)_minmax(0,4fr)]",
  3: "lg:grid-cols-[minmax(0,3fr)_minmax(0,6fr)]",
  4: "lg:grid-cols-[minmax(0,3fr)_minmax(0,8fr)]",
  5: "lg:grid-cols-[minmax(0,3fr)_minmax(0,10fr)]",
  6: "lg:grid-cols-[minmax(0,3fr)_minmax(0,12fr)]",
};

/**
 * The desktop template when the merchant set the panel's width: the panel
 * takes its share, the shelf the rest.
 */
const ROW_GRID_SIZED = "lg:grid-cols-[minmax(0,var(--fc-panel))_minmax(0,1fr)]";

/** The shelf's columns from lg: one per card. */
const SHELF_GRIDS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

/**
 * No fixed aspect from lg up: the panel stretches to the ROW height, which
 * the product cards set — so the panel's bottom edge lands level with the
 * bottom of the cards, per the design. A panel given a height of its own
 * sets the row's instead, and the cards stretch to it.
 */
function panelFrame(spacing: CollectionRowsSpacing): string {
  return cn(
    "relative min-h-[18rem] overflow-hidden rounded-[var(--fc-radius)] lg:min-h-0",
    spacing.panelHeight > 0 ? "lg:h-[var(--fc-panel-h)]" : "lg:h-full",
  );
}

/**
 * The "Top Collections" section: an editable heading over one row per
 * collection — a feature panel on the left (a chosen image or saved slider,
 * else the collection's own promo panel) with a compact product shelf
 * beside it, both bottoming out on the same line.
 */
export async function CollectionRows({
  locale,
  title,
  rows,
  spacing,
  emptyState = null,
}: {
  locale: Locale;
  title: string;
  rows: CollectionRowEntry[];
  spacing: CollectionRowsSpacing;
  emptyState?: React.ReactNode;
}) {
  const PANEL_FRAME = panelFrame(spacing);
  // The custom properties every row reads. A custom gap is the space
  // between the panel and the shelf ONLY; the cards keep the product grids'
  // spacing (Product card → Style → Grid spacing) whatever is set here.
  const rowVars = {
    "--fc-panel": `${spacing.panelWidth}%`,
    "--fc-panel-h": `${spacing.panelHeight}px`,
    "--fc-radius": spacing.radius,
    ...(spacing.gap !== null ? { gap: spacing.gap } : {}),
  } as React.CSSProperties;
  // One extra product per row: the first backstops the panel artwork.
  const shelves = await Promise.all(
    rows.map((row) =>
      row.collection
        ? fetchCollectionShelf(row.collection, row.limit + 1)
        : Promise.resolve(null),
    ),
  );
  const resolved = rows.flatMap((row, index) => {
    const shelf = shelves[index];
    return shelf ? [{ row, shelf }] : [];
  });
  if (resolved.length === 0) return <>{emptyState}</>;

  // The feature slots are slider cells — resolve their sliders (and the
  // products their price elements need) exactly like the hero grid does.
  const cells: SliderCellContent[] = resolved.map(({ row }) => ({
    kind: row.kind,
    slider: row.slider,
    image: row.image,
    link: "",
    alt: "",
  }));
  const { sliders, products } = await resolveCellData(cells);

  const t = await getTranslations({ locale, namespace: "common" });
  const [firstWord, ...restWords] = title.trim().split(/\s+/);

  return (
    <section className="py-6 lg:py-10">
      <div className="container mx-auto space-y-10 px-4 lg:space-y-14">
        {firstWord ? (
          <h2 className="text-center text-[length:var(--sec-title,1.5rem)] font-bold tracking-tight sm:text-[length:var(--sec-title-lg,1.875rem)]">
            {firstWord}
            {restWords.length > 0 ? (
              <> <span className="text-muted-foreground">{restWords.join(" ")}</span></>
            ) : null}
          </h2>
        ) : null}

        {resolved.map(({ row, shelf }, index) => {
          const href = `/${locale}/collections/${shelf.slug}`;
          const [lead, ...rest] = shelf.products;
          const cards = (
            rest.length >= row.limit ? rest : shelf.products
          ).slice(0, row.limit);
          const rowGrid =
            spacing.panelWidth > 0
              ? ROW_GRID_SIZED
              : (ROW_GRIDS[cards.length] ?? ROW_GRIDS[4]);
          const shelfGrid = SHELF_GRIDS[cards.length] ?? SHELF_GRIDS[4];
          const slider =
            row.kind === "slider" && row.slider
              ? sliders.get(row.slider)
              : undefined;

          const panel = slider ? (
            <div className={PANEL_FRAME}>
              <SavedSlider
                slides={buildRenderSlides(slider.slides, products, { locale })}
                className="h-full w-full rounded-[var(--fc-radius)] aspect-auto"
                transition={slider.transition}
                controls={slider.controls}
                handle={slider.handle}
                autoplayDelayMs={slider.autoplaySeconds * 1000}
              />
            </div>
          ) : row.kind === "image" && row.image ? (
            <Link href={href} className={PANEL_FRAME}>
              <AppImage
                src={row.image}
                alt={shelf.title}
                fill
                className="object-cover"
                sizes="(min-width: 1024px) 33vw, 100vw"
              />
            </Link>
          ) : (
            // No feature chosen: the collection promotes itself — name,
            // call to action, and its lead product as artwork.
            <div className={`${PANEL_FRAME} flex flex-col bg-muted p-5`}>
              <h3 className="text-center text-xl font-bold tracking-tight">
                {shelf.title}
              </h3>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="mx-auto mt-3 w-fit gap-1.5 rounded-full bg-background/70 px-4"
              >
                <Link href={href}>
                  {t("shopNow")}
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
                </Link>
              </Button>
              {lead?.images?.[0] ? (
                <AppImage
                  src={lead.images[0]}
                  alt=""
                  width={480}
                  height={640}
                  aria-hidden
                  className="pointer-events-none mt-auto max-h-[60%] w-full object-contain object-bottom"
                  sizes="(min-width: 1024px) 33vw, 100vw"
                />
              ) : null}
            </div>
          );

          return (
            <div
              key={`${row.collection}-${index}`}
              className={`grid ${CARD_GRID_GAP_TIGHT} ${rowGrid}`}
              style={rowVars}
            >
              {panel}
              {/* The shelf: 2/3-up below lg, one column per card from lg
                  up, where the cards set the row height. Its own gap is
                  the product grids', never the row's. */}
              <div
                className={`grid grid-cols-2 sm:grid-cols-3 ${shelfGrid} ${CARD_GRID_GAP_TIGHT}`}
              >
                {/* The store's one card, arrangement from the theme via
                    context — stretched so a row of uneven titles still lands
                    every card's bottom edge (the electronics View button
                    above all) on one line. */}
                {cards.map((product) => (
                  <ModernProductCard
                    key={product._id}
                    product={product}
                    locale={locale}
                    className="w-full self-stretch"
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
