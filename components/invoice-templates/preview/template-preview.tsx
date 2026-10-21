"use client";

/**
 * `TemplatePreview` (docs/INVOICE_TEMPLATE_BUILDER.md §7 Phase 2 step 7):
 * a template's pages at real size, scaled down only when the column is
 * narrower than the page (fit to width; never enlarged). The renderer lays
 * the pages out at 100 % inside a CSS transform, so what it measures (row
 * heights, shrink-to-fit) is what prints; `onMeasure` hands that measure up
 * for `printTemplate`. Sample data is labelled above the page, never on it.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { layoutTemplate, TemplateRenderer } from "@/components/invoice-templates/renderer/template-renderer";
import type { RenderMeasure } from "@/components/invoice-templates/renderer/types";
import type { PrintContext } from "@/lib/invoice-templates/context-types";
import { findFlowingBlock, MAX_PAGES } from "@/lib/invoice-templates/pagination";
import { mmToPx } from "@/lib/invoice-templates/units";
import type { TemplateDesign } from "@/lib/invoice-templates/types";
import { cn } from "@/lib/utils";

export interface TemplatePreviewProps {
  design: TemplateDesign;
  context: PrintContext;
  /**
   * The latest measure (rows and shrink-to-fit sizes, merged), or null while a
   * new design or context is being measured; pass it to `printTemplate`.
   */
  onMeasure?: (measure: RenderMeasure | null) => void;
  /** Largest scale; 1 = real size. */
  maxScale?: number;
  className?: string;
}

const PAGE_GAP_MM = 8;

/** Merges a renderer report into what is already known (rows and fits arrive separately). */
export function mergeMeasure(previous: RenderMeasure | null, next: RenderMeasure): RenderMeasure {
  return { rows: next.rows ?? previous?.rows ?? null, fits: { ...(previous?.fits ?? {}), ...next.fits } };
}

/** Whether a print can use the measure: the flowing block's rows were measured (or there are none to measure). */
export function measureReady(design: TemplateDesign, context: PrintContext, measure: RenderMeasure | null): boolean {
  return !findFlowingBlock(design.elements) || context.items.length === 0 || Boolean(measure?.rows);
}

export function TemplatePreview({ design, context, onMeasure, maxScale = 1, className }: TemplatePreviewProps) {
  const t = useTranslations("admin.invoiceTemplates.preview");
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState(0);
  // A new design or context is drawn by a fresh renderer and measured afresh.
  const [tracked, setTracked] = useState({ design, context, key: 0, measure: null as RenderMeasure | null });
  if (tracked.design !== design || tracked.context !== context) {
    setTracked({ design, context, key: tracked.key + 1, measure: null });
  }
  const { key: renderKey, measure } = tracked;

  const handleMeasure = useCallback(
    (next: RenderMeasure) =>
      setTracked((previous) => (previous.key === renderKey ? { ...previous, measure: mergeMeasure(previous.measure, next) } : previous)),
    [renderKey],
  );
  useEffect(() => {
    onMeasure?.(measure);
  }, [measure, onMeasure]);

  // Only the column is observed; the pages' own size comes from the layout, not from the DOM.
  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const read = () => setAvailable(outer.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(outer);
    return () => observer.disconnect();
  }, []);

  // The same pages the renderer draws: it paginates with the rows it measured, which are the ones reported here.
  const layout = useMemo(() => layoutTemplate(design, context, measure), [design, context, measure]);
  const { pages } = layout;
  const pageCount = pages.length;
  const heightMm = Math.round((pages[0]?.heightMm ?? design.canvas.heightMm) * 10) / 10;
  const natural = {
    width: mmToPx(Math.max(...pages.map((page) => page.widthMm), design.canvas.widthMm)),
    height: mmToPx(pages.reduce((sum, page) => sum + page.heightMm, 0) + PAGE_GAP_MM * Math.max(0, pages.length - 1)),
  };
  const scale = available > 0 ? Math.min(maxScale, available / natural.width) : Math.min(maxScale, 1);
  const ready = measureReady(design, context, measure);
  // Rows the paper can't show whole, or at all. Said only once the rows are measured: estimates would flicker.
  const flowWarnings = ready
    ? [
        layout.clippedRows > 0 && t("flow.clipped", { count: layout.clippedRows }),
        layout.droppedRows > 0 && t("flow.dropped", { count: layout.droppedRows, max: MAX_PAGES }),
      ].filter((text): text is string => Boolean(text))
    : [];

  return (
    <div className={cn("space-y-3", className)} data-invoice-preview="" data-ready={ready ? "true" : "false"} data-pages={pageCount}>
      {context.isSample && (
        <div
          role="note"
          className="flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs font-semibold tracking-wide text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          <TriangleAlert aria-hidden className="h-4 w-4 shrink-0" />
          {t("sampleBanner")}
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground tabular-nums">
        {t("pageInfo", {
          width: design.canvas.widthMm,
          height: heightMm,
          pages: pageCount,
          zoom: Math.round(scale * 100),
        })}
      </p>
      {flowWarnings.map((text) => (
        <p
          key={text}
          role="alert"
          data-flow-warning=""
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
        >
          <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          {text}
        </p>
      ))}
      <div ref={outerRef} className="w-full overflow-hidden rounded-lg bg-muted/50 p-0">
        <div className="mx-auto" style={{ width: natural.width * scale || undefined, height: natural.height * scale || undefined }}>
          <div style={{ width: "max-content", transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <TemplateRenderer key={renderKey} template={design} context={context} mode="screen" pageGapMm={PAGE_GAP_MM} onMeasure={handleMeasure} />
          </div>
        </div>
      </div>
    </div>
  );
}
