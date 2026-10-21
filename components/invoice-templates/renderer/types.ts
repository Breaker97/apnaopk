/**
 * What every element component receives from the page it prints on
 * (docs/INVOICE_TEMPLATE_BUILDER.md §4.6). The renderer is pure: these are
 * the template, the context and the layout, never editor state.
 */
import type { PrintContext } from "@/lib/invoice-templates/context-types";
import type { PlacedElement, RowMeasure } from "@/lib/invoice-templates/pagination";
import type { FitResult } from "@/lib/invoice-templates/shrink";
import type { ElementType, TemplateDesign, TemplateElement } from "@/lib/invoice-templates/types";

export type RenderMode = "screen" | "print" | "thumbnail";

/** What the renderer measured at 100 %: row heights and shrink-to-fit results, by element id. */
export interface RenderMeasure {
  rows: RowMeasure | null;
  fits: Record<string, FitResult>;
}

export interface ElementRenderProps<T extends ElementType = ElementType> {
  /** The element, narrowed to its type (a union of the types when `T` is one). */
  element: Extract<TemplateElement, { type: T }>;
  /** Where and how tall the element is on this page (push-down and continuation applied). */
  placed: PlacedElement;
  context: PrintContext;
  design: TemplateDesign;
  mode: RenderMode;
}
