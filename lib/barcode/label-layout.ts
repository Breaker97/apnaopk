import {
  detectBarcodeFormat,
  inspectBarcode,
  type BarcodeFormat,
} from "@/lib/barcode/standards";

/**
 * Where everything goes on a product label, in printer dots.
 *
 * One layout feeds both thermal languages (ZPL and TSPL), so a label size that
 * fits in one fits in the other. The positions used to be fixed numbers tuned
 * for three presets; any other size overprinted the SKU with the price, pushed
 * the barcode past the label's edge, or let a long name run off it. Here every
 * position is worked out from the label's own size, and a label that cannot
 * hold its content comes back as a list of problems instead of a bad print.
 */

/** What a label can be. Narrower than the printer, wider than a barcode needs. */
export const LABEL_SIZE_LIMITS = {
  minWidthMm: 33,
  maxWidthMm: 110,
  minHeightMm: 20,
  maxHeightMm: 300,
} as const;

// A barcode is 38% of the label height, but on a tall label (4 × 6 in) that
// would be a 57 mm bar; this keeps it a scannable size instead.
export const MAX_LABEL_BARCODE_HEIGHT_MM = 25;
const MIN_LABEL_BARCODE_HEIGHT_MM = 8;
/** Room under the bars for the digits the printer prints beneath them. */
const HUMAN_READABLE_MM = 3.2;
/** Average glyph width as a share of the font size; deliberately generous. */
const CHAR_WIDTH_RATIO = 0.6;
const LINE_GAP = 3;

export interface ProductLabelInput {
  barcode: string;
  barcodeFormat?: BarcodeFormat;
  productName: string;
  variantName?: string;
  sku?: string;
  price?: string;
  storeName?: string;
  widthMm: number;
  heightMm: number;
  dpi: 203 | 300;
}

interface LabelTextLine {
  x: number;
  y: number;
  text: string;
}

export interface LabelLayout {
  widthDots: number;
  heightDots: number;
  textSize: number;
  smallTextSize: number;
  store?: LabelTextLine;
  name: LabelTextLine;
  variant?: LabelTextLine;
  sku?: LabelTextLine;
  price?: LabelTextLine;
  barcode: {
    format: BarcodeFormat;
    value: string;
    x: number;
    y: number;
    /** Bar height only; the digits are printed under it. */
    height: number;
    moduleWidth: number;
  };
  /** Space reserved under the bars for the printed digits. */
  humanReadableDots: number;
}

export type LabelLayoutResult =
  | { ok: true; layout: LabelLayout }
  | { ok: false; problems: string[] };

/** Why a width × height cannot be a label, or null when it can. */
export function checkLabelSize(
  widthMm: number,
  heightMm: number,
): string | null {
  const { minWidthMm, maxWidthMm, minHeightMm, maxHeightMm } = LABEL_SIZE_LIMITS;
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm)) {
    return "Enter the label width and height in mm.";
  }
  if (widthMm < minWidthMm || widthMm > maxWidthMm) {
    return `Label width must be ${minWidthMm}–${maxWidthMm} mm.`;
  }
  if (heightMm < minHeightMm || heightMm > maxHeightMm) {
    return `Label height must be ${minHeightMm}–${maxHeightMm} mm.`;
  }
  return null;
}

