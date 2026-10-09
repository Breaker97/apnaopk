"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { BackgroundSwatchField } from "@/components/admin/sliders/background-swatch";
import { newId, type HeaderJustify } from "@/lib/site-config/header-layout";
import {
  FOOTER_COLUMN_FLOWS,
  MAX_FOOTER_PADDING,
  type FooterBrandItem,
  type FooterContactItem,
  type FooterCopyrightItem,
  type FooterLayout,
  type FooterLayoutColumn,
  type FooterLayoutItem,
  type FooterLayoutRow,
  type FooterLinksItem,
  type FooterPaymentsItem,
  type FooterSocialItem,
  type FooterTextItem,
} from "@/lib/site-config/footer-layout";
import {
  AlignmentField,
  ColorField,
  FillField,
  PaddingField,
  PanelRow,
  SelectField,
  ToggleField,
  UnitField,
} from "@/components/admin/online-store/header-studio/controls";
import { footerItemMeta } from "@/components/admin/online-store/footer-studio/layout-style";
import { MenuSelect } from "@/components/admin/online-store/header-studio/menu-select";
import type { TSafe } from "@/components/admin/online-store/t-safe";

/**
 * The footer's "Properties:" card — the header studio's, kind for kind.
 *
 * It shares the header's widgets rather than owning lookalikes, because the
 * footer model is written in the header's own types: a padding, an alignment
 * or a fill edited here goes through exactly the control that edits the one
 * above it, and the two builders cannot drift into two dialects of the same
 * idea.
 */

export type FooterSelection =
  | { kind: "row"; rowId: string }
  | { kind: "column"; rowId: string; columnId: string }
  | { kind: "item"; itemId: string }
  | null;

/**
 * A selection names ids, never nodes, so that every patch lands on the layout
 * the studio holds and a stale copy can never be edited. The panel resolves
 * them on each render; a selection whose node has just been removed simply
 * finds nothing and falls back to the empty state.
 */
function findRow(layout: FooterLayout, rowId: string): FooterLayoutRow | null {
  return layout.rows.find((row) => row.id === rowId) ?? null;
}

function findColumn(
  layout: FooterLayout,
  rowId: string,
  columnId: string,
): FooterLayoutColumn | null {
  return (
    findRow(layout, rowId)?.columns.find((column) => column.id === columnId) ??
    null
  );
}

function findItem(
  layout: FooterLayout,
  itemId: string,
): FooterLayoutItem | null {
  for (const row of layout.rows) {
    for (const column of row.columns) {
      const item = column.items.find((entry) => entry.id === itemId);
      if (item) return item;
    }
  }
  return null;
}

