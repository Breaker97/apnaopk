import { generateSku } from "@/lib/products/codes";
import type { GlobalVariantVisual, LocationInventory } from "@/types";

// Types
export interface OptionValue {
  id: string;
  value: string;
  colorCode?: string;
  position: number;
}

export interface ProductOption {
  id: string;
  name: string;
  values: OptionValue[];
  position: number;
  // Storefront presentation hint. Absent → name-based fallback.
  visual?: GlobalVariantVisual;
}

export interface VariantOptionValue {
  optionId: string;
  optionName: string;
  valueId: string;
  value: string;
  colorCode?: string;
}

export interface ProductVariant {
  id: string;
  optionValues: VariantOptionValue[];
  name: string;
  sku: string;
  barcode?: string;
  barcodeFormat?: "ean13" | "upca" | "gtin14" | "code128";
  barcodeSource?: "manufacturer" | "gs1" | "internal";
  price: number;
  comparePrice?: number;
  cost?: number;
  stock: number;
  mediaId?: string;
  locationInventory?: LocationInventory[];
  requiresShipping?: boolean;
  weight?: number;
  weightUnit?: "g" | "kg" | "lb" | "oz";
  preorder?: {
    enabled?: boolean;
    releaseDate?: string;
    message?: string;
    limit?: number;
    reservedQuantity?: number;
    preorderOnly?: boolean;
    autoConvert?: boolean;
    paymentMode?: "full" | "deposit" | "pay_later";
    depositType?: "percentage" | "fixed";
    depositValue?: number;
    supplierEta?: string;
    batchName?: string;
  };
}

export interface MediaItem {
  _id: string;
  url: string;
  alt?: string;
}

// Describes which variant(s) an AI-generated image should be applied to, plus
// the colour context used to keep the generated image true to the variant.
export interface VariantAiImageTarget {
  variantIds: string[];
  label: string;
  colorName?: string;
  colorHex?: string;
}

export interface InventoryLocationLite {
  _id: string;
  name: string;
  isDefault: boolean;
}

export interface VariantsManagerProps {
  options: ProductOption[];
  onOptionsChange: (options: ProductOption[]) => void;
  variants: ProductVariant[];
  onVariantsChange: (variants: ProductVariant[]) => void;
  mediaItems?: MediaItem[];
  defaultPrice?: number;
  locations?: InventoryLocationLite[];
  onRequestAiImage?: (target: VariantAiImageTarget) => void;
  defaultRequiresShipping?: boolean;
  defaultWeightUnit?: "g" | "kg" | "lb" | "oz";
  /**
   * Set when this vendor may not open a pre-order: variants cannot switch one
   * on, and this sentence says why. A variant already on pre-order can still
   * be switched off.
   */
  preorderLockedReason?: string | null;
}

export const MAX_OPTION_COUNT = 5;
const OPTION_NAME_PLACEHOLDERS = [
  "Size",
  "Color",
  "Material",
  "Style",
  "Pattern",
];

// Sum a variant's stock from its locationInventory array (preferred) or
// fall back to the legacy stock field. The pre-save hook on the server
// applies the same priority, so this matches what gets persisted.
export function variantAvailable(variant: ProductVariant): number {
  if (
    Array.isArray(variant.locationInventory) &&
    variant.locationInventory.length > 0
  ) {
    return variant.locationInventory.reduce(
      (sum, loc) => sum + (loc.quantity || 0),
      0,
    );
  }
  return variant.stock || 0;
}

// Ensure a variant has one locationInventory entry per active location,
// preserving any existing quantities. Used when generating/merging variants
// or when a new location is added to the store.
export function withSyncedLocations(
  variant: ProductVariant,
  locations: InventoryLocationLite[],
): ProductVariant {
  if (locations.length === 0) return variant;
  const existing = new Map(
    (variant.locationInventory || []).map((li) => [
      String(li.locationId),
      li,
    ]),
  );
  const synced: LocationInventory[] = locations.map((loc) => {
    const prior = existing.get(loc._id);
    return prior
      ? { ...prior, locationName: loc.name }
      : {
          locationId: loc._id,
          locationName: loc.name,
          quantity: 0,
        };
  });
  // A variant created before the store used locations holds its units in
  // `stock` alone. The moment `locationInventory` has a single row, Σ(rows)
  // BECOMES the stock — the server's pre-validate hook applies the same
  // priority — so syncing in a grid of zeros does not leave the count
  // untracked, it silently destroys every unit the variant had.
  //
  // The whole balance therefore lands on the default location: that is where
  // the goods are until the merchant moves them, and splitting it across
  // branches would invent a distribution nobody stated. (Shopify does the same
  // when a store adds its second location.)
  //
  // Keyed on "had no rows at all", not on "the row reads zero": a merchant who
  // deliberately empties a branch must not have the legacy count resurrected
  // under them on the next save.
  if (existing.size === 0 && (variant.stock || 0) > 0) {
    const inheriting = locations.find((loc) => loc.isDefault) ?? locations[0];
    const index = synced.findIndex((row) => row.locationId === inheriting._id);
    if (index >= 0) {
      synced[index] = { ...synced[index], quantity: variant.stock };
    }
  }
  return { ...variant, locationInventory: synced };
}

