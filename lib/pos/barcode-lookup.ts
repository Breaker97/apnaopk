import { cleanScannedCode, normalizeLookupCode } from "@/lib/catalog/barcodes";

type POSLookupVariant = {
  _id: string;
  name?: string;
  sku?: string;
  skuNormalized?: string;
  barcode?: string;
  barcodeNormalized?: string;
  stock?: number;
};

export type POSLookupProduct = {
  _id: string;
  name?: string;
  sku?: string;
  skuNormalized?: string;
  barcode?: string;
  barcodeNormalized?: string;
  stock?: number;
  variants?: POSLookupVariant[];
};

export type POSBarcodeMatch<TProduct extends POSLookupProduct> = {
  product: TProduct;
  variant?: NonNullable<TProduct["variants"]>[number];
  field: "barcode" | "sku";
  scope: "product" | "variant";
};

type POSBarcodeLookupResult<TProduct extends POSLookupProduct> =
  | {
      status: "matched";
      match: POSBarcodeMatch<TProduct>;
    }
  | {
      status: "none";
      code: string;
    }
  | {
      status: "multiple";
      code: string;
      matches: POSBarcodeMatch<TProduct>[];
    };

function normalizeBarcode(value: unknown): string {
  return normalizeLookupCode(value);
}

function normalizeSku(value: unknown): string {
  return normalizeLookupCode(value);
}

function matchesBarcode(value: unknown, code: string): boolean {
  return normalizeBarcode(value) === normalizeBarcode(code);
}

function matchesSku(value: unknown, code: string): boolean {
  return normalizeSku(value) === normalizeSku(code);
}

export function getPOSMatchStock(
  match: POSBarcodeMatch<POSLookupProduct>,
): number {
  return match.variant?.stock ?? match.product.stock ?? 0;
}

export function resolvePOSBarcodeMatch<TProduct extends POSLookupProduct>(
  products: TProduct[],
  rawCode: string,
): POSBarcodeLookupResult<TProduct> {
  const code = cleanScannedCode(rawCode);
  const normalizedCode = normalizeLookupCode(code);
  if (!code) {
    return { status: "none", code };
  }

  const matches: POSBarcodeMatch<TProduct>[] = [];

  for (const product of products) {
    if (
      matchesBarcode(product.barcodeNormalized || product.barcode, normalizedCode)
    ) {
      matches.push({ product, field: "barcode", scope: "product" });
    }

    if (matchesSku(product.skuNormalized || product.sku, normalizedCode)) {
      matches.push({ product, field: "sku", scope: "product" });
    }

    for (const variant of product.variants || []) {
      if (
        matchesBarcode(
          variant.barcodeNormalized || variant.barcode,
          normalizedCode,
        )
      ) {
        matches.push({ product, variant, field: "barcode", scope: "variant" });
      }

      if (matchesSku(variant.skuNormalized || variant.sku, normalizedCode)) {
        matches.push({ product, variant, field: "sku", scope: "variant" });
      }
    }
  }

  const uniqueMatches = dedupeMatches(matches);

  if (uniqueMatches.length === 0) {
    return { status: "none", code };
  }

  if (uniqueMatches.length > 1) {
    return { status: "multiple", code, matches: uniqueMatches };
  }

  return { status: "matched", match: uniqueMatches[0] };
}

function dedupeMatches<TProduct extends POSLookupProduct>(
  matches: POSBarcodeMatch<TProduct>[],
): POSBarcodeMatch<TProduct>[] {
  const seen = new Set<string>();
  const unique: POSBarcodeMatch<TProduct>[] = [];

  for (const match of matches) {
    const variantId = match.variant?._id || "";
    const key = `${match.product._id}:${variantId}:${match.scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
  }

  return unique;
}
