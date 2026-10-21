"use client";

/**
 * `TemplateRenderer` (docs/INVOICE_TEMPLATE_BUILDER.md §4.6): the one
 * renderer the canvas, the preview, thumbnails and print draw through. It
 * takes a template design, a render context and a mode, measures the
 * flowing block's rows at 100 % (on screen), runs pagination and renders the
 * pages: absolutely positioned elements in millimetres, pure output, no
 * editor state. Editor chrome belongs in a separate overlay (§4.1).
 *
 * `measure` lets a caller hand back what an earlier screen render measured
 * (row heights, shrink-to-fit sizes), so a print rendered to static markup
 * paginates exactly as the preview did. `onMeasure` reports it.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PrintContext } from "@/lib/invoice-templates/context-types";
import { shrinksToFit } from "@/lib/invoice-templates/editor/review";
import { fontFaceCss } from "@/lib/invoice-templates/fonts";
import { findFlowingBlock, pageContext, paginate, type PaginatedPage, type Pagination, type RowMeasure } from "@/lib/invoice-templates/pagination";
import type { FitResult } from "@/lib/invoice-templates/shrink";
import type { TemplateDesign } from "@/lib/invoice-templates/types";
import { ElementView } from "./element-view";
import { RowMeasurer } from "./measure";
import { RendererProvider } from "./render-context";
import { mm } from "./styles";
import type { RenderMeasure, RenderMode } from "./types";

/** The renderer's own rules; the print document includes them too. */
export const RENDERER_CSS = [
  ".it-doc{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;}",
  ".it-page{position:relative;overflow:hidden;box-sizing:border-box;margin:0;color:#111;}",
  ".it-page,.it-page *{box-sizing:border-box;}",
  ".it-page svg{display:block;}",
  ".it-doc[data-mode=screen] .it-page{box-shadow:0 1px 4px rgba(0,0,0,.18);}",
  "@media print{.it-measure{display:none !important;}.it-page{box-shadow:none !important;break-after:page;page-break-after:always;}.it-page:last-child{break-after:auto;page-break-after:auto;}}",
].join("\n");

/** Fonts plus rules, as one stylesheet. */
export function rendererStylesheet(fontOrigin = ""): string {
  return `${fontFaceCss(fontOrigin)}\n${RENDERER_CSS}`;
}

export interface TemplateRendererProps {
  template: TemplateDesign;
  context: PrintContext;
  mode?: RenderMode;
  /** Measurements from an earlier screen render; used as they are. */
  measure?: RenderMeasure | null;
  onMeasure?: (measure: RenderMeasure) => void;
  /** Space between pages on screen. */
  pageGapMm?: number;
  /** Origin for the font URLs (a print iframe written from another base). */
  fontOrigin?: string;
  /** Leave the stylesheet out when the host document already carries it. */
  withStyles?: boolean;
  className?: string;
}

/** Pages for a design and context, with the measure a screen render captured (or estimates). */
export function layoutTemplate(template: TemplateDesign, context: PrintContext, measure?: RenderMeasure | null): Pagination {
  return paginate({ canvas: template.canvas, elements: template.elements, rowCount: context.items.length, measure: measure?.rows ?? null });
}

function Page({ page, template, context, mode }: { page: PaginatedPage; template: TemplateDesign; context: PrintContext; mode: RenderMode }) {
  const pageCtx = useMemo(() => pageContext(context, page), [context, page]);
  return (
    <div
      className="it-page"
      data-page={page.number}
      data-page-count={page.count}
      style={{ width: mm(page.widthMm), height: mm(page.heightMm), background: template.canvas.background || "#ffffff" }}
    >
      {page.elements.map((placed) => (
        <ElementView key={placed.element.id} element={placed.element} placed={placed} context={pageCtx} design={template} mode={mode} />
      ))}
    </div>
  );
}

export function TemplateRenderer({
  template,
  context,
  mode = "screen",
  measure,
  onMeasure,
  pageGapMm = 8,
  fontOrigin = "",
  withStyles = true,
  className,
}: TemplateRendererProps) {
  const [rows, setRows] = useState<RowMeasure | null>(null);
  const [fits, setFits] = useState<Record<string, FitResult>>({});
  const rowsMeasure = measure?.rows ?? rows;
  const knownFits = measure?.fits ?? fits;

  const pagination = useMemo(
    () => paginate({ canvas: template.canvas, elements: template.elements, rowCount: context.items.length, measure: rowsMeasure }),
    [template.canvas, template.elements, context.items.length, rowsMeasure],
  );
  const block = useMemo(() => findFlowingBlock(template.elements), [template.elements]);

  const handleRows = useCallback(
    (next: RowMeasure) => {
      setRows(next);
      onMeasure?.({ rows: next, fits: knownFits });
    },
    [onMeasure, knownFits],
  );
  // Fits arrive from the elements' layout effects, several in one commit. A ref holds the running map, so each report builds on the
  // last, and `onMeasure` (which sets the parent's state) is called here, never inside a state updater (React runs those while rendering).
  const fitsRef = useRef(fits);
  const reportFit = useCallback(
    (elementId: string, fit: FitResult) => {
      const previous = fitsRef.current;
      const known = previous[elementId];
      if (known && known.px === fit.px && known.fits === fit.fits) return;
      const next = { ...previous, [elementId]: fit };
      fitsRef.current = next;
      setFits(next);
      onMeasure?.({ rows: rowsMeasure, fits: next });
    },
    [onMeasure, rowsMeasure],
  );
  // An element removed, or no longer shrinking to fit, drops its measure: a stale "doesn't fit" would otherwise stay in the
  // editor's warnings and in what a print is handed. The elements' own reports run first (child effects), so a box that just
  // started shrinking is kept.
  useLayoutEffect(() => {
    const previous = fitsRef.current;
    const elements = new Map(template.elements.map((element) => [element.id, element]));
    const kept = Object.entries(previous).filter(([id]) => {
      const element = elements.get(id);
      return element !== undefined && shrinksToFit(element);
    });
    if (kept.length === Object.keys(previous).length) return;
    const next = Object.fromEntries(kept);
    fitsRef.current = next;
    setFits(next);
    onMeasure?.({ rows: rowsMeasure, fits: next });
  }, [template.elements, onMeasure, rowsMeasure]);

  const state = useMemo(() => ({ mode, fits: knownFits, reportFit }), [mode, knownFits, reportFit]);
  const stylesheet = useMemo(() => rendererStylesheet(fontOrigin), [fontOrigin]);

  return (
    <RendererProvider value={state}>
      <div
        className={["it-doc", className].filter(Boolean).join(" ")}
        data-mode={mode}
        data-pages={pagination.pages.length}
        style={mode === "screen" ? { display: "flex", flexDirection: "column", rowGap: mm(pageGapMm), position: "relative" } : { position: "relative" }}
      >
        {withStyles && <style dangerouslySetInnerHTML={{ __html: stylesheet }} />}
        {pagination.pages.map((page) => (
          <Page key={page.number} page={page} template={template} context={context} mode={mode} />
        ))}
        {mode === "screen" && block && !measure?.rows && (
          <RowMeasurer block={block} context={context} design={template} onMeasure={handleRows} />
        )}
      </div>
    </RendererProvider>
  );
}
