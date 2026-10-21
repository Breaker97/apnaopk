"use client";

/**
 * Row measurement (§4.6): the flowing block is drawn once more, hidden and
 * off-screen at 100 % with every row, and each row's height is read back in
 * mm. Pagination then knows exactly how many rows a page holds. Without a
 * laid-out DOM (static markup, jsdom) nothing is reported and the estimate
 * stands.
 */
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PrintContext } from "@/lib/invoice-templates/context-types";
import { blockHasHeader, type FlowingElement, type RowMeasure } from "@/lib/invoice-templates/pagination";
import type { TemplateDesign } from "@/lib/invoice-templates/types";
import { pxToMm } from "@/lib/invoice-templates/units";
import { ProductRowsElement } from "./elements/product-rows";
import { ProductTableElement } from "./elements/product-table";
import { boxStyle, mm, stackStyle, textStyle } from "./styles";
import type { ElementRenderProps } from "./types";

export interface RowMeasurerProps {
  block: FlowingElement;
  context: PrintContext;
  design: TemplateDesign;
  onMeasure: (measure: RowMeasure) => void;
}

const sameMeasure = (a: RowMeasure | null, b: RowMeasure) =>
  a !== null && a.headerMm === b.headerMm && a.rowsMm.length === b.rowsMm.length && a.rowsMm.every((row, index) => row === b.rowsMm[index]);

function RowMeasurerInner({ block, context, design, onMeasure }: RowMeasurerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const last = useRef<RowMeasure | null>(null);
  const rowCount = context.items.length;
  // Web fonts change row heights when they arrive: measure again then.
  const [, setFontsLoaded] = useState(0);
  useEffect(() => {
    const fonts = typeof document === "undefined" ? undefined : document.fonts;
    if (!fonts) return;
    let alive = true;
    const remeasure = () => {
      if (alive) setFontsLoaded((count) => count + 1);
    };
    void fonts.ready.then(remeasure);
    fonts.addEventListener?.("loadingdone", remeasure);
    return () => {
      alive = false;
      fonts.removeEventListener?.("loadingdone", remeasure);
    };
  }, []);

  useLayoutEffect(() => {
    const root = ref.current;
    const box = root?.firstElementChild as HTMLElement | null | undefined;
    if (!root || !box || box.offsetWidth === 0) return;
    // A preview fitted to its column or an editor zoom scales an ancestor;
    // bounding boxes come back scaled, layout widths don't. Undo the scale so
    // rows are measured at 100 %.
    const zoom = box.getBoundingClientRect().width / box.offsetWidth || 1;
    const heightMm = (element: Element) => pxToMm(element.getBoundingClientRect().height / zoom);
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".it-row")).map(heightMm);
    const header = root.querySelector<HTMLElement>(".it-header");
    const headerMm = header ? heightMm(header) : 0;
    // Rows that are really 0 mm tall (a row of an image field only, no gap) are a measure too: without it Print never enables.
    if (rows.length === 0) return;
    const measure: RowMeasure = { headerMm: Math.round(headerMm * 100) / 100, rowsMm: rows.map((row) => Math.round(row * 100) / 100) };
    if (sameMeasure(last.current, measure)) return;
    last.current = measure;
    onMeasure(measure);
  });

  const props: ElementRenderProps<typeof block.type> = {
    element: block,
    placed: {
      element: block,
      xMm: 0,
      yMm: 0,
      widthMm: block.widthMm,
      heightMm: block.heightMm,
      rows: { start: 0, end: rowCount, header: blockHasHeader(block), continuation: false },
    },
    context,
    design,
    mode: "screen",
  };
  return (
    <div className="it-measure" aria-hidden="true" ref={ref} style={{ position: "absolute", left: "-100000px", top: 0, visibility: "hidden", pointerEvents: "none" }}>
      <div style={{ ...stackStyle(block.style), ...boxStyle(block.style), ...textStyle(block.style, design.canvas), width: mm(block.widthMm), height: "auto" }}>
        {block.type === "productTable" ? (
          <ProductTableElement {...(props as ElementRenderProps<"productTable">)} />
        ) : (
          <ProductRowsElement {...(props as ElementRenderProps<"productRows">)} />
        )}
      </div>
    </div>
  );
}

/**
 * Measured again only when what it measures changes: the block, the order,
 * the design's canvas, format or language (what the rows read), or when
 * fonts arrive. A drag of some other element in the editor leaves it alone.
 */
export const RowMeasurer = memo(
  RowMeasurerInner,
  (a, b) =>
    a.block === b.block &&
    a.context === b.context &&
    a.onMeasure === b.onMeasure &&
    a.design.canvas === b.design.canvas &&
    a.design.format === b.design.format &&
    a.design.locale === b.design.locale,
);
