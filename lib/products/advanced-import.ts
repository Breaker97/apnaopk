import { isRecord } from "@/lib/utils";
type LooseRecord = Record<string, unknown>;
type ImportRow = Record<string, string>;

type ImportedOption = {
  _id: string;
  name: string;
  position: number;
  visual?: string;
  values: Array<{
    _id: string;
    value: string;
    position: number;
    colorCode?: string;
  }>;
};

type ImportedOptionValue = {
  optionId: string;
  optionName: string;
  valueId: string;
  value: string;
  colorCode?: string;
};

type AdvancedProductImportRow = {
  id: string;
  title: string;
  slug: string;
  sku: string;
  barcode: string;
  barcodeFormat: string;
  barcodeSource: string;
  description: string;
  shortDescription: string;
  price: number;
  comparePrice?: number;
  cost?: number;
  stock: number;
  status: string;
  category: string;
  categoryId: string;
  brand: string;
  brandId: string;
  tags: string;
  images: string;
  onlineStore: boolean;
  pointOfSale: boolean;
  featured: boolean;
  productType: string;
  weight: string;
  weightUnit: string;
  countryOfOrigin: string;
  hsCode: string;
  vendorId: string;
  productSource: string;
  shipping: { isPhysicalProduct: boolean };
  inventory: { tracked: boolean };
  options: ImportedOption[];
  variants: Array<Record<string, unknown>>;
  digitalDelivery: { downloadLimit: number };
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function boolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  if (["true", "1", "yes", "y", "on"].includes(value.trim().toLowerCase())) {
    return true;
  }
  if (["false", "0", "no", "n", "off"].includes(value.trim().toLowerCase())) {
    return false;
  }
  return fallback;
}

function list(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join("|");
  }
  return text(value);
}

function optionKey(values: ImportedOptionValue[]) {
  return values.map(({ optionId, valueId }) => `${optionId}:${valueId}`).join("|");
}

function normalizeOptions(input: unknown): ImportedOption[] {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error("Product options must be an array.");
  }
  if (input.length > 5) {
    throw new Error("A product can have at most 5 options.");
  }

  const usedNames = new Set<string>();
  return input.map((rawOption, optionIndex) => {
    if (!isRecord(rawOption)) throw new Error("Every product option must be an object.");
    const name = text(rawOption.name);
    if (!name) throw new Error("Every product option needs a name.");
    const nameKey = name.toLowerCase();
    if (usedNames.has(nameKey)) throw new Error(`Duplicate option name: ${name}.`);
    usedNames.add(nameKey);

    if (!Array.isArray(rawOption.values) || rawOption.values.length === 0) {
      throw new Error(`Option ${name} needs at least one value.`);
    }
    const usedValues = new Set<string>();
    const values = rawOption.values.map((rawValue, valueIndex) => {
      const valueRecord = isRecord(rawValue) ? rawValue : undefined;
      const value = text(valueRecord?.value ?? rawValue);
      if (!value) throw new Error(`Option ${name} contains an empty value.`);
      const valueKey = value.toLowerCase();
      if (usedValues.has(valueKey)) {
        throw new Error(`Option ${name} contains duplicate value ${value}.`);
      }
      usedValues.add(valueKey);
      const colorCode = text(valueRecord?.colorCode);
      return {
        _id: `import-option-${optionIndex + 1}-value-${valueIndex + 1}`,
        value,
        position: valueIndex,
        ...( /^#[0-9a-f]{6}$/i.test(colorCode) ? { colorCode } : {}),
      };
    });

    const visual = text(rawOption.visual);
    return {
      _id: `import-option-${optionIndex + 1}`,
      name,
      position: optionIndex,
      values,
      ...(visual ? { visual } : {}),
    };
  });
}

