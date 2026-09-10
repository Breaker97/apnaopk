import { ConflictError, ValidationError } from "@/lib/api/errors";
import { normalizeBarcodeForLookup } from "@/lib/catalog/barcodes";
import {
  assignProductLookupCodes,
  collectProductBarcodeEntries,
  findDuplicateBarcodeCodes,
} from "@/lib/products/barcode-normalization";
import {
  inspectBarcode,
  type BarcodeFormat,
  type BarcodeSource,
} from "@/lib/barcode/standards";

type ProductBarcodePayload = Record<string, unknown> & {
  variants?: Array<Record<string, unknown>>;
};

type ProductModelLike = {
  find: (query: Record<string, unknown>) => {
    select: (fields: string) => {
      lean: () => Promise<ProductBarcodePayload[]>;
    };
  };
};

export function buildBarcodeValidationPayload(
  existing: ProductBarcodePayload | null | undefined,
  update: ProductBarcodePayload,
): ProductBarcodePayload {
  return {
    ...(existing || {}),
    ...update,
    variants: Array.isArray(update.variants)
      ? update.variants
      : Array.isArray(existing?.variants)
        ? existing.variants
        : [],
  };
}

function codeMatchesProduct(product: ProductBarcodePayload, code: string) {
  if (normalizeBarcodeForLookup(product.barcode) === code) return true;
  if (normalizeBarcodeForLookup(product.barcodeNormalized) === code) return true;

  for (const variant of product.variants || []) {
    if (normalizeBarcodeForLookup(variant.barcode) === code) return true;
    if (normalizeBarcodeForLookup(variant.barcodeNormalized) === code) return true;
  }

  return false;
}

export async function assertProductBarcodesAreUnique(
  Product: ProductModelLike,
  product: ProductBarcodePayload,
  options: { excludeProductId?: string } = {},
) {
  assignProductLookupCodes(product);

  const candidates = [
    product,
    ...(Array.isArray(product.variants) ? product.variants : []),
  ];
  const invalidBarcodes: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate.barcode !== "string" || !candidate.barcode.trim()) continue;
    const inspection = inspectBarcode(candidate.barcode, {
      format:
        typeof candidate.barcodeFormat === "string"
          ? (candidate.barcodeFormat as BarcodeFormat)
          : undefined,
      source:
        typeof candidate.barcodeSource === "string"
          ? (candidate.barcodeSource as BarcodeSource)
          : undefined,
    });
    if (!inspection.valid) {
      invalidBarcodes.push(`${candidate.barcode}: ${inspection.message || "invalid"}`);
    }
  }
  if (invalidBarcodes.length > 0) {
    throw new ValidationError({ barcode: invalidBarcodes });
  }

  const duplicates = findDuplicateBarcodeCodes(product);
  if (duplicates.length > 0) {
    throw new ValidationError({
      barcode: [`Duplicate barcode value: ${duplicates.join(", ")}`],
    });
  }

  const codes = [...new Set(collectProductBarcodeEntries(product).map((entry) => entry.code))];
  if (codes.length === 0) return;

  const query: Record<string, unknown> = {
    $or: [
      { barcodeNormalized: { $in: codes } },
      { "variants.barcodeNormalized": { $in: codes } },
      { barcode: { $in: codes } },
      { "variants.barcode": { $in: codes } },
    ],
  };

  if (options.excludeProductId) {
    query._id = { $ne: options.excludeProductId };
  }

  const conflicts = await Product.find(query)
    .select("name title barcode barcodeNormalized variants")
    .lean();

  const conflictingCodes = codes.filter((code) =>
    conflicts.some((conflict) => codeMatchesProduct(conflict, code)),
  );

  if (conflictingCodes.length > 0) {
    throw new ConflictError(
      `Barcode already exists: ${conflictingCodes.join(", ")}`,
    );
  }
}
