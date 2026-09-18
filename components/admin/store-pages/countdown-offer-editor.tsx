"use client";

import { useState, type ReactNode } from "react";
import { LayoutGrid } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CollectionProductSelector } from "@/components/admin/collection-product-selector";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import {
  DEAL_LAYOUTS,
  getDealLayout,
  type DealLayout,
} from "@/lib/storefront/sections/deal-layouts";
import { VARIANT_FIELD_KEY } from "@/lib/storefront/sections/types";
import type { SectionCatalogEntry } from "@/lib/storefront/sections/types";
import { fieldsForVariant } from "@/lib/storefront/sections/variant-fields";
import { cn } from "@/lib/utils";
import { EditorGroup, FieldRenderer, isCompactField, isFieldShown } from "./field-renderer";
import { EditorShell, PanelGroup } from "./editor-shell";
import { OptionTile } from "./slider-setup-panels";

type TSafe = ReturnType<typeof createTSafe>;

/** The settings the groups below hand-place; the generic form skips them. */
const PLACED_KEYS = new Set(["layout", "productIds", VARIANT_FIELD_KEY]);

/**
 * The Countdown Offer inspector in three groups, in the order a merchant
 * decides them: the arrangement, then the copy and paint, then the deals.
 *
 * The layout is picked from tiles rather than a dropdown, like the
 * promotion grid's, because "featured + 2" means nothing until you see it.
 * The deals picker only offers products that carry a deal, and its cap is
 * the layout's slot count, so a merchant cannot pick a sixth deal for five
 * places and wonder where it went.
 */
