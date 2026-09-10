import {
  normalizeBarcodeForLookup,
  normalizeSkuForLookup,
} from "@/lib/catalog/barcodes";

type LooseProduct = Record<string, unknown> & {
  variants?: Array<Record<string, unknown>>;
};

type ProductBarcodeEntry = {
  code: string;
  label: string;
};

function setOrDelete(target: Record<string, unknown>, key: string, value: string) {
  if (value) target[key] = value;
  else delete target[key];
}

export function assignProductLookupCodes<TProduct extends LooseProduct>(
  product: TProduct,
): TProduct {
  setOrDelete(product, "barcodeNormalized", normalizeBarcodeForLookup(product.barcode));
  setOrDelete(product, "skuNormalized", normalizeSkuForLookup(product.sku));

  if (Array.isArray(product.variants)) {
    for (const variant of product.variants) {
      setOrDelete(
        variant,
        "barcodeNormalized",
        normalizeBarcodeForLookup(variant.barcode),
      );
      setOrDelete(variant, "skuNormalized", normalizeSkuForLookup(variant.sku));
    }
  }

  return product;
}

export function collectProductBarcodeEntries(
  product: LooseProduct,
): ProductBarcodeEntry[] {
  const entries: ProductBarcodeEntry[] = [];
  const productBarcode = normalizeBarcodeForLookup(product.barcode);
  if (productBarcode) {
    entries.push({ code: productBarcode, label: "product barcode" });
  }

  if (Array.isArray(product.variants)) {
    for (const [index, variant] of product.variants.entries()) {
      const variantBarcode = normalizeBarcodeForLookup(variant.barcode);
      if (variantBarcode) {
        entries.push({
          code: variantBarcode,
          label: `variant ${index + 1} barcode`,
        });
      }
    }
  }

  return entries;
}

export function findDuplicateBarcodeCodes(product: LooseProduct): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entry of collectProductBarcodeEntries(product)) {
    if (seen.has(entry.code)) duplicates.add(entry.code);
    seen.add(entry.code);
  }

  return [...duplicates];
}
