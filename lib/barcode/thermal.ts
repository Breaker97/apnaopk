import {
  detectBarcodeFormat,
  inspectBarcode,
  type BarcodeFormat,
} from "@/lib/barcode/standards";

export type ThermalPrinterLanguage = "zpl" | "tspl";

interface ThermalProductLabel {
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
  copies?: number;
}

function dots(mm: number, dpi: number) {
  return Math.max(1, Math.round((mm / 25.4) * dpi));
}

function cleanPrinterText(value: string | undefined, maxLength: number) {
  return (value || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/[\^~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function zplBarcodeCommand(format: BarcodeFormat, height: number) {
  if (format === "ean13") return `^BEN,${height},Y,N`;
  if (format === "upca") return `^BUN,${height},Y,N,Y`;
  return `^BCN,${height},Y,N,N`;
}

export function buildZplProductLabel(input: ThermalProductLabel): string {
  const format = detectBarcodeFormat(input.barcode, input.barcodeFormat);
  const inspection = inspectBarcode(input.barcode, { format });
  if (!inspection.valid) throw new Error(inspection.message || "Invalid barcode");

  const width = dots(input.widthMm, input.dpi);
  const height = dots(input.heightMm, input.dpi);
  const padding = dots(2, input.dpi);
  const barcodeHeight = Math.max(dots(9, input.dpi), Math.round(height * 0.38));
  const textSize = input.dpi === 300 ? 28 : 19;
  const smallTextSize = input.dpi === 300 ? 23 : 16;
  const name = cleanPrinterText(input.productName, 44);
  const variant = cleanPrinterText(input.variantName, 38);
  const sku = cleanPrinterText(input.sku, 30);
  const store = cleanPrinterText(input.storeName, 32);
  const price = cleanPrinterText(input.price, 20);
  const copies = Math.min(500, Math.max(1, Math.trunc(input.copies ?? 1)));
  const barcodeY = Math.max(
    padding + textSize * 2 + (variant ? smallTextSize + 3 : 0),
    Math.round(height * 0.32),
  );
  const moduleWidth = input.dpi === 300 ? 3 : 2;

  const fields = [
    "^XA",
    `^PW${width}`,
    `^LL${height}`,
    "^CI28",
    `^FO${padding},${padding}^A0N,${smallTextSize},${smallTextSize}^FD${store}^FS`,
    `^FO${padding},${padding + smallTextSize + 3}^A0N,${textSize},${textSize}^FD${name}^FS`,
    variant
      ? `^FO${padding},${padding + smallTextSize + textSize + 7}^A0N,${smallTextSize},${smallTextSize}^FD${variant}^FS`
      : "",
    `^BY${moduleWidth},2,${barcodeHeight}`,
    `^FO${padding},${barcodeY}${zplBarcodeCommand(format, barcodeHeight)}^FD${inspection.value}^FS`,
    `^FO${padding},${height - smallTextSize - padding}^A0N,${smallTextSize},${smallTextSize}^FDSKU ${sku}^FS`,
    price
      ? `^FO${Math.max(padding, width - dots(27, input.dpi))},${height - smallTextSize - padding}^A0N,${smallTextSize},${smallTextSize}^FD${price}^FS`
      : "",
    `^PQ${copies},0,1,N`,
    "^XZ",
  ];

  return fields.filter(Boolean).join("\n");
}

export function buildTsplProductLabel(input: ThermalProductLabel): string {
  const format = detectBarcodeFormat(input.barcode, input.barcodeFormat);
  const inspection = inspectBarcode(input.barcode, { format });
  if (!inspection.valid) throw new Error(inspection.message || "Invalid barcode");

  const dpi = input.dpi;
  const x = dots(2, dpi);
  const name = cleanPrinterText(input.productName, 42).replace(/"/g, "'");
  const variant = cleanPrinterText(input.variantName, 38).replace(/"/g, "'");
  const sku = cleanPrinterText(input.sku, 30).replace(/"/g, "'");
  const price = cleanPrinterText(input.price, 20).replace(/"/g, "'");
  const store = cleanPrinterText(input.storeName, 32).replace(/"/g, "'");
  const copies = Math.min(500, Math.max(1, Math.trunc(input.copies ?? 1)));
  const barcodeType = format === "ean13" ? "EAN13" : format === "upca" ? "UPCA" : "128";
  const barcodeY = dots(11 + (variant ? 4 : 0), dpi);
  const barcodeHeight = dots(10, dpi);

  return [
    `SIZE ${input.widthMm} mm,${input.heightMm} mm`,
    "GAP 2 mm,0 mm",
    "DIRECTION 1",
    "CLS",
    `TEXT ${x},${dots(1, dpi)},\"0\",0,1,1,\"${store}\"`,
    `TEXT ${x},${dots(4, dpi)},\"0\",0,1,1,\"${name}\"`,
    variant ? `TEXT ${x},${dots(7, dpi)},\"0\",0,1,1,\"${variant}\"` : "",
    `BARCODE ${x},${barcodeY},\"${barcodeType}\",${barcodeHeight},1,0,2,2,\"${inspection.value}\"`,
    `TEXT ${x},${dots(input.heightMm - 4, dpi)},\"0\",0,1,1,\"SKU ${sku}\"`,
    price ? `TEXT ${dots(input.widthMm - 18, dpi)},${dots(input.heightMm - 4, dpi)},\"0\",0,1,1,\"${price}\"` : "",
    `PRINT ${copies},1`,
  ]
    .filter(Boolean)
    .join("\r\n");
}

