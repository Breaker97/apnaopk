"use client";

import { type CSSProperties, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ChevronDown,
  ChevronRight,
  Footprints,
  Gem,
  MapPin,
  Menu,
  Search,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sofa,
  Store,
  User,
  type LucideIcon,
} from "lucide-react";
import { LinkGlyphIcon } from "@/lib/site-config/header-link-glyphs";
import { CategoryTriggerGlyph } from "@/lib/site-config/header-trigger-style";
import { AppImage } from "@/components/ui/app-image";
import { FlagIcon } from "@/components/ui/flag-icon";
import { localeConfig, type Locale } from "@/config/i18n.config";
import { useCurrency } from "@/providers/currency-provider";
import {
  backgroundAccentColor,
  backgroundCss,
  hasBackground,
} from "@/lib/sliders/types";
import {
  announcementBarCss,
  announcementTextCss,
} from "@/lib/site-config/announcement-style";
import {
  headerLocationSlot,
  linkGlyph,
  visibleColumns,
  type HeaderCategoriesItem,
  type HeaderIconsItem,
  type HeaderLayout,
  type HeaderLayoutItem,
  type HeaderLayoutRow,
  type HeaderLocationItem,
} from "@/lib/site-config/header-layout";
import type { AnnouncementDraft } from "@/components/admin/online-store/header-chrome-state";
import {
  HEADER_ICON_META,
  alignItemsValue,
  columnStyle,
  fillColorCss,
  fillTextCss,
  navJustifyContent,
  paddingStyle,
  rowStyle,
  surfaceInkCss,
  surfaceTone,
  textStyleCss,
  type SurfaceTone,
} from "@/components/admin/online-store/header-studio/layout-style";
import { cn } from "@/lib/utils";

export interface PreviewBrand {
  storeName: string;
  logoUrl: string;
  darkLogoUrl: string;
}

/**
 * What the category panel lists in the preview. The real panel is the
 * store's mega menu, built from the catalogue; the studio has no need of
 * the catalogue to show a merchant how their panel will be painted, so it
 * shows a shop's worth of typical departments instead.
 */
const SAMPLE_CATEGORIES: { label: string; icon: LucideIcon }[] = [
  { label: "Electronics", icon: Smartphone },
  { label: "Fashion", icon: ShoppingBag },
  { label: "Furniture", icon: Sofa },
  { label: "Shoe", icon: Footprints },
  { label: "Jewelry & Accessories", icon: Gem },
  { label: "Food & Grocery", icon: ShoppingBasket },
];

/** Room the preview keeps under the rows for a panel pinned open. */
const OPEN_PANEL_HEIGHT = 330;

function hasOpenPanel(layout: HeaderLayout): boolean {
  return layout.rows.some((row) =>
    row.columns.some((column) =>
      column.items.some(
        (item) => item.type === "categories" && item.openOn === "always",
      ),
    ),
  );
}

interface HeaderStudioPreviewProps {
  layout: HeaderLayout;
  brand: PreviewBrand;
  /** The pinned chrome row, edited from the studio canvas. */
  announcement?: AnnouncementDraft | null;
  /**
   * Whether the storefront hangs its "Deliver to" control on this layout.
   * Not an item the merchant places: the preview attaches it to the same
   * item the storefront does, so the switch is seen to change the header.
   */
  showLocation?: boolean;
  className?: string;
}

/**
 * The header as the layout tree describes it — the Figma "Header Preview"
 * card. Static markup: nothing here is clickable, because the preview's job
 * is to show the merchant what the storefront will paint, and a preview that
 * navigates away from the studio is a trap.
 */
export function HeaderStudioPreview({
  layout,
  brand,
  announcement,
  showLocation = false,
  className,
}: HeaderStudioPreviewProps) {
  const showAnnouncement = Boolean(announcement?.enabled && announcement.text);
  // The preview has no store settings; search is shown as on, which is the
  // storefront's default and the case the slot rule cares about. A placed
  // Location item draws itself, so no host is decorated then.
  const slot = showLocation
    ? headerLocationSlot(layout, { showSearch: true })
    : null;
  const locationItemId = slot && slot.type !== "location" ? slot.itemId : null;
  const announcementPainted = Boolean(
    announcement && hasBackground(announcement.background),
  );
  // A panel pinned open hangs below the header over the page. The preview
  // has no page, so it keeps the room the panel needs; otherwise the card
  // would clip it at the header's own edge.
  const openPanel = hasOpenPanel(layout);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[12px] border bg-white text-[#111827] shadow-sm dark:bg-neutral-950 dark:text-neutral-100",
        className,
      )}
      style={openPanel ? { paddingBottom: OPEN_PANEL_HEIGHT } : undefined}
    >
      {showAnnouncement && announcement ? (
        <div
          className={cn(
            "px-4 py-2",
            announcementPainted
              ? undefined
              : "bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 text-white",
          )}
          style={{
            ...backgroundCss(announcement.background),
            ...announcementBarCss(announcement.style),
          }}
        >
          <span style={announcementTextCss(announcement.style)}>
            {announcement.text}
          </span>
        </div>
      ) : null}

      {layout.rows.map((row) => (
        <PreviewRow
          key={row.id}
          row={row}
          brand={brand}
          locationItemId={locationItemId}
        />
      ))}
    </div>
  );
}

