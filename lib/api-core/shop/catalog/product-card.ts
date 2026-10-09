import type { NamedLink, ProductCard } from "@/contracts/mobile/shop/v1/catalog";
import { resolveCurrency, type Currency } from "@/lib/intl/currencies";
import type { ModernProduct, ProductMedia } from "@/lib/products/modern-product";
import {
  getProductCompareAtPrice,
  getProductPriceRange,
} from "@/lib/products/price-display";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { isDigitalProduct } from "@/lib/products/stock-policy";
import { productRequiresVariantSelection } from "@/lib/products/variant-selection";
import type { MobileShopAppSettings } from "@/lib/settings/mobile-app";
import type { StoreFacts } from "@/lib/storefront/store-facts";
import { imageSet } from "../images";
import { toMoney } from "../money";
import { productAvailability, purchasableInApp } from "./availability";

/**
 * What every catalogue mapper needs besides the product: the store's
 * currency, whether cards name their seller, and whether the app may sell
 * goods that do not ship.
 */
export type CatalogContext = {
  currency: Pick<Currency, "code" | "locale">;
  multiVendor: boolean;
  allowDigitalPurchases: boolean;
};

/**
 * The context, from the store's facts (lib/storefront/store-facts.ts: one
 * cached settings read that throws on failure, so a static route may use it)
 * and the app's settings.
 */
export function catalogContext(
  facts: Pick<StoreFacts, "currencyCode" | "multiVendor">,
  shop: Pick<MobileShopAppSettings, "allowDigitalPurchases">,
): CatalogContext {
  return {
    currency: resolveCurrency(facts.currencyCode),
    multiVendor: facts.multiVendor,
    allowDigitalPurchases: shop.allowDigitalPurchases,
  };
}

/** A media item stored without a kind is read by its type or file name, as the web's card does. */
function isPicture(media: ProductMedia): boolean {
  if (media.type) return media.type === "image";
  const mime = media.mimeType?.toLowerCase() ?? "";
  const url = media.url.toLowerCase();
  return !(
    mime.startsWith("video/") ||
    mime.includes("gltf") ||
    mime === "application/octet-stream" ||
    url.endsWith(".glb") ||
    url.endsWith(".gltf")
  );
}

/**
 * The picture a card shows: its first media item a card can draw, else its
 * first image. A video or a 3D model stands in with its thumbnail. The same
 * picture the web's card puts in the cart (components/products/
 * modern-product-card.tsx).
 */
function cardPicture(product: ModernProduct): { url?: string; alt?: string } {
  const media = [...(product.media ?? [])]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .find((item) => (item.type === "external_video" ? Boolean(item.thumbnailUrl) : Boolean(item.url)));
  if (media) {
    const url = isPicture(media) ? media.url : media.thumbnailUrl || product.images?.find(Boolean);
    return { url, alt: media.alt };
  }
  return { url: product.images?.find(Boolean) };
}

/** A populated `{ name, slug }`, else nothing (a bare id cannot be shown). */
function namedLink(value: unknown, nameKey: "name" | "storeName" = "name"): NamedLink | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const name = record[nameKey];
  const slug = record.slug;
  return typeof name === "string" && name && typeof slug === "string" && slug
    ? { name, slug }
    : undefined;
}

/**
 * A product as a card shows it, from what the storefront's card loaders
 * return (lib/products/storefront-product-cards.ts, the listing grid, the
 * sponsored lanes, which add the sponsored marks). The product page starts
 * from it too, so it opens as the card that was tapped.
 */
export function toProductCard(product: ModernProduct, ctx: CatalogContext): ProductCard {
  const priceOnRequest = isQuoteOnlyProduct(product);
  const range = getProductPriceRange(product);
  const compareAt = priceOnRequest ? null : getProductCompareAtPrice(product);
  const picture = cardPicture(product);
  const image = imageSet(picture.url, picture.alt);
  const vendor = ctx.multiVendor ? namedLink(product.vendorId, "storeName") : undefined;

  return {
    id: String(product._id),
    slug: product.slug,
    name: product.name,
    ...(image ? { image } : {}),
    ...(priceOnRequest ? {} : { price: toMoney(range.min, ctx.currency) }),
    ...(compareAt !== null ? { compareAtPrice: toMoney(compareAt, ctx.currency) } : {}),
    priceVaries: !priceOnRequest && range.min !== range.max,
    ...(product.reviewCount > 0
      ? { rating: { average: Number(product.rating) || 0, count: product.reviewCount } }
      : {}),
    availability: productAvailability(product),
    requiresVariantChoice: productRequiresVariantSelection(product),
    priceOnRequest,
    isDigital: isDigitalProduct(product),
    purchasableInApp: purchasableInApp(product, ctx.allowDigitalPurchases),
    ...(product.sponsored && product.sponsoredCampaignId
      ? { sponsored: { campaignId: product.sponsoredCampaignId } }
      : {}),
    ...(vendor ? { vendor } : {}),
  };
}
