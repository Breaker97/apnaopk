import type { VendorMessagingSettings } from "@/lib/notifications/vendor-messaging";
import type { MoneyRangeLike } from "@/lib/products/price-display";

/**
 * The product page draws most of itself on the server (components/products/
 * product-details.tsx) and runs code in the browser only for the controls a
 * shopper works: the variant picker, the price it moves, the cart buttons,
 * the gallery. This module is the line between the two — what the server
 * reads, and the smaller shape those controls are handed.
 *
 * Everything that crosses it is serialized into the page's RSC payload, so
 * `toPurchaseProduct` keeps only what the browser reads. The loader's own
 * document stays whole: it also answers GET /api/products/[slug].
 *
 * Pure and free of server imports, so the browser can import its types.
 */

type WeightUnit = "g" | "kg" | "lb" | "oz";

export type ProductPreorderSettings = {
  enabled?: boolean;
  releaseDate?: string | Date;
  message?: string;
  limit?: number;
  reservedQuantity?: number;
  preorderOnly?: boolean;
  autoConvert?: boolean;
  paymentMode?: "full" | "deposit" | "pay_later";
  depositType?: "percentage" | "fixed";
  depositValue?: number;
  batchName?: string;
};

type SourceOptionValue =
  | string
  | {
      optionId: string;
      optionName: string;
      valueId: string;
      value: string;
      colorCode?: string;
    };

type ProductMediaKind = "image" | "video" | "model" | "external_video";

/**
 * The product as getStorefrontProductBySlug (lib/products/storefront-product-
 * detail.ts) serves it: what the product page's server shell reads.
 */
export interface ProductPageProduct {
  _id: string;
  name: string;
  title?: string;
  slug: string;
  /** Sanitized on the server by the loader. */
  description: string;
  shortDescription?: string;
  price: number;
  comparePrice?: number;
  priceRange?: MoneyRangeLike;
  compareAtPriceRange?: MoneyRangeLike;
  /** Sold by quote — see lib/products/quote-pricing.ts. */
  priceOnRequest?: boolean;
  quoteButtonLabel?: string;
  sku: string;
  barcode?: string;
  stock: number;
  /** Stock policy — read via lib/products/stock-policy.ts, never directly. */
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
  preorder?: ProductPreorderSettings;
  images: string[];
  media?: {
    _id: string;
    type?: ProductMediaKind;
    url: string;
    alt?: string;
    position?: number;
    mimeType?: string;
    thumbnailUrl?: string;
    provider?: "youtube" | "vimeo";
    embedId?: string;
    fit?: "auto" | "contain" | "cover";
    /** Recorded at upload; the carousels size each frame by them. */
    width?: number;
    height?: number;
  }[];
  category?: { _id: string; name: string; slug: string };
  brand?: { _id: string; name: string; slug: string; logo?: string };
  tags: string[];
  attributes: { name: string; value: string }[];
  shipping?: {
    isPhysicalProduct?: boolean;
    weight?: number;
    weightUnit?: WeightUnit;
    countryOfOrigin?: string;
    hsCode?: string;
  };
  options?: {
    name: string;
    visual?: string | null;
    values: {
      _id: string;
      value: string;
      position?: number;
      colorCode?: string;
    }[];
  }[];
  variants: {
    _id: string;
    name: string;
    sku: string;
    barcode?: string;
    price: number;
    comparePrice?: number;
    stock: number;
    attributes: { name: string; value: string }[];
    optionValues?: SourceOptionValue[];
    weight?: number;
    weightUnit?: WeightUnit;
    mediaId?: string;
    preorder?: ProductPreorderSettings;
  }[];
  rating: number;
  reviewCount: number;
  vendorId?: {
    _id: string;
    storeName: string;
    slug: string;
    logo?: string;
    rating: number;
    messaging?: VendorMessagingSettings;
    isDefault?: boolean;
  };
  platformMessaging?: VendorMessagingSettings;
}

/** A gallery item, in display order, its kind resolved. */
type PurchaseMedia = {
  id: string;
  type: ProductMediaKind;
  url: string;
  alt: string;
  thumbnailUrl?: string;
  provider?: "youtube" | "vimeo";
  embedId?: string;
  fit?: "auto" | "contain" | "cover";
  width?: number;
  height?: number;
};

export type PurchaseVariant = {
  _id: string;
  name: string;
  sku: string;
  barcode?: string;
  price: number;
  comparePrice?: number;
  stock: number;
  attributes?: { name: string; value: string }[];
  /**
   * One answer per option, in the options' order. A plain string when the
   * option's own name applies; the name travels with the value only where the
   * variant recorded a different one.
   */
  optionValues?: (string | { optionName: string; value: string })[];
  weight?: number;
  weightUnit?: WeightUnit;
  /** Where the variant's own picture sits in `PurchaseProduct.media`. */
  mediaIndex?: number;
  /** Present only when the variant runs its own pre-order. */
  preorder?: ProductPreorderSettings;
};