export function CountdownOfferEditor({
  preview,
  entry,
  variant,
  settings,
  onSettingChange,
  languages,
  defaultLanguage,
  locale,
  sectionId,
}: {
  /** The storefront's render of the section, from the builder. */
  preview?: ReactNode;
  entry: SectionCatalogEntry;
  variant: string | undefined;
  settings: Record<string, unknown>;
  onSettingChange: (key: string, value: unknown) => void;
  languages: string[];
  defaultLanguage: string;
  locale: string;
  sectionId: string;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const [layoutOpen, setLayoutOpen] = useState(false);

  const fields = fieldsForVariant(entry.fields, variant);
  const imageContext = { locale, sectionType: entry.type, sectionId };

  // The slider editor's shape: short controls in the panel beside the
  // preview, wide ones — the copy, the pictures — under it.
  const renderFields = (list: typeof fields, layout: "grid" | "panel") => (
    <FieldRenderer
      fields={list}
      layout={layout}
      settings={settings}
      onChange={onSettingChange}
      languages={languages}
      defaultLanguage={defaultLanguage}
      imageContext={imageContext}
    />
  );
  const contentGroup = (list: typeof fields) =>
    list.some((field) => isFieldShown(field, settings)) ? (
      <EditorGroup title={tSafe("admin.storeBuilder.sectionEditor.content", "Content")}>
        {renderFields(list, "grid")}
      </EditorGroup>
    ) : null;

  if (variant !== "deals-panel") {
    const plain = fields.filter((field) => field.key !== VARIANT_FIELD_KEY);
    const compact = plain.filter((field) => isCompactField(field));
    const wide = plain.filter((field) => !isCompactField(field));
    return (
      <EditorShell
        preview={preview}
        panel={compact.length > 0 ? renderFields(compact, "panel") : null}
      >
        {contentGroup(wide)}
      </EditorShell>
    );
  }

  const layout = getDealLayout(settings.layout);
  const picks = Array.isArray(settings.productIds)
    ? (settings.productIds as string[])
    : [];
  const layoutLabel = (key: string, fallback: string) =>
    tSafe(`admin.storeBuilder.countdown.layouts.${key}`, fallback);
  const placed = fields.filter((field) => !PLACED_KEYS.has(field.key));
  const compact = placed.filter((field) => isCompactField(field));
  const wide = placed.filter((field) => !isCompactField(field));

  return (
    <EditorShell
      preview={preview}
      panel={
        <>
          {/* The arrangement first: the one choice the rest hangs off. */}
          <PanelGroup
            title={tSafe("admin.storeBuilder.fields.layout", "Layout")}
            hint={tSafe(
              "admin.storeBuilder.countdown.layoutHint",
              "How the deals are arranged. The featured slot is the large card with gallery, colours and add-to-cart.",
            )}
            badge={tSafe("admin.storeBuilder.countdown.slotsUsed", "{count} of {max} slots", {
              count: Math.min(picks.length, layout.slots),
              max: layout.slots,
            })}
          >
            <div className="flex items-center gap-3">
              <div className="w-24 shrink-0 rounded-md border border-border bg-muted/40 p-1.5">
                <LayoutThumb layout={layout} />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-xs font-semibold">
                  {layoutLabel(layout.key, layout.label)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLayoutOpen(true)}
                  className="h-8 gap-1.5 text-xs"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  {tSafe("admin.storeBuilder.countdown.changeLayout", "Change layout")}
                </Button>
              </div>
            </div>
          </PanelGroup>
          {compact.length > 0 ? renderFields(compact, "panel") : null}
        </>
      }
    >
      {contentGroup(wide)}

      <EditorGroup
        title={tSafe("admin.storeBuilder.countdown.dealsTitle", "Deals")}
        count={Math.min(picks.length, layout.slots)}
        hint={tSafe(
          "admin.storeBuilder.countdown.perProductTimer",
          "One deadline for the whole panel. Every deal counts down to the same moment.",
        )}
      >
        <p className="text-xs leading-snug text-muted-foreground">
          {tSafe(
            "admin.storeBuilder.countdown.dealsHint",
            "Only products currently on sale are offered. Drag to set the slot order; leave empty to show whatever is on sale.",
          )}
        </p>
        <CollectionProductSelector
          selectedProducts={picks}
          onChange={(ids) => onSettingChange("productIds", ids)}
          // The group above already says "Deals"; the picker names what it
          // holds so the two captions do not read as one word twice.
          title={tSafe("admin.storeBuilder.fields.productIds", "Products")}
          max={layout.slots}
          query={{ onSale: "true" }}
        />
      </EditorGroup>

      <DealLayoutDialog
        open={layoutOpen}
        onOpenChange={setLayoutOpen}
        value={layout.key}
        onSelect={(key) => onSettingChange("layout", key)}
        tSafe={tSafe}
      />
    </EditorShell>
  );
}

/**
 * A layout at miniature scale: one box per slot on the layout's own grid,
 * the featured slot in the accent so the merchant can see which card will
 * be the big one.
 */
function LayoutThumb({ layout }: { layout: DealLayout }) {
  // Collapse minmax() to its flexible max, as the slider thumbs do: a pixel
  // minimum wider than the thumbnail would blow the grid out of the tile.
  const columns = layout.columns.replace(/minmax\([^,]+,\s*([^)]+)\)/g, "$1");
  return (
    <div
      className="grid h-14 gap-1"
      style={{
        gridTemplateColumns: columns,
        gridTemplateRows: layout.rows,
        gridTemplateAreas: layout.areas,
      }}
    >
      {layout.slotAreas.map((area, index) => (
        <span
          key={area}
          className={cn(
            "rounded-[3px]",
            index === layout.hero ? "bg-primary/70" : "bg-foreground/25",
          )}
          style={{ gridArea: area }}
        />
      ))}
    </div>
  );
}

/** The "Pick a deals layout" sheet: every arrangement as a tile. */
function DealLayoutDialog({
  open,
  onOpenChange,
  value,
  onSelect,
  tSafe,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onSelect: (key: string) => void;
  tSafe: TSafe;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {tSafe("admin.storeBuilder.countdown.layoutTitle", "Pick a deals layout")}
          </DialogTitle>
          <DialogDescription>
            {tSafe(
              "admin.storeBuilder.countdown.layoutHint",
              "How the deals are arranged. The featured slot is the large card with gallery, colours and add-to-cart.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {DEAL_LAYOUTS.map((layout) => (
            <OptionTile
              key={layout.key}
              label={tSafe(
                `admin.storeBuilder.countdown.layouts.${layout.key}`,
                layout.label,
              )}
              selected={value === layout.key}
              onSelect={() => {
                onSelect(layout.key);
                onOpenChange(false);
              }}
            >
              <LayoutThumb layout={layout} />
            </OptionTile>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
