import type { BarcodeFormat } from "@/lib/barcode/standards";
import {
  layoutProductLabel,
  MAX_LABEL_BARCODE_HEIGHT_MM,
  type LabelLayout,
  type ProductLabelInput,
} from "@/lib/barcode/label-layout";

export type ThermalPrinterLanguage = "zpl" | "tspl";

interface ThermalProductLabel extends ProductLabelInput {
  copies?: number;
}

export { MAX_LABEL_BARCODE_HEIGHT_MM };

function clampCopies(copies: number | undefined) {
  return Math.min(500, Math.max(1, Math.trunc(copies ?? 1)));
}

/** The layout, or the first reason this label cannot be printed. */
function requireLayout(input: ProductLabelInput): LabelLayout {
  const result = layoutProductLabel(input);
  if (!result.ok) throw new Error(result.problems[0]);
  return result.layout;
}

function zplBarcodeCommand(format: BarcodeFormat, height: number) {
  if (format === "ean13") return `^BEN,${height},Y,N`;
  if (format === "upca") return `^BUN,${height},Y,N,Y`;
  return `^BCN,${height},Y,N,N`;
}

export function buildZplProductLabel(input: ThermalProductLabel): string {
  const layout = requireLayout(input);
  const { barcode, smallTextSize, textSize } = layout;
  const text = (
    line: { x: number; y: number; text: string } | undefined,
    size: number,
  ) => (line ? `^FO${line.x},${line.y}^A0N,${size},${size}^FD${line.text}^FS` : "");

  const fields = [
    "^XA",
    `^PW${layout.widthDots}`,
    `^LL${layout.heightDots}`,
    "^CI28",
    text(layout.store, smallTextSize),
    text(layout.name, textSize),
    text(layout.variant, smallTextSize),
    `^BY${barcode.moduleWidth},2,${barcode.height}`,
    `^FO${barcode.x},${barcode.y}${zplBarcodeCommand(barcode.format, barcode.height)}^FD${barcode.value}^FS`,
    text(layout.sku, smallTextSize),
    text(layout.price, smallTextSize),
    `^PQ${clampCopies(input.copies)},0,1,N`,
    "^XZ",
  ];

  return fields.filter(Boolean).join("\n");
}

export function buildTsplProductLabel(input: ThermalProductLabel): string {
  const layout = requireLayout(input);
  const { barcode } = layout;
  const barcodeType =
    barcode.format === "ean13"
      ? "EAN13"
      : barcode.format === "upca"
        ? "UPCA"
        : "128";
  const text = (line: { x: number; y: number; text: string } | undefined) =>
    line
      ? `TEXT ${line.x},${line.y},"0",0,1,1,"${line.text.replace(/"/g, "'")}"`
      : "";

  return [
    `SIZE ${input.widthMm} mm,${input.heightMm} mm`,
    "GAP 2 mm,0 mm",
    "DIRECTION 1",
    "CLS",
    text(layout.store),
    text(layout.name),
    text(layout.variant),
    `BARCODE ${barcode.x},${barcode.y},"${barcodeType}",${barcode.height},1,0,${barcode.moduleWidth},${barcode.moduleWidth},"${barcode.value}"`,
    text(layout.sku),
    text(layout.price),
    `PRINT ${clampCopies(input.copies)},1`,
  ]
    .filter(Boolean)
    .join("\r\n");
}