type PurchaseOption = {
  name: string;
  visual?: string | null;
  /**
   * `colorCode` is the swatch colour already resolved: the value's own, else
   * the one a variant recorded for it, else the colour its name says.
   */
  values: { _id: string; value: string; colorCode?: string }[];
};

/** Which list of details a product gets, and under which title. */
export type ProductInfoSectionKind =
  | "sizeFit"
  | "technicalDetails"
  | "dimensionsDetails"
  | "productInformation"
  | "productDetails";

/** Read from the product's category and tags: apparel, electronics, … */
export function productInfoSectionKind(
  product: Pick<ProductPageProduct, "category" | "tags">,
): ProductInfoSectionKind {
  const categoryText = [
    product.category?.name,
    product.category?.slug,
    ...(product.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /\b(cloth|clothes|clothing|fashion|apparel|wear|shirt|t-shirt|tee|pant|jean|dress|shoe|sneaker|hoodie|jacket)\b/.test(
      categoryText,
    )
  ) {
    return "sizeFit";
  }

  if (
    /\b(electronic|electronics|phone|mobile|laptop|computer|camera|audio|speaker|headphone|gadget|device|tv|television)\b/.test(
      categoryText,
    )
  ) {
    return "technicalDetails";
  }

  if (
    /\b(furniture|home|decor|table|chair|sofa|bed|mattress|cabinet|shelf|lighting)\b/.test(
      categoryText,
    )
  ) {
    return "dimensionsDetails";
  }

  if (
    /\b(beauty|cosmetic|skincare|makeup|perfume|fragrance|health|personal-care)\b/.test(
      categoryText,
    )
  ) {
    return "productInformation";
  }

  return "productDetails";
}

/** What the product page's client controls read. */
export type PurchaseProduct = {
  _id: string;
  name: string;
  /** The size guide reads it with the name to pick a chart. */
  title?: string;
  slug: string;
  price: number;
  comparePrice?: number;
  priceRange?: MoneyRangeLike;
  compareAtPriceRange?: MoneyRangeLike;
  priceOnRequest?: boolean;
  quoteButtonLabel?: string;
  sku: string;
  barcode?: string;
  stock: number;
  inventory?: ProductPageProduct["inventory"];
  preorder?: ProductPreorderSettings;
  shipping?: {
    isPhysicalProduct?: boolean;
    weight?: number;
    weightUnit?: WeightUnit;
    countryOfOrigin?: string;
  };
  category?: { name: string; slug: string };
  brand?: { name: string; slug: string };
  tags: string[];
  attributes: { name: string; value: string }[];
  options: PurchaseOption[];
  variants: PurchaseVariant[];
  media: PurchaseMedia[];
  /** The picture a cart line and the pinned bar show. */
  previewImage: string;
  reviewCount: number;
};

/**
 * Drops the keys whose value is `undefined`. React Flight writes each one out
 * as `"$undefined"`, so a field the product does not have would still cost
 * bytes in every page's payload.
 */
function defined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function inferMediaType(media: {
  type?: ProductMediaKind;
  url: string;
  mimeType?: string;
}): ProductMediaKind {
  if (media.type) return media.type;
  const mimeType = media.mimeType?.toLowerCase() || "";
  const url = media.url.toLowerCase();

  if (mimeType.startsWith("video/")) return "video";
  if (
    mimeType.includes("gltf") ||
    mimeType === "application/octet-stream" ||
    url.endsWith(".glb") ||
    url.endsWith(".gltf")
  ) {
    return "model";
  }

  return "image";
}

/** The gallery's items: the product's media by position, else its images. */
function productPageMedia(product: ProductPageProduct): PurchaseMedia[] {
  if (Array.isArray(product.media) && product.media.length > 0) {
    return [...product.media]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((m) =>
        defined({
          id: m._id,
          type: inferMediaType(m),
          url: m.url,
          alt: m.alt || product.name,
          thumbnailUrl: m.thumbnailUrl,
          provider: m.provider,
          embedId: m.embedId,
          fit: m.fit,
          width: m.width,
          height: m.height,
        }),
      );
  }
  return (product.images || []).map((url, idx) => ({
    id: String(idx),
    type: "image" as const,
    url,
    alt: product.name,
  }));
}

function firstImageUrl(media: PurchaseMedia[], images: string[]) {
  return (
    media.find((item) => item.type === "image")?.url ||
    images.find(Boolean) ||
    media.find((item) => item.thumbnailUrl)?.thumbnailUrl ||
    ""
  );
}

const colorMap: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  purple: "#a855f7",
  pink: "#ec4899",
  black: "#000000",
  white: "#ffffff",
  gray: "#6b7280",
  grey: "#6b7280",
  brown: "#92400e",
  navy: "#1e3a8a",
  beige: "#d4c4a8",
  cream: "#fffdd0",
  teal: "#14b8a6",
  cyan: "#06b6d4",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  maroon: "#7f1d1d",
  olive: "#65a30d",
  coral: "#fb7185",
  mint: "#86efac",
  gold: "#ca8a04",
  silver: "#94a3b8",
};

