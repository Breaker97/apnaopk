/**
 * The Hero Slider's category rail, shared by the storefront component
 * (`components/store/sections/category-rail-card.tsx`) and the builder's
 * preview (`components/admin/store-pages/hero-slider-studio.tsx`).
 *
 * The two used to hand-copy each other's limit and class strings — the copy
 * was held together by a comment, and it drifted. Everything both sides need
 * lives here instead. Nothing in this file may import server-only code: the
 * studio that reads it is a client component.
 */

/**
 * Root categories the rail shows. Anything past this is reachable from the
 * header nav, not from the hero.
 */
export const RAIL_CATEGORY_LIMIT = 10;

/**
 * The panel. It is a COLUMN so the list below can claim the leftover height
 * as a flex line — the rail is stretched to the hero's row, and the list has
 * to be measured against that, not against its own content.
 */
export const RAIL_PANEL_CLASS =
  "flex h-full flex-col overflow-hidden border-solid border-[#e7e2ff] [border-width:0.5px] bg-[#f2f2f2] text-[#474747] dark:border-border dark:bg-muted dark:text-foreground";

/**
 * Rows are FLEXIBLE (see RAIL_ROW_CLASS), so the list only has to hand them
 * the height and stay out of the way. `gap-2` is a floor that keeps two rows
 * from touching when the hero is short; the real breathing room comes from
 * the rows growing.
 *
 * `justify-center-safe` centers the block once the rows hit their cap — and
 * degrades to flex-start when the content overflows instead, which plain
 * `center` would push out of both ends and make the top unscrollable.
 *
 * `overflow-y-auto`, not `hidden`: under roughly a 1/4-height hero ten rows
 * do not fit at any spacing, and scrolling to a department beats hiding it.
 */
export const RAIL_LIST_CLASS =
  "flex min-h-0 flex-1 flex-col justify-center-safe gap-2 overflow-y-auto py-[26px] pe-[30px] ps-[29px]";

/**
 * One department. The rail's height is a viewport fraction picked in the
 * builder (30svh…85svh) and has no relationship to how many categories a
 * store has, so a fixed 26px row with a fixed 25px gap was wrong at both
 * ends: it clipped the last entry on a short hero and left a dead pocket
 * under the list on a tall one.
 *
 * Each row takes an equal share of whatever height it is given instead —
 * floored at the icon's 26px, and capped at 72px so a Full-height hero does
 * not strand ten departments across 100px of air apiece. The cap's leftover
 * is centered by the list, which reads as deliberate margin rather than as
 * a hole at the bottom.
 */
export const RAIL_ROW_CLASS =
  "flex max-h-[72px] min-h-[26px] flex-1 items-center";

/** The row fills its line, so the whole band is the hit target. */
export const RAIL_LINK_CLASS =
  "flex h-full w-full items-center gap-2 text-[15px] font-bold";

export const RAIL_ICON_CLASS =
  "grid h-[26px] w-[27px] shrink-0 place-items-center";
