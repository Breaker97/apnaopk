"use client";

import { useState } from "react";
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
import { EditorGroup, FieldRenderer } from "./field-renderer";
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
  entry,
  variant,
  settings,
  onSettingChange,
  languages,
  defaultLanguage,
  locale,
  sectionId,
}: {
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

  // The image banner design has no arrangement and no deals: it is the
  // generic form, and nothing else.
  if (variant !== "deals-panel") {
    return (
      <EditorGroup
        title={tSafe("admin.storeBuilder.sectionEditor.settings", "Settings")}
      >
        <FieldRenderer
          fields={fields.filter((field) => field.key !== VARIANT_FIELD_KEY)}
          settings={settings}
          onChange={onSettingChange}
          languages={languages}
          defaultLanguage={defaultLanguage}
          imageContext={imageContext}
        />
      </EditorGroup>
    );
  }

  const layout = getDealLayout(settings.layout);
  const picks = Array.isArray(settings.productIds)
    ? (settings.productIds as string[])
    : [];
  const layoutLabel = (key: string, fallback: string) =>
    tSafe(`admin.storeBuilder.countdown.layouts.${key}`, fallback);

  return (
    <div className="space-y-6">
      <EditorGroup
        title={tSafe("admin.storeBuilder.fields.layout", "Layout")}
        hint={tSafe(
          "admin.storeBuilder.countdown.layoutHint",
          "How the deals are arranged. The featured slot is the large card with gallery, colours and add-to-cart.",
        )}
      >
        <div className="flex flex-wrap items-center gap-4 rounded-[10px] border bg-muted/30 p-3">
          <div className="w-40 rounded-md bg-card p-2 shadow-sm">
            <LayoutThumb layout={layout} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold">
              {layoutLabel(layout.key, layout.label)}
            </p>
            <p className="text-xs text-muted-foreground">
              {tSafe("admin.storeBuilder.countdown.slotsUsed", "{count} of {max} slots", {
                count: Math.min(picks.length, layout.slots),
                max: layout.slots,
              })}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setLayoutOpen(true)}
            className="gap-2"
          >
            <LayoutGrid className="h-4 w-4" />
            {tSafe("admin.storeBuilder.countdown.changeLayout", "Change layout")}
          </Button>
        </div>
      </EditorGroup>

      <EditorGroup
        title={tSafe("admin.storeBuilder.sectionEditor.settings", "Settings")}
      >
        <FieldRenderer
          fields={fields.filter((field) => !PLACED_KEYS.has(field.key))}
          settings={settings}
          onChange={onSettingChange}
          languages={languages}
          defaultLanguage={defaultLanguage}
          imageContext={imageContext}
        />
      </EditorGroup>

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
    </div>
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
