import { toSVG } from "@bwip-js/generic";
import {
  detectBarcodeFormat,
  inspectBarcode,
  type BarcodeFormat,
} from "@/lib/barcode/standards";

const BWIP_FORMAT: Record<BarcodeFormat, string> = {
  ean13: "ean13",
  upca: "upca",
  gtin14: "itf14",
  code128: "code128",
};

interface RenderBarcodeOptions {
  format?: BarcodeFormat;
  heightMm?: number;
  includeText?: boolean;
  scale?: number;
  paddingMm?: number;
}

export function renderBarcodeSvg(
  rawValue: string,
  options: RenderBarcodeOptions = {},
): string {
  const format = detectBarcodeFormat(rawValue, options.format);
  const inspection = inspectBarcode(rawValue, { format });
  if (!inspection.valid) {
    throw new Error(inspection.message || "Invalid barcode");
  }

  const paddingMm = Math.max(1.5, options.paddingMm ?? 2.5);
  return toSVG({
    bcid: BWIP_FORMAT[format],
    text: inspection.value,
    scale: Math.max(1, Math.round(options.scale ?? 2)),
    height: Math.max(8, options.heightMm ?? 14),
    includetext: options.includeText ?? true,
    textxalign: "center",
    textsize: 9,
    paddingwidth: paddingMm,
    backgroundcolor: "FFFFFF",
    barcolor: "000000",
    textcolor: "000000",
  });
}

