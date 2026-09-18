import { isRecord } from "@/lib/utils";

type LooseRecord = Record<string, unknown>;

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

type ImportedVariant = {
  name: string;
  optionValues: ImportedOptionValue[];
  price: number;
  stock: number;
  requiresShipping: boolean;
  sku?: string;
  barcode?: string;
  comparePrice?: number;
  cost?: number;
};

/**
 * One product of an advanced catalog, validated.
 *
 * A field the document leaves out stays `undefined` rather than taking a
 * default: when the product already exists the importer keeps its stored value
 * for that field, so re-importing a catalog that never mentions stock does not
 * zero the shelf, and one that never mentions `featured` does not un-feature
 * anything. New products get the model's defaults instead.
 */
type AdvancedProduct = {
  id: string;
  title: string;
  slug: string;
  sku: string;
  barcode: string;
  barcodeFormat: string;
  barcodeSource: string;
  description: string;
  shortDescription: string;
  price?: number;
  comparePrice?: number;
  cost?: number;
  stock?: number;
  status: string;
  category: string;
  categoryId: string;
  brand: string;
  brandId: string;
  tags: string;
  images: string;
  onlineStore?: boolean;
  pointOfSale?: boolean;
  featured?: boolean;
  productType: string;
  weight: string;
  weightUnit: string;
  countryOfOrigin: string;
  hsCode: string;
  vendorId: string;
  productSource: string;
  isPhysicalProduct?: boolean;
  inventoryTracked?: boolean;
  digitalDownloadLimit?: number;
  options?: ImportedOption[];
  variants?: ImportedVariant[];
};