/** The colour a variant recorded for this option value, if any did. */
function variantColorFor(
  product: ProductPageProduct,
  optionName: string,
  valueId: string,
  value: string,
) {
  for (const variant of product.variants || []) {
    const optionValues = variant.optionValues || [];
    for (let index = 0; index < optionValues.length; index += 1) {
      const optionValue = optionValues[index];
      if (!optionValue || typeof optionValue === "string") continue;

      const variantOptionName =
        optionValue.optionName || product.options?.[index]?.name || "";
      const matchesOption =
        variantOptionName.toLowerCase() === optionName.toLowerCase();
      const matchesValue =
        optionValue.valueId === valueId || optionValue.value === value;

      if (matchesOption && matchesValue && optionValue.colorCode) {
        return optionValue.colorCode;
      }
    }
  }
  return undefined;
}

function swatchColor(
  product: ProductPageProduct,
  optionName: string,
  value: { _id: string; value: string; colorCode?: string },
): string | undefined {
  const recorded =
    value.colorCode || variantColorFor(product, optionName, value._id, value.value);
  if (recorded) return recorded;
  return colorMap[answerText(value.value).toLowerCase()];
}

function answerText(value: unknown): string {
  return value == null ? "" : String(value);
}

/**
 * The product page's client shape. Trimmed field by field: a variant keeps
 * its price, stock, pre-order and what the details list prints, not its
 * normalized SKU, barcode bookkeeping or per-branch counts; an option value
 * keeps its id, text and resolved swatch colour.
 */
export function toPurchaseProduct(product: ProductPageProduct): PurchaseProduct {
  const media = productPageMedia(product);
  const hasMediaItems = Array.isArray(product.media) && product.media.length > 0;
  const options = Array.isArray(product.options) ? product.options : [];

  const variants = (product.variants || []).map((variant) => {
    const mediaIndex =
      hasMediaItems && variant.mediaId
        ? media.findIndex((item) => item.id === variant.mediaId)
        : -1;
    const answers = (variant.optionValues || []).map((optionValue, index) => {
      if (typeof optionValue === "string") return optionValue;
      if (!optionValue) return "";
      const value = answerText(optionValue.value);
      const optionName = optionValue.optionName;
      return !optionName || optionName === options[index]?.name
        ? value
        : { optionName, value };
    });
    const shaped: PurchaseVariant = {
      _id: variant._id,
      name: variant.name,
      sku: variant.sku,
      price: variant.price,
      stock: variant.stock,
    };
    if (variant.barcode) shaped.barcode = variant.barcode;
    if (variant.comparePrice !== undefined) {
      shaped.comparePrice = variant.comparePrice;
    }
    if (variant.attributes?.length) shaped.attributes = variant.attributes;
    if (answers.length) shaped.optionValues = answers;
    if (variant.weight !== undefined) shaped.weight = variant.weight;
    if (variant.weightUnit) shaped.weightUnit = variant.weightUnit;
    if (mediaIndex >= 0) shaped.mediaIndex = mediaIndex;
    if (variant.preorder?.enabled) shaped.preorder = variant.preorder;
    return shaped;
  });

  return defined({
    _id: product._id,
    name: product.name,
    title: product.title || undefined,
    slug: product.slug,
    price: product.price,
    comparePrice: product.comparePrice,
    priceRange: product.priceRange,
    compareAtPriceRange: product.compareAtPriceRange,
    priceOnRequest: product.priceOnRequest,
    quoteButtonLabel: product.quoteButtonLabel,
    sku: product.sku,
    barcode: product.barcode,
    stock: product.stock,
    inventory: product.inventory,
    preorder: product.preorder,
    shipping: product.shipping
      ? defined({
          isPhysicalProduct: product.shipping.isPhysicalProduct,
          weight: product.shipping.weight,
          weightUnit: product.shipping.weightUnit,
          countryOfOrigin: product.shipping.countryOfOrigin,
        })
      : undefined,
    category: product.category
      ? { name: product.category.name, slug: product.category.slug }
      : undefined,
    brand: product.brand
      ? { name: product.brand.name, slug: product.brand.slug }
      : undefined,
    tags: product.tags || [],
    attributes: product.attributes || [],
    options: options.map((option) => ({
      name: option.name,
      ...(option.visual ? { visual: option.visual } : {}),
      values: (option.values || []).map((value) => {
        const colorCode = swatchColor(product, option.name, value);
        return {
          _id: value._id,
          value: value.value,
          ...(colorCode ? { colorCode } : {}),
        };
      }),
    })),
    variants,
    media,
    previewImage: firstImageUrl(media, product.images || []),
    reviewCount: product.reviewCount,
  });
}