export function FooterPropertyPanel({
  layout,
  selection,
  tSafe,
  onPatchRow,
  onPatchColumn,
  onPatchItem,
  onRemoveRow,
  onRemoveItem,
}: {
  layout: FooterLayout;
  selection: FooterSelection;
  tSafe: TSafe;
  onPatchRow: (rowId: string, patch: Partial<FooterLayoutRow>) => void;
  onPatchColumn: (columnId: string, patch: Partial<FooterLayoutColumn>) => void;
  onPatchItem: (itemId: string, patch: Partial<FooterLayoutItem>) => void;
  onRemoveRow: (rowId: string) => void;
  onRemoveItem: (itemId: string) => void;
}) {
  const row =
    selection?.kind === "row" ? findRow(layout, selection.rowId) : null;
  const column =
    selection?.kind === "column"
      ? findColumn(layout, selection.rowId, selection.columnId)
      : null;
  const item =
    selection?.kind === "item" ? findItem(layout, selection.itemId) : null;

  const title = () => {
    if (item) {
      const meta = footerItemMeta(item.type);
      return tSafe(`admin.footerStudio.items.${item.type}`, meta.label);
    }
    if (column) return tSafe("admin.footerStudio.panel.column", "Column");
    if (row) return tSafe("admin.footerStudio.panel.row", "Row");
    return tSafe("admin.footerStudio.panel.nothing", "Nothing selected");
  };

  return (
    <div className="rounded-[12px] border bg-card shadow-xs">
      <p className="border-b bg-muted/40 px-4 py-3 text-sm">
        <span className="font-semibold">
          {tSafe("admin.footerStudio.panel.title", "Properties:")}
        </span>{" "}
        <span className="text-muted-foreground">{title()}</span>
      </p>
      <div className="p-4">
        {row ? (
          <RowProperties
            tSafe={tSafe}
            row={row}
            onPatch={(patch) => onPatchRow(row.id, patch)}
            onRemove={() => onRemoveRow(row.id)}
          />
        ) : null}

        {column ? (
          <ColumnProperties
            tSafe={tSafe}
            column={column}
            onPatch={(patch) => onPatchColumn(column.id, patch)}
          />
        ) : null}

        {item ? (
          <ItemProperties
            tSafe={tSafe}
            item={item}
            onPatch={(patch) => onPatchItem(item.id, patch)}
            onRemove={() => onRemoveItem(item.id)}
          />
        ) : null}

        {!row && !column && !item ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {tSafe(
              "admin.footerStudio.panel.nothingHint",
              "Pick a row, a column or a block on the canvas to edit it. Anything left unset here follows the theme.",
            )}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The labels several panels share, looked up once rather than inline twice. */
function commonLabels(tSafe: TSafe) {
  return {
    alignment: {
      horizontal: tSafe(
        "admin.footerStudio.panel.alignHorizontal",
        "Horizontal alignment",
      ),
      vertical: tSafe(
        "admin.footerStudio.panel.alignVertical",
        "Vertical alignment",
      ),
    },
    padding: {
      top: tSafe("admin.footerStudio.panel.paddingTop", "Padding top"),
      right: tSafe("admin.footerStudio.panel.paddingRight", "Padding right"),
      bottom: tSafe("admin.footerStudio.panel.paddingBottom", "Padding bottom"),
      left: tSafe("admin.footerStudio.panel.paddingLeft", "Padding left"),
      horizontal: tSafe("admin.footerStudio.panel.paddingX", "Left and right"),
      vertical: tSafe("admin.footerStudio.panel.paddingY", "Top and bottom"),
      expand: tSafe("admin.footerStudio.panel.paddingSides", "Edit each side"),
      collapse: tSafe("admin.footerStudio.panel.paddingPairs", "Edit as pairs"),
    },
    paddingLabel: tSafe("admin.footerStudio.panel.padding", "Padding"),
    heading: tSafe("admin.footerStudio.panel.heading", "Title"),
    inherit: tSafe("admin.footerStudio.panel.inherit", "Inherit"),
    clearColor: tSafe(
      "admin.footerStudio.panel.clearColor",
      "Reset to inherit",
    ),
  };
}

/**
 * Four of the six the header offers. `HeaderJustify` also carries "around"
 * and "evenly", but the footer normalizer keeps only these, so listing the
 * other two would let a merchant pick a value that silently reads as Start
 * again after the next save.
 */
const FOOTER_JUSTIFY_VALUES = ["start", "center", "end", "between"] as const;

function justifyOptions(tSafe: TSafe) {
  const labels: Record<(typeof FOOTER_JUSTIFY_VALUES)[number], string> = {
    start: tSafe("admin.footerStudio.justify.start", "Start"),
    center: tSafe("admin.footerStudio.justify.center", "Center"),
    end: tSafe("admin.footerStudio.justify.end", "End"),
    between: tSafe("admin.footerStudio.justify.between", "Space Between"),
  };
  return FOOTER_JUSTIFY_VALUES.map((value) => ({
    value: value as HeaderJustify,
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
  row: FooterLayoutRow;
  onPatch: (patch: Partial<FooterLayoutRow>) => void;
  onRemove: () => void;
}) {
  const labels = commonLabels(tSafe);

  return (
    <div className="space-y-3">
      {/* No column count: a footer row's columns are added and removed on the
          canvas, because a link column carries its own content and dropping
          one by picking a smaller number would throw that content away. */}
      <PanelRow
        label={tSafe("admin.footerStudio.panel.alignment", "Alignment")}
        align="start"
      >
        <AlignmentField
          value={row.align}
          labels={labels.alignment}
          onChange={(align) => onPatch({ align })}
        />
      </PanelRow>

      <PanelRow
        label={tSafe("admin.footerStudio.panel.columnGap", "Column gap")}
      >
        <UnitField
          value={row.gap}
          unit="px"
          max={120}
          ariaLabel={tSafe("admin.footerStudio.panel.columnGap", "Column gap")}
          onChange={(gap) => onPatch({ gap })}
        />
      </PanelRow>

      {/* A footer row has no height of its own — it is as tall as its columns
          make it — so this inset is the only thing that gives it air. */}
      <PanelRow label={labels.paddingLabel} layout="stacked">
        <PaddingField
          value={row.padding}
          max={MAX_FOOTER_PADDING}
          labels={labels.padding}
          onChange={(padding) => onPatch({ padding })}
        />
      </PanelRow>

      <PanelRow
        label={tSafe("admin.footerStudio.panel.background", "Background")}
      >
        <BackgroundSwatchField
          value={row.background}
          label={tSafe("admin.footerStudio.panel.background", "Background")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(background) => onPatch({ background })}
        />
      </PanelRow>

      <PanelRow
        label={tSafe("admin.footerStudio.panel.foreground", "Foreground")}
      >
        <FillField
          value={row.foreground}
          label={tSafe("admin.footerStudio.panel.foreground", "Foreground")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(foreground) => onPatch({ foreground })}
        />
      </PanelRow>

      {/* The TOP edge, where the header states its bottom one: the footer's
          single rule is the divider over the legal strip, and a merchant
          reaches for it on the strip they can see it above. */}
      <PanelRow label={tSafe("admin.footerStudio.panel.topBorder", "Top border")}>
        <UnitField
          value={row.borderTop}
          unit="px"
          max={8}
          ariaLabel={tSafe("admin.footerStudio.panel.topBorder", "Top border")}
          onChange={(borderTop) => onPatch({ borderTop })}
        />
      </PanelRow>
      {row.borderTop > 0 ? (
        <PanelRow
          label={tSafe("admin.footerStudio.panel.borderColor", "Border colour")}
        >
          <ColorField
            value={row.borderColor}
            label={tSafe(
              "admin.footerStudio.panel.borderColor",
              "Border colour",
            )}
            inheritLabel={labels.inherit}
            clearLabel={labels.clearColor}
            onChange={(borderColor) => onPatch({ borderColor })}
          />
        </PanelRow>
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
        {tSafe("admin.footerStudio.panel.removeRow", "Remove row")}
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
  column: FooterLayoutColumn;
  onPatch: (patch: Partial<FooterLayoutColumn>) => void;
}) {
  const labels = commonLabels(tSafe);

  return (
    <div className="space-y-3">
      <PanelRow label={tSafe("admin.footerStudio.panel.width", "Width")}>
        <UnitField
          value={column.width}
          unit="fr"
          min={1}
          max={12}
          ariaLabel={tSafe("admin.footerStudio.panel.width", "Width")}
          onChange={(width) => onPatch({ width })}
        />
      </PanelRow>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {tSafe(
          "admin.footerStudio.panel.widthHint",
          "The column's share of the row: a 2 beside two 1s takes half the width. The brand column is 2 in the footer you started from.",
        )}
      </p>

      {/* "Side by side" is what holds the payment marks and the social icons
          together at the end of the legal strip; stacked, the icons would
          drop under the marks and the strip would grow a second line. */}
      <PanelRow label={tSafe("admin.footerStudio.panel.flow", "Flow")}>
        <SelectField
          accent
          ariaLabel={tSafe("admin.footerStudio.panel.flow", "Flow")}
          value={column.flow}
          options={FOOTER_COLUMN_FLOWS.map((flow) => ({
            value: flow,
            label: tSafe(
              `admin.footerStudio.panel.flows.${flow}`,
              flow === "stack" ? "Stacked" : "Side by side",
            ),
          }))}
          onChange={(flow) => onPatch({ flow })}
        />
      </PanelRow>

      <PanelRow label={tSafe("admin.footerStudio.panel.justify", "Justify")}>
        <SelectField
          accent
          ariaLabel={tSafe("admin.footerStudio.panel.justify", "Justify")}
          value={column.justify}
          options={justifyOptions(tSafe)}
          onChange={(justify) => onPatch({ justify })}
        />
      </PanelRow>

      <PanelRow
        label={tSafe("admin.footerStudio.panel.alignment", "Alignment")}
        align="start"
      >
        <AlignmentField
          value={column.align}
          labels={labels.alignment}
          onChange={(align) => onPatch({ align })}
        />
      </PanelRow>

      <PanelRow label={tSafe("admin.footerStudio.panel.itemGap", "Item gap")}>
        <UnitField
          value={column.gap}
          unit="px"
          max={80}
          ariaLabel={tSafe("admin.footerStudio.panel.itemGap", "Item gap")}
          onChange={(gap) => onPatch({ gap })}
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
}: {
  tSafe: TSafe;
  item: FooterLayoutItem;
  onPatch: (patch: Partial<FooterLayoutItem>) => void;
  onRemove: () => void;
}) {
  const labels = commonLabels(tSafe);

  return (
    <div className="space-y-3">
      {item.type === "brand" ? (
        <BrandFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<FooterBrandItem>) => void}
        />
      ) : null}

      {item.type === "text" ? (
        <TextFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<FooterTextItem>) => void}
        />
      ) : null}

      {item.type === "contact" ? (
        <ContactFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<FooterContactItem>) => void}
        />
      ) : null}

      {item.type === "social" ? (
        <SocialFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<FooterSocialItem>) => void}
        />
      ) : null}

      {item.type === "links" ? (
        <LinksFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<FooterLinksItem>) => void}
        />
      ) : null}

      {item.type === "copyright" ? (
        <CopyrightFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<FooterCopyrightItem>) => void}
        />
      ) : null}

      {item.type === "payments" ? (
        <PaymentsFields
          tSafe={tSafe}
          item={item}
          onPatch={onPatch as (patch: Partial<FooterPaymentsItem>) => void}
        />
      ) : null}

      {/* Every kind has an inset, so the row sits once after the kind's own
          fields rather than being repeated inside each of them. */}
      <PanelRow label={labels.paddingLabel} layout="stacked">
        <PaddingField
          value={item.padding}
          max={MAX_FOOTER_PADDING}
          labels={labels.padding}
          onChange={(padding) => onPatch({ padding })}
        />
      </PanelRow>

      <Separator />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full text-xs text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {tSafe("admin.footerStudio.panel.removeItem", "Remove item")}
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
  item: FooterBrandItem;
  onPatch: (patch: Partial<FooterBrandItem>) => void;
}) {
  return (
    <>
      <PanelRow label={tSafe("admin.footerStudio.panel.size", "Size")}>
        <UnitField
          value={item.size}
          unit="px"
          max={400}
          zeroLabel={tSafe("admin.footerStudio.panel.sizeAuto", "auto")}
          ariaLabel={tSafe("admin.footerStudio.panel.size", "Size")}
          onChange={(size) => onPatch({ size })}
        />
      </PanelRow>
      {item.size === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {tSafe(
            "admin.footerStudio.panel.sizeHint",
            "At 0 the mark follows the logo size set on the header, so one change resizes both.",
          )}
        </p>
      ) : null}
    </>
  );
}

function TextFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: FooterTextItem;
  onPatch: (patch: Partial<FooterTextItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      {/* A textarea, not an input: this is the about paragraph under the logo,
          and a footer line that wraps three times is the normal case. */}
      <PanelRow
        label={tSafe("admin.footerStudio.panel.text", "Text")}
        layout="stacked"
      >
        <Textarea
          value={item.text}
          rows={4}
          onChange={(event) => onPatch({ text: event.target.value })}
          className="min-h-20 text-xs"
          aria-label={tSafe("admin.footerStudio.panel.text", "Text")}
        />
      </PanelRow>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {tSafe(
          "admin.footerStudio.panel.textHint",
          "Left empty, the store's own description is shown here instead — which is what most footers do.",
        )}
      </p>
      <PanelRow label={tSafe("admin.footerStudio.panel.color", "Colour")}>
        <FillField
          value={item.fill}
          label={tSafe("admin.footerStudio.panel.color", "Colour")}
          clearLabel={labels.clearColor}
          tSafe={tSafe}
          onChange={(fill) => onPatch({ fill })}
        />
      </PanelRow>
    </>
  );
}

function ContactFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: FooterContactItem;
  onPatch: (patch: Partial<FooterContactItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow label={labels.heading} align="start">
        <Input
          value={item.title}
          onChange={(event) => onPatch({ title: event.target.value })}
          className="h-8 text-xs"
          aria-label={labels.heading}
        />
      </PanelRow>
      {/* Switches, not fields: the number, the address and the mailbox are the
          store's contact details, written once in Settings and shown here only
          where they have a value. */}
      <ToggleField
        label={tSafe("admin.footerStudio.panel.showPhone", "Show phone")}
        checked={item.showPhone}
        onChange={(showPhone) => onPatch({ showPhone })}
      />
      <ToggleField
        label={tSafe("admin.footerStudio.panel.showEmail", "Show email")}
        checked={item.showEmail}
        onChange={(showEmail) => onPatch({ showEmail })}
      />
      <ToggleField
        label={tSafe("admin.footerStudio.panel.showAddress", "Show address")}
        checked={item.showAddress}
        onChange={(showAddress) => onPatch({ showAddress })}
      />
    </>
  );
}

function SocialFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: FooterSocialItem;
  onPatch: (patch: Partial<FooterSocialItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow label={labels.heading} align="start">
        <Input
          value={item.title}
          onChange={(event) => onPatch({ title: event.target.value })}
          className="h-8 text-xs"
          aria-label={labels.heading}
        />
      </PanelRow>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {tSafe(
          "admin.footerStudio.panel.socialHint",
          "Which icons appear, and where they point, comes from Branding — this block only decides where they sit.",
        )}
      </p>
    </>
  );
}

/** The normalizer keeps the first 40 links, so the editor stops there too. */
const MAX_LINK_ROWS = 40;

function LinksFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: FooterLinksItem;
  onPatch: (patch: Partial<FooterLinksItem>) => void;
}) {
  const labels = commonLabels(tSafe);
  return (
    <>
      <PanelRow label={labels.heading} align="start">
        <Input
          value={item.title}
          onChange={(event) => onPatch({ title: event.target.value })}
          className="h-8 text-xs"
          aria-label={labels.heading}
        />
      </PanelRow>

      <PanelRow
        label={tSafe("admin.footerStudio.panel.menu", "Menu")}
        align="start"
      >
        <MenuSelect
          value={item.menu}
          onChange={(menu) => onPatch({ menu })}
          ariaLabel={tSafe("admin.footerStudio.panel.menu", "Menu")}
          noneLabel={tSafe("admin.footerStudio.panel.menuNone", "Own links")}
          inactiveLabel={tSafe(
            "admin.footerStudio.panel.menuInactive",
            "inactive",
          )}
          manageLabel={tSafe(
            "admin.footerStudio.panel.manageMenus",
            "Manage menus",
          )}
        />
      </PanelRow>

      {/* A menu wins over the column's own list, so the list is hidden rather
          than shown greyed out — two sets of links on screen with only one of
          them rendering is the confusion this avoids. The list stays in the
          model, so clearing the menu brings it back untouched. */}
      {item.menu ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {tSafe(
            "admin.footerStudio.panel.menuHint",
            "The links come from this menu, and follow it as it changes. Choose \u201cOwn links\u201d to write them here instead.",
          )}
        </p>
      ) : (
        <div className="space-y-2">
          {item.links.map((link) => (
            <div
              key={link.id}
              className="space-y-1.5 rounded-[4px] border bg-muted/30 p-2"
            >
              <div className="flex items-center gap-1.5">
                <Input
                  value={link.label}
                  placeholder={tSafe("admin.footerStudio.links.label", "Label")}
                  onChange={(event) =>
                    onPatch({
                      links: item.links.map((entry) =>
                        entry.id === link.id
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
                    "admin.footerStudio.panel.removeLink",
                    "Remove link",
                  )}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() =>
                    onPatch({
                      links: item.links.filter((entry) => entry.id !== link.id),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              <Input
                value={link.url}
                placeholder={tSafe("admin.footerStudio.links.url", "Url")}
                onChange={(event) =>
                  onPatch({
                    links: item.links.map((entry) =>
                      entry.id === link.id
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
            disabled={item.links.length >= MAX_LINK_ROWS}
            onClick={() =>
              onPatch({
                links: [...item.links, { id: newId(), label: "", url: "" }],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" />
            {tSafe("admin.footerStudio.panel.addLink", "Add link")}
          </Button>
        </div>
      )}
    </>
  );
}

function CopyrightFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: FooterCopyrightItem;
  onPatch: (patch: Partial<FooterCopyrightItem>) => void;
}) {
  return (
    <>
      <PanelRow
        label={tSafe("admin.footerStudio.panel.text", "Text")}
        align="start"
      >
        <Input
          value={item.text}
          onChange={(event) => onPatch({ text: event.target.value })}
          className="h-8 text-xs"
          aria-label={tSafe("admin.footerStudio.panel.text", "Text")}
        />
      </PanelRow>
      {/* The year and the name are composed as the page renders, which is why
          they are switches and not something to type: a hard-typed "2024" is
          the one line nobody remembers to come back to. */}
      <ToggleField
        label={tSafe("admin.footerStudio.panel.showYear", "Show year")}
        checked={item.showYear}
        onChange={(showYear) => onPatch({ showYear })}
      />
      <ToggleField
        label={tSafe(
          "admin.footerStudio.panel.showStoreName",
          "Show store name",
        )}
        checked={item.showStoreName}
        onChange={(showStoreName) => onPatch({ showStoreName })}
      />
    </>
  );
}

function PaymentsFields({
  tSafe,
  item,
  onPatch,
}: {
  tSafe: TSafe;
  item: FooterPaymentsItem;
  onPatch: (patch: Partial<FooterPaymentsItem>) => void;
}) {
  return (
    <>
      <PanelRow
        label={tSafe("admin.footerStudio.panel.imageUrl", "Image URL")}
        align="start"
      >
        <Input
          value={item.imageUrl}
          placeholder="https://"
          onChange={(event) => onPatch({ imageUrl: event.target.value })}
          className="h-8 text-xs"
          aria-label={tSafe("admin.footerStudio.panel.imageUrl", "Image URL")}
        />
      </PanelRow>
      <PanelRow
        label={tSafe("admin.footerStudio.panel.imageAlt", "Alt text")}
        align="start"
      >
        <Input
          value={item.imageAlt}
          onChange={(event) => onPatch({ imageAlt: event.target.value })}
          className="h-8 text-xs"
          aria-label={tSafe("admin.footerStudio.panel.imageAlt", "Alt text")}
        />
      </PanelRow>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {tSafe(
          "admin.footerStudio.panel.paymentsHint",
          "One strip of card marks, as a single image. Without artwork the block stays empty on the storefront.",
        )}
      </p>
    </>
  );
}