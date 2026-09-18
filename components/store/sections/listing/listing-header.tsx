import type { CSSProperties, ReactNode } from "react";
import {
  listingCategoriesInCover,
  listingCoverStyle,
  listingHasCover,
  type ProductsListingLayout,
} from "@/lib/storefront/sections/products-listing-layout";
import { BackgroundVideo } from "@/components/store/background-video";
import { cn } from "@/lib/utils";

/**
 * The top of the products listing: the title, and — as the merchant set it
 * up — a cover painted behind it (a colour, a gradient or a picture;
 * contained in the page or across the whole screen) that can also hold the
 * breadcrumb and the categories, and a saved slider drawn as a banner above
 * it all.
 *
 * With no cover this is just the title row, exactly as the listing always
 * drew it. Chips never enter the cover; they belong to the toolbar above
 * the grid (see `listingCategoriesInCover`).
 */
export function ListingHeader({
  layout,
  align,
  title,
  aside,
  breadcrumb,
  categories,
  banner,
  className,
}: {
  layout: ProductsListingLayout;
  align: "left" | "center";
  /** The theme's own h1. */
  title: ReactNode;
  /** Beside a left-aligned title without a cover (the Classic sort pill). */
  aside?: ReactNode;
  /** Rendered only inside a cover; the page route draws it otherwise. */
  breadcrumb?: ReactNode;
  /** The non-chip category designs. */
  categories?: ReactNode;
  /** A saved slider above the title; follows the cover's width and corners. */
  banner?: ReactNode;
  className?: string;
}) {
  const centered = align === "center";
  const full = layout.coverWidth === "full";

  // The banner keeps the slider's own proportions unless the cover states a
  // height, in which case it fills exactly that.
  const bannerNode = banner ? (
    <div className={cn(full ? "" : "container mx-auto px-4", "mb-6")}>
      <div
        className="overflow-hidden"
        style={{
          borderRadius: full ? 0 : layout.coverRadius,
          height: layout.coverHeight > 0 ? layout.coverHeight : undefined,
          aspectRatio: layout.coverHeight > 0 ? undefined : "1248 / 450",
        }}
      >
        {banner}
      </div>
    </div>
  ) : null;

  if (!listingHasCover(layout)) {
    return (
      <div className={className}>
        {bannerNode}
        <div className="container mx-auto px-4">
          <div
            className={cn(
              "flex flex-col gap-4",
              centered
                ? "items-center text-center"
                : "sm:flex-row sm:items-center sm:justify-between",
            )}
          >
            {title}
            {aside && !centered ? aside : null}
          </div>
          {categories ? <div className="mt-8">{categories}</div> : null}
        </div>
      </div>
    );
  }

  const inCover = listingCategoriesInCover(layout);
  const paint = listingCoverStyle(layout);

  // The theme's ink tokens, re-pointed at the cover's text colour, so every
  // child that paints with `text-foreground` / `text-muted-foreground`
  // (breadcrumb, category names) follows the cover instead of the page.
  const ink: CSSProperties = paint.color
    ? ({
        color: paint.color,
        "--foreground": paint.color,
        "--muted-foreground": `color-mix(in srgb, ${paint.color} 72%, transparent)`,
      } as CSSProperties)
    : {};

  const content = (
    <div
      className={cn(
        "relative flex flex-col justify-center gap-5",
        centered ? "items-center text-center" : "items-start text-start",
      )}
      style={{ minHeight: layout.coverHeight > 0 ? layout.coverHeight : undefined }}
    >
      {breadcrumb ? (
        <div className="max-w-full rounded-full bg-[color-mix(in_srgb,currentColor_10%,transparent)] px-3.5 py-1.5 backdrop-blur-sm [&_nav]:mb-0">
          {breadcrumb}
        </div>
      ) : null}
      {title}
      {inCover && categories ? <div className="mt-3 w-full">{categories}</div> : null}
    </div>
  );

  const scrim = (
    <>
      {/* A video cover plays under the copy; the paint above is its poster. */}
      <BackgroundVideo background={layout.cover} />
      {paint.overlay > 0 ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 bg-black"
          style={{ opacity: paint.overlay / 100 }}
        />
      ) : null}
    </>
  );

  return (
    <div className={className}>
      {bannerNode}
      {full ? (
        <div className="relative overflow-hidden" style={{ ...paint.background, ...ink }}>
          {scrim}
          <div className="container relative mx-auto px-4 py-10 sm:py-14">{content}</div>
        </div>
      ) : (
        <div className="container mx-auto px-4">
          <div
            className="relative overflow-hidden px-5 py-8 sm:px-10 sm:py-12"
            style={{ ...paint.background, ...ink, borderRadius: layout.coverRadius }}
          >
            {scrim}
            {content}
          </div>
        </div>
      )}
      {!inCover && categories ? (
        <div className="container mx-auto mt-8 px-4">{categories}</div>
      ) : null}
    </div>
  );
}
