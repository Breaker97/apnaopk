import { BarcodeRegistry } from "@/models/barcode-registry.model";
import { ConflictError } from "@/lib/api/errors";
import { normalizeBarcodeForLookup } from "@/lib/catalog/barcodes";
import {
  detectBarcodeFormat,
  type BarcodeFormat,
  type BarcodeSource,
} from "@/lib/barcode/standards";

type LooseBarcodeTarget = Record<string, unknown> & {
  _id?: unknown;
  barcode?: unknown;
  barcodeFormat?: unknown;
  barcodeSource?: unknown;
};

type LooseProduct = LooseBarcodeTarget & {
  variants?: LooseBarcodeTarget[];
};

type RegistryEntry = {
  value: string;
  valueNormalized: string;
  variantId?: string;
  format: BarcodeFormat;
  source?: BarcodeSource;
};

function toEntry(target: LooseBarcodeTarget, variant = false): RegistryEntry | null {
  const value = typeof target.barcode === "string" ? target.barcode.trim() : "";
  const valueNormalized = normalizeBarcodeForLookup(value);
  if (!value || !valueNormalized) return null;
  const variantId = variant && target._id ? String(target._id) : undefined;
  return {
    value,
    valueNormalized,
    variantId,
    format:
      typeof target.barcodeFormat === "string"
        ? (target.barcodeFormat as BarcodeFormat)
        : detectBarcodeFormat(value),
    source:
      typeof target.barcodeSource === "string"
        ? (target.barcodeSource as BarcodeSource)
        : undefined,
  };
}

export function buildBarcodeRegistryEntries(product: LooseProduct): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  const productEntry = toEntry(product);
  if (productEntry) entries.push(productEntry);
  for (const variant of product.variants || []) {
    const entry = toEntry(variant, true);
    if (entry) entries.push(entry);
  }
  return entries;
}

function duplicateError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    Number((error as { code?: unknown }).code) === 11000
  );
}

export async function reserveProductBarcodeRegistry(
  productId: string,
  product: LooseProduct,
) {
  const entries = buildBarcodeRegistryEntries(product);
  const values = entries.map((entry) => entry.valueNormalized);
  if (new Set(values).size !== values.length) {
    throw new ConflictError("A barcode can only be assigned to one product or variant");
  }

  const conflictingEntry = values.length
    ? await BarcodeRegistry.exists({
        valueNormalized: { $in: values },
        productId: { $ne: productId },
      })
    : null;
  if (conflictingEntry) {
    throw new ConflictError("Barcode is already assigned to another product or variant");
  }

  try {
    for (const entry of entries) {
      await BarcodeRegistry.updateOne(
        { valueNormalized: entry.valueNormalized, productId },
        {
          $set: {
            value: entry.value,
            valueNormalized: entry.valueNormalized,
            productId,
            variantId: entry.variantId,
            format: entry.format,
            source: entry.source,
            active: true,
          },
        },
        { upsert: true, runValidators: true },
      );
    }
  } catch (error) {
    if (duplicateError(error)) {
      throw new ConflictError("Barcode is already assigned to another product or variant");
    }
    throw error;
  }
  return entries;
}

export async function syncProductBarcodeRegistry(
  productId: string,
  product: LooseProduct,
) {
  const entries = await reserveProductBarcodeRegistry(productId, product);
  const values = entries.map((entry) => entry.valueNormalized);
  await BarcodeRegistry.deleteMany({
    productId,
    ...(values.length > 0 ? { valueNormalized: { $nin: values } } : {}),
  });
}

export async function releaseProductBarcodeRegistry(productId: string) {
  await BarcodeRegistry.deleteMany({ productId });
}
