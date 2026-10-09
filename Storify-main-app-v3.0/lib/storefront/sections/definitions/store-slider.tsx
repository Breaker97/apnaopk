import { SavedSliderLazy as SavedSlider } from "@/components/store/saved-slider-lazy";
import { sectionEmptyState } from "@/components/store/sections/section-empty-state";
import {
  buildRenderSlides,
  collectSlideProductIds,
  type SlideProductInfo,
} from "@/lib/sliders/render";
import type { SliderSlide } from "@/lib/sliders/types";
import {
  getProductCompareAtRange,
  getProductPriceRange,
} from "@/lib/products/price-display";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import { cn } from "@/lib/utils";
import { getVendorStorefrontSlider } from "@/lib/vendors/vendor-sliders";
import type { SectionDefinition, SectionRenderProps } from "../types";

const STORE_SLIDER_HEIGHTS = ["compact", "standard", "large"] as const;
type StoreSliderHeight = (typeof STORE_SLIDER_HEIGHTS)[number];

/** Frame per height; "standard" is the promotional banner's own frame. */
const FRAME: Record<StoreSliderHeight, string> = {
  compact: "aspect-[16/7] sm:aspect-[16/4]",
  standard: "aspect-[16/7] sm:aspect-[16/5]",
  large: "aspect-[4/3] sm:aspect-[16/7]",
};

/** Price the bound products — the vendor's own only, as the store shows them. */
async function resolveSlideProducts(
  slides: SliderSlide[],
  vendorId: string,
): Promise<Map<string, SlideProductInfo>> {
  const products = new Map<string, SlideProductInfo>();
  const ids = collectSlideProductIds(slides);
  if (ids.length === 0) return products;
  try {
    const cards = await getStorefrontProductCards({
      ids,
      limit: ids.length,
      vendorId,
    });
    for (const card of cards) {
      if (!card.slug) continue;
      const compareAtMax = getProductCompareAtRange(card)?.max;
      products.set(String(card._id), {
        slug: card.slug,
        priceMin: getProductPriceRange(card).min,
        ...(compareAtMax !== undefined ? { compareAtMax } : {}),
      });
    }
  } catch {
    // Price is decoration on a slide; a failed lookup must not take the
    // section down with it.
  }
  return products;
}

async function StoreSliderRender({ settings, ctx }: SectionRenderProps) {
  const vendor = ctx.vendor;
  const handle = typeof settings.slider === "string" ? settings.slider : "";
  const empty = sectionEmptyState(ctx, {
    title: "Slider",
    hint: "Pick one of your sliders. Build and publish them in Online Store → Sliders.",
  });
  if (!vendor || !handle) return empty;

  const slider = await getVendorStorefrontSlider(vendor.id, handle).catch(
    () => null,
  );
  if (!slider) return empty;

  const products = await resolveSlideProducts(slider.slides, vendor.id);
  const slides = buildRenderSlides(slider.slides, products, {
    locale: ctx.locale,
  });
  if (slides.length === 0) return empty;

  const fullWidth = settings.fullWidth === true;
  const height = (STORE_SLIDER_HEIGHTS as readonly string[]).includes(
    settings.frameHeight as string,
  )
    ? (settings.frameHeight as StoreSliderHeight)
    : "standard";
  const carousel = (
    <SavedSlider
      slides={slides}
      transition={slider.transition}
      autoplayDelayMs={slider.autoplaySeconds * 1000}
      controls={slider.controls}
      className={cn(FRAME[height], fullWidth ? "rounded-none" : "rounded-xl")}
    />
  );
  return (
    <section className="py-5 lg:py-8">
      {fullWidth ? carousel : <div className="container mx-auto px-4">{carousel}</div>}
    </section>
  );
}

/**
 * A vendor's own saved slider on their landing page (`vendorOnly`). The
 * slides are built in the vendor's Online Store → Sliders and referenced by
 * handle, so editing a slider never needs the page republished.
 */
export const storeSlider: SectionDefinition = {
  type: "store-slider",
  version: 1,
  category: "promotions",
  vendorOnly: true,
  fields: [
    { key: "slider", type: "slider", default: "" },
    { key: "frameHeight", type: "select", options: STORE_SLIDER_HEIGHTS, default: "standard" },
    { key: "fullWidth", type: "toggle", default: false },
  ],
  isEmpty: ({ settings }) => !settings.slider,
  Render: StoreSliderRender,
};