const MAX_CATALOG_PRODUCTS = 1000;
const MAX_OPTIONS = 5;
const MAX_VARIANTS = 500;
const MAX_DOWNLOAD_LIMIT = 1000;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function isAbsent(value: unknown) {
  return value === undefined || value === null || text(value) === "";
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (isAbsent(value)) return undefined;
  const parsed = typeof value === "number" ? value : Number(text(value));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${field} must be a number of 0 or more.`);
  }
  return parsed;
}

function optionalCount(
  value: unknown,
  field: string,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const parsed = optionalNumber(value, field);
  if (parsed !== undefined && (!Number.isInteger(parsed) || parsed > max)) {
    throw new Error(
      max === Number.MAX_SAFE_INTEGER
        ? `${field} must be a whole number of 0 or more.`
        : `${field} must be a whole number from 0 to ${max}.`,
    );
  }
  return parsed;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (isAbsent(value)) return undefined;
  const normalized = text(value).toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  throw new Error(`${field} must be true or false.`);
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
  if (!Array.isArray(input)) {
    throw new Error("Product options must be an array.");
  }
  if (input.length > MAX_OPTIONS) {
    throw new Error(`A product can have at most ${MAX_OPTIONS} options.`);
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

function normalizeVariants(
  options: ImportedOption[],
  rawVariants: unknown,
  product: { price?: number; stock?: number; isPhysicalProduct?: boolean },
): ImportedVariant[] {
  const overrides = normalizeOverrides(rawVariants, options);
  const isPhysicalProduct = product.isPhysicalProduct !== false;
  if (options.length === 0) return [];

  return createCombinations(options).map((optionValues) => {
    const override = overrides.get(optionKey(optionValues));
    const name = optionValues.map((value) => value.value).join(" / ");
    const price = optionalNumber(override?.price, `Variant ${name} price`) ?? product.price;
    // A variant with no price anywhere would go on sale for nothing.
    if (price === undefined) {
      throw new Error(
        `Variant ${name} has no price. Set price on the product or on this variant.`,
      );
    }
    const stock = optionalCount(override?.stock, `Variant ${name} stock`) ?? product.stock ?? 0;
    const comparePrice = optionalNumber(override?.comparePrice, `Variant ${name} comparePrice`);
    const cost = optionalNumber(override?.cost, `Variant ${name} cost`);
    const barcode = text(override?.barcode);
    const sku = text(override?.sku);
    return {
      name,
      optionValues,
      price,
      stock: isPhysicalProduct ? stock : 0,
      requiresShipping: isPhysicalProduct,
      ...(sku ? { sku } : {}),
      ...(barcode ? { barcode } : {}),
      ...(comparePrice !== undefined ? { comparePrice } : {}),
      ...(cost !== undefined ? { cost } : {}),
    };
  });
}

/**
 * Validate one product of an advanced catalog. Throws with a message naming
 * the problem; the importer reports it against this product alone, so one bad
 * entry does not stop the rest of the catalog.
 */
export function normalizeAdvancedProduct(raw: unknown): AdvancedProduct {
  if (!isRecord(raw)) throw new Error("Every product must be an object.");

  const isPhysicalProduct = optionalBoolean(raw.isPhysicalProduct, "isPhysicalProduct");
  const price = optionalNumber(raw.price, "price");
  // A digital product has no stock to count, whatever the document says.
  const stock = isPhysicalProduct === false ? 0 : optionalCount(raw.stock, "stock");

  let options: ImportedOption[] | undefined;
  let variants: ImportedVariant[] | undefined;
  if (raw.options != null) {
    options = normalizeOptions(raw.options);
    const variantCount = options.reduce(
      (count, option) => count * option.values.length,
      1,
    );
    if (variantCount > MAX_VARIANTS) {
      throw new Error(`A product can have at most ${MAX_VARIANTS} variants.`);
    }
    variants = normalizeVariants(options, raw.variants, {
      price,
      stock,
      isPhysicalProduct,
    });
  } else if (raw.variants != null) {
    throw new Error("Product variants require product options.");
  }

  const delivery = isRecord(raw.digitalDelivery) ? raw.digitalDelivery : {};

  return {
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
    comparePrice: optionalNumber(raw.comparePrice, "comparePrice"),
    cost: optionalNumber(raw.cost, "cost"),
    stock,
    status: text(raw.status),
    category: text(raw.category),
    categoryId: text(raw.categoryId),
    brand: text(raw.brand),
    brandId: text(raw.brandId),
    tags: list(raw.tags),
    images: list(raw.images),
    onlineStore: optionalBoolean(raw.onlineStore, "onlineStore"),
    pointOfSale: optionalBoolean(raw.pointOfSale, "pointOfSale"),
    featured: optionalBoolean(raw.featured, "featured"),
    productType: text(raw.productType),
    weight: text(raw.weight),
    weightUnit: text(raw.weightUnit),
    countryOfOrigin: text(raw.countryOfOrigin),
    hsCode: text(raw.hsCode),
    vendorId: text(raw.vendorId),
    productSource: text(raw.productSource),
    isPhysicalProduct,
    inventoryTracked: optionalBoolean(raw.inventoryTracked, "inventoryTracked"),
    digitalDownloadLimit: optionalCount(
      delivery.downloadLimit ?? raw.digitalDownloadLimit,
      "digitalDelivery.downloadLimit",
      MAX_DOWNLOAD_LIMIT,
    ),
    options,
    variants,
  };
}

/**
 * Read an advanced catalog document's envelope. Only a problem with the file as
 * a whole throws here; each product is validated separately by
 * `normalizeAdvancedProduct`.
 */
export function parseAdvancedProductCatalog(textContent: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(textContent);
  } catch {
    throw new Error("Advanced product import JSON is invalid.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.products)) {
    throw new Error("Advanced product import JSON must contain a products array.");
  }
  if (parsed.products.length > MAX_CATALOG_PRODUCTS) {
    throw new Error(`Import supports up to ${MAX_CATALOG_PRODUCTS} products at a time.`);
  }
  return parsed.products;
}

function cell(value: number | boolean | undefined) {
  return value === undefined ? "" : String(value);
}

/**
 * The importer's flat row for one advanced product. CSV and JSON share one
 * persistence path, so structured fields travel as JSON strings and an absent
 * field travels as an empty cell — which the importer reads as "keep".
 */
export function toImportValues(product: AdvancedProduct): Record<string, string> {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    sku: product.sku,
    barcode: product.barcode,
    barcodeFormat: product.barcodeFormat,
    barcodeSource: product.barcodeSource,
    description: product.description,
    shortDescription: product.shortDescription,
    price: cell(product.price),
    comparePrice: cell(product.comparePrice),
    cost: cell(product.cost),
    stock: cell(product.stock),
    status: product.status,
    category: product.category,
    categoryId: product.categoryId,
    brand: product.brand,
    brandId: product.brandId,
    tags: product.tags,
    images: product.images,
    onlineStore: cell(product.onlineStore),
    pointOfSale: cell(product.pointOfSale),
    featured: cell(product.featured),
    productType: product.productType,
    weight: product.weight,
    weightUnit: product.weightUnit,
    countryOfOrigin: product.countryOfOrigin,
    hsCode: product.hsCode,
    vendorId: product.vendorId,
    productSource: product.productSource,
    isPhysicalProduct: cell(product.isPhysicalProduct),
    inventoryTracked: cell(product.inventoryTracked),
    digitalDownloadLimit: cell(product.digitalDownloadLimit),
    options: product.options === undefined ? "" : JSON.stringify(product.options),
    variants: product.variants === undefined ? "" : JSON.stringify(product.variants),
  };
}
