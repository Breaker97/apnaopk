import "server-only";

import { cleanScannedCode, normalizeLookupCode } from "@/lib/catalog/barcodes";
import { Product } from "@/models";

/**
 * The products a scanned code could be: the point of sale's scan
 * (GET /api/pos/barcode) and the business app's (GET /products?barcode=), so a
 * code the register finds the app finds too. Which of them it is, product or
 * variant, barcode or SKU, is `resolvePOSBarcodeMatch`'s to say
 * (./barcode-lookup.ts).
 *
 * Two steps: the normalised fields are indexed and the raw ones are not. A
 * single `$or` holding the raw branches scanned the collection on EVERY scan;
 * normalised first keeps the hot path indexed, and the raw fallback (for
 * products whose normalised fields were never backfilled) runs only when that
 * found nothing.
 */
export async function findBarcodeCandidates<T>(
  rawCode: string,
  options: {
    /** Who may see what (status, owner, channel), merged into both steps. */
    filter: Record<string, unknown>;
    select: string;
    limit?: number;
  },
): Promise<T[]> {
  const code = cleanScannedCode(rawCode);
  const normalizedCode = normalizeLookupCode(code);
  if (!normalizedCode) return [];
  const limit = options.limit ?? 25;

  const indexed = await Product.find({
    ...options.filter,
    $or: [
      { barcodeNormalized: normalizedCode },
      { skuNormalized: normalizedCode },
      { "variants.barcodeNormalized": normalizedCode },
      { "variants.skuNormalized": normalizedCode },
    ],
  })
    .select(options.select)
    .limit(limit)
    .lean<T[]>();
  if (indexed.length > 0) return indexed;

  const rawCandidates = [code, code.toUpperCase(), rawCode].filter(Boolean);
  return Product.find({
    ...options.filter,
    $or: [
      { barcode: { $in: rawCandidates } },
      { sku: { $in: rawCandidates } },
      { "variants.barcode": { $in: rawCandidates } },
      { "variants.sku": { $in: rawCandidates } },
    ],
  })
    .select(options.select)
    .limit(limit)
    .lean<T[]>();
}
