import { PRODUCT_STATUS } from "@/config/app.config";
import { inspectBarcode } from "@/lib/barcode/standards";
import { currencyMinorUnitExponent } from "@/lib/intl/money";
import { PURCHASE_TYPE, resolvePurchaseType } from "@/lib/orders/preorders";
import { resolveOptionVisual } from "@/lib/products/option-visual";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { htmlToPlainText } from "@/lib/strings";

/**
 * One product as Meta catalog items — the single mapping the scheduled feed
 * (app/feeds/meta) and the live sync share, so the two can never describe the
 * same item two ways.
 *
 * Follows Meta's catalog field reference
 * (developers.facebook.com/docs/commerce-platform/catalog/fields):
 *
 * - a product with variants is an item group: one item per variant, `id` the
 *   variant's `_id`, `item_group_id` the product's. A product without variants
 *   is one item whose `id` is the product's. The Pixel sends exactly these ids
 *   (lib/analytics/events.ts), which is what lets an ad match a view or a
 *   purchase to an item.
 * - availability comes from the same rule checkout applies
 *   (`resolvePurchaseType`): buyable now is "in stock", not buyable is "out
 *   of stock". Meta has no value for a pre-order, so an item that would be
 *   sold as one right now is left out rather than advertised as in stock.
 * - money is the store currency at its own number of decimals, "12.99 USD" /
 *   "1500 JPY"; a compare-at price above the price makes the compare-at
 *   `price` and the real one `sale_price`, as Meta reads a sale.
 */

export type MetaAvailability = "in stock" | "out of stock";

export interface MetaCatalogItem {
  id: string;
  item_group_id?: string;
  title: string;
  description: string;
  availability: MetaAvailability;
  condition: "new";
  price: string;
  sale_price?: string;
  link: string;
  image_link: string;
  additional_image_link: string[];
  brand?: string;
  gtin?: string;
  color?: string;
  size?: string;
  additional_variant_attribute?: string;
  custom_label_0?: string;
}

/** Why an item Meta would otherwise get is not in the feed. */
export type MetaItemSkipReason = "preorder" | "no_image" | "no_price";

/** Why a whole product is not in the feed. */
export type MetaProductSkipReason = "hidden" | "quote_only";

export interface MetaCatalogMapResult {
  items: MetaCatalogItem[];
  /** The whole product is left out (every one of its items with it). */
  excluded?: MetaProductSkipReason;
  /** Items left out one by one, with why. */
  skipped: Array<{ id: string; reason: MetaItemSkipReason }>;
}

type IdLike = { toString(): string } | string;

type MediaSource = {
  _id?: string | null;
  type?: string | null;
  url?: string | null;
  mimeType?: string | null;
  position?: number | null;
};

type BarcodeFields = {
  barcode?: string | null;
  barcodeFormat?: "ean13" | "upca" | "gtin14" | "code128" | null;
  barcodeSource?: "manufacturer" | "gs1" | "internal" | null;
};

type PreorderFields = {
  enabled?: boolean;
  releaseDate?: Date | string | null;
  limit?: number | null;
  reservedQuantity?: number | null;
  preorderOnly?: boolean;
  autoConvert?: boolean;
};

export type MetaCatalogVariantSource = BarcodeFields & {
  _id?: IdLike | null;
  name?: string | null;
  price?: number | null;
  comparePrice?: number | null;
  stock?: number | null;
  image?: string | null;
  mediaId?: string | null;
  optionValues?: Array<{
    optionId?: string | null;
    optionName?: string | null;
    value?: string | null;
  }> | null;
  preorder?: PreorderFields | null;
};

