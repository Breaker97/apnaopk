import "server-only";

import {
  getProductCompareAtRange,
  getProductPriceRange,
} from "@/lib/products/price-display";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import {
  buildRenderSlides,
  collectSlideProductIds,
  type RenderSliderSlide,
  type SlideProductInfo,
} from "@/lib/sliders/render";
import type { SliderSlide } from "@/lib/sliders/types";
import type { SliderCellContent } from "@/lib/storefront/sections/slider-grids";
import {
  getStorefrontSlider,
  type ResolvedSlider,
} from "@/lib/storefront/sliders";
import { getVendorStorefrontSlider } from "@/lib/vendors/vendor-sliders";
import { readOr, type SectionReadMode } from "./read-mode";

/**
 * Whose sliders and products a cell reads. Unset: the store's own (Online
 * Store → Sliders). On a vendor's landing page, that vendor's sliders — and
 * only that vendor's products price their slides.
 */
export interface CellDataScope {
  vendorId?: string;
}

/**
 * The data behind every grid of cells — the Hero Slider, the Promotion Grid
 * and the featured-collection panels. A cell holds a saved Slider (by handle)
 * or a static linked image; this resolves what each will draw. The grid's
 * markup stays in lib/storefront/sections/section-grid.tsx.
 */

/**
 * A cell as the grid will draw it: a linked image, or a slider with the
 * slides that are live right now. `null` draws the quiet plate.
 */
export type DrawnGridCell =
  | { kind: "image"; image: string; link: string; alt: string }
  | { kind: "slider"; slider: ResolvedSlider; slides: RenderSliderSlide[] }
  | null;

/**
 * The price facts of the products slides are bound to, keyed by id: the one
 * place a slide's Price element comes from.
 *
 * Price is decoration on a promo cell: in page mode a failed lookup leaves
 * the slides without prices rather than taking the cell — or the page — down
 * with it.
 */
export async function resolveSlideProducts(
  slides: SliderSlide[],
  mode: SectionReadMode = "page",
  scope: CellDataScope = {},
): Promise<Map<string, SlideProductInfo>> {
  const products = new Map<string, SlideProductInfo>();
  const ids = collectSlideProductIds(slides);
  if (ids.length === 0) return products;
  const cards = await readOr(
    mode,
    () =>
      getStorefrontProductCards({
        ids,
        limit: ids.length,
        ...(scope.vendorId ? { vendorId: scope.vendorId } : {}),
      }),
    () => [],
  );
  for (const card of cards) {
    if (!card.slug) continue;
    const priceMin = getProductPriceRange(card).min;
    const compareAtMax = getProductCompareAtRange(card)?.max;
    products.set(String(card._id), {
      slug: card.slug,
      priceMin,
      ...(compareAtMax !== undefined ? { compareAtMax } : {}),
    });
  }
  return products;
}

/** Resolve every bound slider, and every product across them, in one pass. */
export async function resolveCellData(
  cells: (SliderCellContent | null)[],
  mode: SectionReadMode = "page",
  scope: CellDataScope = {},
) {
  const { vendorId } = scope;
  const handles = Array.from(
    new Set(
      cells.flatMap((cell) =>
        cell && cell.kind === "slider" && cell.slider ? [cell.slider] : [],
      ),
    ),
  );
  const sliders = new Map(
    (
      await Promise.all(
        handles.map(
          async (handle) =>
            [
              handle,
              vendorId
                ? await getVendorStorefrontSlider(vendorId, handle).catch(() => null)
                : await getStorefrontSlider(handle),
            ] as const,
        ),
      )
    ).filter((entry): entry is readonly [string, ResolvedSlider] => entry[1] !== null),
  );

  const products = await resolveSlideProducts(
    Array.from(sliders.values()).flatMap((slider) => slider.slides),
    mode,
    scope,
  );
  return { sliders, products };
}

/**
 * Resolve a grid's cells to what they will draw. A slider that is switched
 * off, deleted, or has no visible slide inside its schedule window draws
 * nothing — exactly like a cell nobody assigned — so a section can tell,
 * before it draws a frame, whether any cell has something to show.
 */
export async function resolveGridCells(
  cells: (SliderCellContent | null)[],
  locale: string,
  mode: SectionReadMode = "page",
  scope: CellDataScope = {},
): Promise<DrawnGridCell[]> {
  const { sliders, products } = await resolveCellData(cells, mode, scope);
  return cells.map((cell): DrawnGridCell => {
    if (!cell) return null;
    if (cell.kind === "image") {
      return cell.image
        ? { kind: "image", image: cell.image, link: cell.link, alt: cell.alt }
        : null;
    }
    const slider = cell.slider ? sliders.get(cell.slider) : undefined;
    if (!slider) return null;
    const slides = buildRenderSlides(slider.slides, products, { locale });
    return slides.length > 0 ? { kind: "slider", slider, slides } : null;
  });
}
