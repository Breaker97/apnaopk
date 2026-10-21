"use client";

import { memo, type ComponentType } from "react";
import type { PrintContext } from "@/lib/invoice-templates/context-types";
import type { PlacedElement } from "@/lib/invoice-templates/pagination";
import type { ElementType } from "@/lib/invoice-templates/types";
import { useShrinkToFit } from "./render-context";
import { boxStyle, placementStyle, stackStyle, textStyle } from "./styles";
import type { ElementRenderProps } from "./types";
import {
  BusinessHeaderElement,
  CodBadgeElement,
  CustomerAddressElement,
  DeliveryMethodElement,
  NotesElement,
  OrderSummaryElement,
  PriceSummaryElement,
} from "./elements/blocks";
import { BarcodeElement, QrElement } from "./elements/code-elements";
import { ImageElement } from "./elements/image-element";
import { ProductRowsElement } from "./elements/product-rows";
import { ProductTableElement } from "./elements/product-table";
import { BoxElement, LineElement } from "./elements/shape-elements";
import { TextElement } from "./elements/text-element";

type AnyElementComponent = ComponentType<ElementRenderProps>;

/** One component per element type (§4.6). */
export const ELEMENT_COMPONENTS: Record<ElementType, AnyElementComponent> = {
  text: TextElement as AnyElementComponent,
  image: ImageElement as AnyElementComponent,
  barcode: BarcodeElement as AnyElementComponent,
  qr: QrElement as AnyElementComponent,
  line: LineElement as AnyElementComponent,
  box: BoxElement as AnyElementComponent,
  businessHeader: BusinessHeaderElement as AnyElementComponent,
  customerAddress: CustomerAddressElement as AnyElementComponent,
  orderSummary: OrderSummaryElement as AnyElementComponent,
  productTable: ProductTableElement as AnyElementComponent,
  productRows: ProductRowsElement as AnyElementComponent,
  priceSummary: PriceSummaryElement as AnyElementComponent,
  codBadge: CodBadgeElement as AnyElementComponent,
  deliveryMethod: DeliveryMethodElement as AnyElementComponent,
  notes: NotesElement as AnyElementComponent,
};

function shrinks(props: ElementRenderProps): boolean {
  if (props.element.type === "customerAddress") return props.element.config.longAddress === "shrink" || props.element.style.shrinkToFit;
  return props.element.style.shrinkToFit;
}

/**
 * An element on a page: the positioned box (placement, box and text style,
 * rotation, z-order), with the type's own component inside. Shrink-to-fit
 * measures the box on screen and prints the result.
 */
function ElementViewInner(props: ElementRenderProps) {
  const { element, placed, design, context } = props;
  const Inner = ELEMENT_COMPONENTS[element.type];
  const { ref, fontSizePx, overflow } = useShrinkToFit(element.id, shrinks(props), element.style.fontSizePx, [
    element,
    context,
    placed.widthMm,
    placed.heightMm,
  ]);
  const box = boxStyle(element.style);
  // A line's border settings are the line itself (P1 seam), not a frame around it.
  if (element.type === "line") delete box.border;
  return (
    <div
      ref={ref}
      className={`it-el it-${element.type}`}
      data-id={element.id}
      data-type={element.type}
      data-show-on={element.showOn}
      data-overflow={overflow ? "true" : undefined}
      // The stack first: its 100 % width and height must not override the placement's mm size.
      style={{ ...stackStyle(element.style), ...placementStyle(placed, element), ...box, ...textStyle(element.style, design.canvas, fontSizePx) }}
    >
      <Inner {...props} />
    </div>
  );
}

/** Two placements of one element are the same box (and the same rows, for a flowing block). */
function samePlacement(a: PlacedElement, b: PlacedElement): boolean {
  if (a.xMm !== b.xMm || a.yMm !== b.yMm || a.widthMm !== b.widthMm || a.heightMm !== b.heightMm) return false;
  if (!a.rows || !b.rows) return a.rows === b.rows;
  return a.rows.start === b.rows.start && a.rows.end === b.rows.end && a.rows.header === b.rows.header && a.rows.continuation === b.rows.continuation;
}

/** A page's context is a fresh copy per layout (`pageContext`); it is the same if everything but that copy is. */
export function samePageContext(a: PrintContext, b: PrintContext): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof PrintContext>;
  for (const key of keys) {
    if (key === "page") continue;
    if (a[key] !== b[key]) return false;
  }
  return a.page.number === b.page.number && a.page.count === b.page.count;
}

/**
 * Element components read only the design's canvas, format and language
 * (`bindingOptions`, `textStyle`), so an element whose own record, box and
 * page context are unchanged draws the same. Skipping it keeps a drag in the
 * editor from re-rendering every other element on every pointer move.
 */
function sameRenderProps(a: ElementRenderProps, b: ElementRenderProps): boolean {
  return (
    a.element === b.element &&
    a.mode === b.mode &&
    a.design.canvas === b.design.canvas &&
    a.design.format === b.design.format &&
    a.design.locale === b.design.locale &&
    samePlacement(a.placed, b.placed) &&
    samePageContext(a.context, b.context)
  );
}

export const ElementView = memo(ElementViewInner, sameRenderProps);
