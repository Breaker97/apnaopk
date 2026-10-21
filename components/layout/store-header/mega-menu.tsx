"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import Link from "@/components/language/link";
import { ArrowRight, ChevronRight } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import {
  MEGA_BOTTOM_PROMO_CARDS,
  MEGA_FLAT_COLUMNS,
  MEGA_LINKS_PER_GROUP_TALL,
  getMegaGroupColumns,
  getMegaGroupLimit,
  getMegaLinkLimit,
  getMegaVisibleLinkCount,
  isMegaTallShape,
} from "@/lib/site-config/menu-depth";
import { DEFAULT_CATEGORY_TRIGGER } from "@/lib/site-config/header-config";
import {
  getCategoryRailRadius,
  getMegaFlyoutMaxWidth,
} from "@/lib/site-config/header-trigger-style";
import type { HeaderMenuItem } from "@/lib/site-config/header-config";

// The menu-structure builder previews this panel without a header config to
// read, so the rail falls back to the radius a fresh store ships with.
const DEFAULT_RAIL_RADIUS = getCategoryRailRadius(DEFAULT_CATEGORY_TRIGGER);
const DEFAULT_RAIL_WIDTH = DEFAULT_CATEGORY_TRIGGER.width;

// Hover intent. Opening the first flyout waits a beat so sweeping down the rail
// to reach a lower category doesn't flash every panel on the way. Once one is
// open, switching between categories is instant — a delay there reads as lag.
const FLYOUT_OPEN_DELAY = 100;
// Grace period after the pointer leaves the rail or the flyout, so a diagonal
// move from a rail row into the panel doesn't close it mid-travel.
const FLYOUT_CLOSE_DELAY = 200;

// Both floating cards carry the same lift. Written out per theme because a
// single hardcoded slate shadow disappears against a dark popover surface.
const PANEL_SHADOW =
  "shadow-[0_22px_48px_-12px_rgba(19,32,50,0.20),0_2px_6px_rgba(19,32,50,0.06)] dark:shadow-[0_22px_48px_-12px_rgba(0,0,0,0.6),0_2px_6px_rgba(0,0,0,0.35)]";

type MegaPromoMode = "none" | "side" | "bottom";

type MegaPromoCard = {
  image: string;
  href: string;
  target?: HeaderMenuItem["target"];
  label: string;
};

export function getHeaderMenuItemKey(item?: HeaderMenuItem) {
  if (!item) return null;
  return `${item.href}::${item.label}`;
}

function getVisibleMegaChildren(item?: HeaderMenuItem) {
  return (item?.children || []).filter((child) => child.label.trim());
}

export function getMegaItemPromoImage(item?: HeaderMenuItem) {
  const image = item?.image?.trim() || "";
  const icon = item?.icon?.trim() || "";
  return image && image !== icon ? image : "";
}

/**
 * Where a category's promo renders. Menus saved before the mode existed only
 * ever had the old "Right promo panel" switch, which is exactly today's "side"
 * and only rendered when the item carried its own image — so derive that rather
 * than silently dropping promos on upgrade.
 */
function getMegaPromoMode(item?: HeaderMenuItem): MegaPromoMode {
  if (!item) return "none";
  if (
    item.promoMode === "none" ||
    item.promoMode === "side" ||
    item.promoMode === "bottom"
  ) {
    return item.promoMode;
  }
  return item.isFeatured && getMegaItemPromoImage(item) ? "side" : "none";
}

/**
 * The bottom promo strip: a fixed pair of images the merchant uploads on the
 * category itself, both linking to that category.
 *
 * `legacySources` is the upgrade path — menus built before the pair of fields
 * existed made the strip out of child groups flagged as promo cards. Those
 * children are cards, not columns, so the caller has to keep them out of the
 * link grid; a category using the new fields returns none and every child
 * stays a column.
 */
function getMegaBottomPromoCards(root: HeaderMenuItem): {
  cards: MegaPromoCard[];
  legacySources: HeaderMenuItem[];
} {
  const uploaded = (root.promoImages || [])
    .map((image) => (typeof image === "string" ? image.trim() : ""))
    .filter(Boolean)
    .slice(0, MEGA_BOTTOM_PROMO_CARDS);

  if (uploaded.length > 0) {
    return {
      cards: uploaded.map((image) => ({
        image,
        href: root.href,
        target: root.target,
        label: root.label,
      })),
      legacySources: [],
    };
  }

  const legacySources = getVisibleMegaChildren(root)
    .filter((child) => child.isFeatured && getMegaItemPromoImage(child))
    .slice(0, MEGA_BOTTOM_PROMO_CARDS);

  return {
    cards: legacySources.map((child) => ({
      image: getMegaItemPromoImage(child),
      href: child.href,
      target: child.target,
      label: child.label,
    })),
    legacySources,
  };
}

