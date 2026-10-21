import { parseColor } from "@/lib/theme-colors/color";
import type { KeyColorRole } from "./tokens";

/**
 * Marking, inside the editor's preview frame, where a key colour paints —
 * shared by the storefront bridge and the dashboard bridge, since a palette
 * is as much the dashboard's colour as the shop's.
 */

const HIGHLIGHT_ATTRIBUTE = "data-theme-highlight";
/** A hidden-until-hover wrapper of a marked part, shown while it is marked. */
const REVEAL_ATTRIBUTE = "data-theme-reveal";
const HIGHLIGHT_STYLE_ID = "theme-preview-highlight";
/**
 * Backgrounds another role paints. A key colour can share its hex with one
 * (Secondary defaults to the text colour, so every `bg-foreground` chip would
 * match): an element that names one of these is that role's, not the key's.
 */
const OTHER_ROLE_BACKGROUND = /^bg-(foreground|background|card|muted|popover|secondary|accent|border|input|destructive)(\/\d+)?$/;

/**
 * Mark every element the editor's pointed-at key colour paints, so a
 * merchant sees where Primary (or Add to cart's Secondary…) lands before
 * changing it. Found by the colour each element actually computes to rather
 * than by class names: whichever component paints it, and however, it is
 * found — and nothing is marked that only shares a class.
 */
export function markKeyColor(
  role: KeyColorRole | null | undefined,
  color: string | undefined,
  { reveal = false }: { reveal?: boolean } = {},
) {
  for (const element of document.querySelectorAll(`[${HIGHLIGHT_ATTRIBUTE}]`)) {
    element.removeAttribute(HIGHLIGHT_ATTRIBUTE);
  }
  // Kept until the marks are redone: a wrapper shown a moment ago is fading
  // back out (its transition), and would no longer read as hidden.
  const shownBefore = new Set(document.querySelectorAll(`[${REVEAL_ATTRIBUTE}]`));
  const shown = new Set<Element>();
  const hideTheRest = () => {
    for (const node of shownBefore) if (!shown.has(node)) node.removeAttribute(REVEAL_ATTRIBUTE);
  };
  const rgb = role && color ? parseColor(color) : null;
  if (!rgb) {
    hideTheRest();
    return;
  }
  // The spelling computed styles use for an opaque colour.
  const target = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  if (!document.getElementById(HIGHLIGHT_STYLE_ID)) {
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent =
      `[${HIGHLIGHT_ATTRIBUTE}]{outline:2px dashed #db2777!important;outline-offset:2px!important}` +
      `[${REVEAL_ATTRIBUTE}]{opacity:1!important}`;
    document.head.appendChild(style);
  }
  const marked: HTMLElement[] = [];
  for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
    if (getComputedStyle(element).backgroundColor !== target) continue;
    // Not drawn (display: none, or inside it) — nothing to outline.
    if (typeof element.checkVisibility === "function" && !element.checkVisibility()) continue;
    if ([...element.classList].some((name) => OTHER_ROLE_BACKGROUND.test(name))) continue;
    element.setAttribute(HIGHLIGHT_ATTRIBUTE, "");
    marked.push(element);
    // A card's Add to cart waits for the pointer inside a see-through
    // wrapper; show it, or the mark would outline nothing visible.
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      if (shownBefore.has(node) || getComputedStyle(node).opacity === "0") {
        node.setAttribute(REVEAL_ATTRIBUTE, "");
        shown.add(node);
      }
    }
  }
  hideTheRest();
  // Nothing marked on screen (Add to cart sits below the hero): bring the
  // first place into view, or pointing at the colour would show nothing.
  const onScreen = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  };
  if (reveal && marked.length > 0 && !marked.some(onScreen)) {
    marked[0].scrollIntoView?.({ block: "center", behavior: "smooth" });
  }
}
