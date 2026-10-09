import { SavedSliderLazy as SavedSlider } from "@/components/store/saved-slider-lazy";
import { buildRenderSlides } from "@/lib/sliders/render";
import { readSliderCell } from "@/lib/storefront/sections/slider-grids";
import { resolveCellData } from "@/lib/storefront/section-data/slider-cells";
import type { ProductsListingLayout } from "@/lib/storefront/sections/products-listing-layout";
import type { Locale } from "@/config/i18n.config";

/**
 * The saved slider a listing draws above its title, resolved.
 *
 * Its own module so no listing can draw the cover its own way: a theme's
 * copy of the listing once never built one, and a merchant on that theme
 * picked a cover slider and silently got nothing. A theme changes how a
 * listing looks; it has no business changing whether a setting works. The
 * slider's client code arrives through its lazy wrapper, as every section's
 * does, so a listing without a cover never loads it.
 */
export async function listingCoverBanner({
  layout,
  locale,
}: {
  layout: ProductsListingLayout;
  locale: Locale;
}): Promise<React.ReactNode> {
  if (!layout.coverSlider) return null;
  const cell = readSliderCell({ kind: "slider", slider: layout.coverSlider });
  const { sliders, products } = await resolveCellData([cell]);
  const slider = sliders.get(layout.coverSlider);
  if (!slider) return null;
  return (
    <SavedSlider
      slides={buildRenderSlides(slider.slides, products, { locale })}
      className="h-full w-full aspect-auto"
      transition={slider.transition}
      controls={slider.controls}
      handle={slider.handle}
      autoplayDelayMs={slider.autoplaySeconds * 1000}
    />
  );
}
