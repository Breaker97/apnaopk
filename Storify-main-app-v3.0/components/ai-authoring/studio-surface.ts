import {
  BLOG_FEATURED_HEIGHT,
  BLOG_FEATURED_WIDTH,
} from "@/lib/ai-authoring/blog-featured/types";
import {
  PROMO_SQUARE_HEIGHT,
  PROMO_SQUARE_WIDTH,
  PROMO_TALL_HEIGHT,
  PROMO_TALL_WIDTH,
  PROMO_WIDE_HEIGHT,
  PROMO_WIDE_WIDTH,
} from "@/lib/ai-authoring/promo-card/types";
import {
  MEGA_MENU_PROMO_HEIGHT,
  MEGA_MENU_PROMO_WIDTH,
} from "@/lib/ai-authoring/mega-menu-promo/types";

export type AiStudioSurface =
  | "default_media"
  | "hero_banner"
  | "blog_featured"
  | "promo_tall"
  | "promo_square"
  | "promo_wide"
  | "mega_menu_promo";
type StudioDimensions = { w: number; h: number };
type StudioArtboard = StudioDimensions & { maxDisplayWidth: number };

/**
 * Whether the surface locks its output to a fixed aspect ratio. Such surfaces
 * hide the tools that would change the ratio (Resize, Expand) and the ones that
 * don't apply to a framed photo (Remove Background), keeping every result inside
 * the surface's contract. Default media stays fully editable.
 */
export function isRatioLockedSurface(surface: AiStudioSurface): boolean {
  return surface !== "default_media";
}

export function getStudioArtboard(
  surface: AiStudioSurface,
  image: StudioDimensions,
): StudioArtboard {
  if (surface === "hero_banner") {
    return { w: 1360, h: 314, maxDisplayWidth: 720 };
  }
  if (surface === "blog_featured") {
    // Fixed 16:9 frame — the ratio the blog cards and home carousel display,
    // so what the merchant frames on the artboard is what the storefront shows.
    return {
      w: BLOG_FEATURED_WIDTH,
      h: BLOG_FEATURED_HEIGHT,
      maxDisplayWidth: 640,
    };
  }
  if (surface === "promo_tall") {
    // The Promotions & Offers frames — the exact ratios the bento grid renders
    // (317:565 tall, 317:272 near-square, 654:272 wide), so what the merchant
    // frames on the artboard is what the storefront card shows.
    return { w: PROMO_TALL_WIDTH, h: PROMO_TALL_HEIGHT, maxDisplayWidth: 320 };
  }
  if (surface === "promo_square") {
    return {
      w: PROMO_SQUARE_WIDTH,
      h: PROMO_SQUARE_HEIGHT,
      maxDisplayWidth: 480,
    };
  }
  if (surface === "promo_wide") {
    return { w: PROMO_WIDE_WIDTH, h: PROMO_WIDE_HEIGHT, maxDisplayWidth: 640 };
  }
  if (surface === "mega_menu_promo") {
    // The header mega menu's right-side promo panel — the exact 10:13 portrait
    // the storefront renders, so what the merchant frames on the artboard is
    // what the promo panel shows.
    return {
      w: MEGA_MENU_PROMO_WIDTH,
      h: MEGA_MENU_PROMO_HEIGHT,
      maxDisplayWidth: 360,
    };
  }
  if (surface === "default_media") {
    const side = Math.max(image.w, image.h);
    return { w: side, h: side, maxDisplayWidth: 320 };
  }
  throw new Error("Unsupported AI Studio surface");
}

export function fitStudioArtboard(
  artboard: StudioArtboard,
  viewport: StudioDimensions,
): number {
  if (!artboard.w || !artboard.h || !viewport.w || !viewport.h) return 1;
  return Math.max(
    0.05,
    Math.min(
      1,
      artboard.maxDisplayWidth / artboard.w,
      (viewport.w - 48) / artboard.w,
      (viewport.h - 48) / artboard.h,
    ),
  );
}
