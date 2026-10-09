import {
  ProductDetail,
  type ProductCard,
  type ProductOption,
  type ProductVariant,
} from "@/contracts/mobile/shop/v1/catalog";
import type { ImageSet } from "@/contracts/mobile/shop/v1/common";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineRoute } from "@/lib/api-core/registry";
import { getProductPageSponsoredLane } from "@/lib/boosts/sponsored-placement";
import { appBaseUrl } from "@/lib/app-url";
import { buildLocalePath } from "@/lib/i18n/locale-prefix";
import type { ModernProduct } from "@/lib/products/modern-product";
import { isSwatchVisual, resolveOptionVisual } from "@/lib/products/option-visual";
import { toPurchaseProduct, type ProductPageProduct } from "@/lib/products/purchase-product";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { getRelatedProductCards } from "@/lib/products/related-products";
import { getStorefrontProductBySlug } from "@/lib/products/storefront-product-detail";
import { productOnlyVariant } from "@/lib/products/variant-selection";
import { getStoreFacts } from "@/lib/storefront/store-facts";
import { imageSet } from "../images";
import { toMoney } from "../money";
import {
  appMaxQuantity,
  purchasableInApp,
  selectionAvailability,
  type AvailabilitySource,
} from "./availability";
import { catalogContext, toProductCard, type CatalogContext } from "./product-card";

type RawOptionAnswer =
  | string
  | { optionId?: string; optionName?: string; valueId?: string; value?: string };

type RawVariant = ProductPageProduct["variants"][number] & {
  requiresShipping?: boolean;
  /** The legacy own-photo field, before `mediaId`. */
  image?: string;
  optionValues?: RawOptionAnswer[];
};

type RawOption = NonNullable<ProductPageProduct["options"]>[number] & { _id?: string };

/** The product page's document (lib/products/storefront-product-detail.ts). */
type DetailProduct = Omit<ProductPageProduct, "variants" | "options"> & {
  variants: RawVariant[];
  options?: RawOption[];
};

