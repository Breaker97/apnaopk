/**
 * The Review tab's rules (docs/INVOICE_TEMPLATE_BUILDER.md §5.5): everything
 * the designer should look at before saving, by element name.
 *
 * | Rule              | Meaning                                                            |
 * |-------------------|--------------------------------------------------------------------|
 * | `outOfBounds`     | an element reaches outside the printable area                       |
 * | `overlap`         | two elements that can share a page cover each other                 |
 * | `fieldUnavailable`| a bound field (or a visible block field) this category never has    |
 * | `sourceUnavailable`| a barcode / QR source the category never has (a POS tracking number) |
 * | `barcodeError`    | the barcode can't be drawn: empty, wrong format or value            |
 * | `barcodeTooSmall` | the narrowest bar is under 0.25 mm at print size                    |
 * | `qrError`         | the QR code can't be made: empty, too long, or an address Save refuses |
 * | `qrTooSmall`      | the QR code is under 15 mm                                          |
 * | `textOverflow`    | text still overflows its box after shrinking to the 6 px minimum    |
 *
 * Hidden elements print nothing and are never reported. Each warning carries
 * the ids and names of the elements it is about, so the tab can name them and
 * select them; messages are the UI's (`code` and `detail` say what to print).
 *
 * Pure and client-safe: the overflow rule needs what the renderer measured
 * (`fits`), everything else is arithmetic over the design and a sample. A
 * measure only counts while the element still shrinks to fit: one taken
 * before the setting was turned off says nothing about the print.
 */
import { checkBounds } from "../bounds";
import type { PrintContext } from "../context-types";
import type { FieldKey } from "../field-keys";
import { fieldUsableIn } from "./field-picker";
import { barcodeCheck, qrCheck, qrUrlProblem } from "./code-checks";
import type { FitResult } from "../shrink";
import type {
  TemplateCategory,
  TemplateDesign,
  TemplateElement,
  TemplateElementOf,
} from "../types";

export const REVIEW_RULES = [
  "outOfBounds",
  "overlap",
  "fieldUnavailable",
  "sourceUnavailable",
  "barcodeError",
  "barcodeTooSmall",
  "qrError",
  "qrTooSmall",
  "textOverflow",
] as const;
export type ReviewRule = (typeof REVIEW_RULES)[number];

/** Problems stop something printing or can't be saved; the rest print but may not look or scan right. */
export type ReviewSeverity = "problem" | "caution";

export interface ReviewWarning {
  /** Stable across edits that don't change the warning (a React key). */
  key: string;
  rule: ReviewRule;
  severity: ReviewSeverity;
  elementIds: string[];
  names: string[];
  /** What the message needs: a field key, an issue code, a measured size. */
  detail: Record<string, string | number>;
}

const SEVERITY: Record<ReviewRule, ReviewSeverity> = {
  outOfBounds: "caution",
  overlap: "caution",
  fieldUnavailable: "caution",
  sourceUnavailable: "caution",
  barcodeError: "problem",
  barcodeTooSmall: "caution",
  qrError: "problem",
  qrTooSmall: "caution",
  textOverflow: "caution",
};

/** The block fields that print on an element (an order summary's, a delivery block's) as registry keys. */
function visibleBlockFields(element: TemplateElement): FieldKey[] {
  switch (element.type) {
    case "orderSummary":
      return element.config.fields.filter((field) => field.visible).map((field) => field.key as FieldKey);
    case "deliveryMethod":
      return element.config.fields.filter((field) => field.visible).map((field) => `delivery.${field.key}` as FieldKey);
    default:
      return [];
  }
}

/** Whether the renderer shrinks this element's text to fit (its setting, or a customer address in "shrink" mode). */
export function shrinksToFit(element: TemplateElement): boolean {
  if (element.type === "customerAddress" && element.config.longAddress === "shrink") return true;
  return element.style.shrinkToFit;
}