export type MetaCatalogProductSource = BarcodeFields & {
  _id: IdLike;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  shortDescription?: string | null;
  status?: string | null;
  vendorId?: IdLike | null;
  brand?: IdLike | null;
  price?: number | null;
  comparePrice?: number | null;
  priceOnRequest?: boolean | null;
  stock?: number | null;
  shipping?: { isPhysicalProduct?: boolean } | null;
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean } | null;
  publishing?: { onlineStore?: boolean } | null;
  preorder?: PreorderFields | null;
  images?: string[] | null;
  media?: MediaSource[] | null;
  options?: Array<{
    _id?: string | null;
    name?: string | null;
    visual?: string | null;
  }> | null;
  variants?: MetaCatalogVariantSource[] | null;
};

/** An image as the mapper hands it to `imageLink`. */
export type MetaImageCandidate = {
  /** The media entry's `_id`, when the image is one. */
  mediaId?: string;
  url: string;
  mimeType?: string;
};

export interface MetaCatalogMapContext {
  /** ISO 4217 code of the store currency. */
  currency: string;
  /**
   * Storefront vendors (approved, store active) by id → store name. A product
   * whose vendor is missing here is not on the storefront.
   */
  vendors: ReadonlyMap<string, string>;
  /** Brands the storefront shows (`STOREFRONT_BRAND_FILTER`) by id → name. */
  brands: ReadonlyMap<string, string>;
  /** Absolute product page URL, in the store's default language. */
  productLink: (slug: string, variantId?: string) => string;
  /**
   * The URL Meta should fetch for an image — the stored file when Meta can
   * read it, a JPEG rendition when not — or null when there is none.
   */
  imageLink: (productId: string, image: MetaImageCandidate) => string | null;
}

/** Meta's limits: title 200, description 9,999, brand and labels 100. */
const LIMITS = {
  title: 200,
  description: 9999,
  brand: 100,
  label: 100,
  attribute: 200,
  additionalImages: 20,
} as const;

/**
 * Option names that mean "size" in the languages a store is likely to name
 * them in. Colour is decided by the option's visual instead (a swatch option,
 * or one named Color/Colour), the rule the product page itself renders by.
 */
const SIZE_OPTION_NAME =
  /^(size|sizes|größe|grosse|taille|talla|tamaño|tamanho|maat|beden|saizi|ukubwa|माप|साइज़|সাইজ|সাইজ়|মাপ|尺码|尺寸|サイズ|مقاس|الحجم)$/iu;

const COLOR_OPTION_NAME =
  /^(colou?rs?|farbe|couleur|kleur|renk|rangi|रंग|রং|রঙ|颜色|顏色|色|カラー|لون|اللون)$/iu;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * `amount` in the currency's minor units, rounded half up on the decimal
 * digits as written: `1.005 * 100` is 100.4999… in floating point, and a
 * plain multiply would print it "1.00".
 */
function toMinorUnits(amount: number, exponent: number): number {
  const shifted = Number(`${amount}e${exponent}`);
  return Math.round(Number.isFinite(shifted) ? shifted : amount * 10 ** exponent);
}

/** Money as Meta writes it: a dot, the currency's own decimals, the code. */
export function formatMetaPrice(amount: number, currency: string): string {
  const code = currency.trim().toUpperCase();
  const exponent = currencyMinorUnitExponent(code);
  const minor = toMinorUnits(Number(amount), exponent);
  return `${(minor / 10 ** exponent).toFixed(exponent)} ${code}`;
}

/** Whether an amount is a price Meta can show: positive once rounded. */
function isSellingPrice(amount: unknown, currency: string): amount is number {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return false;
  return toMinorUnits(amount, currencyMinorUnitExponent(currency)) > 0;
}

function priceFields(
  price: number,
  comparePrice: number | null | undefined,
  currency: string,
): Pick<MetaCatalogItem, "price" | "sale_price"> {
  if (
    typeof comparePrice === "number" &&
    isSellingPrice(comparePrice, currency) &&
    formatMetaPrice(comparePrice, currency) !== formatMetaPrice(price, currency) &&
    comparePrice > price
  ) {
    return {
      price: formatMetaPrice(comparePrice, currency),
      sale_price: formatMetaPrice(price, currency),
    };
  }
  return { price: formatMetaPrice(price, currency) };
}

