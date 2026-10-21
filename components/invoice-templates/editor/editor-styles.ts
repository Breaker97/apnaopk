/**
 * The Slider editor's look (components/admin/sliders/slider-editor.tsx),
 * shared by the invoice template editor's toolbar, panel and palette, so the
 * two editors read as one app: soft 10 px cards for every group of settings,
 * 8 px controls in the toolbar, small semibold titles and 11 px hints.
 */

/** A group of settings, the palette, the stage: a light card. */
export const EDITOR_CARD_CLASS = "rounded-[10px] border border-border bg-card";

/** A card's title. */
export const EDITOR_TITLE_CLASS = "text-xs font-semibold text-foreground";

/** The line under a title on what the group is for. */
export const EDITOR_HINT_CLASS = "text-[11px] leading-snug text-muted-foreground";

/** A labelled toolbar control (Test print, Save, Size ▾). */
export const TOOL_BUTTON_CLASS = "h-9 gap-1.5 rounded-[8px] px-3";

/** An icon-only toolbar control (Back, the panel toggles, Reset). */
export const TOOL_ICON_CLASS = "h-9 w-9 shrink-0 rounded-[8px] text-muted-foreground hover:text-foreground";

/** Undo and Redo: small outlined squares, as the slider's name row has them. */
export const TOOL_OUTLINE_ICON_CLASS = "h-8 w-8 shrink-0 rounded-[6px]";

/** A run of related toolbar controls inside one border (zoom). */
export const TOOL_GROUP_CLASS = "flex items-center overflow-hidden rounded-[8px] border border-border";