export interface ReviewInput {
  design: TemplateDesign;
  category: TemplateCategory;
  /** The clearly-marked sample order of the category (the checks encode its values). */
  sample: PrintContext;
  /** What the renderer measured for shrink-to-fit, by element id (empty until it has). */
  fits?: Readonly<Record<string, FitResult>>;
}

function make(
  rule: ReviewRule,
  elements: readonly TemplateElement[],
  detail: ReviewWarning["detail"] = {},
  suffix = "",
): ReviewWarning {
  return {
    key: `${rule}:${elements.map((element) => element.id).join("+")}${suffix}`,
    rule,
    severity: SEVERITY[rule],
    elementIds: elements.map((element) => element.id),
    names: elements.map((element) => element.name),
    detail,
  };
}

export function reviewWarnings({ design, category, sample, fits = {} }: ReviewInput): ReviewWarning[] {
  const warnings: ReviewWarning[] = [];
  const byId = new Map(design.elements.map((element) => [element.id, element]));

  // Layout: outside the printable area, and overlapping pairs.
  for (const bounds of checkBounds(design.canvas, design.elements)) {
    if (bounds.kind === "outOfBounds") warnings.push(make("outOfBounds", [byId.get(bounds.elementId)!]));
    else warnings.push(make("overlap", bounds.elementIds.map((id) => byId.get(id)!)));
  }

  for (const element of design.elements) {
    if (element.hidden) continue;

    // A bound field this category never has data for.
    if (element.type === "text" && element.binding?.mode === "field" && element.binding.field) {
      if (!fieldUsableIn(element.binding.field, category)) {
        warnings.push(make("fieldUnavailable", [element], { field: element.binding.field }, `:${element.binding.field}`));
      }
    }
    for (const key of visibleBlockFields(element)) {
      if (!fieldUsableIn(key, category)) warnings.push(make("fieldUnavailable", [element], { field: key }, `:${key}`));
    }

    // Codes.
    if (element.type === "barcode") {
      const barcode = element as TemplateElementOf<"barcode">;
      const check = barcodeCheck(barcode, sample);
      if (check.issue) {
        const bound = barcode.config.source !== "fixed";
        if (check.issue.code === "empty" && bound) {
          // A bound source the sample has nothing for: a source this category never has (a POS tracking number).
          warnings.push(make("sourceUnavailable", [element], { source: barcode.config.source }));
        } else {
          warnings.push(make("barcodeError", [element], { code: check.issue.code, format: barcode.config.format }));
        }
      } else if (check.warnings.some((warning) => warning.code === "tooSmall")) {
        warnings.push(make("barcodeTooSmall", [element], { widthMm: Math.round((check.moduleWidthMm ?? 0) * 100) / 100 }));
      }
    }
    if (element.type === "qr") {
      const qr = element as TemplateElementOf<"qr">;
      const check = qrCheck(qr, sample);
      const addressProblem = qr.config.source === "fixed" ? qrUrlProblem(qr.config.url) : null;
      if (addressProblem) {
        warnings.push(make("qrError", [element], { code: addressProblem }));
      } else if (check.issue) {
        if (check.issue.code === "empty" && qr.config.source !== "fixed") {
          warnings.push(make("sourceUnavailable", [element], { source: qr.config.source }));
        } else {
          warnings.push(make("qrError", [element], { code: check.issue.code }));
        }
      } else if (check.warnings.some((warning) => warning.code === "tooSmall")) {
        warnings.push(make("qrTooSmall", [element], { sizeMm: Math.round(check.sizeMm * 10) / 10 }));
      }
    }

    // Text that still overflows after shrinking as far as it may.
    if (shrinksToFit(element) && fits[element.id]?.fits === false) warnings.push(make("textOverflow", [element]));
  }
  return warnings;
}

/** The ids a click on a warning selects. */
export function warningElementIds(warning: ReviewWarning): string[] {
  return warning.elementIds;
}
