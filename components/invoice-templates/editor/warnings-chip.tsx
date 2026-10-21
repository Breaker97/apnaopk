"use client";

/**
 * The warnings chip (§5.2): how many things the Review tab has to say about
 * the design — layout (outside the printable area, overlapping), data a
 * category never has, barcodes and QR codes that can't be drawn or scanned,
 * text that overflows (review.ts). A click opens the Review tab and selects
 * the next warning's element(s) on the canvas, so repeated clicks walk
 * through them.
 */
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditorApi } from "./editor-store";
import { TOOL_BUTTON_CLASS } from "./editor-styles";
import { useReviewWarnings } from "./review-panel";

export function WarningsChip() {
  const t = useTranslations("admin.invoiceTemplates.editor.warnings");
  const api = useEditorApi();
  const warnings = useReviewWarnings();
  const next = useRef(0);
  const count = warnings.length;
  const label = t("label", { count });

  const open = () => {
    api.getState().setPanelTab("review");
    if (count === 0) return;
    const at = next.current % count;
    next.current = at + 1;
    api.getState().select(warnings[at]!.elementIds);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={label}
          onClick={open}
          data-action="warnings"
          data-count={count}
          className={cn(TOOL_BUTTON_CLASS, "gap-1 px-2.5 tabular-nums", count > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
        >
          {count > 0 ? <TriangleAlert aria-hidden className="h-4 w-4" /> : <CircleCheck aria-hidden className="h-4 w-4" />}
          {count}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{count > 0 ? t("hint") : t("none")}</TooltipContent>
    </Tooltip>
  );
}