/** A manufacturer or GS1 barcode Meta can match; never an internal "20" code. */
function marketplaceGtin(source: BarcodeFields): string | undefined {
  if (!text(source.barcode)) return undefined;
  const inspection = inspectBarcode(source.barcode, {
    format: source.barcodeFormat ?? undefined,
    source: source.barcodeSource ?? undefined,
  });
  return inspection.marketplaceEligible ? inspection.value : undefined;
}

/** The product's pictures in display order, as `imageLink` is asked about them. */
export function productImageCandidates(
  product: MetaCatalogProductSource,
): MetaImageCandidate[] {
  const media = Array.isArray(product.media) ? product.media : [];
  const pictures = media
    .filter((entry) => (entry?.type ?? "image") === "image" && text(entry?.url))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((entry) => ({
      mediaId: entry._id ? String(entry._id) : undefined,
      url: text(entry.url),
      mimeType: entry.mimeType ?? undefined,
    }));
  if (pictures.length > 0) return pictures;
  // A product saved before media existed carries bare URLs only.
  return (Array.isArray(product.images) ? product.images : [])
    .map((url) => text(url))
    .filter(Boolean)
    .map((url) => ({ url }));
}

/** The variant's own picture first, then the product's in order, deduped. */
function imageFields(
  product: MetaCatalogProductSource,
  ctx: MetaCatalogMapContext,
  variant?: MetaCatalogVariantSource,
): Pick<MetaCatalogItem, "image_link" | "additional_image_link"> | null {
  const productId = String(product._id);
  const all = productImageCandidates(product);
  const own = variant
    ? (all.find((image) => variant.mediaId && image.mediaId === variant.mediaId) ??
      all.find((image) => text(variant.image) && image.url === text(variant.image)) ??
      (text(variant.image) ? { url: text(variant.image) } : undefined))
    : undefined;

  const links: string[] = [];
  for (const candidate of own ? [own, ...all] : all) {
    const link = ctx.imageLink(productId, candidate);
    if (link && !links.includes(link)) links.push(link);
    if (links.length > LIMITS.additionalImages) break;
  }
  if (links.length === 0) return null;
  return {
    image_link: links[0],
    additional_image_link: links.slice(1, LIMITS.additionalImages + 1),
  };
}

/** Meta's `additional_variant_attribute` separators, kept out of values. */
function attributePart(value: string): string {
  return value.replace(/[:,]/g, " ").replace(/\s+/g, " ").trim();
}

function variantAttributes(
  product: MetaCatalogProductSource,
  variant: MetaCatalogVariantSource,
): Pick<MetaCatalogItem, "color" | "size" | "additional_variant_attribute"> {
  const options = Array.isArray(product.options) ? product.options : [];
  const result: Pick<
    MetaCatalogItem,
    "color" | "size" | "additional_variant_attribute"
  > = {};
  const others: string[] = [];

  for (const entry of variant.optionValues ?? []) {
    const value = text(entry?.value);
    if (!value) continue;
    const option = options.find((candidate) => candidate?._id === entry.optionId);
    const name = text(option?.name) || text(entry.optionName);
    const visual = resolveOptionVisual({ name, visual: option?.visual });
    const isColor =
      visual === "color" || visual === "color_label" || COLOR_OPTION_NAME.test(name);

    if (isColor && !result.color) {
      result.color = truncate(value, LIMITS.attribute);
    } else if (SIZE_OPTION_NAME.test(name) && !result.size) {
      result.size = truncate(value, LIMITS.attribute);
    } else if (name) {
      others.push(`${attributePart(name)}:${attributePart(value)}`);
    }
  }

  if (others.length > 0) {
    result.additional_variant_attribute = truncate(others.join(","), LIMITS.attribute);
  }
  return result;
}