export function labelDots(mm: number, dpi: number) {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

/**
 * Thermal printers print plain ASCII here. Accents are stripped to their base
 * letter ("Café" → "Cafe"); anything with no ASCII form prints as "?".
 */
export function cleanPrinterText(value: string | undefined, maxLength: number) {
  return (value || "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/[\^~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function fitText(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, Math.max(0, maxChars));
  return `${text.slice(0, maxChars - 2).trimEnd()}..`;
}

/** Symbol width in modules, and the blank margin the scanner needs around it. */
function barcodeModules(format: BarcodeFormat, value: string) {
  if (format === "ean13" || format === "upca") {
    return { symbol: 95, quiet: 18 };
  }
  // Code 128 (a GTIN-14 is also sent as Code 128 to thermal printers):
  // start + data + check + stop, with the widest subset assumed.
  return { symbol: 11 * value.length + 35, quiet: 20 };
}

export function layoutProductLabel(input: ProductLabelInput): LabelLayoutResult {
  const sizeProblem = checkLabelSize(input.widthMm, input.heightMm);
  if (sizeProblem) return { ok: false, problems: [sizeProblem] };

  const format = detectBarcodeFormat(input.barcode, input.barcodeFormat);
  const inspection = inspectBarcode(input.barcode, { format });
  if (!inspection.valid) {
    return { ok: false, problems: [inspection.message || "Invalid barcode"] };
  }

  const { dpi } = input;
  const width = labelDots(input.widthMm, dpi);
  const height = labelDots(input.heightMm, dpi);
  const padding = labelDots(2, dpi);
  const textSize = dpi === 300 ? 28 : 19;
  const smallTextSize = dpi === 300 ? 23 : 16;
  const usableWidth = width - padding * 2;
  const problems: string[] = [];

  const charsFor = (size: number, cap: number) =>
    Math.max(1, Math.min(cap, Math.floor(usableWidth / (size * CHAR_WIDTH_RATIO))));

  const storeText = fitText(
    cleanPrinterText(input.storeName, 32),
    charsFor(smallTextSize, 32),
  );
  const nameText = fitText(
    cleanPrinterText(input.productName, 44),
    charsFor(textSize, 44),
  );
  const variantText = fitText(
    cleanPrinterText(input.variantName, 38),
    charsFor(smallTextSize, 38),
  );
  const skuClean = cleanPrinterText(input.sku, 30);
  const priceText = cleanPrinterText(input.price, 20);

  // Top to bottom: store, name, variant.
  let y = padding;
  const store = storeText ? { x: padding, y, text: storeText } : undefined;
  if (store) y += smallTextSize + LINE_GAP;
  const name = { x: padding, y, text: nameText };
  y += textSize + LINE_GAP;
  const variant = variantText ? { x: padding, y, text: variantText } : undefined;
  if (variant) y += smallTextSize + LINE_GAP;
  const headerEnd = y;

  // The footer row: SKU on the left, price flush right.
  const footerY = height - padding - smallTextSize;
  const hasFooter = Boolean(skuClean || priceText);
  const priceWidth = Math.ceil(priceText.length * smallTextSize * CHAR_WIDTH_RATIO);
  const price = priceText
    ? { x: width - padding - priceWidth, y: footerY, text: priceText }
    : undefined;
  let sku: LabelTextLine | undefined;
  if (skuClean) {
    const room =
      usableWidth - (price ? priceWidth + labelDots(2, dpi) : 0);
    const maxChars = Math.floor(room / (smallTextSize * CHAR_WIDTH_RATIO));
    if (maxChars < 8) {
      problems.push(
        "There is no room for both the SKU and the price on this label. Hide one of them or use a wider label.",
      );
    } else {
      sku = { x: padding, y: footerY, text: fitText(`SKU ${skuClean}`, maxChars) };
    }
  }

  // The barcode takes what the rows above and below leave, bars plus digits.
  const readable = labelDots(HUMAN_READABLE_MM, dpi);
  const bottom = hasFooter ? footerY - LINE_GAP : height - padding;
  const space = bottom - headerEnd;
  const minBarHeight = labelDots(MIN_LABEL_BARCODE_HEIGHT_MM, dpi);
  const barHeight = Math.min(
    labelDots(MAX_LABEL_BARCODE_HEIGHT_MM, dpi),
    Math.max(minBarHeight, Math.round(height * 0.38)),
    space - readable,
  );
  if (barHeight < minBarHeight) {
    problems.push(
      "This label is too short for the content chosen. Hide the SKU, price or variant, or use a taller label.",
    );
  }

  // The widest module the label's width allows, never thinner than a scanner
  // reads reliably.
  const { symbol, quiet } = barcodeModules(format, inspection.value);
  const minModule = dpi === 300 ? 3 : 2;
  const maxModule = dpi === 300 ? 4 : 3;
  let moduleWidth = 0;
  for (let candidate = maxModule; candidate >= minModule; candidate -= 1) {
    if ((symbol + quiet) * candidate <= usableWidth) {
      moduleWidth = candidate;
      break;
    }
  }
  if (!moduleWidth) {
    const neededMm = Math.ceil(
      (((symbol + quiet) * minModule + padding * 2) / dpi) * 25.4,
    );
    problems.push(
      `This barcode needs a label about ${neededMm} mm wide; this one is ${input.widthMm} mm. Use a wider label or a shorter code.`,
    );
  }

  if (problems.length > 0) return { ok: false, problems };

  const block = barHeight + readable;
  return {
    ok: true,
    layout: {
      widthDots: width,
      heightDots: height,
      textSize,
      smallTextSize,
      store,
      name,
      variant,
      sku,
      price,
      barcode: {
        format,
        value: inspection.value,
        x: Math.floor((width - symbol * moduleWidth) / 2),
        y: headerEnd + Math.floor((space - block) / 2),
        height: barHeight,
        moduleWidth,
      },
      humanReadableDots: readable,
    },
  };
}
