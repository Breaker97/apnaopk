"use client";

import { Link as LinkIcon, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { AnnouncementDraft } from "@/components/admin/online-store/header-chrome-state";
import { BackgroundSwatchField } from "@/components/admin/sliders/background-swatch";
import {
  HEADER_BRAND_THEMES,
  HEADER_BUTTON_VARIANTS,
  HEADER_CATEGORIES_ICONS,
  HEADER_CATEGORIES_OPEN_MODES,
  HEADER_COLUMN_COUNTS,
  HEADER_ICON_KEYS,
  HEADER_JUSTIFY_VALUES,
  HEADER_SEARCH_ICON_STYLES,
  MAX_HEADER_BUTTONS,
  type HeaderBackground,
  MIN_HEADER_ROW_GAP,
  type HeaderBrandItem,
  type HeaderButtonsItem,
  type HeaderCategoriesItem,
  type HeaderCategoriesPanel,
  type HeaderColumnCount,
  type HeaderCollectionsItem,
  type HeaderIconKey,
  type HeaderIconsItem,
  type HeaderJustify,
  type HeaderLayoutColumn,
  type HeaderLayoutItem,
  type HeaderLayoutRow,
  type HeaderLocationItem,
  type HeaderMenuButtonItem,
  type HeaderNavItem,
  type HeaderSearchBarItem,
  type HeaderSearchIconItem,
  type HeaderTextItem,
  type HeaderUserItem,
} from "@/lib/site-config/header-layout";
import {
  AlignmentField,
  ColorField,
  FillField,
  PaddingField,
  PanelRow,
  SelectField,
  TextStyleField,
  ToggleField,
  UnitField,
} from "@/components/admin/online-store/header-studio/controls";
import {
  HEADER_ICON_META,
  itemMeta,
} from "@/components/admin/online-store/header-studio/layout-style";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";

/**
 * The Figma "Properties:" card. One panel per selected thing — row, column,
 * or an item — because the controls a merchant needs for a search bar have
 * nothing in common with the ones a row needs, and a single merged panel
 * would show mostly disabled fields.
 */

/**
 * "announcement" is the chrome row pinned above the layout rows. It is a
 * section instance on the header group document rather than a node of the
 * layout tree, so it carries no id.
 */
export type StudioSelection =
  | { kind: "row"; rowId: string }
  | { kind: "column"; rowId: string; columnId: string }
  | { kind: "item"; itemId: string }
  | { kind: "announcement" }
  | null;

interface PropertyPanelProps {
  tSafe: TSafe;
  selection: StudioSelection;
  row: HeaderLayoutRow | null;
  column: HeaderLayoutColumn | null;
  item: HeaderLayoutItem | null;
  announcement: AnnouncementDraft;
  onPatchRow: (rowId: string, patch: Partial<HeaderLayoutRow>) => void;
  onPatchColumn: (
    columnId: string,
    patch: Partial<HeaderLayoutColumn>,
  ) => void;
  onPatchItem: (itemId: string, patch: Partial<HeaderLayoutItem>) => void;
  onRemoveRow: (rowId: string) => void;
  onRemoveItem: (itemId: string) => void;
  onEditLinks: (itemId: string) => void;
  onPatchAnnouncement: (patch: Partial<AnnouncementDraft>) => void;
}

export function PropertyPanel({
  tSafe,
  selection,
  row,
  column,
  item,
  announcement,
  onPatchRow,
  onPatchColumn,
  onPatchItem,
  onRemoveRow,
  onRemoveItem,
  onEditLinks,
  onPatchAnnouncement,
}: PropertyPanelProps) {
  const title = () => {
    if (selection?.kind === "item" && item) {
      const meta = itemMeta(item.type);
      return tSafe(`admin.headerStudio.items.${item.type}`, meta.label);
    }
    if (selection?.kind === "announcement") {
      return tSafe("admin.headerStudio.chrome.announcement", "Announcement bar");
    }
    if (selection?.kind === "column") {
      return tSafe("admin.headerStudio.panel.column", "Column");
    }
    if (selection?.kind === "row") {
      return tSafe("admin.headerStudio.panel.row", "Row");
    }
    return tSafe("admin.headerStudio.panel.nothing", "Nothing selected");
  };

  return (
    <div className="rounded-[12px] border bg-card shadow-xs">
      <p className="border-b bg-muted/40 px-4 py-3 text-sm">
        <span className="font-semibold">
          {tSafe("admin.headerStudio.panel.title", "Properties:")}
        </span>{" "}
        <span className="text-muted-foreground">{title()}</span>
      </p>
      <div className="p-4">

      {selection === null ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {tSafe(
            "admin.headerStudio.panel.empty",
            "Select a row, a column or an item to edit its properties.",
          )}
        </p>
      ) : null}

      {selection?.kind === "row" && row ? (
        <RowProperties
          tSafe={tSafe}
          row={row}
          onPatch={(patch) => onPatchRow(row.id, patch)}
          onRemove={() => onRemoveRow(row.id)}
        />
      ) : null}

      {selection?.kind === "column" && column ? (
        <ColumnProperties
          tSafe={tSafe}
          column={column}
          onPatch={(patch) => onPatchColumn(column.id, patch)}
        />
      ) : null}

      {selection?.kind === "item" && item ? (
        <ItemProperties
          tSafe={tSafe}
          item={item}
          onPatch={(patch) => onPatchItem(item.id, patch)}
          onRemove={() => onRemoveItem(item.id)}
          onEditLinks={() => onEditLinks(item.id)}
        />
      ) : null}

      {selection?.kind === "announcement" ? (
        <AnnouncementProperties
          tSafe={tSafe}
          draft={announcement}
          onPatch={onPatchAnnouncement}
        />
      ) : null}

      </div>
    </div>
  );
}

/**
 * The announcement bar's settings. "" for a colour means the theme's
 * primary scheme, which is what the storefront paints when nothing is set —
 * so the swatch's "inherit" reads the same as it does on a row.
 */
