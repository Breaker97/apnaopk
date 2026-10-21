/**
 * The Sliders page's card language (components/admin/sliders/slider-card.tsx),
 * shared by every card on Invoice Settings — a template, a preset to start
 * from, and their loading placeholders — so the two screens read as one app.
 */

/** The card: a soft-cornered, lightly shadowed panel. */
export const CARD_CLASS = "flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5";

/** A real card (not a loading placeholder) lifts a little on hover. */
export const CARD_HOVER_CLASS = "transition-[box-shadow,border-color,opacity] hover:shadow-md";

/** Cards side by side: one on a phone, more as the page widens. */
export const TEMPLATE_GRID_CLASS = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

/** The picture's frame inside a card. */
export const THUMBNAIL_FRAME_CLASS = "block rounded-xl bg-muted/50 p-3";

/** The picture's height inside its frame. */
export const THUMBNAIL_HEIGHT_CLASS = "h-56";

/** A page in a picture: a hairline edge and a soft shadow, so it reads as paper. */
export const PAPER_SHADOW = "0 0 0 1px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06), 0 6px 16px -4px rgba(0,0,0,.14)";

/** A card's small round-ended button. */
export const PILL_BUTTON_CLASS = "h-8 gap-1.5 rounded-full px-3 text-xs";

/** The page's main action, beside the title. */
export const PAGE_ACTION_CLASS = "h-11 shrink-0 gap-2 rounded-full px-5";

/** A short status word beside a card's name (Default, Draft). */
export const CHIP_CLASS = "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";