export function applyBulkStockToVariants({
  variants,
  selectedVariantIds,
  quantity,
  locations,
}: {
  variants: ProductVariant[];
  selectedVariantIds: Set<string>;
  quantity: number;
  locations: InventoryLocationLite[];
}): ProductVariant[] {
  const normalizedQuantity = Math.max(0, Math.trunc(quantity) || 0);
  if (locations.length === 0) {
    return variants.map((variant) =>
      selectedVariantIds.has(variant.id)
        ? { ...variant, stock: normalizedQuantity }
        : variant,
    );
  }

  const targetLocation = locations.find((loc) => loc.isDefault) ?? locations[0];
  return variants.map((variant) => {
    if (!selectedVariantIds.has(variant.id)) return variant;

    const locationInventory = (variant.locationInventory || []).map((entry) =>
      String(entry.locationId) === targetLocation._id
        ? { ...entry, quantity: normalizedQuantity }
        : entry,
    );

    if (
      !locationInventory.some(
        (entry) => String(entry.locationId) === targetLocation._id,
      )
    ) {
      locationInventory.push({
        locationId: targetLocation._id,
        locationName: targetLocation.name,
        quantity: normalizedQuantity,
      });
    }

    const stock = locationInventory.reduce(
      (sum, entry) => sum + (entry.quantity || 0),
      0,
    );
    return { ...variant, locationInventory, stock };
  });
}

// Utility functions
export function generateId(): string {
  return crypto.randomUUID();
}

function getVariantSkuSource(variant: ProductVariant): string {
  const optionSource = variant.optionValues
    .map((optionValue) => optionValue.value)
    .filter(Boolean)
    .join(" ");
  return optionSource || variant.name || "Variant";
}

export function generateVariantSku(variant: ProductVariant): string {
  return generateSku(getVariantSkuSource(variant));
}

export function collectVariantBarcodes(
  variants: ProductVariant[],
  exceptVariantId?: string,
): Set<string> {
  return new Set(
    variants
      .filter((variant) => variant.id !== exceptVariantId)
      .map((variant) => variant.barcode?.trim())
      .filter((barcode): barcode is string => Boolean(barcode)),
  );
}

export function getOptionNamePlaceholder(index: number): string {
  return OPTION_NAME_PLACEHOLDERS[index] || `Option ${index + 1}`;
}

export function generateAllCombinations(options: ProductOption[]): ProductVariant[] {
  const validOptions = options
    .filter((o) => o.values.length > 0 && o.name.trim())
    .sort((a, b) => a.position - b.position);

  if (validOptions.length === 0) {
    return [];
  }

  let combinations: ProductVariant[] = [];

  for (const option of validOptions) {
    const sortedValues = [...option.values].sort(
      (a, b) => a.position - b.position
    );

    if (combinations.length === 0) {
      combinations = sortedValues.map((v) => ({
        id: v.id,
        optionValues: [
          {
            optionId: option.id,
            optionName: option.name,
            valueId: v.id,
            value: v.value,
            colorCode: v.colorCode,
          },
        ],
        name: v.value,
        sku: "",
        price: 0,
        stock: 0,
      }));
    } else {
      const newCombinations: ProductVariant[] = [];
      for (const combo of combinations) {
        for (const value of sortedValues) {
          newCombinations.push({
            id: `${combo.id}_${value.id}`,
            optionValues: [
              ...combo.optionValues,
              {
                optionId: option.id,
                optionName: option.name,
                valueId: value.id,
                value: value.value,
                colorCode: value.colorCode,
              },
            ],
            name: [
              ...combo.optionValues.map((ov) => ov.value),
              value.value,
            ].join(" / "),
            sku: "",
            price: 0,
            stock: 0,
          });
        }
      }
      combinations = newCombinations;
    }
  }

  return combinations;
}

export function mergeVariants(
  newCombinations: ProductVariant[],
  existingVariants: ProductVariant[],
  defaultPrice: number
): ProductVariant[] {
  const existingMap = new Map<string, ProductVariant>();

  for (const variant of existingVariants) {
    const key = variant.optionValues.map((ov) => ov.valueId).join("_");
    existingMap.set(key, variant);
  }

  return newCombinations.map((combo) => {
    const key = combo.optionValues.map((ov) => ov.valueId).join("_");
    const existing = existingMap.get(key);

    if (existing) {
      return {
        ...combo,
        sku: existing.sku,
        price: existing.price,
        comparePrice: existing.comparePrice,
        stock: existing.stock,
        mediaId: existing.mediaId,
        locationInventory: existing.locationInventory,
        preorder: existing.preorder,
      };
    }

    return { ...combo, price: defaultPrice };
  });
}

export function groupVariantsByOption(
  variants: ProductVariant[],
  optionId: string
): Map<string, ProductVariant[]> {
  const groups = new Map<string, ProductVariant[]>();

  for (const variant of variants) {
    const optionValue = variant.optionValues.find(
      (ov) => ov.optionId === optionId
    );
    const groupKey = optionValue?.value || "Other";

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(variant);
  }

  return groups;
}

// Sortable Value Item