/**
 * Turns a category's children into the grid the flyout draws, inside the four
 * columns / two rows budget (see lib/menu-depth.ts). Everything the panel needs
 * to size itself is decided here, so the JSX below never has to guess.
 */
function getMegaFlyoutLayout(
  root: HeaderMenuItem,
  {
    hasSidePromo,
    hasBottomPromo,
    excluded,
    railRowCount,
  }: {
    hasSidePromo: boolean;
    hasBottomPromo: boolean;
    excluded: HeaderMenuItem[];
    /** Categories in the rail beside the flyout, whose height sets the tall cap. */
    railRowCount: number;
  },
) {
  const children = getVisibleMegaChildren(root).filter(
    (child) => !excluded.includes(child),
  );
  const groupsWithLinks = children.filter(
    (child) => getVisibleMegaChildren(child).length > 0,
  );
  const ungrouped = children.filter(
    (child) => getVisibleMegaChildren(child).length === 0,
  );

  // Nothing groups into columns, so the children render as a flat link list
  // with no headings — short rows, so it can run the full column count.
  if (groupsWithLinks.length === 0) {
    return {
      isFlat: true as const,
      groups: [],
      loose: ungrouped.slice(0, MEGA_FLAT_COLUMNS * MEGA_LINKS_PER_GROUP_TALL),
      columnCount: Math.min(MEGA_FLAT_COLUMNS, Math.max(ungrouped.length, 1)),
      linkLimit: MEGA_LINKS_PER_GROUP_TALL,
      isTall: false,
    };
  }

  const columns = getMegaGroupColumns(hasSidePromo);
  // Ungrouped links share one trailing column, so they cost a slot as well.
  const looseSlot = ungrouped.length > 0 ? 1 : 0;
  const groups = groupsWithLinks.slice(
    0,
    getMegaGroupLimit(hasSidePromo) - looseSlot,
  );
  const usedColumns = groups.length + looseSlot;
  const columnCount = Math.min(columns, Math.max(usedColumns, 1));
  const rows = Math.ceil(usedColumns / columnCount);
  const linkLimit = getMegaLinkLimit(rows, hasBottomPromo, railRowCount);

  return {
    isFlat: false as const,
    groups,
    loose: ungrouped.slice(0, linkLimit),
    columnCount,
    linkLimit,
    isTall: isMegaTallShape(rows, hasBottomPromo),
  };
}

/**
 * Icon for a menu item, or nothing at all. The desktop rail runs label-only —
 * names all starting at one edge scan faster — but the mobile sheet still leads
 * each row with a visual.
 *
 * Returns `null` rather than a stand-in glyph when the item has no icon: a
 * guessed-from-the-label pictogram is noise next to the label it was guessed
 * from. Callers keep the row aligned with a blank spacer of the same size.
 */
export function MegaMenuItemVisual({
  item,
  className,
}: {
  item: HeaderMenuItem;
  className?: string;
}) {
  // Icon-only: the promo image is never borrowed as an icon. It stays confined
  // to the promo panel — see mapMegaMenuItem, which keeps the two apart.
  const imageSrc = item.icon;

  if (!imageSrc) return null;

  return (
    <AppImage
      src={imageSrc}
      alt={item.label}
      width={20}
      height={20}
      className={cn("h-5 w-5 object-contain", className)}
    />
  );
}

/**
 * Header mega menu: a category rail that opens a flyout for whichever category
 * the pointer rests on. Categories with no children get no arrow and no flyout.
 *
 * Active-category state lives here rather than in the header — nothing outside
 * this panel reads it, and keeping it local means the header no longer tracks
 * three separate hover keys.
 */
