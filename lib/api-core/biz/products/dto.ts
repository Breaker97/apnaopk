import type { ImageSet } from "@/contracts/mobile/biz/v1/common";
import type {
  ProductDetail,
  ProductListItem,
  ProductVariant,
  StockLocation,
} from "@/contracts/mobile/biz/v1/products";
import { imageSet } from "@/lib/api-core/shop/images";
import { toMoney } from "@/lib/api-core/shop/money";
import { resolveVariantOptions } from "@/lib/cart/variant-options";
import { isLowStock } from "@/lib/inventory/low-stock";
import type { Currency } from "@/lib/intl/currencies";
import { getPrimaryProductMedia } from "@/lib/products/card-media";
import { getProductPriceRange } from "@/lib/products/price-display";
import { toPurchaseProduct, type ProductPageProduct } from "@/lib/products/purchase-product";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { productTracksStock } from "@/lib/products/stock-policy";

/**
 * Products as the business app reads them, from the documents the website's
 * readers return. Prices, stock and pictures come from the same policy
 * modules the dashboards and the storefront read: price-display, quote
 * pricing, stock policy, the low-stock rule, the card's picture.
 */

export interface ProductDtoContext {
  currency: Pick<Currency, "code" | "locale">;
  /** The seller's name on each product: the store's own operators, on a store with sellers. */
  showVendor: boolean;
}

type LocationRow = { locationId?: unknown; quantity?: number | null };

/** A product document as the readers return it (lean, loosely typed). */
export type ProductDocument = {
  _id: unknown;
  name?: string;
  sku?: string | null;
  barcode?: string | null;
  status?: string;
  images?: string[];
  media?: unknown[];
  price?: number | null;
  comparePrice?: number | null;
  priceRange?: { min?: number; max?: number } | null;
  priceOnRequest?: boolean | null;
  stock?: number | null;
  locationInventory?: LocationRow[] | null;
  shipping?: { isPhysicalProduct?: boolean } | null;
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean } | null;
  options?: Array<{ name?: string }> | null;
  variants?: Array<{
    _id?: unknown;
    name?: string;
    sku?: string | null;
    barcode?: string | null;
    price?: number | null;
    comparePrice?: number | null;
    stock?: number | null;
    image?: string | null;
    mediaId?: string | null;
    optionValues?: unknown[];
    locationInventory?: LocationRow[] | null;
  }> | null;
  vendorId?: unknown;
  updatedAt?: Date | string | null;
};

/**
 * The version a change names in `If-Match`: the product's `updatedAt`, in
 * milliseconds. Every write to a product moves it (Mongoose timestamps), a
 * sale or a stock edit too. "0" for a product never written since the field
 * existed.
 */
export function productVersion(updatedAt: Date | string | null | undefined): string {
  const time = updatedAt ? new Date(updatedAt).getTime() : NaN;
  return Number.isFinite(time) ? String(time) : "0";
}

/** Units that can still be sold: the stored counter, which oversold stock takes below zero. */
const sellable = (stock: number | null | undefined) => Math.max(0, Math.trunc(Number(stock ?? 0)));

function vendorNameOf(vendor: unknown): string | undefined {
  if (!vendor || typeof vendor !== "object") return undefined;
  const name = (vendor as { storeName?: unknown }).storeName;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/** A positive price as Money; a compare-at price of 0 is no compare-at price. */
function moneyOf(amount: number | null | undefined, ctx: ProductDtoContext, { positive = false } = {}) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return undefined;
  if (positive && amount <= 0) return undefined;
  return toMoney(amount, ctx.currency);
}

/** The card's picture: a video or a 3D model stands in with its thumbnail. */
function listPicture(product: ProductDocument): ImageSet | undefined {
  const media = getPrimaryProductMedia(product as unknown as Parameters<typeof getPrimaryProductMedia>[0]);
  if (!media) return undefined;
  return imageSet(media.type === "image" ? media.url : media.thumbnailUrl, media.alt);
}

export function toProductListItem(product: ProductDocument, ctx: ProductDtoContext): ProductListItem {
  const quote = isQuoteOnlyProduct(product);
  const range = getProductPriceRange(product as Parameters<typeof getProductPriceRange>[0]);
  return {
    id: String(product._id),
    name: product.name ?? "",
    ...(product.sku ? { sku: product.sku } : {}),
    status: product.status ?? "",
    ...withImage(listPicture(product)),
    ...(quote ? {} : { price: toMoney(range.min, ctx.currency) }),
    ...(!quote && range.max > range.min ? { maxPrice: toMoney(range.max, ctx.currency) } : {}),
    stock: sellable(product.stock),
    lowStock: isLowStock(product),
    untracked: !productTracksStock(product),
    variantCount: product.variants?.length ?? 0,
    ...withVendor(product, ctx),
  };
}