function sameText(a: unknown, b: unknown): boolean {
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

/**
 * The value ids a variant is made of, one per option in the options' order;
 * null when one of its answers names no value of its option (a variant the
 * shopper could never select).
 */
function optionValueIds(variant: RawVariant, options: RawOption[]): string[] | null {
  const answers = variant.optionValues ?? [];
  const ids: string[] = [];
  for (const [index, option] of options.entries()) {
    const answer =
      answers.find(
        (candidate) =>
          typeof candidate === "object" &&
          candidate !== null &&
          ((option._id && candidate.optionId === option._id) ||
            sameText(candidate.optionName, option.name)),
      ) ?? answers[index];
    if (answer === undefined || answer === null) return null;
    const values = option.values ?? [];
    const match =
      typeof answer === "string"
        ? values.find((value) => sameText(value.value, answer))
        : (values.find((value) => answer.valueId && value._id === answer.valueId) ??
          values.find((value) => sameText(value.value, answer.value)));
    if (!match) return null;
    ids.push(String(match._id));
  }
  return ids;
}

/** An alt text only when the merchant wrote one; the app labels a picture with the product's name itself. */
function ownAlt(alt: string | undefined, productName: string): string | undefined {
  return alt && alt !== productName ? alt : undefined;
}

type DetailExtras = {
  related: ProductCard[];
  sponsoredRail: ProductCard[];
  shareUrl: string;
};

/**
 * The product page: the card's fields, then everything the buy box needs.
 * Prices, availability and quantities per variant, each from the same
 * policy modules the web's buy box reads.
 */
function toProductDetail(
  product: DetailProduct,
  ctx: CatalogContext,
  extras: DetailExtras,
): ProductDetail {
  const card = toProductCard(product as unknown as ModernProduct, ctx);
  const source = product as unknown as AvailabilitySource;
  const purchase = toPurchaseProduct(product as unknown as ProductPageProduct);
  const priceOnRequest = isQuoteOnlyProduct(product);
  const rawOptions = Array.isArray(product.options) ? product.options : [];

  const pictureOf = (mediaId: string | undefined): ImageSet | undefined => {
    if (!mediaId) return undefined;
    const media = purchase.media.find((item) => item.id === mediaId);
    if (!media) return undefined;
    const url = media.type === "image" ? media.url : media.thumbnailUrl;
    return imageSet(url, ownAlt(media.alt, product.name));
  };

  const images = purchase.media
    .filter((item) => item.type === "image")
    .map((item) => imageSet(item.url, ownAlt(item.alt, product.name)))
    .filter((image): image is ImageSet => Boolean(image));

  const options: ProductOption[] = rawOptions.map((option, index) => {
    const swatches = isSwatchVisual(resolveOptionVisual(option));
    // `toPurchaseProduct` resolved each value's swatch colour (its own, a
    // variant's, or the one its name says), as the web's picker shows it.
    const resolved = purchase.options[index]?.values ?? [];
    return {
      id: String(option._id ?? option.name),
      name: option.name,
      values: (option.values ?? []).map((value) => {
        const swatch = swatches
          ? resolved.find((candidate) => candidate._id === value._id)?.colorCode
          : undefined;
        return {
          id: String(value._id),
          label: value.value,
          ...(swatch ? { swatch } : {}),
        };
      }),
    };
  });

  const variants: ProductVariant[] = [];
  for (const variant of product.variants ?? []) {
    const ids = optionValueIds(variant, rawOptions);
    if (!ids) continue;
    const availability = selectionAvailability(source, variant);
    const sellable = !priceOnRequest && purchasableInApp(source, ctx.allowDigitalPurchases, variant);
    const image = pictureOf(variant.mediaId) ?? imageSet(variant.image);
    const hasDiscount =
      typeof variant.comparePrice === "number" && variant.comparePrice > variant.price;
    variants.push({
      id: String(variant._id),
      optionValueIds: ids,
      ...(priceOnRequest ? {} : { price: toMoney(variant.price, ctx.currency) }),
      ...(!priceOnRequest && hasDiscount
        ? { compareAtPrice: toMoney(variant.comparePrice, ctx.currency) }
        : {}),
      availability,
      maxQuantity: appMaxQuantity(source, { availability, sellable, stock: variant.stock }),
      ...(image ? { image } : {}),
    });
  }

  // A product with variants is bought as one of them; one that asks nothing
  // is bought as its single placeholder variant.
  const onlyVariant = productOnlyVariant(product);
  const maxQuantity =
    (product.variants ?? []).length === 0
      ? appMaxQuantity(source, {
          availability: selectionAvailability(source),
          sellable: !priceOnRequest && purchasableInApp(source, ctx.allowDigitalPurchases),
          stock: product.stock,
        })
      : (variants.find((variant) => variant.id === String(onlyVariant?._id))?.maxQuantity ?? 0);

  const description = typeof product.description === "string" ? product.description.trim() : "";
  const brand = product.brand?.name && product.brand.slug
    ? { name: product.brand.name, slug: product.brand.slug }
    : undefined;
  const category = product.category?.name && product.category.slug
    ? { name: product.category.name, slug: product.category.slug }
    : undefined;

  return {
    ...card,
    images,
    ...(description ? { descriptionHtml: description } : {}),
    attributes: (product.attributes ?? [])
      .filter((attribute) => attribute?.name && attribute.value)
      .map((attribute) => ({ name: String(attribute.name), value: String(attribute.value) })),
    options,
    variants,
    maxQuantity,
    ...(brand ? { brand } : {}),
    ...(category ? { category } : {}),
    shareUrl: extras.shareUrl,
    related: extras.related,
    sponsoredRail: extras.sponsoredRail,
  };
}

/**
 * GET /products/{slug}: the product page. The same for every shopper, so a
 * static route: expired by the product's own tag on a stock movement, and by
 * the catalogue tags on any edit (lib/cache-invalidation.ts). The shopper's
 * own half (wishlist, may review) is `GET /me/products/{id}`.
 */
export const productDetailRoute = defineRoute({
  id: "catalog.products.detail",
  method: "GET",
  path: "/products/{slug}",
  auth: "none",
  cache: { kind: "static", revalidate: 60 },
  output: ProductDetail,
  handler: async ({ params, locale, mobileApp }) => {
    const [product, facts] = await Promise.all([
      getStorefrontProductBySlug(params.slug) as Promise<DetailProduct | null>,
      getStoreFacts(),
    ]);
    if (!product) throw new MobileApiError(404, "NOT_FOUND", "This product is not available.");

    const ctx = catalogContext(facts, mobileApp);
    const productId = String(product._id);
    const categoryId = product.category?._id;
    // The rail's ladder is read at this render, so a booking that starts or
    // ends shows within the route's 60 s (its pool's tag expires it sooner).
    const [related, lane] = await Promise.all([
      getRelatedProductCards(productId, categoryId),
      getProductPageSponsoredLane({ productId, categoryId }),
    ]);
    const path = buildLocalePath(locale, `/products/${product.slug}`, facts.routing.storeDefault);

    return toProductDetail(product, ctx, {
      related: related.map((card) => toProductCard(card, ctx)),
      sponsoredRail: (lane ?? []).map((card) => toProductCard(card, ctx)),
      shareUrl: `${appBaseUrl()}${path}`,
    });
  },
});
