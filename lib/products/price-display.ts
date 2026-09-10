export type MoneyRangeLike = {
  min?: number;
  max?: number;
};

type ProductPriceVariant = {
  _id?: unknown;
  name?: string;
  price?: number;
  comparePrice?: number;
};

export type ProductPriceSummary = {
  price?: number;
  comparePrice?: number;
  priceRange?: MoneyRangeLike;
  compareAtPriceRange?: MoneyRangeLike;
  variants?: ProductPriceVariant[];
};

function money(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizeRange(
  range: MoneyRangeLike | undefined,
): Required<MoneyRangeLike> | null {
  const min = money(range?.min);
  const max = money(range?.max);
  if (min === null || max === null) return null;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

function variantPrices(product: ProductPriceSummary): number[] {
  return (product.variants || [])
    .map((variant) => money(variant.price))
    .filter((price): price is number => price !== null);
}

function displayedCompareAtPrice(product: ProductPriceSummary): number | null {
  const displayPrice = getProductPriceRange(product).min;
  const variants = product.variants || [];
  const matchingVariantComparePrices = variants
    .filter((variant) => money(variant.price) === displayPrice)
    .map((variant) => money(variant.comparePrice))
    .filter(
      (comparePrice): comparePrice is number =>
        comparePrice !== null && comparePrice > displayPrice,
    );

  if (matchingVariantComparePrices.length > 0) {
    return Math.min(...matchingVariantComparePrices);
  }

  if (variants.length > 0) return null;

  const comparePrice = money(product.comparePrice);
  if (comparePrice !== null && comparePrice > displayPrice) {
    return comparePrice;
  }

  const storedRange = normalizeRange(product.compareAtPriceRange);
  if (storedRange && storedRange.min > displayPrice) {
    return storedRange.min;
  }

  return null;
}

export function getProductPriceRange(
  product: ProductPriceSummary,
): Required<MoneyRangeLike> {
  const prices = variantPrices(product);
  if (prices.length > 0) {
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }

  const storedRange = normalizeRange(product.priceRange);
  if (storedRange) {
    return { min: storedRange.min, max: storedRange.max };
  }

  const price = money(product.price) ?? 0;
  return { min: price, max: price };
}

export function formatProductPrice(
  product: ProductPriceSummary,
  formatPrice: (price: number) => string,
): string {
  const range = getProductPriceRange(product);
  return formatPrice(range.min);
}

export function getProductCompareAtRange(
  product: ProductPriceSummary,
): Required<MoneyRangeLike> | null {
  const comparePrices = (product.variants || [])
    .filter((variant) => {
      const price = money(variant.price);
      const comparePrice = money(variant.comparePrice);
      return price !== null && comparePrice !== null && comparePrice > price;
    })
    .map((variant) => variant.comparePrice!)
    .filter((price): price is number => money(price) !== null);

  if (comparePrices.length > 0) {
    return {
      min: Math.min(...comparePrices),
      max: Math.max(...comparePrices),
    };
  }

  const storedRange = normalizeRange(product.compareAtPriceRange);
  if (storedRange) {
    return { min: storedRange.min, max: storedRange.max };
  }

  const price = money(product.price);
  const comparePrice = money(product.comparePrice);
  if (price !== null && comparePrice !== null && comparePrice > price) {
    return { min: comparePrice, max: comparePrice };
  }

  return null;
}

export function formatProductCompareAtPrice(
  product: ProductPriceSummary,
  formatPrice: (price: number) => string,
): string | null {
  const comparePrice = displayedCompareAtPrice(product);
  return comparePrice === null ? null : formatPrice(comparePrice);
}

export function getProductDiscountPercentage(
  product: ProductPriceSummary,
): number {
  const price = getProductPriceRange(product).min;
  const comparePrice = displayedCompareAtPrice(product);
  if (comparePrice !== null && comparePrice > price) {
    return Math.round(((comparePrice - price) / comparePrice) * 100);
  }

  return 0;
}

/**
 * What the shopper keeps, in money: the displayed compare-at price less the
 * displayed price. Zero when there is no real saving — the caller prints
 * nothing rather than "You save $0.00".
 */
export function getProductSavings(product: ProductPriceSummary): number {
  const price = getProductPriceRange(product).min;
  const comparePrice = displayedCompareAtPrice(product);
  return comparePrice !== null && comparePrice > price ? comparePrice - price : 0;
}

export function productRequiresVariantSelection(
  product: ProductPriceSummary,
): boolean {
  return Array.isArray(product.variants) && product.variants.length > 1;
}

export function productMatchesPriceFilter(
  product: ProductPriceSummary,
  minPrice: number,
  maxPrice: number,
): boolean {
  const prices = variantPrices(product);
  if (prices.length > 0) {
    return prices.some((price) => price >= minPrice && price <= maxPrice);
  }

  const price = getProductPriceRange(product).min;
  return price >= minPrice && price <= maxPrice;
}
