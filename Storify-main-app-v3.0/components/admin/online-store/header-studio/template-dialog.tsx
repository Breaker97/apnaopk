"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HeaderLayout } from "@/lib/site-config/header-layout";
import {
  HEADER_LAYOUT_PRESETS,
  type HeaderLayoutPresetKey,
} from "@/lib/site-config/header-layout-presets";
import {
  HeaderStudioPreview,
  type PreviewBrand,
} from "@/components/admin/online-store/header-studio/header-studio-preview";
import type { TSafe } from "@/components/admin/online-store/t-safe";

/**
 * The Figma "Select from template" sheet. Each card is the preset rendered
 * by the same preview component the studio uses, scaled down — a card drawn
 * separately would drift from what the template actually builds.
 *
 * One template per row, at the widest the dialog allows: a header is a
 * wide, short thing, and two abreast made every one of them a strip of
 * unreadable dots. The card is `zoom`ed rather than transformed so its box
 * shrinks with it and the list has no phantom height between cards.
 */

/** The width the preview is laid out at before it is shrunk to the card. */
const PREVIEW_WIDTH = 1100;
const PREVIEW_ZOOM = 0.72;
export function TemplateDialog({
  open,
  onOpenChange,
  onSelect,
  brand,
  tSafe,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: HeaderLayoutPresetKey, layout: HeaderLayout) => void;
  brand: PreviewBrand;
  tSafe: TSafe;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {tSafe("admin.headerStudio.templates.title", "Header templates")}
          </DialogTitle>
          <DialogDescription>
            {tSafe(
              "admin.headerStudio.templates.description",
              "A template replaces the rows on the canvas. Everything in it stays editable afterwards.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {HEADER_LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => onSelect(preset.key, preset.build())}
              className="space-y-2.5 rounded-[12px] border p-3 text-left transition-colors hover:border-primary hover:bg-muted/40"
            >
              <div className="overflow-hidden rounded-[4px] border bg-muted/30 p-3">
                <div
                  style={{ width: PREVIEW_WIDTH, zoom: PREVIEW_ZOOM }}
                >
                  <HeaderStudioPreview
                    layout={preset.build()}
                    brand={brand}
                    className="pointer-events-none"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold">
                  {tSafe(
                    `admin.headerStudio.templates.${preset.key}.label`,
                    preset.label,
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {tSafe(
                    `admin.headerStudio.templates.${preset.key}.description`,
                    preset.description,
                  )}
                </p>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