const withImage = (image: ImageSet | undefined) => (image ? { image } : {});

function withVendor(product: ProductDocument, ctx: ProductDtoContext) {
  const vendorName = ctx.showVendor ? vendorNameOf(product.vendorId) : undefined;
  return vendorName ? { vendorName } : {};
}

/** Which of a product's stock rows an operator sees, and what their locations are called. */
export interface LocationView {
  names: ReadonlyMap<string, string>;
  /** A staff member assigned to locations sees those only; everyone else every row. */
  visible: (locationId: string) => boolean;
}

/** The location ids a product's stock rows name, its variants' included. */
export function stockLocationIds(product: ProductDocument): string[] {
  const rows = [
    ...(product.locationInventory ?? []),
    ...(product.variants ?? []).flatMap((variant) => variant.locationInventory ?? []),
  ];
  return [...new Set(rows.map((row) => String(row.locationId ?? "")).filter(Boolean))];
}

/** Available units per location, rows of the same location added together, in first-seen order. */
export function locationsOf(rows: LocationRow[], view: LocationView): StockLocation[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.locationId ?? "");
    if (!id || !view.visible(id)) continue;
    totals.set(id, (totals.get(id) ?? 0) + Number(row.quantity ?? 0));
  }
  return [...totals].map(([locationId, quantity]) => ({
    locationId,
    name: view.names.get(locationId) || "Unknown location",
    available: Math.max(0, Math.trunc(quantity)),
  }));
}

/** A variant's options as the store names them ("Red / XL"). */
export function variantCaption(
  variant: NonNullable<ProductDocument["variants"]>[number],
  product: ProductDocument,
): string {
  const options = resolveVariantOptions(
    variant as Parameters<typeof resolveVariantOptions>[0],
    (product.options ?? undefined) as Parameters<typeof resolveVariantOptions>[1],
  );
  return options.map((option) => option.value).join(" / ") || variant.name || "";
}

export function toProductDetail(
  product: ProductDocument,
  ctx: ProductDtoContext,
  view: LocationView,
): ProductDetail {
  const quote = isQuoteOnlyProduct(product);
  const variants = product.variants ?? [];
  const hasVariants = variants.length > 0;
  const purchase = toPurchaseProduct(product as unknown as ProductPageProduct);

  const images = purchase.media
    .filter((item) => item.type === "image")
    .map((item) => imageSet(item.url, item.alt))
    .filter((image): image is ImageSet => Boolean(image));

  const pictureOf = (mediaId: string | null | undefined): ImageSet | undefined => {
    const media = mediaId ? purchase.media.find((item) => item.id === mediaId) : undefined;
    return media ? imageSet(media.type === "image" ? media.url : media.thumbnailUrl, media.alt) : undefined;
  };

  const toVariant = (variant: (typeof variants)[number]): ProductVariant & { locations: StockLocation[] } => {
    const price = quote ? undefined : moneyOf(variant.price, ctx);
    const compareAtPrice = quote ? undefined : moneyOf(variant.comparePrice, ctx, { positive: true });
    const image = pictureOf(variant.mediaId) ?? imageSet(variant.image);
    return {
      id: String(variant._id),
      name: variantCaption(variant, product),
      ...(variant.sku ? { sku: variant.sku } : {}),
      ...(variant.barcode ? { barcode: variant.barcode } : {}),
      ...(price ? { price } : {}),
      ...(compareAtPrice ? { compareAtPrice } : {}),
      stock: sellable(variant.stock),
      ...withImage(image),
      locations: locationsOf(variant.locationInventory ?? [], view),
    };
  };

  const price = quote || hasVariants ? undefined : moneyOf(product.price, ctx);
  const compareAtPrice =
    quote || hasVariants ? undefined : moneyOf(product.comparePrice, ctx, { positive: true });
  const updatedAt = product.updatedAt ? new Date(product.updatedAt) : null;

  return {
    id: String(product._id),
    name: product.name ?? "",
    ...(product.sku ? { sku: product.sku } : {}),
    ...(product.barcode ? { barcode: product.barcode } : {}),
    status: product.status ?? "",
    images,
    ...(price ? { price } : {}),
    ...(compareAtPrice ? { compareAtPrice } : {}),
    priceOnRequest: quote,
    variants: variants.map(toVariant),
    stock: sellable(product.stock),
    lowStock: isLowStock(product),
    untracked: !productTracksStock(product),
    // A product with variants keeps its stock on them; its own rows are stale.
    locations: locationsOf(
      hasVariants ? variants.flatMap((variant) => variant.locationInventory ?? []) : (product.locationInventory ?? []),
      view,
    ),
    ...withVendor(product, ctx),
    version: productVersion(product.updatedAt),
    updatedAt: (updatedAt && Number.isFinite(updatedAt.getTime()) ? updatedAt : new Date(0)).toISOString(),
  };
}