function PreviewRow({
  row,
  brand,
  locationItemId,
}: {
  row: HeaderLayoutRow;
  brand: PreviewBrand;
  /** The item the "Deliver to" control leads, if any. */
  locationItemId: string | null;
}) {
  const rowTone = surfaceTone(row.background);
  return (
    <div className="relative px-4 py-2" style={rowStyle(row)}>
      {visibleColumns(row).map((column) => (
        <div key={column.id} style={columnStyle(column, row)}>
          {column.items.map((item) => (
            <PreviewItem
              key={item.id}
              item={item}
              brand={brand}
              rowTone={rowTone}
              // Hosted, not placed beside: the storefront hangs the control
              // INSIDE its host, so the gap between the two is the host's.
              location={item.id === locationItemId ? <PreviewLocation /> : null}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * The storefront's "Deliver to" block, as the header row's own ink. With an
 * item it wears that item's size, caption and fill; without one it is the
 * default the storefront attaches beside the search.
 */
function PreviewLocation({
  item,
}: {
  item?: HeaderLocationItem;
}) {
  const t = useTranslations();
  const size = item?.size ?? 18;
  // The LocationPicker's "header" face, to the class — its own inset
  // included, which is the room between the pin and whatever it sits beside.
  const control = (
    <span className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-left leading-tight text-current">
      <MapPin className="shrink-0" style={{ width: size, height: size }} />
      <span className="flex min-w-0 flex-col">
        {item && !item.showCaption ? null : (
          <span className="text-[11px] opacity-70">
            {item?.caption || t("location.deliverTo")}
          </span>
        )}
        <span className="max-w-[10rem] truncate text-[13px] font-semibold">
          {t("location.setLocation")}
        </span>
      </span>
    </span>
  );
  // A placed item wears its own padding and fill around that face; a hosted
  // control is the bare face, exactly as its host hangs it.
  return item ? (
    <span
      className="flex shrink-0 items-center"
      style={{ ...paddingStyle(item.padding), ...fillColorCss(item.foreground) }}
    >
      {control}
    </span>
  ) : (
    control
  );
}

function PreviewItem({
  item,
  brand,
  rowTone,
  location,
}: {
  item: HeaderLayoutItem;
  brand: PreviewBrand;
  /** The row's own paint, when it has one — what an "auto" logo reads. */
  rowTone: SurfaceTone | null;
  /** The "Deliver to" control, when this item is the one that carries it. */
  location: ReactNode;
}) {
  const t = useTranslations();
  const pad = paddingStyle(item.padding);

  switch (item.type) {
    case "brand": {
      // The preview is drawn light, so "auto" is the primary logo unless
      // the row's own paint is dark — the reading the storefront takes.
      const wantsDark =
        item.theme === "dark" || (item.theme === "auto" && rowTone === "dark");
      const logo =
        wantsDark && brand.darkLogoUrl ? brand.darkLogoUrl : brand.logoUrl;
      return (
        <div className="flex shrink-0 items-center gap-2" style={pad}>
          {logo ? (
            // Sized by WIDTH, the axis the studio's Size field sets; the
            // height follows the artwork's own proportions.
            <span className="relative block" style={{ width: item.size }}>
              <AppImage
                src={logo}
                alt={brand.storeName || "Logo"}
                width={Math.round(item.size)}
                height={Math.round(item.size / 4)}
                className="h-auto w-full object-contain object-left"
                fallback={<PreviewBrandName name={brand.storeName} />}
              />
            </span>
          ) : (
            <PreviewBrandName name={brand.storeName} />
          )}
        </div>
      );
    }

    case "nav": {
      const style: CSSProperties = {
        ...pad,
        display: "flex",
        flex: 1,
        minWidth: 0,
        gap: item.gap,
        justifyContent: navJustifyContent(item),
        alignItems: alignItemsValue(item.align.vertical),
        ...backgroundCss(item.background),
        ...surfaceInkCss(item.background, item.textStyle.fill),
        ...textStyleCss(item.textStyle),
      };
      const linkFill = fillTextCss(item.textStyle.fill);
      return (
        <div style={style}>
          {item.links.length ? (
            item.links.map((link) => (
              <span
                key={link.id}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap",
                  // A plain link rests at 90%; a dropdown trigger does not.
                  link.children.length ? undefined : "opacity-90",
                )}
                style={linkFill}
              >
                <LinkIcon icon={link.icon} />
                {link.label || "Link"}
                {link.children.length ? (
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                ) : null}
              </span>
            ))
          ) : (
            <span className="text-xs italic text-muted-foreground">
              No links yet
            </span>
          )}
        </div>
      );
    }

    case "searchBar": {
      const bar = (
        <div className="relative min-w-0 flex-1" style={pad}>
          <div
            className="flex items-center gap-2 pl-4 pr-1.5"
            style={{
              height: item.height,
              borderRadius: item.roundness,
              borderWidth: item.borderThickness,
              borderStyle: "solid",
              borderColor: item.border || "transparent",
              ...backgroundCss(item.background),
              ...surfaceInkCss(item.background, item.foreground),
            }}
          >
            {/* `text-start` because the storefront's field is an <input>,
                which does not take the column's text-align — a span does,
                and a centred placeholder is not what the shopper sees. */}
            <span
              className="min-w-0 flex-1 truncate text-start"
              style={{
                ...textStyleCss(item.textStyle),
                ...fillTextCss(item.textStyle.fill),
              }}
            >
              {item.placeholder || t("common.searchPlaceholder")}
            </span>
            {item.showCategoryFilter ? (
              <span className="relative flex shrink-0 items-center border-l border-current/20 pl-2 opacity-80">
                <span className="max-w-32 truncate pr-5 text-xs font-medium">
                  {t.has("common.allCategories")
                    ? t("common.allCategories")
                    : "All"}
                </span>
                <ChevronDown className="absolute right-0 h-3 w-3" />
              </span>
            ) : null}
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full">
              <Search className="h-4 w-4" />
            </span>
          </div>
        </div>
      );
      // "Deliver to" leads the bar, the way every marketplace with a search
      // bar places it. Only wrapped when it is actually there, so a plain
      // bar keeps the exact box it had.
      return location ? (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {location}
          {bar}
        </div>
      ) : (
        bar
      );
    }

    case "categories":
      return <PreviewCategories item={item} />;

    case "collections":
      // The panel is catalogue-driven, so the studio shows the TRIGGER only —
      // a preview of invented collections would teach the wrong shape.
      return (
        <span
          className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"
          style={{ ...pad, ...textStyleCss(item.textStyle) }}
        >
          {item.label || t("nav.collections")}
          {item.showChevron ? (
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          ) : null}
        </span>
      );

    case "searchIcon": {
      const pill = item.style === "pill";
      const button = (
        <span
          className="grid shrink-0 place-items-center"
          style={{
            borderRadius: item.roundness,
            padding: pill ? "8px 14px" : 8,
            ...backgroundCss(item.background),
            ...surfaceInkCss(item.background, item.foreground),
          }}
        >
          <Search style={{ width: item.size, height: item.size }} />
        </span>
      );
      const control = (
        <span className="relative shrink-0" style={pad}>
          {pill ? (
            // The capsule: an outlined, input-shaped plate with the button
            // flush to its end — a search bar's shape at a fraction of the
            // width. The room on the left is the field that opens there.
            <span
              className="flex items-center justify-end gap-1 p-1 pl-3"
              style={{
                width: item.width,
                borderRadius: item.pillRoundness,
                borderWidth: item.borderThickness,
                borderStyle: "solid",
                borderColor: item.border || "transparent",
                ...backgroundCss(item.pillBackground),
                ...surfaceInkCss(item.pillBackground),
              }}
            >
              {button}
            </span>
          ) : (
            button
          )}
        </span>
      );
      // A header with no search bar hangs "Deliver to" beside the compact
      // search instead.
      return location ? (
        <div className="flex shrink-0 items-center gap-3">
          {location}
          {control}
        </div>
      ) : (
        control
      );
    }

    case "location":
      return <PreviewLocation item={item} />;

    case "menuButton":
      return (
        <span
          className="flex shrink-0 items-center gap-2"
          style={{
            ...pad,
            borderRadius: item.roundness,
            ...(hasBackground(item.background) ? { padding: 8 } : {}),
            ...backgroundCss(item.background),
            ...surfaceInkCss(item.background, item.foreground),
          }}
        >
          <Menu style={{ width: item.size, height: item.size }} />
          {item.showLabel ? (
            <span className="text-sm font-semibold">{item.label}</span>
          ) : null}
        </span>
      );

    case "buttons":
      return (
        <div className="flex shrink-0 items-center" style={{ ...pad, gap: item.gap }}>
          {item.buttons.map((button) => (
            <span
              key={button.id}
              className={cn(
                "inline-flex items-center whitespace-nowrap px-4 py-2",
                item.variant === "outline" && "border",
                item.variant === "ghost" && "opacity-80",
              )}
              style={{
                ...textStyleCss(item.textStyle),
                borderRadius: item.roundness,
                ...(item.variant === "solid"
                  ? hasBackground(item.background)
                    ? backgroundCss(item.background)
                    : {
                        background: "var(--primary)",
                        color: "var(--primary-foreground)",
                      }
                  : {}),
                borderColor:
                  item.variant === "outline"
                    ? backgroundAccentColor(item.background) || "currentColor"
                    : undefined,
                // A solid button reads in the ink its plate calls for until
                // the merchant says otherwise; the label carries any fill of
                // its own.
                ...(item.variant === "solid" && !hasBackground(item.textStyle.fill)
                  ? surfaceInkCss(item.background)
                  : {}),
              }}
            >
              <span style={fillTextCss(item.textStyle.fill)}>
                {button.label || "Button"}
              </span>
            </span>
          ))}
        </div>
      );

    case "text":
      return (
        <span
          className="min-w-0 truncate"
          style={{
            ...pad,
            ...backgroundCss(item.background),
            ...surfaceInkCss(item.background, item.textStyle.fill),
          }}
        >
          <span
            style={{
              ...textStyleCss(item.textStyle),
              ...fillTextCss(item.textStyle.fill),
            }}
          >
            {item.content}
          </span>
        </span>
      );

    case "icons":
      return <PreviewIcons item={item} pad={pad} location={location} />;

    case "user":
      return (
        <span
          className="flex shrink-0 items-center gap-2 text-left leading-none"
          style={{ ...pad, ...fillColorCss(item.foreground) }}
        >
          <User style={{ width: item.size, height: item.size }} />
          {item.showLabel ? (
            // `whitespace-nowrap` is load-bearing: the row's tracks floor at
            // their content, so a label that can wrap tells the grid this
            // column needs less than it does — and the cluster, which never
            // shrinks, then overhangs the search bar to its left.
            <span className="flex flex-col gap-[3px]">
              <span className="text-[11px] font-medium opacity-60">
                {item.greeting || t("common.welcome")}
              </span>
              <span className="inline-flex items-center gap-0.5 whitespace-nowrap text-[12px] font-semibold leading-none tracking-normal">
                {item.label ? (
                  <span className="leading-none">{item.label}</span>
                ) : (
                  <>
                    <span className="leading-none">{t("common.login")} /</span>
                    <span className="leading-none opacity-80">
                      {t("common.register")}
                    </span>
                  </>
                )}
                <ChevronDown className="h-3.5 w-3.5 opacity-55" />
              </span>
            </span>
          ) : null}
        </span>
      );
  }
}

/**
 * The All Categories button, and — when it is set to stay open — the panel
 * beneath it. The panel hangs off the button's own box so the two line up
 * as one card, the way the storefront's rail does; the row is positioned
 * so a panel wider than its button still starts at the button's edge.
 */
function PreviewCategories({ item }: { item: HeaderCategoriesItem }) {
  const t = useTranslations();
  // The glyphs take the item's foreground, else the label's fill, else the
  // ink the button's own plate calls for — the storefront's reading. Set on
  // the button, so both glyphs read it the way the storefront's do.
  const glyphFill = surfaceInkCss(
    item.background,
    hasBackground(item.foreground) ? item.foreground : item.textStyle.fill,
  );
  const panelText = hasBackground(item.panel.foreground)
    ? fillColorCss(item.panel.foreground)
    : hasBackground(item.textStyle.fill)
      ? fillTextCss(item.textStyle.fill)
      : surfaceInkCss(item.panel.background);
  const open = item.openOn === "always";

  return (
    // No width set means the button takes whatever its column has: the
    // sidebar designs give it a column of its own and want it filled.
    <div className={cn("relative", item.width ? "shrink-0" : "min-w-0 flex-1")}>
      <span
        className={cn(
          "flex items-center gap-3 px-5 text-left",
          item.width ? "shrink-0" : "w-full",
        )}
        style={{
          // The item's padding is the room AROUND the button; the button's
          // own inset stays, so the glyph never sits on the edge of its plate.
          margin: `${item.padding.top}px ${item.padding.right}px ${item.padding.bottom}px ${item.padding.left}px`,
          width: item.width || undefined,
          height: item.height || 40,
          borderRadius: open
            ? `${item.roundness}px ${item.roundness}px 0 0`
            : item.roundness,
          borderWidth: item.borderThickness,
          borderStyle: "solid",
          borderColor: item.border || "transparent",
          ...backgroundCss(item.background),
          ...textStyleCss(item.textStyle),
          ...glyphFill,
        }}
      >
        {item.showIcon ? (
          <CategoryTriggerGlyph icon={item.icon} className="h-4 w-4 shrink-0" />
        ) : null}
        <span
          className="min-w-0 flex-1 truncate"
          style={fillTextCss(item.textStyle.fill)}
        >
          {item.label || t("common.allCategories")}
        </span>
        {item.showChevron ? <ChevronDown className="h-4 w-4 shrink-0" /> : null}
      </span>

      {open ? (
        <div
          className="absolute start-0 top-full z-10 space-y-1 p-3 shadow-[0_18px_30px_-12px_rgba(0,0,0,0.25)]"
          style={{
            width: item.panel.width || "100%",
            minWidth: 200,
            borderRadius: `0 0 ${item.roundness}px ${item.roundness}px`,
            ...backgroundCss(item.panel.background),
            ...panelText,
          }}
        >
          {SAMPLE_CATEGORIES.map((category, index) => {
            const CategoryIcon = category.icon;
            return (
              <div
                key={category.label}
                className="flex items-center gap-3 px-4 py-2.5 text-[13px]"
                style={{
                  borderRadius: item.panel.itemRoundness,
                  ...(index === 0 ? backgroundCss(item.panel.highlight) : {}),
                }}
              >
                {item.panel.showIcons ? (
                  <CategoryIcon className="h-4 w-4 shrink-0 opacity-90" />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{category.label}</span>
                {index === 0 ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The utility cluster: each key drawn the way the storefront draws it —
 * the language flag and the currency code included, which are text rather
 * than glyphs and would otherwise preview as a globe and a dollar sign.
 */
function PreviewIcons({
  item,
  pad,
  location,
}: {
  item: HeaderIconsItem;
  pad: CSSProperties;
  location: ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const { currency } = useCurrency();
  const size = { width: item.size, height: item.size };
  const shell = cn(
    "relative flex shrink-0 items-center",
    item.showLabels ? "flex-col gap-1" : "",
  );

  return (
    <div
      className="flex shrink-0 items-center"
      style={{ ...pad, gap: item.gap, ...fillColorCss(item.foreground) }}
    >
      {/* The last resort for a design with no search at all: the control
          leads the utility cluster, in the cluster's own ink. */}
      {location}
      {item.keys.map((key) => {
        if (key === "language") {
          return (
            <span
              key={key}
              className={cn(shell, "gap-2 text-left leading-none")}
            >
              <FlagIcon
                countryCode={localeConfig[locale].countryCode}
                size={item.size}
                aria-hidden="true"
              />
              <span className="text-[12px] font-medium">
                {locale.toUpperCase()}
              </span>
            </span>
          );
        }
        if (key === "currency") {
          return (
            <span
              key={key}
              className="shrink-0 text-[12px] font-medium leading-none tracking-normal"
            >
              {currency.code}
            </span>
          );
        }
        const meta = HEADER_ICON_META[key];
        const Icon = meta.icon;
        return (
          <span key={key} className={shell}>
            <Icon style={size} />
            {item.showLabels ? (
              <span className="text-[10px] font-medium leading-none">
                {t.has(meta.labelKey) ? t(meta.labelKey) : meta.label}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/** The storefront's logo-less brand: the shop glyph and the store's name. */
function PreviewBrandName({ name }: { name: string }) {
  return (
    <>
      <Store className="h-6 w-6 text-primary" />
      <span className="truncate text-xl font-bold">{name || "Your store"}</span>
    </>
  );
}

/** A link's leading icon: a built-in glyph, an uploaded image, or nothing. */
function LinkIcon({ icon }: { icon: string }) {
  if (!icon) return null;
  if (linkGlyph(icon)) {
    return <LinkGlyphIcon icon={icon} className="h-4 w-4 shrink-0 opacity-80" />;
  }
  return (
    <AppImage
      src={icon}
      alt=""
      width={16}
      height={16}
      className="h-4 w-4 shrink-0 object-contain"
    />
  );
}
