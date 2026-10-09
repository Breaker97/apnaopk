import { SCROLLBAR_STYLES, type ThemeTokens } from "@/lib/storefront/themes/tokens";

/**
 * The shop's own scrollbar, as a stylesheet.
 *
 * It is built here and rendered by the store layout rather than living in
 * globals.css, for two reasons. The document scrollbar belongs to `html`,
 * which the admin shares — and `.store-surface` is not a marker for "this is
 * the shop", because the admin mounts one to render its previews, so a
 * `:root:has(.store-surface)` rule reached the dashboard too. The store
 * layout is the one thing only the shop mounts.
 *
 * The second reason is that the values are the merchant's: Themes → Layout.
 */

const THIN_WIDTH_PX = 10;

/** A hex/rgb the tokens already validated, or a fallback. */
function paint(value: string, fallback: string): string {
  return value.trim() ? value.trim() : fallback;
}

export function storeScrollbarCss(layout: ThemeTokens["layout"]): string {
  const style =
    SCROLLBAR_STYLES.find((entry) => entry.key === layout.scrollbar) ??
    SCROLLBAR_STYLES[0];

  // Standard is the browser's own: say nothing and let it draw what the
  // platform draws, rather than re-specifying it and losing the OS look.
  if (style.key === "standard") return "";

  if (style.key === "hidden") {
    // Both spellings: since Chrome 121 `scrollbar-width` wins over
    // `::-webkit-scrollbar`, but Safari still reads only the latter.
    return "html{scrollbar-width:none}html::-webkit-scrollbar{width:0;height:0}";
  }

  const thumb = paint(layout.scrollbarThumb, "color-mix(in oklab, var(--border) 50%, transparent)");
  const track = paint(layout.scrollbarTrack, "transparent");
  return [
    `html{scrollbar-width:thin;scrollbar-color:${thumb} ${track}}`,
    `html::-webkit-scrollbar{width:${THIN_WIDTH_PX}px;height:${THIN_WIDTH_PX}px}`,
    `html::-webkit-scrollbar-track{background:${track}}`,
    // A transparent border with `background-clip` insets the handle, so it
    // reads as a floating pill rather than a bar filling the groove.
    `html::-webkit-scrollbar-thumb{background-color:${thumb};border-radius:9999px;border:3px solid transparent;background-clip:content-box}`,
  ].join("");
}