function createCombinations(options: ImportedOption[]): ImportedOptionValue[][] {
  return options.reduce<ImportedOptionValue[][]>((combinations, option) => {
    const next: ImportedOptionValue[][] = [];
    for (const combination of combinations) {
      for (const value of option.values) {
        next.push([
          ...combination,
          {
            optionId: option._id,
            optionName: option.name,
            valueId: value._id,
            value: value.value,
            ...(value.colorCode ? { colorCode: value.colorCode } : {}),
          },
        ]);
      }
    }
    return next;
  }, [[]]);
}

function normalizeOverrides(
  input: unknown,
  options: ImportedOption[],
): Map<string, LooseRecord> {
  if (input == null) return new Map();
  if (!Array.isArray(input)) throw new Error("Product variants must be an array.");
  if (options.length === 0 && input.length > 0) {
    throw new Error("Product variants require product options.");
  }

  const byName = new Map(options.map((option) => [option.name.toLowerCase(), option]));
  const overrides = new Map<string, LooseRecord>();
  for (const rawVariant of input) {
    if (!isRecord(rawVariant)) {
      throw new Error("Every variant needs an optionValues object.");
    }
    const rawOptionValues = rawVariant.optionValues;
    if (!isRecord(rawOptionValues)) {
      throw new Error("Every variant needs an optionValues object.");
    }

    const values = options.map((option) => {
      const rawValue = rawOptionValues[option.name];
      const value = text(rawValue);
      const matching = option.values.find(
        (candidate) => candidate.value.toLowerCase() === value.toLowerCase(),
      );
      if (!matching) {
        throw new Error(`Variant value ${value || "(empty)"} is not valid for ${option.name}.`);
      }
      return {
        optionId: option._id,
        optionName: option.name,
        valueId: matching._id,
        value: matching.value,
        ...(matching.colorCode ? { colorCode: matching.colorCode } : {}),
      };
    });

    for (const optionName of Object.keys(rawOptionValues)) {
      if (!byName.has(optionName.toLowerCase())) {
        throw new Error(`Variant uses unknown option ${optionName}.`);
      }
    }

    const key = optionKey(values);
    if (overrides.has(key)) throw new Error("Duplicate variant override.");
    overrides.set(key, rawVariant);
  }
  return overrides;
}

function normalizeVariantRows(
  options: ImportedOption[],
  rawVariants: unknown,
  price: number,
  stock: number,
  isPhysicalProduct: boolean,
) {
  if (options.length === 0) return [];
  const overrides = normalizeOverrides(rawVariants, options);
  return createCombinations(options).map((optionValues) => {
    const override = overrides.get(optionKey(optionValues));
    const comparePrice = number(override?.comparePrice, NaN);
    const cost = number(override?.cost, NaN);
    const barcode = text(override?.barcode);
    const sku = text(override?.sku);
    return {
      name: optionValues.map((value) => value.value).join(" / "),
      optionValues,
      price: number(override?.price, price),
      stock: isPhysicalProduct ? number(override?.stock, stock) : 0,
      requiresShipping: isPhysicalProduct,
      ...(sku ? { sku } : {}),
      ...(barcode ? { barcode } : {}),
      ...(Number.isFinite(comparePrice) ? { comparePrice } : {}),
      ...(Number.isFinite(cost) ? { cost } : {}),
    };
  });
}