export function CustomMegaMenuPanel({
  roots,
  railLabel,
  viewAllHref,
  viewAllLabel,
  viewAllShortLabel,
  shopAllLabel,
  railRadius = DEFAULT_RAIL_RADIUS,
  railWidth = DEFAULT_RAIL_WIDTH,
  onNavigate,
}: {
  roots: HeaderMenuItem[];
  railLabel: string;
  viewAllHref: string;
  viewAllLabel: string;
  viewAllShortLabel: string;
  /** The flyout footer's link to the open category, e.g. "Shop All Gaming". */
  shopAllLabel: (categoryLabel: string) => string;
  /** Bottom corners follow the trigger button's radius — see header-trigger-style. */
  railRadius?: number;
  /** Matches the trigger button's width; the flyout sizes itself around it. */
  railWidth?: number;
  onNavigate: () => void;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const flyoutRef = useRef<HTMLDivElement | null>(null);
  // Stepping back out of the flyout hands focus to the rail row that opened it,
  // and that row's own focus handler would immediately reopen the panel the
  // keystroke just closed. Held across the synchronous focus() call only.
  const suppressFocusOpenRef = useRef(false);

  useEffect(
    () => () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const clearTimers = () => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  };

  const openFlyout = (item: HeaderMenuItem, immediate = false) => {
    clearTimers();
    const key = getHeaderMenuItemKey(item);
    if (immediate || activeKey) {
      setActiveKey(key);
      return;
    }
    openTimerRef.current = setTimeout(
      () => setActiveKey(key),
      FLYOUT_OPEN_DELAY,
    );
  };

  const scheduleClose = () => {
    clearTimers();
    closeTimerRef.current = setTimeout(() => setActiveKey(null), FLYOUT_CLOSE_DELAY);
  };

  const closeNow = () => {
    clearTimers();
    setActiveKey(null);
  };

  const activeIndex = roots.findIndex(
    (item) => getHeaderMenuItemKey(item) === activeKey,
  );
  const activeRoot = activeIndex < 0 ? undefined : roots[activeIndex];

  /**
   * Arrow-key roving over the rail, plus →/← to step into and back out of the
   * flyout. Escape is only swallowed while the flyout owns focus — otherwise it
   * belongs to the popover, which closes the whole menu.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rows = rowRefs.current;
    const insideFlyout = !!flyoutRef.current?.contains(document.activeElement);
    const returnToRail = () => {
      closeNow();
      suppressFocusOpenRef.current = true;
      if (activeIndex >= 0) rows[activeIndex]?.focus();
      suppressFocusOpenRef.current = false;
    };

    // The flyout opens on the inline-end side, so the keys that walk into and
    // out of it swap with the writing direction.
    const isRtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const enterKey = isRtl ? "ArrowLeft" : "ArrowRight";
    const leaveKey = isRtl ? "ArrowRight" : "ArrowLeft";

    if (event.key === "Escape") {
      if (!activeRoot || !insideFlyout) return;
      event.preventDefault();
      event.stopPropagation();
      returnToRail();
      return;
    }

    if (event.key === leaveKey && insideFlyout) {
      event.preventDefault();
      returnToRail();
      return;
    }

    const focusedIndex = rows.findIndex((row) => row === document.activeElement);
    if (focusedIndex < 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      // Wraps at both ends, skipping any row that failed to mount.
      for (let offset = 1; offset <= roots.length; offset += 1) {
        const target =
          (((focusedIndex + step * offset) % roots.length) + roots.length) %
          roots.length;
        const next = rows[target];
        if (next) {
          next.focus();
          return;
        }
      }
      return;
    }

    if (event.key === enterKey) {
      const item = roots[focusedIndex];
      if (!item || getVisibleMegaChildren(item).length === 0) return;
      event.preventDefault();
      openFlyout(item, true);
      // The panel only exists after this state change commits, so wait a frame
      // before reaching for its first link.
      requestAnimationFrame(() => {
        flyoutRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
      });
    }
  };

  return (
    // Rail and flyout are two floating cards, not one box — the flyout usually
    // runs taller than the rail, and a shared background would leave a slab of
    // empty popover hanging below the last category.
    <div className="flex items-start" onKeyDown={handleKeyDown}>
      {/* Plain nav + list rather than role="menu": these are links, and menu
          semantics would promise a roving tabindex this doesn't implement —
          every row stays in the tab order, with arrow keys as a shortcut. */}
      <nav
        aria-label={railLabel}
        data-mega-rail=""
        style={{
          width: railWidth,
          // Logical corners, so the rail rounds on the outside in RTL too.
          // The corner the flyout butts against goes square while a panel is
          // open — a rounded one there cuts a notch out of the joined card.
          borderEndStartRadius: railRadius,
          borderEndEndRadius: activeRoot ? 0 : railRadius,
        }}
        className={cn(
          "flex shrink-0 flex-col overflow-hidden border border-border/60 bg-popover",
          PANEL_SHADOW,
        )}
      >
        <ul className="flex max-h-[400px] min-h-0 list-none flex-col overflow-y-auto p-1">
          {roots.map((item, index) => {
            const hasChildren = getVisibleMegaChildren(item).length > 0;
            const isActive = index === activeIndex;

            return (
              <li key={getHeaderMenuItemKey(item)} className="shrink-0">
                <Link
                  ref={(node) => {
                    rowRefs.current[index] = node;
                  }}
                  href={item.href}
                  target={item.target}
                  rel={item.target === "_blank" ? "noopener noreferrer" : undefined}
                  aria-haspopup={hasChildren || undefined}
                  aria-expanded={hasChildren ? isActive : undefined}
                  // Childless categories are plain links: no arrow, and pointing
                  // at one dismisses whatever flyout was open rather than leaving
                  // a stale panel beside an unrelated row.
                  onMouseEnter={() =>
                    hasChildren ? openFlyout(item) : scheduleClose()
                  }
                  onFocus={() => {
                    if (suppressFocusOpenRef.current) return;
                    if (hasChildren) openFlyout(item, true);
                    else closeNow();
                  }}
                  onClick={onNavigate}
                  // Full foreground, one step above the flyout's /75 links, so
                  // the rail reads as the level above them. h-9 is
                  // MEGA_RAIL_ROW_HEIGHT in lib/site-config/menu-depth.ts.
                  className={cn(
                    "flex h-9 items-center justify-between gap-2 rounded-lg px-3 text-[13.5px] transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2",
                    isActive
                      ? "bg-primary/10 font-medium text-store-link"
                      : "text-foreground hover:bg-muted/60",
                  )}
                >
                  <span className="min-w-0 truncate">{item.label}</span>
                  {hasChildren ? (
                    <ChevronRight
                      className={cn(
                        // The flyout opens on the inline-end side, so the arrow
                        // has to flip with the writing direction.
                        "h-3.5 w-3.5 shrink-0 transition-opacity rtl:rotate-180",
                        isActive ? "opacity-100" : "opacity-55",
                      )}
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        {/* Same h-10 as the flyout's footer, so the two footer rules meet
            in one line across the seam. */}
        <div className="flex h-10 shrink-0 items-center border-t border-border/60 px-4">
          <MegaMenuMoreLink
            href={viewAllHref}
            onClick={onNavigate}
            onMouseEnter={scheduleClose}
            onFocus={closeNow}
          >
            {viewAllLabel}
          </MegaMenuMoreLink>
        </div>
      </nav>

      {activeRoot ? (
        <MegaMenuFlyout
          // Keyed so swapping category re-runs the fade instead of snapping.
          key={getHeaderMenuItemKey(activeRoot)}
          ref={flyoutRef}
          root={activeRoot}
          railWidth={railWidth}
          railRowCount={roots.length}
          viewAllShortLabel={viewAllShortLabel}
          shopAllLabel={shopAllLabel}
          onPointerEnter={clearTimers}
          onPointerLeave={scheduleClose}
          onNavigate={onNavigate}
        />
      ) : null}
    </div>
  );
}

function MegaMenuFlyout({
  ref,
  root,
  railWidth,
  railRowCount,
  viewAllShortLabel,
  shopAllLabel,
  onPointerEnter,
  onPointerLeave,
  onNavigate,
}: {
  ref: Ref<HTMLDivElement>;
  root: HeaderMenuItem;
  railWidth: number;
  railRowCount: number;
  viewAllShortLabel: string;
  shopAllLabel: (categoryLabel: string) => string;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onNavigate: () => void;
}) {
  const mode = getMegaPromoMode(root);
  const sidePromoImage = mode === "side" ? getMegaItemPromoImage(root) : "";
  const { cards, legacySources } =
    mode === "bottom"
      ? getMegaBottomPromoCards(root)
      : { cards: [] as MegaPromoCard[], legacySources: [] as HeaderMenuItem[] };
  const { isFlat, groups, loose, columnCount, linkLimit, isTall } =
    getMegaFlyoutLayout(root, {
      hasSidePromo: !!sidePromoImage,
      hasBottomPromo: cards.length > 0,
      excluded: legacySources,
      railRowCount,
    });

  return (
    <div
      ref={ref}
      role="region"
      aria-label={root.label}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      // The width guard is what keeps the panel inside the store container at
      // every viewport: the rail's own width plus 48px of breathing room,
      // capped at 920px — exactly four 200px columns plus gutters and padding.
      // Inside the cap the panel is only as wide as its columns, so a short
      // category never stretches its links apart.
      // Inline because the rail width is a merchant setting, so the cap has to
      // be computed rather than picked from Tailwind's scale.
      style={{ maxWidth: getMegaFlyoutMaxWidth(railWidth) }}
      className={cn(
        // self-stretch: the panel runs the rail's full height, so the two
        // cards read as one and no stub of rail shadow hangs below a short
        // panel. The wrapper stays items-start, so a panel TALLER than the
        // rail still doesn't drag the rail down into empty popover.
        "flex max-h-[min(74vh,580px)] min-w-0 flex-col self-stretch rounded-e-xl border border-s-0 border-border/60 bg-popover",
        "animate-in fade-in-0 duration-150 motion-reduce:animate-none",
        PANEL_SHADOW,
        // The flyout butts against the rail, and its blur reaches ~12px past
        // its own start edge — painted over the rail, which read as a grey
        // smear down the seam and made the panel look half-transparent.
        // Clipping at that edge keeps the lift on the three free sides and
        // lets the rail's own border draw the join. Mirrored for RTL, where
        // the panel opens on the other side.
        "[clip-path:inset(-60px_-60px_-60px_0)] rtl:[clip-path:inset(-60px_0_-60px_-60px)]",
      )}
    >
      {/* Only the body scrolls, so the footer stays on the rail footer's line. */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="flex min-w-0 flex-1 flex-col">
          {/* pt-1 matches the rail list's p-1, so with h-9 headings each
              column's rule lands on the bottom edge of the rail's first row.
              The flat list has no headings and starts its first link level
              with the first rail row's label instead. */}
          <div
            className={cn(
              "grid min-w-0 gap-x-6 ps-6 pb-3",
              sidePromoImage ? "pe-3" : "pe-6",
              isFlat ? "gap-y-px pt-2" : "gap-y-4 pt-1",
            )}
            style={{
              gridTemplateColumns: `repeat(${columnCount}, minmax(0, 200px))`,
            }}
          >
            {isFlat
              ? loose.map((item) => (
                  <MegaMenuLeafLink
                    key={getHeaderMenuItemKey(item)}
                    item={item}
                    onNavigate={onNavigate}
                  />
                ))
              : (
                <>
                  {groups.map((group) => (
                    <MegaMenuColumn
                      key={getHeaderMenuItemKey(group)}
                      group={group}
                      linkLimit={linkLimit}
                      isTall={isTall}
                      viewAllShortLabel={viewAllShortLabel}
                      onNavigate={onNavigate}
                    />
                  ))}
                  {loose.length > 0 ? (
                    <div className="flex min-w-0 flex-col gap-px pt-1">
                      {loose.map((item) => (
                        <MegaMenuLeafLink
                          key={getHeaderMenuItemKey(item)}
                          item={item}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </div>
                  ) : null}
                </>
              )}
          </div>

          {/* Pinned to the bottom of the body, with the same 24px gutter as
              the columns so each card spans exactly two of them. */}
          {cards.length > 0 ? (
            <div
              className="mt-auto grid gap-x-6 px-6 pb-6"
              style={{
                gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))`,
              }}
            >
              {cards.map((card, index) => (
                <Link
                  key={`${index}-${card.image}`}
                  href={card.href}
                  target={card.target}
                  rel={card.target === "_blank" ? "noopener noreferrer" : undefined}
                  onClick={onNavigate}
                  className="group relative block aspect-[1296/366] overflow-hidden rounded-xl border border-border/60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
                >
                  {/* The frame keeps the studio's 1296 × 366 ratio at any
                      width, so a studio-authored card covers it exactly;
                      cover only matters for art uploaded by hand, which it
                      trims rather than stretches. */}
                  <AppImage
                    src={card.image}
                    width={864}
                    height={244}
                    alt={card.label}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        {/* The banner runs the body's full height: never under 262px, and at
            most 376px beside the tallest rail. No divider and no shadow of its
            own — the card's hairline is enough inside an already lifted panel. */}
        {sidePromoImage ? (
          <div className="flex w-[210px] shrink-0 p-3">
            <Link
              href={root.href}
              target={root.target}
              rel={root.target === "_blank" ? "noopener noreferrer" : undefined}
              onClick={onNavigate}
              className="group relative block min-h-[262px] flex-1 overflow-hidden rounded-xl border border-border/60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
            >
              {/* Absolutely placed, so the art can only ever fill the frame the
                  body sized — left in flow, a portrait taller than the columns
                  pushes the whole flyout down to its own aspect.

                  object-cover, not fill: this frame's height follows the rail,
                  so its ratio moves between stores and stretching art authored
                  at 3:5 would distort baked-in type. Covering trims instead —
                  at most 9% off one pair of edges, which the studio prompt
                  asks authors to keep quiet. */}
              <AppImage
                src={sidePromoImage}
                width={480}
                height={800}
                alt={root.label}
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
              />
            </Link>
          </div>
        ) : null}
      </div>

      {/* Same h-10 as the rail's footer, so one rule runs across both cards. */}
      <div className="flex h-10 shrink-0 items-center border-t border-border/60 px-6">
        <MegaMenuMoreLink
          href={root.href}
          target={root.target}
          onClick={onNavigate}
        >
          {shopAllLabel(root.label)}
        </MegaMenuMoreLink>
      </div>
    </div>
  );
}

function MegaMenuColumn({
  group,
  linkLimit,
  isTall,
  viewAllShortLabel,
  onNavigate,
}: {
  group: HeaderMenuItem;
  linkLimit: number;
  isTall: boolean;
  viewAllShortLabel: string;
  onNavigate: () => void;
}) {
  const children = getVisibleMegaChildren(group);
  const visibleChildren = children.slice(
    0,
    getMegaVisibleLinkCount(children.length, linkLimit, isTall),
  );
  const hiddenCount = children.length - visibleChildren.length;

  return (
    <div className="flex min-w-0 flex-col">
      <Link
        href={group.href}
        target={group.target}
        rel={group.target === "_blank" ? "noopener noreferrer" : undefined}
        onClick={onNavigate}
        className={cn(
          "mb-1.5 flex h-9 min-w-0 items-center border-b border-border",
          "text-[12.5px] font-semibold uppercase tracking-[0.07em] text-foreground transition-colors hover:text-store-link",
          "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
        )}
      >
        <span className="min-w-0 truncate">
          {group.columnTitle || group.label}
        </span>
      </Link>
      <div className="flex min-w-0 flex-col gap-px">
        {visibleChildren.map((child) => (
          <MegaMenuLeafLink
            key={getHeaderMenuItemKey(child)}
            item={child}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      {hiddenCount > 0 ? (
        <MegaMenuMoreLink
          href={group.href}
          onClick={onNavigate}
          className="mt-1"
        >
          {viewAllShortLabel} ({children.length})
        </MegaMenuMoreLink>
      ) : null}
    </div>
  );
}

/**
 * Every "see more" link in the panel — the rail's View All Categories, a
 * column's View all, the flyout's Shop All — wears this one style, so none of
 * them reads as a different kind of thing.
 */
function MegaMenuMoreLink({
  href,
  target,
  className,
  children,
  onClick,
  onMouseEnter,
  onFocus,
}: {
  href: string;
  target?: HeaderMenuItem["target"];
  className?: string;
  children: ReactNode;
  onClick: () => void;
  onMouseEnter?: () => void;
  onFocus?: () => void;
}) {
  return (
    <Link
      href={href}
      target={target}
      rel={target === "_blank" ? "noopener noreferrer" : undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      className={cn(
        "group/more inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm text-[13px] font-medium leading-5 text-store-link transition-colors hover:text-store-link/80",
        "focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
        className,
      )}
    >
      <span className="min-w-0 truncate">{children}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover/more:translate-x-0.5 rtl:rotate-180" />
    </Link>
  );
}

function MegaMenuLeafLink({
  item,
  onNavigate,
}: {
  item: HeaderMenuItem;
  onNavigate: () => void;
}) {
  // 26px tall (py-[3px] + leading-5): MEGA_LINK_ROW_HEIGHT in
  // lib/site-config/menu-depth.ts counts on it.
  return (
    <Link
      href={item.href}
      target={item.target}
      rel={item.target === "_blank" ? "noopener noreferrer" : undefined}
      onClick={onNavigate}
      className="inline-flex min-w-0 max-w-full items-center gap-[7px] rounded-sm py-[3px] text-[13.5px] leading-5 text-foreground/75 transition-colors hover:text-store-link focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2"
    >
      <span className="min-w-0 truncate">{item.label}</span>
      {item.badge ? (
        // Micro-tag in the theme's promotional ACCENT — one of the two places
        // the accent is meant for (with the Featured label), so "New" or
        // "Sale" beside a link reads as a promotion, not as a link state.
        <span className="shrink-0 rounded-md bg-highlight px-[5px] py-px text-[9.5px] font-semibold uppercase tracking-[0.04em] text-highlight-foreground">
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}