function AnnouncementProperties({
  tSafe,
  draft,
  onPatch,
}: {
  tSafe: TSafe;
  draft: AnnouncementDraft;
  onPatch: (patch: Partial<AnnouncementDraft>) => void;
}) {
  const labels = commonLabels(tSafe);
  const textLabel = tSafe("admin.headerStudio.chrome.text", "Text");
  const urlLabel = tSafe("admin.headerStudio.chrome.url", "Link");
  const patchStyle = (patch: Partial<AnnouncementDraft["style"]>) =>
    onPatch({ style: { ...draft.style, ...patch } });

  return (
    <div className="space-y-3">
      <ToggleField
        label={tSafe(
          "admin.headerStudio.chrome.showAnnouncement",
          "Show announcement bar",
        )}
        checked={draft.enabled}
        onChange={(enabled) => onPatch({ enabled })}
      />
      <PanelRow label={textLabel} align="start">
        <Input
          value={draft.text}
          placeholder={tSafe(
            "admin.headerStudio.chrome.textPlaceholder",
            "Free shipping on orders over $50",
          )}
          onChange={(event) => onPatch({ text: event.target.value })}
          className="h-8 text-xs"
          aria-label={textLabel}
        />
      </PanelRow>
      <PanelRow label={urlLabel} align="start">
        <Input
          value={draft.url}
          placeholder="/products"
          onChange={(event) => onPatch({ url: event.target.value })}
          className="h-8 text-xs"
          aria-label={urlLabel}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.height", "Height")}>
        <UnitField
          value={draft.style.height}
          unit="px"
          max={200}
          ariaLabel={tSafe("admin.headerStudio.panel.height", "Height")}
          onChange={(height) => patchStyle({ height })}
        />
      </PanelRow>
      <PanelRow
        label={tSafe("admin.headerStudio.panel.alignment", "Alignment")}
        align="start"
      >
        <AlignmentField
          value={draft.style.align}
          labels={labels.alignment}
          onChange={(align) => patchStyle({ align })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.background", "Background")}>
        <BackgroundSwatchField
          value={draft.background}
          label={tSafe("admin.headerStudio.panel.background", "Background")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(background) => onPatch({ background })}
        />
      </PanelRow>
      <PanelRow label={labels.textStyle.trigger}>
        <TextStyleField
          value={draft.style.textStyle}
          labels={labels.textStyle}
          tSafe={tSafe}
          onChange={(textStyle) => patchStyle({ textStyle })}
        />
      </PanelRow>
    </div>
  );
}

function commonLabels(tSafe: TSafe) {
  return {
    alignment: {
      horizontal: tSafe(
        "admin.headerStudio.panel.alignHorizontal",
        "Horizontal alignment",
      ),
      vertical: tSafe(
        "admin.headerStudio.panel.alignVertical",
        "Vertical alignment",
      ),
    },
    padding: {
      top: tSafe("admin.headerStudio.panel.paddingTop", "Padding top"),
      right: tSafe("admin.headerStudio.panel.paddingRight", "Padding right"),
      bottom: tSafe("admin.headerStudio.panel.paddingBottom", "Padding bottom"),
      left: tSafe("admin.headerStudio.panel.paddingLeft", "Padding left"),
    },
    inherit: tSafe("admin.headerStudio.panel.inherit", "Inherit"),
    clearColor: tSafe("admin.headerStudio.panel.clearColor", "Reset to inherit"),
    textStyle: {
      trigger: tSafe("admin.headerStudio.panel.textStyle", "Text style"),
      size: tSafe("admin.headerStudio.panel.fontSize", "Size"),
      weight: tSafe("admin.headerStudio.panel.fontWeight", "Weight"),
      weights: {
        300: tSafe("admin.headerStudio.panel.weight.300", "Light"),
        400: tSafe("admin.headerStudio.panel.weight.400", "Normal"),
        500: tSafe("admin.headerStudio.panel.weight.500", "Medium"),
        600: tSafe("admin.headerStudio.panel.weight.600", "Semibold"),
        700: tSafe("admin.headerStudio.panel.weight.700", "Bold"),
        800: tSafe("admin.headerStudio.panel.weight.800", "Extrabold"),
      },
      spacing: tSafe("admin.headerStudio.panel.letterSpacing", "Spacing"),
      transform: tSafe("admin.headerStudio.panel.transform", "Case"),
      transforms: {
        none: tSafe("admin.headerStudio.panel.transformNone", "As typed"),
        uppercase: tSafe(
          "admin.headerStudio.panel.transformUpper",
          "UPPERCASE",
        ),
        capitalize: tSafe(
          "admin.headerStudio.panel.transformCapital",
          "Capitalize",
        ),
      },
      slant: tSafe("admin.headerStudio.panel.slant", "Style"),
      normal: tSafe("admin.headerStudio.panel.slantNormal", "Normal"),
      italic: tSafe("admin.headerStudio.panel.italic", "Italic"),
      underline: tSafe("admin.headerStudio.panel.underline", "Underline"),
      color: tSafe("admin.headerStudio.panel.color", "Color"),
      clearColor: tSafe(
        "admin.headerStudio.panel.clearColor",
        "Reset to inherit",
      ),
    },
  };
}

function justifyOptions(tSafe: TSafe) {
  const labels: Record<HeaderJustify, string> = {
    start: tSafe("admin.headerStudio.justify.start", "Start"),
    center: tSafe("admin.headerStudio.justify.center", "Center"),
    end: tSafe("admin.headerStudio.justify.end", "End"),
    between: tSafe("admin.headerStudio.justify.between", "Space Between"),
    around: tSafe("admin.headerStudio.justify.around", "Space Around"),
    evenly: tSafe("admin.headerStudio.justify.evenly", "Space Evenly"),
  };
  return HEADER_JUSTIFY_VALUES.map((value) => ({
    value,
    label: labels[value],
  }));
}

function RowProperties({
  tSafe,
  row,
  onPatch,
  onRemove,
}: {
  tSafe: TSafe;
  row: HeaderLayoutRow;
  onPatch: (patch: Partial<HeaderLayoutRow>) => void;
  onRemove: () => void;
}) {
  const labels = commonLabels(tSafe);

  return (
    <div className="space-y-3">
      <PanelRow label={tSafe("admin.headerStudio.panel.columns", "Columns")}>
        <SelectField
          accent
          ariaLabel={tSafe("admin.headerStudio.panel.columns", "Columns")}
          value={String(row.columnCount)}
          options={HEADER_COLUMN_COUNTS.map((count) => ({
            value: String(count),
            label: tSafe(
              `admin.headerStudio.panel.columnCount.${count}`,
              `${count} Column`,
            ),
          }))}
          onChange={(value) =>
            onPatch({ columnCount: Number(value) as HeaderColumnCount })
          }
        />
      </PanelRow>

      <PanelRow
        label={tSafe("admin.headerStudio.panel.alignment", "Alignment")}
        align="start"
      >
        <AlignmentField
          value={row.align}
          labels={labels.alignment}
          onChange={(align) => onPatch({ align })}
        />
      </PanelRow>

      <PanelRow label={tSafe("admin.headerStudio.panel.height", "Height")}>
        <UnitField
          value={row.height}
          unit="px"
          max={400}
          ariaLabel={tSafe("admin.headerStudio.panel.height", "Height")}
          onChange={(height) => onPatch({ height })}
        />
      </PanelRow>

      <PanelRow
        label={tSafe("admin.headerStudio.panel.columnGap", "Column gap")}
      >
        <UnitField
          value={row.gap}
          unit="px"
          min={MIN_HEADER_ROW_GAP}
          max={120}
          ariaLabel={tSafe("admin.headerStudio.panel.columnGap", "Column gap")}
          onChange={(gap) => onPatch({ gap })}
        />
      </PanelRow>

      <PanelRow label={tSafe("admin.headerStudio.panel.background", "Background")}>
        <BackgroundSwatchField
          value={row.background}
          label={tSafe("admin.headerStudio.panel.background", "Background")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(background) => onPatch({ background })}
        />
      </PanelRow>

      <PanelRow label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}>
        <FillField
          value={row.foreground}
          label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => onPatch({ foreground })}
        />
      </PanelRow>

      {/* The rule under the row: the divider between it and the next, or
          the line under the header when it is the last. It sits with the
          row's paint because that is what it is — the row's bottom edge. */}
      <PanelRow
        label={tSafe("admin.headerStudio.panel.bottomBorder", "Bottom border")}
      >
        <UnitField
          value={row.borderBottom}
          unit="px"
          max={8}
          ariaLabel={tSafe("admin.headerStudio.panel.bottomBorder", "Bottom border")}
          onChange={(borderBottom) => onPatch({ borderBottom })}
        />
      </PanelRow>
      {row.borderBottom > 0 ? (
        <PanelRow
          label={tSafe("admin.headerStudio.panel.borderColor", "Border colour")}
        >
          <ColorField
            value={row.borderColor}
            label={tSafe("admin.headerStudio.panel.borderColor", "Border colour")}
            inheritLabel={labels.inherit}
            clearLabel={labels.clearColor}
            onChange={(borderColor) => onPatch({ borderColor })}
          />
        </PanelRow>
      ) : null}

      {/* Frosted glass: only visible through a translucent background, so
          it sits with the paint rather than in a section of its own. */}
      <PanelRow label={tSafe("admin.headerStudio.panel.blur", "Background blur")}>
        <UnitField
          value={row.blur}
          unit="px"
          max={40}
          ariaLabel={tSafe("admin.headerStudio.panel.blur", "Background blur")}
          onChange={(blur) => onPatch({ blur })}
        />
      </PanelRow>

      <ToggleField
        label={tSafe("admin.headerStudio.panel.hideOnScroll", "Hide on scroll")}
        checked={row.hideOnScroll}
        onChange={(hideOnScroll) => onPatch({ hideOnScroll })}
      />
      {row.hideOnScroll ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {tSafe(
            "admin.headerStudio.panel.hideOnScrollHint",
            "Tucks away as the page scrolls down. A top row returns at the top; a lower row returns as soon as the page scrolls up.",
          )}
        </p>
      ) : null}

      <Separator />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full text-xs text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {tSafe("admin.headerStudio.panel.removeRow", "Remove row")}
      </Button>
    </div>
  );
}