function normalizeProduct(raw: unknown): AdvancedProductImportRow {
  if (!isRecord(raw)) throw new Error("Every product must be an object.");
  const isPhysicalProduct = boolean(raw.isPhysicalProduct, true);
  const price = number(raw.price);
  const stock = isPhysicalProduct ? number(raw.stock) : 0;
  const options = normalizeOptions(raw.options);
  const variantCount = options.reduce(
    (count, option) => count * option.values.length,
    1,
  );
  if (variantCount > 500) {
    throw new Error("A product can have at most 500 variants.");
  }
  const variants = normalizeVariantRows(
    options,
    raw.variants,
    price,
    stock,
    isPhysicalProduct,
  );
  const delivery = isRecord(raw.digitalDelivery) ? raw.digitalDelivery : {};
  const downloadLimit = Math.min(1000, number(delivery.downloadLimit ?? raw.digitalDownloadLimit));

  const comparePrice = number(raw.comparePrice, NaN);
  const cost = number(raw.cost, NaN);
  const row: AdvancedProductImportRow = {
    id: text(raw.id),
    title: text(raw.title ?? raw.name),
    slug: text(raw.slug ?? raw.handle),
    sku: text(raw.sku),
    barcode: text(raw.barcode),
    barcodeFormat: text(raw.barcodeFormat),
    barcodeSource: text(raw.barcodeSource),
    description: text(raw.description),
    shortDescription: text(raw.shortDescription),
    price,
    ...(Number.isFinite(comparePrice) ? { comparePrice } : {}),
    ...(Number.isFinite(cost) ? { cost } : {}),
    stock,
    status: text(raw.status),
    category: text(raw.category),
    categoryId: text(raw.categoryId),
    brand: text(raw.brand),
    brandId: text(raw.brandId),
    tags: list(raw.tags),
    images: list(raw.images),
    onlineStore: boolean(raw.onlineStore, true),
    pointOfSale: boolean(raw.pointOfSale, false),
    featured: boolean(raw.featured, false),
    productType: text(raw.productType),
    weight: text(raw.weight),
    weightUnit: text(raw.weightUnit),
    countryOfOrigin: text(raw.countryOfOrigin),
    hsCode: text(raw.hsCode),
    vendorId: text(raw.vendorId),
    productSource: text(raw.productSource),
    shipping: { isPhysicalProduct },
    inventory: { tracked: isPhysicalProduct },
    options,
    variants,
    digitalDelivery: { downloadLimit },
  };

  return row;
}

/**
 * Parse an advanced catalog document. The return value uses the importer’s
 * flat row shape with structured fields encoded as JSON strings so CSV and
 * JSON ultimately share the same persistence code path.
 */
export function parseAdvancedProductCatalog(
  textContent: string,
): AdvancedProductImportRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textContent);
  } catch {
    throw new Error("Advanced product import JSON is invalid.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.products)) {
    throw new Error("Advanced product import JSON must contain a products array.");
  }
  if (parsed.products.length > 1000) {
    throw new Error("Import supports up to 1000 products at a time.");
  }
  return parsed.products.map(normalizeProduct);
}

/** Convert parsed JSON records to the flat row shape used by the importer. */
export function flattenAdvancedProductCatalog(
  products: AdvancedProductImportRow[],
): ImportRow[] {
  return products.map((product) => ({
    id: product.id,
    title: product.title,
    slug: product.slug,
    sku: product.sku,
    barcode: product.barcode,
    barcodeFormat: product.barcodeFormat,
    barcodeSource: product.barcodeSource,
    description: product.description,
    shortDescription: product.shortDescription,
    price: String(product.price),
    comparePrice: product.comparePrice == null ? "" : String(product.comparePrice),
    cost: product.cost == null ? "" : String(product.cost),
    stock: String(product.stock),
    status: product.status,
    category: product.category,
    categoryId: product.categoryId,
    brand: product.brand,
    brandId: product.brandId,
    tags: product.tags,
    images: product.images,
    onlineStore: String(product.onlineStore),
    pointOfSale: String(product.pointOfSale),
    featured: String(product.featured),
    productType: product.productType,
    weight: product.weight,
    weightUnit: product.weightUnit,
    countryOfOrigin: product.countryOfOrigin,
    hsCode: product.hsCode,
    vendorId: product.vendorId,
    productSource: product.productSource,
    isPhysicalProduct: String(product.shipping.isPhysicalProduct),
    inventoryTracked: String(product.inventory.tracked),
    options: JSON.stringify(product.options),
    variants: JSON.stringify(product.variants),
    digitalDownloadLimit: String(product.digitalDelivery.downloadLimit),
  }));
}
