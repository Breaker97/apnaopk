"use client";

/**
 * Size ▾ (§5.2, §5.10, D-13): the paper presets and Custom (width and height
 * in mm, 20–500 × 20–1000). Each change is one undo step; elements are never
 * moved, scaled or deleted — whatever falls outside shows as out of bounds.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { CANVAS_SIZE_KEYS, CANVAS_SIZES, CUSTOM_SIZE_LIMITS, isCanvasSizeKey, type CanvasSizeKey } from "@/lib/invoice-templates/canvas-sizes";
import type { TemplateCanvas } from "@/lib/invoice-templates/types";
import { roundMm } from "@/lib/invoice-templates/units";
import { cn } from "@/lib/utils";
import { useEditor, useEditorApi } from "./editor-store";
import { TOOL_BUTTON_CLASS } from "./editor-styles";

/** "A4 portrait · 210 × 297 mm", "Thermal 80 mm · 80 mm roll", "Custom size · 120 × 90 mm". */
export function useSizeLabels() {
  const t = useTranslations("admin.invoiceTemplates.editor.size");
  const tManager = useTranslations("admin.invoiceTemplates.manager");
  const dimensions = (size: Pick<TemplateCanvas, "widthMm" | "heightMm" | "heightMode">) =>
    size.heightMode === "auto"
      ? tManager("rollSize", { width: size.widthMm })
      : tManager("pageSize", { width: size.widthMm, height: size.heightMm });
  return {
    name: (key: CanvasSizeKey | "custom") => tManager(`sizeNames.${key}`),
    dimensions,
    option: (key: CanvasSizeKey) => t("option", { name: tManager(`sizeNames.${key}`), size: dimensions(CANVAS_SIZES[key]) }),
    current: (canvas: TemplateCanvas) =>
      t("option", { name: tManager(`sizeNames.${isCanvasSizeKey(canvas.preset) ? canvas.preset : "custom"}`), size: dimensions(canvas) }),
  };
}

export function CustomSizeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("admin.invoiceTemplates.editor.size");
  const api = useEditorApi();
  const canvas = useEditor((state) => state.design.canvas);
  const [size, setSize] = useState({ widthMm: canvas.widthMm, heightMm: canvas.heightMm });
  const [opened, setOpened] = useState(open);
  if (open !== opened) {
    // Each opening starts from the canvas as it is now.
    setOpened(open);
    if (open) setSize({ widthMm: canvas.widthMm, heightMm: canvas.heightMm });
  }
  const apply = () => {
    api.getState().setCustomSize(size.widthMm, size.heightMm);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("customTitle")}</DialogTitle>
          <DialogDescription>
            {t("customDescription", {
              minWidth: CUSTOM_SIZE_LIMITS.minWidthMm,
              maxWidth: CUSTOM_SIZE_LIMITS.maxWidthMm,
              minHeight: CUSTOM_SIZE_LIMITS.minHeightMm,
              maxHeight: CUSTOM_SIZE_LIMITS.maxHeightMm,
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="custom-size-width">{t("width")}</Label>
            <NumberInput
              id="custom-size-width"
              step={0.1}
              min={CUSTOM_SIZE_LIMITS.minWidthMm}
              max={CUSTOM_SIZE_LIMITS.maxWidthMm}
              whenEmpty="keep"
              normalize={roundMm}
              value={size.widthMm}
              onValueChange={(value) => value !== undefined && setSize((current) => ({ ...current, widthMm: value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="custom-size-height">{t("height")}</Label>
            <NumberInput
              id="custom-size-height"
              step={0.1}
              min={CUSTOM_SIZE_LIMITS.minHeightMm}
              max={CUSTOM_SIZE_LIMITS.maxHeightMm}
              whenEmpty="keep"
              normalize={roundMm}
              value={size.heightMm}
              onValueChange={(value) => value !== undefined && setSize((current) => ({ ...current, heightMm: value }))}
            />
          </div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit">{t("apply")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SizeMenu() {
  const t = useTranslations("admin.invoiceTemplates.editor.size");
  const api = useEditorApi();
  const canvas = useEditor((state) => state.design.canvas);
  const labels = useSizeLabels();
  const [customOpen, setCustomOpen] = useState(false);
  const current = labels.current(canvas);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className={cn(TOOL_BUTTON_CLASS, "gap-1 px-2.5")} aria-label={t("menu", { size: current })} data-action="size">
            <Ruler aria-hidden className="h-4 w-4" />
            <span className="hidden max-w-[11rem] truncate 2xl:inline">{current}</span>
            <ChevronDown aria-hidden className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuRadioGroup
            value={isCanvasSizeKey(canvas.preset) ? canvas.preset : "custom"}
            onValueChange={(value) => {
              if (isCanvasSizeKey(value)) api.getState().setCanvasSize(value);
            }}
          >
            {CANVAS_SIZE_KEYS.map((key) => (
              <DropdownMenuRadioItem key={key} value={key} data-size={key}>
                {labels.option(key)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCustomOpen(true)} data-size="custom">
            {t("custom")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomSizeDialog open={customOpen} onOpenChange={setCustomOpen} />
    </>
  );
}