function ColumnProperties({
  tSafe,
  column,
  onPatch,
}: {
  tSafe: TSafe;
  column: HeaderLayoutColumn;
  onPatch: (patch: Partial<HeaderLayoutColumn>) => void;
}) {
  const labels = commonLabels(tSafe);

  return (
    <div className="space-y-3">
      <PanelRow label={tSafe("admin.headerStudio.panel.width", "Width")}>
        <UnitField
          value={column.width}
          unit="fr"
          min={0.25}
          max={12}
          step={0.25}
          ariaLabel={tSafe("admin.headerStudio.panel.width", "Width")}
          onChange={(width) => onPatch({ width })}
        />
      </PanelRow>

      <PanelRow label={tSafe("admin.headerStudio.panel.height", "Height")}>
        <UnitField
          value={column.height}
          unit="px"
          max={400}
          ariaLabel={tSafe("admin.headerStudio.panel.height", "Height")}
          onChange={(height) => onPatch({ height })}
        />
      </PanelRow>

      <PanelRow label={tSafe("admin.headerStudio.panel.justify", "Justify")}>
        <SelectField
          accent
          ariaLabel={tSafe("admin.headerStudio.panel.justify", "Justify")}
          value={column.justify}
          options={justifyOptions(tSafe)}
          onChange={(justify) => onPatch({ justify })}
        />
      </PanelRow>

      <PanelRow label={tSafe("admin.headerStudio.panel.gap", "Gap")}>
        <UnitField
          value={column.gap}
          unit="px"
          max={80}
          ariaLabel={tSafe("admin.headerStudio.panel.gap", "Gap")}
          onChange={(gap) => onPatch({ gap })}
        />
      </PanelRow>

      <PanelRow
        label={tSafe("admin.headerStudio.panel.alignment", "Alignment")}
        align="start"
      >
        <AlignmentField
          value={column.align}
          labels={labels.alignment}
          onChange={(align) => onPatch({ align })}
        />
      </PanelRow>
    </div>
  );
}

