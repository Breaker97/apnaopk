/**
 * SKU and internal barcode generators for the product forms.
 *
 * Moved out of `lib/utils.ts`: that module is imported by ~300 client
 * components for `cn()`, and the barcode standards it pulled in for these two
 * helpers rode along into every one of their bundles.
 */
import { generateInternalEan13 } from "@/lib/barcode/standards";

/**
 * Auto-generate a SKU from product title.
 * E.g. "Classic Cotton T-Shirt" → "CCT-8A3F"
 * Takes uppercase initials of each word + 4-char random hex suffix.
 */
export function generateSku(title: string): string {
  const cleaned = title.trim().replace(/[^a-zA-Z0-9\s]/g, "");
  const words = cleaned.split(/\s+/).filter(Boolean);

  let base: string;
  if (words.length >= 2) {
    // Take first letter of each word (up to 5)
    base = words
      .slice(0, 5)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  } else if (words.length === 1) {
    // Single word: take first 3 chars
    base = words[0].substring(0, 3).toUpperCase();
  } else {
    base = "PRD";
  }

  const suffix = Math.random().toString(16).substring(2, 6).toUpperCase();
  return `${base}-${suffix}`;
}

/**
 * Auto-generate a numeric internal-use EAN-13 Restricted Circulation Number.
 * It is suitable for this store's POS/inventory labels, not marketplace GTINs.
 */
export function generateBarcode(existingBarcodes: Iterable<string> = []): string {
  const used = new Set(existingBarcodes);

  for (let attempt = 0; attempt < 20; attempt++) {
    const barcode = generateInternalEan13();
    if (!used.has(barcode)) return barcode;
  }

  throw new Error("Unable to generate a unique internal barcode");
}
