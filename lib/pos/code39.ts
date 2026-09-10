import { renderBarcodeSvg } from "@/lib/barcode/render";

interface Code39BarcodeOptions {
  /** Total height of the barcode bars (default 50). */
  height?: number;
  /** Width of a single narrow bar (default 1). */
  narrow?: number;
  /** Ratio of wide:narrow bars (default 2.5). */
  wideRatio?: number;
  /** Whether to render the human-readable text below the bars. */
  showText?: boolean;
  /** Foreground (bar) color. Default `#000`. */
  color?: string;
}

/**
 * Backwards-compatible receipt helper. Receipts now use the denser Code 128
 * encoder from BWIPP/bwip-js instead of the former handwritten Code 39 table.
 */
export function buildCode39SVG(
  input: string,
  options: Code39BarcodeOptions = {},
): string {
  return renderBarcodeSvg(input || "RECEIPT", {
    format: "code128",
    heightMm: Math.max(10, (options.height ?? 50) / 3.5),
    includeText: options.showText ?? true,
    scale: Math.max(1, options.narrow ?? 1),
    paddingMm: 2.5,
  });
}