function descriptionFor(product: MetaCatalogProductSource, title: string): string {
  const plain =
    htmlToPlainText(product.description) || htmlToPlainText(product.shortDescription);
  return truncate(plain || title, LIMITS.description);
}

/** Whether the product is one the storefront shows at all. */
function isOnStorefront(
  product: MetaCatalogProductSource,
  ctx: MetaCatalogMapContext,
): boolean {
  if (product.status !== PRODUCT_STATUS.ACTIVE) return false;
  if (product.publishing?.onlineStore === false) return false;
  if (!text(product.slug)) return false;
  return product.vendorId ? ctx.vendors.has(String(product.vendorId)) : false;
}

export function mapProductToMetaItems(
  product: MetaCatalogProductSource,
  ctx: MetaCatalogMapContext,
): MetaCatalogMapResult {
  if (!isOnStorefront(product, ctx)) {
    return { items: [], excluded: "hidden", skipped: [] };
  }
  // No price to advertise: a "price on request" listing priced at 0 is how
  // a quote-only product ends up shown as free.
  if (isQuoteOnlyProduct(product)) {
    return { items: [], excluded: "quote_only", skipped: [] };
  }

  const productId = String(product._id);
  const title = truncate(text(product.name), LIMITS.title);
  if (!title) return { items: [], excluded: "hidden", skipped: [] };

  const vendorName = truncate(
    ctx.vendors.get(String(product.vendorId)) ?? "",
    LIMITS.label,
  );
  const brandName = product.brand ? ctx.brands.get(String(product.brand)) : undefined;
  // The manufacturer first, the seller when there is none — the product
  // page's structured data names its brand the same way.
  const brand = truncate(text(brandName) || vendorName, LIMITS.brand) || undefined;
  const description = descriptionFor(product, title);
  const slug = text(product.slug);
  const variants = Array.isArray(product.variants)
    ? product.variants.filter((variant) => variant?._id)
    : [];

  const shared = {
    title,
    description,
    condition: "new" as const,
    ...(brand ? { brand } : {}),
    ...(vendorName ? { custom_label_0: vendorName } : {}),
  };

  const items: MetaCatalogItem[] = [];
  const skipped: MetaCatalogMapResult["skipped"] = [];

  /**
   * One item, or why there is none. `variant` is absent for a product
   * without variants, whose price, barcode and stock are its own.
   */
  const addItem = (variant?: MetaCatalogVariantSource, linkVariant = false) => {
    const id = variant ? String(variant._id) : productId;
    const own = variant ?? product;
    const purchase = resolvePurchaseType({
      product: product as Parameters<typeof resolvePurchaseType>[0]["product"],
      variantId: variant ? id : undefined,
      requestedQuantity: 1,
    });
    if (purchase?.purchaseType === PURCHASE_TYPE.PREORDER) {
      skipped.push({ id, reason: "preorder" });
      return;
    }
    if (!isSellingPrice(own.price, ctx.currency)) {
      skipped.push({ id, reason: "no_price" });
      return;
    }
    const images = imageFields(product, ctx, variant);
    if (!images) {
      skipped.push({ id, reason: "no_image" });
      return;
    }
    const gtin = marketplaceGtin(own);
    items.push({
      id,
      ...(variant ? { item_group_id: productId } : {}),
      ...shared,
      availability: purchase ? "in stock" : "out of stock",
      ...priceFields(own.price, own.comparePrice, ctx.currency),
      link: ctx.productLink(slug, linkVariant ? id : undefined),
      ...images,
      ...(gtin ? { gtin } : {}),
      ...(variant ? variantAttributes(product, variant) : {}),
    });
  };

  if (variants.length === 0) {
    addItem();
  } else {
    // The variant to land on only means something when there is a choice.
    for (const variant of variants) addItem(variant, variants.length > 1);
  }

  return { items, skipped };
}
