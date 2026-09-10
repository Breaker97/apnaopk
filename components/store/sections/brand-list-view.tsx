import Link from "next/link";
import { AppImage } from "@/components/ui/app-image";
import { ScrollRail } from "@/components/store/scroll-rail";
import { cn } from "@/lib/utils";

/**
 * "cards" is the original bordered-tile row; "strip" is the plain logo run
 * from the Electronics design — no boxes, just evenly spaced marks. The
 * presentational half of the section's variants.
 */
export type BrandListAppearance = "cards" | "strip";

/**
 * Container framing, sharing the hero/promo width vocabulary so a merchant
 * meets the same three words everywhere: the store container, edge to edge,
 * or edge to edge with a gutter.
 */
export const BRAND_LIST_WIDTHS = ["fixed", "full", "fullPadding"] as const;

export type BrandListWidth = (typeof BRAND_LIST_WIDTHS)[number];

export interface BrandTile {
  key: string;
  href: string;
  image: string;
  name: string;
}

const WIDTH_FRAMES: Record<BrandListWidth, string> = {
  fixed: "container mx-auto px-4",
  // Edge to edge still keeps a mobile gutter — a logo flush against a phone
  // bezel reads as a rendering bug, not a design.
  full: "px-4 sm:px-0",
  fullPadding: "px-4 sm:px-6 lg:px-8",
};

/**
 * The brand logo row, shared by the storefront section (server-rendered with
 * brands resolved from the DB) and the builder's live preview (the same
 * markup over the brands the inspector already fetched).
 *
 * Every size steps up at `sm`: on a phone the tiles are smaller and the row
 * scrolls with snap points, so a ten-brand strip stays readable instead of
 * squashing its logos to nothing.
 *
 * A phone can only ever hold four or five marks of a ten-brand run, so the
 * row is a scroller there — and it has to LOOK like one. `ScrollRail` fades
 * whichever edge still hides a logo; without that cue the mark the viewport
 * cuts in half reads as a rendering fault. It is measured, not assumed, so a
 * short run that fits (at any width) gets no fade at all.
 */
export function BrandListView({
  tiles,
  appearance = "cards",
  width = "fixed",
}: {
  tiles: BrandTile[];
  appearance?: BrandListAppearance;
  width?: BrandListWidth;
}) {
  const strip = appearance === "strip";
  // The Electronics run spreads its logos across the row, which only reads as
  // a design once there are enough of them — two brands pushed to opposite
  // edges look like a broken layout, so a short run centers instead.
  const spread = strip && tiles.length >= 4;

  return (
    <section className="py-4 lg:py-8">
      <div className={WIDTH_FRAMES[width] ?? WIDTH_FRAMES.fixed}>
        <ScrollRail
          className={cn(
            "flex snap-x items-center pb-1",
            "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            // A snapped logo lands clear of the edge instead of flush against
            // it, which is what makes the row feel scrolled rather than cut.
            "scroll-px-4",
            // On a phone every layout stays left-aligned and scrolls.
            strip ? "gap-6 sm:gap-10" : "gap-2.5 sm:gap-3",
            strip && (spread ? "sm:justify-between" : "sm:justify-center"),
          )}
        >
          {tiles.map((tile) => (
            <Link
              key={tile.key}
              href={tile.href}
              title={tile.name}
              className={cn(
                "flex shrink-0 snap-start items-center justify-center",
                strip
                  ? "h-11 px-1 sm:h-20"
                  : "h-24 w-32 rounded-md border border-border/70 bg-card px-3 transition-colors hover:border-border sm:h-28 sm:w-44 sm:px-5",
              )}
            >
              {tile.image ? (
                <AppImage
                  src={tile.image}
                  alt={tile.name}
                  width={176}
                  height={112}
                  // Brand logos are usually square artboards with generous
                  // internal padding, so the mark only reads at a tall box:
                  // the image fills the tile's height and object-contain
                  // letterboxes wide wordmarks instead of shrinking them to
                  // a wide-but-short strip.
                  className={cn(
                    "h-full w-auto max-w-full object-contain opacity-80 grayscale transition-all hover:opacity-100 hover:grayscale-0",
                    strip ? "max-h-11 sm:max-h-20" : "max-h-20 sm:max-h-24",
                  )}
                  sizes="(min-width: 640px) 176px, 112px"
                />
              ) : (
                <span className="truncate text-xs font-semibold text-muted-foreground sm:text-sm">
                  {tile.name}
                </span>
              )}
            </Link>
          ))}
        </ScrollRail>
      </div>
    </section>
  );
}