function ItemProperties({
  tSafe,
  item,
  onPatch,
  onRemove,
  onEditLinks,
}: {
  tSafe: TSafe;
  item: HeaderLayoutItem;
  onPatch: (patch: Partial<HeaderLayoutItem>) => void;
  onRemove: () => void;
  onEditLinks: () => void;
}) {
  const labels = commonLabels(tSafe);

  const paddingRow = (
    <PanelRow
      label={tSafe("admin.headerStudio.panel.padding", "Padding")}
      align="start"
    >
      <PaddingField
        value={item.padding}
        labels={labels.padding}
        onChange={(padding) => onPatch({ padding })}
      />
    </PanelRow>
  );

  return (
    <div className="space-y-3">
      {item.type === "brand" ? (
        <BrandFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderBrandItem>) => void}
        />
      ) : null}

      {item.type === "nav" ? (
        <NavFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderNavItem>) => void}
        />
      ) : null}

      {item.type === "categories" ? (
        <CategoriesFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderCategoriesItem>) => void}
        />
      ) : null}

      {item.type === "collections" ? (
        <CollectionsFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderCollectionsItem>) => void}
        />
      ) : null}

      {item.type === "menuButton" ? (
        <MenuButtonFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderMenuButtonItem>) => void}
        />
      ) : null}

      {item.type === "location" ? (
        <LocationFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderLocationItem>) => void}
        />
      ) : null}

      {item.type === "searchBar" ? (
        <SearchBarFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderSearchBarItem>) => void}
        />
      ) : null}

      {item.type === "searchIcon" ? (
        <SearchIconFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderSearchIconItem>) => void}
        />
      ) : null}

      {item.type === "buttons" ? (
        <ButtonsFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderButtonsItem>) => void}
        />
      ) : null}

      {item.type === "text" ? (
        <TextFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderTextItem>) => void}
        />
      ) : null}

      {item.type === "icons" ? (
        <IconsFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderIconsItem>) => void}
        />
      ) : null}

      {item.type === "user" ? (
        <UserFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<HeaderUserItem>) => void}
        />
      ) : null}

      {paddingRow}

      {item.type === "nav" ? (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onEditLinks}
        >
          {tSafe("admin.headerStudio.panel.editLinks", "Edit Links")}
          <LinkIcon className="h-4 w-4" />
        </Button>
      ) : null}

      <Separator />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full text-xs text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {tSafe("admin.headerStudio.panel.removeItem", "Remove item")}
      </Button>
    </div>
  );
}

function BrandFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderBrandItem;
  onPatch: (patch: Partial<HeaderBrandItem>) => void;
}) {
  return (
    <>
      <PanelRow label={tSafe("admin.headerStudio.panel.size", "Size")}>
        <UnitField
          value={item.size}
          unit="px"
          min={16}
          max={400}
          ariaLabel={tSafe("admin.headerStudio.panel.size", "Size")}
          onChange={(size) => onPatch({ size })}
        />
      </PanelRow>
      {/* The compact width, once scrolled. 0 keeps the logo at its size. */}
      <PanelRow label={tSafe("admin.headerStudio.panel.scrollSize", "Scroll size")}>
        <UnitField
          value={item.scrollSize}
          unit="px"
          max={400}
          ariaLabel={tSafe("admin.headerStudio.panel.scrollSize", "Scroll size")}
          onChange={(scrollSize) => onPatch({ scrollSize })}
        />
      </PanelRow>
      {item.scrollSize > 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {tSafe(
            "admin.headerStudio.panel.scrollSizeHint",
            "The logo animates to this width as the page scrolls down, and its row compacts with it.",
          )}
        </p>
      ) : null}
      <PanelRow label={tSafe("admin.headerStudio.panel.theme", "Theme")}>
        <SelectField
          accent
          ariaLabel={tSafe("admin.headerStudio.panel.theme", "Theme")}
          value={item.theme}
          options={HEADER_BRAND_THEMES.map((theme) => ({
            value: theme,
            label: tSafe(
              `admin.headerStudio.panel.brandTheme.${theme}`,
              theme === "auto" ? "Auto" : theme === "light" ? "Light" : "Dark",
            ),
          }))}
          onChange={(theme) => onPatch({ theme })}
        />
      </PanelRow>
    </>
  );
}

function NavFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderNavItem;
  onPatch: (patch: Partial<HeaderNavItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow label={tSafe("admin.headerStudio.panel.justify", "Justify")}>
        <SelectField
          accent
          ariaLabel={tSafe("admin.headerStudio.panel.justify", "Justify")}
          value={item.justify}
          options={justifyOptions(tSafe)}
          onChange={(justify) => onPatch({ justify })}
        />
      </PanelRow>
      <PanelRow
        label={tSafe("admin.headerStudio.panel.alignment", "Alignment")}
        align="start"
      >
        <AlignmentField
          value={item.align}
          labels={labels.alignment}
          onChange={(align) => onPatch({ align })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.gap", "Gap")}>
        <UnitField
          value={item.gap}
          unit="px"
          max={80}
          ariaLabel={tSafe("admin.headerStudio.panel.gap", "Gap")}
          onChange={(gap) => onPatch({ gap })}
        />
      </PanelRow>
      <PanelRow label={labels.textStyle.trigger}>
        <TextStyleField
          value={item.textStyle}
          labels={labels.textStyle}
          tSafe={tSafe}
          onChange={(textStyle) => onPatch({ textStyle })}
        />
      </PanelRow>
      <BackgroundRow
        tSafe={tSafe}
        background={item.background}
        onPatch={onPatch}
      />
    </>
  );
}

function SearchBarFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderSearchBarItem;
  onPatch: (patch: Partial<HeaderSearchBarItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow
        label={tSafe("admin.headerStudio.panel.placeholder", "Placeholder")}
        align="start"
      >
        <Input
          value={item.placeholder}
          onChange={(event) => onPatch({ placeholder: event.target.value })}
          className="h-8 text-xs"
          aria-label={tSafe("admin.headerStudio.panel.placeholder", "Placeholder")}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.roundness", "Roundness")}>
        <UnitField
          value={item.roundness}
          unit="px"
          max={999}
          ariaLabel={tSafe("admin.headerStudio.panel.roundness", "Roundness")}
          onChange={(roundness) => onPatch({ roundness })}
        />
      </PanelRow>
      <PanelRow
        label={tSafe("admin.headerStudio.panel.borderThickness", "Border Thickness")}
      >
        <UnitField
          value={item.borderThickness}
          unit="px"
          max={8}
          ariaLabel={tSafe(
            "admin.headerStudio.panel.borderThickness",
            "Border Thickness",
          )}
          onChange={(borderThickness) => onPatch({ borderThickness })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.height", "Height")}>
        <UnitField
          value={item.height}
          unit="px"
          min={24}
          max={96}
          ariaLabel={tSafe("admin.headerStudio.panel.height", "Height")}
          onChange={(height) => onPatch({ height })}
        />
      </PanelRow>
      <PanelRow label={labels.textStyle.trigger}>
        <TextStyleField
          value={item.textStyle}
          labels={labels.textStyle}
          tSafe={tSafe}
          onChange={(textStyle) => onPatch({ textStyle })}
        />
      </PanelRow>
      <BackgroundRow
        tSafe={tSafe}
        background={item.background}
        onPatch={onPatch}
      />
      <PanelRow label={tSafe("admin.headerStudio.panel.icon", "Icon")}>
        <FillField
          value={item.foreground}
          label={tSafe("admin.headerStudio.panel.icon", "Icon")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => onPatch({ foreground })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.border", "Border")}>
        <ColorField
          value={item.border}
          label={tSafe("admin.headerStudio.panel.border", "Border")}
          inheritLabel={labels.inherit}
          clearLabel={labels.clearColor}
          onChange={(border) => onPatch({ border })}
        />
      </PanelRow>
      <ToggleField
        label={tSafe(
          "admin.headerStudio.panel.showCategoryFilter",
          "Show Category Filter",
        )}
        checked={item.showCategoryFilter}
        onChange={(showCategoryFilter) => onPatch({ showCategoryFilter })}
      />
    </>
  );
}

function SearchIconFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderSearchIconItem;
  onPatch: (patch: Partial<HeaderSearchIconItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  const pill = item.style === "pill";
  return (
    <>
      <PanelRow label={tSafe("admin.headerStudio.panel.variant", "Style")}>
        <SelectField
          accent
          ariaLabel={tSafe("admin.headerStudio.panel.variant", "Style")}
          value={item.style}
          options={HEADER_SEARCH_ICON_STYLES.map((style) => ({
            value: style,
            label: tSafe(
              `admin.headerStudio.panel.searchIconStyle.${style}`,
              style === "pill" ? "Pill" : "Plain",
            ),
          }))}
          onChange={(style) => onPatch({ style })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.size", "Size")}>
        <UnitField
          value={item.size}
          unit="px"
          min={12}
          max={64}
          ariaLabel={tSafe("admin.headerStudio.panel.size", "Size")}
          onChange={(size) => onPatch({ size })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.roundness", "Roundness")}>
        <UnitField
          value={item.roundness}
          unit="px"
          max={999}
          ariaLabel={tSafe("admin.headerStudio.panel.roundness", "Roundness")}
          onChange={(roundness) => onPatch({ roundness })}
        />
      </PanelRow>
      <BackgroundRow
        tSafe={tSafe}
        background={item.background}
        onPatch={onPatch}
      />
      <PanelRow label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}>
        <FillField
          value={item.foreground}
          label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => onPatch({ foreground })}
        />
      </PanelRow>
      {pill ? (
        <>
          <PanelHeading>
            {tSafe("admin.headerStudio.panel.pill", "Capsule")}
          </PanelHeading>
          <PanelRow label={tSafe("admin.headerStudio.panel.width", "Width")}>
            <UnitField
              value={item.width}
              unit="px"
              min={40}
              max={400}
              ariaLabel={tSafe("admin.headerStudio.panel.width", "Width")}
              onChange={(width) => onPatch({ width })}
            />
          </PanelRow>
          <PanelRow label={tSafe("admin.headerStudio.panel.roundness", "Roundness")}>
            <UnitField
              value={item.pillRoundness}
              unit="px"
              max={999}
              ariaLabel={tSafe("admin.headerStudio.panel.roundness", "Roundness")}
              onChange={(pillRoundness) => onPatch({ pillRoundness })}
            />
          </PanelRow>
          <PanelRow label={tSafe("admin.headerStudio.panel.background", "Background")}>
            <BackgroundSwatchField
              value={item.pillBackground}
              label={tSafe("admin.headerStudio.panel.background", "Background")}
              clearLabel={labels.clearColor}
              tSafe={tSafe}
              onChange={(pillBackground) => onPatch({ pillBackground })}
            />
          </PanelRow>
          <BorderRows
            tSafe={tSafe}
            thickness={item.borderThickness}
            color={item.border}
            onThickness={(borderThickness) => onPatch({ borderThickness })}
            onColor={(border) => onPatch({ border })}
          />
        </>
      ) : null}
    </>
  );
}

/** A small caption that splits one item's panel into named parts. */
function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/** Border thickness, and its colour once there is a border to colour. */
function BorderRows({
  tSafe,
  thickness,
  color,
  onThickness,
  onColor,
}: {
  tSafe: TSafe;
  thickness: number;
  color: string;
  onThickness: (value: number) => void;
  onColor: (value: string) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow
        label={tSafe("admin.headerStudio.panel.borderThickness", "Border Thickness")}
      >
        <UnitField
          value={thickness}
          unit="px"
          max={8}
          ariaLabel={tSafe("admin.headerStudio.panel.borderThickness", "Border Thickness")}
          onChange={onThickness}
        />
      </PanelRow>
      {thickness > 0 ? (
        <PanelRow label={tSafe("admin.headerStudio.panel.borderColor", "Border colour")}>
          <ColorField
            value={color}
            label={tSafe("admin.headerStudio.panel.borderColor", "Border colour")}
            inheritLabel={labels.inherit}
            clearLabel={labels.clearColor}
            onChange={onColor}
          />
        </PanelRow>
      ) : null}
    </>
  );
}

/**
 * The All Categories button, then its panel. The list itself is not here:
 * it is the mega menu, edited where the rest of the menu is. What a
 * merchant sets on this item is how the trigger looks and when it opens.
 */
function CategoriesFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderCategoriesItem;
  onPatch: (patch: Partial<HeaderCategoriesItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  const patchPanel = (patch: Partial<HeaderCategoriesPanel>) =>
    onPatch({ panel: { ...item.panel, ...patch } });
  return (
    <>
      <PanelRow label={tSafe("admin.headerStudio.panel.label", "Label")}>
        <Input
          value={item.label}
          onChange={(event) => onPatch({ label: event.target.value })}
          className="h-8 text-xs"
          aria-label={tSafe("admin.headerStudio.panel.label", "Label")}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.opensOn", "Dropdown")}>
        <SelectField
          accent
          ariaLabel={tSafe("admin.headerStudio.panel.opensOn", "Dropdown")}
          value={item.openOn}
          options={HEADER_CATEGORIES_OPEN_MODES.map((mode) => ({
            value: mode,
            label: tSafe(`admin.headerStudio.panel.openMode.${mode}`, {
              hover: "On hover",
              click: "On click",
              always: "Always open",
            }[mode]),
          }))}
          onChange={(openOn) => onPatch({ openOn })}
        />
      </PanelRow>
      <ToggleField
        label={tSafe("admin.headerStudio.panel.showIcon", "Show icon")}
        checked={item.showIcon}
        onChange={(showIcon) => onPatch({ showIcon })}
      />
      {item.showIcon ? (
        <PanelRow label={tSafe("admin.headerStudio.panel.icon", "Icon")}>
          <SelectField
            ariaLabel={tSafe("admin.headerStudio.panel.icon", "Icon")}
            value={item.icon}
            options={HEADER_CATEGORIES_ICONS.map((icon) => ({
              value: icon,
              label: tSafe(`admin.headerStudio.panel.categoriesIcon.${icon}`, {
                menu: "Hamburger",
                grid: "Grid",
                list: "List",
              }[icon]),
            }))}
            onChange={(icon) => onPatch({ icon })}
          />
        </PanelRow>
      ) : null}
      <ToggleField
        label={tSafe("admin.headerStudio.panel.showChevron", "Show chevron")}
        checked={item.showChevron}
        onChange={(showChevron) => onPatch({ showChevron })}
      />
      <PanelRow label={tSafe("admin.headerStudio.panel.width", "Width")}>
        <UnitField
          value={item.width}
          unit="px"
          max={600}
          ariaLabel={tSafe("admin.headerStudio.panel.width", "Width")}
          onChange={(width) => onPatch({ width })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.height", "Height")}>
        <UnitField
          value={item.height}
          unit="px"
          max={120}
          ariaLabel={tSafe("admin.headerStudio.panel.height", "Height")}
          onChange={(height) => onPatch({ height })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.roundness", "Roundness")}>
        <UnitField
          value={item.roundness}
          unit="px"
          max={999}
          ariaLabel={tSafe("admin.headerStudio.panel.roundness", "Roundness")}
          onChange={(roundness) => onPatch({ roundness })}
        />
      </PanelRow>
      <PanelRow label={labels.textStyle.trigger}>
        <TextStyleField
          value={item.textStyle}
          labels={labels.textStyle}
          tSafe={tSafe}
          onChange={(textStyle) => onPatch({ textStyle })}
        />
      </PanelRow>
      <BackgroundRow
        tSafe={tSafe}
        background={item.background}
        onPatch={onPatch}
      />
      <PanelRow label={tSafe("admin.headerStudio.panel.iconColor", "Icon colour")}>
        <FillField
          value={item.foreground}
          label={tSafe("admin.headerStudio.panel.iconColor", "Icon colour")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => onPatch({ foreground })}
        />
      </PanelRow>
      <BorderRows
        tSafe={tSafe}
        thickness={item.borderThickness}
        color={item.border}
        onThickness={(borderThickness) => onPatch({ borderThickness })}
        onColor={(border) => onPatch({ border })}
      />

      <PanelHeading>
        {tSafe("admin.headerStudio.panel.categoriesPanel", "Dropdown panel")}
      </PanelHeading>
      <PanelRow label={tSafe("admin.headerStudio.panel.background", "Background")}>
        <BackgroundSwatchField
          value={item.panel.background}
          label={tSafe("admin.headerStudio.panel.background", "Background")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(background) => patchPanel({ background })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.text", "Text")}>
        <FillField
          value={item.panel.foreground}
          label={tSafe("admin.headerStudio.panel.text", "Text")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => patchPanel({ foreground })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.highlight", "Highlight")}>
        <BackgroundSwatchField
          value={item.panel.highlight}
          label={tSafe("admin.headerStudio.panel.highlight", "Highlight")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          modes={["solid", "gradient"]}
          onChange={(highlight) => patchPanel({ highlight })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.width", "Width")}>
        <UnitField
          value={item.panel.width}
          unit="px"
          max={600}
          ariaLabel={tSafe("admin.headerStudio.panel.width", "Width")}
          onChange={(width) => patchPanel({ width })}
        />
      </PanelRow>
      <PanelRow
        label={tSafe("admin.headerStudio.panel.itemRoundness", "Item roundness")}
      >
        <UnitField
          value={item.panel.itemRoundness}
          unit="px"
          max={999}
          ariaLabel={tSafe("admin.headerStudio.panel.itemRoundness", "Item roundness")}
          onChange={(itemRoundness) => patchPanel({ itemRoundness })}
        />
      </PanelRow>
      <ToggleField
        label={tSafe("admin.headerStudio.panel.showIcons", "Show icons")}
        checked={item.panel.showIcons}
        onChange={(showIcons) => patchPanel({ showIcons })}
      />
    </>
  );
}

/**
 * The Collections trigger. Nothing here names a collection: the panel is the
 * catalogue, so the controls are about how much of it to show and how.
 */
function CollectionsFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderCollectionsItem;
  onPatch: (patch: Partial<HeaderCollectionsItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  const labelText = tSafe("admin.headerStudio.panel.label", "Label");
  return (
    <>
      <PanelRow label={labelText}>
        <Input
          value={item.label}
          aria-label={labelText}
          onChange={(event) => onPatch({ label: event.target.value })}
          className="h-8 text-xs"
        />
      </PanelRow>
      <PanelRow label={labels.textStyle.trigger}>
        <TextStyleField
          value={item.textStyle}
          labels={labels.textStyle}
          tSafe={tSafe}
          onChange={(textStyle) => onPatch({ textStyle })}
        />
      </PanelRow>
      <PanelRow
        label={tSafe("admin.headerStudio.panel.collectionsLimit", "Show")}
      >
        <UnitField
          value={item.limit}
          unit=""
          min={1}
          max={24}
          ariaLabel={tSafe("admin.headerStudio.panel.collectionsLimit", "Show")}
          onChange={(limit) => onPatch({ limit })}
        />
      </PanelRow>
      <PanelRow
        label={tSafe("admin.headerStudio.panel.collectionsColumns", "Columns")}
      >
        <UnitField
          value={item.columns}
          unit=""
          min={1}
          max={4}
          ariaLabel={tSafe(
            "admin.headerStudio.panel.collectionsColumns",
            "Columns",
          )}
          onChange={(columns) => onPatch({ columns })}
        />
      </PanelRow>
      <ToggleField
        label={tSafe("admin.headerStudio.panel.showChevron", "Show chevron")}
        checked={item.showChevron}
        onChange={(showChevron) => onPatch({ showChevron })}
      />
      <ToggleField
        label={tSafe(
          "admin.headerStudio.panel.collectionsDescription",
          "Show descriptions",
        )}
        checked={item.showDescription}
        onChange={(showDescription) => onPatch({ showDescription })}
      />
      <ToggleField
        label={tSafe("admin.headerStudio.panel.collectionsViewAll", "View all row")}
        checked={item.showViewAll}
        onChange={(showViewAll) => onPatch({ showViewAll })}
      />
    </>
  );
}

function MenuButtonFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderMenuButtonItem;
  onPatch: (patch: Partial<HeaderMenuButtonItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow label={tSafe("admin.headerStudio.panel.size", "Size")}>
        <UnitField
          value={item.size}
          unit="px"
          min={12}
          max={64}
          ariaLabel={tSafe("admin.headerStudio.panel.size", "Size")}
          onChange={(size) => onPatch({ size })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.roundness", "Roundness")}>
        <UnitField
          value={item.roundness}
          unit="px"
          max={999}
          ariaLabel={tSafe("admin.headerStudio.panel.roundness", "Roundness")}
          onChange={(roundness) => onPatch({ roundness })}
        />
      </PanelRow>
      <BackgroundRow
        tSafe={tSafe}
        background={item.background}
        onPatch={onPatch}
      />
      <PanelRow label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}>
        <FillField
          value={item.foreground}
          label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => onPatch({ foreground })}
        />
      </PanelRow>
      <ToggleField
        label={tSafe("admin.headerStudio.panel.showLabel", "Show label")}
        checked={item.showLabel}
        onChange={(showLabel) => onPatch({ showLabel })}
      />
      {item.showLabel ? (
        <PanelRow label={tSafe("admin.headerStudio.panel.label", "Label")}>
          <Input
            value={item.label}
            onChange={(event) => onPatch({ label: event.target.value })}
            className="h-8 text-xs"
            aria-label={tSafe("admin.headerStudio.panel.label", "Label")}
          />
        </PanelRow>
      ) : null}
    </>
  );
}

/** The "Deliver to" block: pin size, ink, and the caption over the place. */
function LocationFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderLocationItem;
  onPatch: (patch: Partial<HeaderLocationItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow label={tSafe("admin.headerStudio.panel.size", "Size")}>
        <UnitField
          value={item.size}
          unit="px"
          min={12}
          max={40}
          ariaLabel={tSafe("admin.headerStudio.panel.size", "Size")}
          onChange={(size) => onPatch({ size })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}>
        <FillField
          value={item.foreground}
          label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => onPatch({ foreground })}
        />
      </PanelRow>
      <ToggleField
        label={tSafe("admin.headerStudio.panel.showCaption", "Show caption")}
        checked={item.showCaption}
        onChange={(showCaption) => onPatch({ showCaption })}
      />
      {item.showCaption ? (
        <PanelRow label={tSafe("admin.headerStudio.panel.caption", "Caption")}>
          <Input
            value={item.caption}
            placeholder={tSafe(
              "admin.headerStudio.panel.captionPlaceholder",
              "Deliver to",
            )}
            onChange={(event) => onPatch({ caption: event.target.value })}
            className="h-8 text-xs"
            aria-label={tSafe("admin.headerStudio.panel.caption", "Caption")}
          />
        </PanelRow>
      ) : null}
    </>
  );
}

function ButtonsFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderButtonsItem;
  onPatch: (patch: Partial<HeaderButtonsItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <div className="space-y-2">
        {item.buttons.map((button) => (
          <div key={button.id} className="space-y-1.5 rounded-[4px] border bg-muted/30 p-2">
            <div className="flex items-center gap-1.5">
              <Input
                value={button.label}
                placeholder={tSafe("admin.headerStudio.links.label", "Label")}
                onChange={(event) =>
                  onPatch({
                    buttons: item.buttons.map((entry) =>
                      entry.id === button.id
                        ? { ...entry, label: event.target.value }
                        : entry,
                    ),
                  })
                }
                className="h-8 text-xs"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={tSafe(
                  "admin.headerStudio.panel.removeButton",
                  "Remove button",
                )}
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  onPatch({
                    buttons: item.buttons.filter(
                      (entry) => entry.id !== button.id,
                    ),
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Input
              value={button.url}
              placeholder={tSafe("admin.headerStudio.links.url", "Url")}
              onChange={(event) =>
                onPatch({
                  buttons: item.buttons.map((entry) =>
                    entry.id === button.id
                      ? { ...entry, url: event.target.value }
                      : entry,
                  ),
                })
              }
              className="h-8 text-xs"
            />
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full text-xs"
          disabled={item.buttons.length >= MAX_HEADER_BUTTONS}
          onClick={() =>
            onPatch({
              buttons: [
                ...item.buttons,
                { id: crypto.randomUUID(), label: "", url: "" },
              ],
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          {tSafe("admin.headerStudio.panel.addButton", "Add button")}
        </Button>
      </div>

      <PanelRow label={tSafe("admin.headerStudio.panel.variant", "Style")}>
        <SelectField
          accent
          ariaLabel={tSafe("admin.headerStudio.panel.variant", "Style")}
          value={item.variant}
          options={HEADER_BUTTON_VARIANTS.map((variant) => ({
            value: variant,
            label: tSafe(
              `admin.headerStudio.panel.buttonVariant.${variant}`,
              variant === "solid"
                ? "Solid"
                : variant === "outline"
                  ? "Outline"
                  : "Ghost",
            ),
          }))}
          onChange={(variant) => onPatch({ variant })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.roundness", "Roundness")}>
        <UnitField
          value={item.roundness}
          unit="px"
          max={999}
          ariaLabel={tSafe("admin.headerStudio.panel.roundness", "Roundness")}
          onChange={(roundness) => onPatch({ roundness })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.gap", "Gap")}>
        <UnitField
          value={item.gap}
          unit="px"
          max={40}
          ariaLabel={tSafe("admin.headerStudio.panel.gap", "Gap")}
          onChange={(gap) => onPatch({ gap })}
        />
      </PanelRow>
      <PanelRow label={labels.textStyle.trigger}>
        <TextStyleField
          value={item.textStyle}
          labels={labels.textStyle}
          tSafe={tSafe}
          onChange={(textStyle) => onPatch({ textStyle })}
        />
      </PanelRow>
      <BackgroundRow
        tSafe={tSafe}
        background={item.background}
        onPatch={onPatch}
      />
    </>
  );
}

function TextFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderTextItem;
  onPatch: (patch: Partial<HeaderTextItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow
        label={tSafe("admin.headerStudio.panel.content", "Text")}
        align="start"
      >
        <Input
          value={item.content}
          onChange={(event) => onPatch({ content: event.target.value })}
          className="h-8 text-xs"
          aria-label={tSafe("admin.headerStudio.panel.content", "Text")}
        />
      </PanelRow>
      <PanelRow label={labels.textStyle.trigger}>
        <TextStyleField
          value={item.textStyle}
          labels={labels.textStyle}
          tSafe={tSafe}
          onChange={(textStyle) => onPatch({ textStyle })}
        />
      </PanelRow>
      <BackgroundRow
        tSafe={tSafe}
        background={item.background}
        onPatch={onPatch}
      />
    </>
  );
}

function IconsFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderIconsItem;
  onPatch: (patch: Partial<HeaderIconsItem>) => void;
}) {
  const labels = commonLabels(tSafe);

  const toggleKey = (key: HeaderIconKey) => {
    const next = item.keys.includes(key)
      ? item.keys.filter((entry) => entry !== key)
      : [...item.keys, key];
    // The normalizer refuses an empty pick (it would render nothing at all),
    // so the last icon cannot be switched off here either.
    if (!next.length) return;
    onPatch({ keys: HEADER_ICON_KEYS.filter((entry) => next.includes(entry)) });
  };

  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {HEADER_ICON_KEYS.map((key) => {
          const meta = HEADER_ICON_META[key];
          const Icon = meta.icon;
          const active = item.keys.includes(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => toggleKey(key)}
              className={cn(
                "flex items-center gap-1 rounded-[4px] border px-2 py-1 text-[11px] transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tSafe(`admin.headerStudio.icons.${key}`, meta.label)}
            </button>
          );
        })}
      </div>

      <PanelRow label={tSafe("admin.headerStudio.panel.size", "Size")}>
        <UnitField
          value={item.size}
          unit="px"
          min={12}
          max={64}
          ariaLabel={tSafe("admin.headerStudio.panel.size", "Size")}
          onChange={(size) => onPatch({ size })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.gap", "Gap")}>
        <UnitField
          value={item.gap}
          unit="px"
          max={60}
          ariaLabel={tSafe("admin.headerStudio.panel.gap", "Gap")}
          onChange={(gap) => onPatch({ gap })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}>
        <FillField
          value={item.foreground}
          label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => onPatch({ foreground })}
        />
      </PanelRow>
      <ToggleField
        label={tSafe("admin.headerStudio.panel.showLabels", "Show labels")}
        checked={item.showLabels}
        onChange={(showLabels) => onPatch({ showLabels })}
      />
    </>
  );
}

function UserFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: HeaderUserItem;
  onPatch: (patch: Partial<HeaderUserItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow label={tSafe("admin.headerStudio.panel.size", "Size")}>
        <UnitField
          value={item.size}
          unit="px"
          min={12}
          max={64}
          ariaLabel={tSafe("admin.headerStudio.panel.size", "Size")}
          onChange={(size) => onPatch({ size })}
        />
      </PanelRow>
      <PanelRow label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}>
        <FillField
          value={item.foreground}
          label={tSafe("admin.headerStudio.panel.foreground", "Foreground")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => onPatch({ foreground })}
        />
      </PanelRow>
      <ToggleField
        label={tSafe("admin.headerStudio.panel.showLabel", "Show label")}
        checked={item.showLabel}
        onChange={(showLabel) => onPatch({ showLabel })}
      />
      {/* Two lines, the way the storefront control reads: a greeting over
          the account name — "Login / Register" until someone signs in. */}
      {item.showLabel ? (
        <>
          <PanelRow
            label={tSafe("admin.headerStudio.panel.greeting", "Greeting")}
          >
            <Input
              value={item.greeting}
              onChange={(event) => onPatch({ greeting: event.target.value })}
              className="h-8 text-xs"
              aria-label={tSafe("admin.headerStudio.panel.greeting", "Greeting")}
            />
          </PanelRow>
          <PanelRow label={tSafe("admin.headerStudio.panel.label", "Label")}>
            <Input
              value={item.label}
              onChange={(event) => onPatch({ label: event.target.value })}
              className="h-8 text-xs"
              aria-label={tSafe("admin.headerStudio.panel.label", "Label")}
            />
          </PanelRow>
        </>
      ) : null}
    </>
  );
}

/** The surface an item paints behind itself — the row every item panel has. */
function BackgroundRow<T extends { background: HeaderBackground }>({
  tSafe,
  background,
  onPatch,
}: {
  tSafe: TSafe;
  background: HeaderBackground;
  onPatch: (patch: Partial<T>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <PanelRow label={tSafe("admin.headerStudio.panel.background", "Background")}>
      <BackgroundSwatchField
        value={background}
        label={tSafe("admin.headerStudio.panel.background", "Background")}
        clearLabel={labels.clearColor}
        tSafe={tSafe}
        onChange={(value) => onPatch({ background: value } as Partial<T>)}
      />
    </PanelRow>
  );
}
