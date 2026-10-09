/**
 * The blog featured image is displayed in landscape across every storefront
 * surface (index cards and the home carousel use 16:9, the post/index heroes are
 * wider still). AI Studio can only emit 1:1, 2:3, or 3:2, so a blog generation is
 * produced at 3:2 (`1536x1024`) and cropped down to a locked 16:9 frame — the
 * ratio the cards and carousel use — before it is applied. Cropping 3:2 → 16:9
 * only trims the top and bottom, so the generated subject stays centered.
 */

/** Locked output width — same as the 3:2 source, so the crop only trims height. */
export const BLOG_FEATURED_WIDTH = 1536 as const;
/** 1536 / (16 / 9) = 864, the 16:9 height the source is cropped to. */
export const BLOG_FEATURED_HEIGHT = 864 as const;
