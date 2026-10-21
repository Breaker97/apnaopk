"use client";

/**
 * The editor canvas (docs/INVOICE_TEMPLATE_BUILDER.md §4.4, §5.1, §5.4): the
 * template's pages drawn by the one renderer (`TemplateRenderer`, sample
 * data), with the editing overlay on top. The pages are laid out at 100 %
 * and zoomed with a CSS transform, so text wraps and rows paginate exactly
 * as they print; zoom never changes the design.
 *
 * Page view "single" shows page 1 of a short sample order. "Flow" shows
 * every page of a 60-line sample, so continuation pages and last-page blocks
 * (`notFirst`, `last`) can be seen and edited.
 *
 * The canvas is a focusable region: once it has focus (a click on the page
 * gives it), Tab walks through the elements in reading order and the editor's
 * shortcuts apply.
 */
import { forwardRef, useCallback, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import { layoutTemplate, TemplateRenderer } from "@/components/invoice-templates/renderer/template-renderer";
import type { RenderMeasure } from "@/components/invoice-templates/renderer/types";
import type { PrintContext } from "@/lib/invoice-templates/context-types";
import { isPaletteItemKey, PALETTE_DRAG_TYPE, type PaletteItemKey } from "@/lib/invoice-templates/editor/palette";
import type { RowMeasure } from "@/lib/invoice-templates/pagination";
import { sampleContext } from "@/lib/invoice-templates/sample-context";
import type { TemplateCategory, TemplateLocale } from "@/lib/invoice-templates/types";
import { mmToPx, PX_PER_MM } from "@/lib/invoice-templates/units";
import { cn } from "@/lib/utils";
import { CanvasOverlay, type ShownPage } from "./canvas-overlay";
import { useEditor, useEditorApi, type PageView } from "./editor-store";

/** Space between stacked pages, as the renderer draws it. */
const PAGE_GAP_MM = 8;
/** Room around the page inside the scrolling view, in screen px. */
const VIEW_PADDING_PX = 40;
/** The sample order the flow view lays out: long enough for first, middle and last pages. */
export const FLOW_SAMPLE_ITEMS = 60;

/** Page view "single" draws only the first page, whatever the renderer lays out. */
const CANVAS_CSS = ".ied-single .it-page:not([data-page='1']){display:none !important;}";

export interface EditorCanvasHandle {
  /** The middle of what the canvas shows, in page mm (where a clicked palette item lands). */
  viewCentreMm: () => { xMm: number; yMm: number };
  focus: () => void;
}

export interface EditorCanvasProps {
  /** A palette item dropped on the page at a point (page mm). */
  onDropItem: (key: PaletteItemKey, at: { xMm: number; yMm: number }) => void;
  className?: string;
}

/** The sample order each page view draws. */
export function canvasContext(category: TemplateCategory, locale: TemplateLocale, view: PageView): PrintContext {
  return view === "flow" ? sampleContext(category, locale, { items: FLOW_SAMPLE_ITEMS }) : sampleContext(category, locale);
}

/** Elements in reading order (top to bottom, then left to right), for Tab. */
function readingOrder(pages: ShownPage[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const { page } of pages) {
    const placed = [...page.elements].sort((a, b) => a.yMm - b.yMm || a.xMm - b.xMm);
    for (const each of placed) {
      if (seen.has(each.element.id)) continue;
      seen.add(each.element.id);
      order.push(each.element.id);
    }
  }
  return order;
}

export const EditorCanvas = forwardRef<EditorCanvasHandle, EditorCanvasProps>(function EditorCanvas({ onDropItem, className }, ref) {
  const t = useTranslations("admin.invoiceTemplates.editor.canvas");
  const api = useEditorApi();
  const design = useEditor((state) => state.design);
  const category = useEditor((state) => state.category);
  const zoom = useEditor((state) => state.zoom);
  const zoomMode = useEditor((state) => state.zoomMode);
  const pageView = useEditor((state) => state.pageView);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const instructionsId = useId();

  const locale = design.locale;
  const context = useMemo(() => canvasContext(category, locale, pageView), [category, locale, pageView]);

  // The rows the renderer measured for this sample order. The renderer keeps
  // its own copy and paginates with it; mirroring it here gives the overlay
  // the very same pages.
  const [measured, setMeasured] = useState<{ context: PrintContext; rows: RowMeasure | null }>({ context, rows: null });
  const rows = measured.context === context ? measured.rows : null;
  const handleMeasure = useCallback(
    (measure: RenderMeasure) => {
      // What the text boxes could and couldn't fit: the Review tab warns about the ones that still overflow.
      api.getState().setFits(measure.fits);
      if (!measure.rows) return;
      setMeasured((previous) => (previous.context === context && previous.rows === measure.rows ? previous : { context, rows: measure.rows }));
    },
    [context, api],
  );

  const layout = useMemo(() => layoutTemplate(design, context, rows ? { rows, fits: {} } : null), [design, context, rows]);
  const shown: ShownPage[] = useMemo(() => {
    const pages = pageView === "flow" ? layout.pages : layout.pages.slice(0, 1);
    let top = 0;
    return pages.map((page) => {
      const entry = { page, topMm: top };
      top += page.heightMm + PAGE_GAP_MM;
      return entry;
    });
  }, [layout, pageView]);
  const widthMm = Math.max(design.canvas.widthMm, ...shown.map(({ page }) => page.widthMm));
  const heightMm = shown.reduce((sum, { page }) => sum + page.heightMm, 0) + PAGE_GAP_MM * Math.max(0, shown.length - 1);
  const firstPage = shown[0]?.page;

  // "Fit" (the default): the first page whole in the view.
  const [view, setView] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const read = () => setView({ width: viewport.clientWidth, height: viewport.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (zoomMode !== "fit" || !firstPage || view.width <= 0 || view.height <= 0) return;
    const fit = Math.min(
      (view.width - 2 * VIEW_PADDING_PX) / mmToPx(firstPage.widthMm),
      (view.height - 2 * VIEW_PADDING_PX) / mmToPx(firstPage.heightMm),
    );
    api.getState().setFitZoom(fit);
  }, [api, zoomMode, view, firstPage?.widthMm, firstPage?.heightMm]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A screen point as page mm on whichever shown page it falls (the first page if none). */
  const toPage = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stackRef.current?.getBoundingClientRect();
      const scale = PX_PER_MM * api.getState().zoom;
      const x = (clientX - (rect?.left ?? 0)) / scale;
      const y = (clientY - (rect?.top ?? 0)) / scale;
      const hit = shown.find(({ page, topMm }) => y >= topMm && y <= topMm + page.heightMm) ?? shown[0];
      return { xMm: x, yMm: y - (hit?.topMm ?? 0) };
    },
    [api, shown],
  );

  const focus = useCallback(() => viewportRef.current?.focus({ preventScroll: true }), []);

  useImperativeHandle(
    ref,
    () => ({
      viewCentreMm: () => {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return { xMm: design.canvas.widthMm / 2, yMm: design.canvas.heightMm / 2 };
        return toPage(rect.left + rect.width / 2, rect.top + rect.height / 2);
      },
      focus,
    }),
    [design.canvas.widthMm, design.canvas.heightMm, toPage, focus],
  );

  /** A press on the page or the canvas around it (not on an element) clears the selection. */
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-hit],[data-handle]")) return;
    if (!event.shiftKey) api.getState().clearSelection();
    focus();
  };

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes(PALETTE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (event: DragEvent) => {
    const key = event.dataTransfer.getData(PALETTE_DRAG_TYPE);
    if (!isPaletteItemKey(key)) return;
    event.preventDefault();
    onDropItem(key, toPage(event.clientX, event.clientY));
    focus();
  };

  /** Tab and Shift+Tab walk the elements while the canvas itself has focus; past either end, focus moves on. */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || event.target !== viewportRef.current || event.ctrlKey || event.metaKey || event.altKey) return;
    const order = readingOrder(shown);
    const state = api.getState();
    const current = state.selection[state.selection.length - 1];
    const index = current ? order.indexOf(current) : -1;
    const next = index === -1 ? (event.shiftKey ? -1 : 0) : index + (event.shiftKey ? -1 : 1);
    const id = order[next];
    if (next < 0 || !id) return;
    event.preventDefault();
    state.select([id]);
    requestAnimationFrame(() =>
      // Element ids are letters, digits, - and _ (schema), safe in a selector.
      viewportRef.current?.querySelector(`[data-hit="${id}"]`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" }),
    );
  };

  const scale = PX_PER_MM * zoom;
  const pageHeightLabel = Math.round((firstPage?.heightMm ?? design.canvas.heightMm) * 10) / 10;

  return (
    <div className={cn("relative min-h-0 min-w-0 flex-1", className)}>
      <style dangerouslySetInnerHTML={{ __html: CANVAS_CSS }} />
      <div
        ref={viewportRef}
        tabIndex={0}
        role="region"
        aria-label={t("label")}
        aria-describedby={instructionsId}
        data-editor-canvas=""
        data-zoom={zoom}
        className="absolute inset-0 overflow-auto bg-muted/60 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40"
        onPointerDown={onPointerDown}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onKeyDown={onKeyDown}
      >
        <div className="grid min-h-full w-max min-w-full content-start justify-center" style={{ padding: VIEW_PADDING_PX }}>
          <div
            ref={stackRef}
            className="relative"
            // Fitting needs the view's size: until it is known (the server render, the first
            // client pass) the page stays invisible rather than flashing at 100 %.
            style={{ width: widthMm * scale, height: heightMm * scale, visibility: zoomMode === "fit" && view.width <= 0 ? "hidden" : undefined }}
          >
            <div
              className={cn("absolute left-0 top-0", pageView === "single" && "ied-single")}
              style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", width: `${widthMm}mm` }}
            >
              <TemplateRenderer template={design} context={context} mode="screen" pageGapMm={PAGE_GAP_MM} onMeasure={handleMeasure} />
            </div>
            <CanvasOverlay pages={shown} zoom={zoom} onFocusCanvas={focus} />
          </div>
        </div>
      </div>
      <p id={instructionsId} className="sr-only">
        {t("instructions")}
      </p>
      <span
        className="pointer-events-none absolute bottom-3 right-4 rounded-md bg-background/90 px-2 py-1 text-[11px] tabular-nums text-muted-foreground shadow-sm ring-1 ring-border"
        data-canvas-badge=""
      >
        {design.canvas.heightMode === "auto"
          ? t("badgeRoll", { width: design.canvas.widthMm, height: pageHeightLabel, zoom: Math.round(zoom * 100) })
          : t("badge", { width: design.canvas.widthMm, height: design.canvas.heightMm, zoom: Math.round(zoom * 100) })}
      </span>
    </div>
  );
});
