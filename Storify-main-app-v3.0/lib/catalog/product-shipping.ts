export type ProductWeightUnit = "g" | "kg" | "lb" | "oz";
type ProductDimensionUnit = "cm" | "in";

/**
 * Parcel size. Optional throughout: a store that never fills it in still ships,
 * it just gets the default box instead of a tighter (cheaper) one.
 */
export type ProductDimensions = {
  length?: number;
  width?: number;
  height?: number;
  dimensionUnit?: ProductDimensionUnit;
};

export type ProductShippingData = ProductDimensions & {
  isPhysicalProduct?: boolean;
  weight?: number;
  weightUnit?: ProductWeightUnit;
  countryOfOrigin?: string;
  hsCode?: string;
  customsDescription?: string;
};

export type VariantShippingData = ProductDimensions & {
  requiresShipping?: boolean;
  weight?: number;
  weightUnit?: ProductWeightUnit;
};

type OrderItemCustomsSnapshot = {
  countryOfOrigin?: string;
  hsCode?: string;
  description?: string;
  weight?: number;
  weightUnit?: ProductWeightUnit;
};

const GRAMS_PER_UNIT: Record<ProductWeightUnit, number> = {
  g: 1,
  kg: 1000,
  lb: 453.59237,
  oz: 28.349523125,
};

function finiteNonNegative(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function convertWeight(
  weight: number,
  fromUnit: ProductWeightUnit,
  toUnit: ProductWeightUnit,
): number {
  const normalizedWeight = finiteNonNegative(weight);
  if (fromUnit === toUnit) return normalizedWeight;
  return (normalizedWeight * GRAMS_PER_UNIT[fromUnit]) / GRAMS_PER_UNIT[toUnit];
}

function normalizeCountryOfOrigin(value: unknown): string | undefined {
  const country = String(value || "").trim();
  if (!country) return undefined;
  return country.length === 2 ? country.toUpperCase() : country;
}

function normalizeHsCode(value: unknown): string | undefined {
  const hsCode = String(value || "").replace(/\D/g, "");
  return hsCode || undefined;
}

function normalizeCustomsDescription(
  value: unknown,
): string | undefined {
  const description = String(value || "").replace(/\s+/g, " ").trim();
  return description || undefined;
}

/**
 * A box only counts when all three axes are present.
 *
 * A partially filled size is worse than none: it would produce an envelope
 * with a zero axis, which fits nothing and silently pushes every consignment
 * into the largest box.
 */
function normalizeDimensions(
  dimensions: ProductDimensions | undefined,
): ProductDimensions {
  const length = finiteNonNegative(dimensions?.length);
  const width = finiteNonNegative(dimensions?.width);
  const height = finiteNonNegative(dimensions?.height);
  if (!length || !width || !height) return {};
  return {
    length,
    width,
    height,
    dimensionUnit: dimensions?.dimensionUnit === "in" ? "in" : "cm",
  };
}

export function normalizeProductShippingData(
  shipping: ProductShippingData | undefined,
): ProductShippingData {
  const isPhysicalProduct = shipping?.isPhysicalProduct !== false;
  return {
    isPhysicalProduct,
    weight: finiteNonNegative(shipping?.weight),
    weightUnit: shipping?.weightUnit || "kg",
    ...normalizeDimensions(shipping),
    countryOfOrigin: normalizeCountryOfOrigin(shipping?.countryOfOrigin),
    hsCode: normalizeHsCode(shipping?.hsCode),
    customsDescription: normalizeCustomsDescription(
      shipping?.customsDescription,
    ),
  };
}

/**
 * The box for one line: the variant's when it has a complete one, else the
 * product's. Mirrors how weight already resolves — variant wins, product is
 * the fallback.
 */
export function resolveItemDimensions(params: {
  productShipping?: ProductShippingData;
  variantShipping?: VariantShippingData;
}): ProductDimensions {
  const variant = normalizeDimensions(params.variantShipping);
  if (variant.length) return variant;
  return normalizeDimensions(params.productShipping);
}

/**
 * True when an update payload asks to flip a product between physical and
 * digital.
 *
 * That switch is not allowed after creation: the two formats own different
 * data (weight/customs vs. private download files), different checkout paths
 * (shipping step vs. none) and different stock semantics (counted vs.
 * unlimited), and existing carts, orders and shipments already reference the
 * old shape. Merchants create a new product instead.
 *
 * Only an explicit boolean counts — a partial update that just changes the
 * weight leaves `isPhysicalProduct` out, and an absent stored flag means
 * physical (the same default `normalizeProductShippingData` applies).
 */
export function isProductFormatChange(
  existing: ProductShippingData | undefined | null,
  next: ProductShippingData | undefined | null,
): boolean {
  if (!next || typeof next.isPhysicalProduct !== "boolean") return false;
  return next.isPhysicalProduct !== (existing?.isPhysicalProduct !== false);
}

export function resolveItemShipping(params: {
  productShipping?: ProductShippingData;
  variantShipping?: VariantShippingData;
  quantity?: number;
  targetWeightUnit?: ProductWeightUnit;
}) {
  const product = normalizeProductShippingData(params.productShipping);
  const requiresShipping =
    params.variantShipping?.requiresShipping ?? product.isPhysicalProduct ?? true;
  const sourceWeight =
    params.variantShipping?.weight ?? product.weight ?? 0;
  const sourceWeightUnit =
    params.variantShipping?.weightUnit ?? product.weightUnit ?? "kg";
  const weightUnit = params.targetWeightUnit || "kg";
  const quantity = finiteNonNegative(params.quantity ?? 1);
  const unitWeight = requiresShipping
    ? convertWeight(sourceWeight, sourceWeightUnit, weightUnit)
    : 0;

  return {
    requiresShipping,
    unitWeight,
    totalWeight: unitWeight * quantity,
    weightUnit,
  };
}

export function buildOrderItemCustomsSnapshot(params: {
  productShipping?: ProductShippingData;
  variantShipping?: VariantShippingData;
}): OrderItemCustomsSnapshot | undefined {
  const normalized = normalizeProductShippingData(params.productShipping);
  const resolved = resolveItemShipping({
    productShipping: normalized,
    variantShipping: params.variantShipping,
    targetWeightUnit:
      params.variantShipping?.weightUnit || normalized.weightUnit || "kg",
  });
  if (!resolved.requiresShipping) return undefined;

  const snapshot: OrderItemCustomsSnapshot = {
    countryOfOrigin: normalized.countryOfOrigin,
    hsCode: normalized.hsCode,
    description: normalized.customsDescription,
    weight: resolved.unitWeight,
    weightUnit: resolved.weightUnit,
  };

  return Object.values(snapshot).some((value) => value !== undefined)
    ? snapshot
    : undefined;
}

/**
 * True when a shipping configuration prices anything by weight, i.e. at least
 * one active `weight_range` rate in any zone. The product form uses this to
 * decide whether a missing product weight is worth warning about.
 */
export function hasWeightRates(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const zones = (value as { zones?: unknown }).zones;
  if (!Array.isArray(zones)) return false;
  return zones.some((zone) => {
    const rates = (zone as { rates?: unknown })?.rates;
    return (
      Array.isArray(rates) &&
      rates.some(
        (rate) =>
          (rate as { type?: unknown; active?: unknown })?.type ===
            "weight_range" &&
          (rate as { active?: unknown }).active !== false,
      )
    );
  });
}
