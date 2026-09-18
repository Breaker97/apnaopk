"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, ChevronRight, ShoppingCart, Star } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { ScrollRail } from "@/components/store/scroll-rail";
import { toast } from "@/components/ui/toast-notification";
import { type Locale } from "@/config/i18n.config";
import { useCart } from "@/hooks/use-cart";
import { useCurrency } from "@/providers/currency-provider";
import { trackAddToCart } from "@/lib/analytics/events";
import {
  findColorOption,
  findColorVariantImage,
  getSwatchColor,
} from "@/lib/products/color-swatch";
import {
  formatProductCompareAtPrice,
  formatProductPrice,
  getProductDiscountPercentage,
  getProductPriceRange,
  getProductSavings,
  productRequiresVariantSelection,
} from "@/lib/products/price-display";
import type { StorefrontProductCard } from "@/lib/products/storefront-product-cards";
import { getPurchasableQuantity } from "@/lib/products/stock-policy";
import type { DealLayout } from "@/lib/storefront/sections/deal-layouts";
import { cn } from "@/lib/utils";

/** Under this many left, the count is worth saying. */
const LOW_STOCK = 10;

/**
 * How few are left, when that is few enough to matter and is real — an
 * untracked product reports a cap, not a count, and says nothing here.
 */
function lowStock(product: StorefrontProductCard): number | null {
  const quantity = getPurchasableQuantity(product, product.stock);
  return quantity > 0 && quantity <= LOW_STOCK ? quantity : null;
}

/**
 * The product plane of the Electronics DEALS panel, in whichever arrangement
 * the merchant chose. The plane carries `store-deal-plane`, which pins the
 * store's LIGHT palette to it in both schemes: the panel paints its own
 * ground — the same field, and the same white countdown cards, whatever the
 * page's theme — so the cards standing on it are coloured against that
 * field, never against the page. Every token below therefore resolves light,
 * the sale price included, and nothing in here takes a `dark:` variant.
 *
 * Below lg every layout is the same thing: the featured deal (if the layout
 * has one), then ONE rail holding the rest. At lg the rail is `contents` and
 * each card takes the named area its slot maps to, so the arrangement is
 * the layout's grid and nothing in the DOM has to move.
 */
/** How a card shows its picture: the fit, and the air around a contained one. */
interface DealImageStyle {
  fit: "contain" | "cover";
  /** px; -1 = the card's own padding. */
  padding: number;
}

/**
 * The picture's classes and inline padding. A contained picture keeps the
 * card's own air unless the merchant set some; a filled one has none.
 */
function dealImageProps(image: DealImageStyle, ownPadding: string, cap: number) {
  if (image.fit === "cover") return { className: "object-cover", style: undefined };
  if (image.padding < 0) return { className: cn("object-contain", ownPadding), style: undefined };
  return { className: "object-contain", style: { padding: Math.min(image.padding, cap) } };
}

export function ElectronicsDealsProducts({
  products,
  locale,
  layout,
  showStock,
  imageFit = "contain",
  imagePadding = -1,
}: {
  products: StorefrontProductCard[];
  locale: Locale;
  layout: DealLayout;
  showStock: boolean;
  imageFit?: "contain" | "cover";
  imagePadding?: number;
}) {
  const image: DealImageStyle = { fit: imageFit, padding: imagePadding };
  const items = products.slice(0, layout.slots);
  if (items.length === 0) return null;

  const hero = layout.hero !== null ? items[layout.hero] : undefined;
  const rest = items.filter((_, index) => index !== layout.hero);

  // The thumbnail's trick: a track's minmax() minimum is its content's, and
  // these cards carry enough fixed geometry to demand it. `minmax(0, …)`
  // everywhere keeps the tracks to the layout's proportions.
  return (
    <div
      className="store-deal-plane flex flex-col gap-[var(--deal-gap-m,0.75rem)] lg:grid lg:flex-1 lg:items-stretch lg:gap-[var(--deal-gap,1rem)] lg:[grid-template-areas:var(--deal-areas)] lg:[grid-template-columns:var(--deal-cols)] lg:[grid-template-rows:var(--deal-rows)]"
      style={{
        ["--deal-cols" as string]: layout.columns,
        ["--deal-rows" as string]: layout.rows,
        ["--deal-areas" as string]: layout.areas,
      }}
    >
      {hero ? (
        <div
          className="min-w-0"
          style={{ gridArea: layout.slotAreas[layout.hero ?? 0] }}
        >
          <FeaturedDealCard
            product={hero}
            locale={locale}
            showStock={showStock}
            image={image}
          />
        </div>
      ) : null}
      {rest.length > 0 ? (
        <ScrollRail className="flex snap-x gap-[var(--deal-gap-m,0.75rem)] scroll-px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] lg:contents [&::-webkit-scrollbar]:hidden">
          {rest.map((product) => {
            const slot = items.indexOf(product);
            return (
              <SmallDealCard
                key={product._id}
                product={product}
                locale={locale}
                showStock={showStock}
                area={layout.slotAreas[slot]}
                image={image}
              />
            );
          })}
        </ScrollRail>
      ) : null}
    </div>
  );
}

function productImage(product: StorefrontProductCard): string | undefined {
  if (product.images?.[0]) return product.images[0];
  // Video-only products: fall back to the first media entry's poster.
  const media = (product as { media?: { url?: string; thumbnailUrl?: string; type?: string }[] }).media?.[0];
  return media?.type === "image" ? media.url : media?.thumbnailUrl;
}

/** The category's name, when the card carries one to show. */
function categoryName(product: StorefrontProductCard): string {
  const category = product.category;
  return category && typeof category === "object" && category.name
    ? category.name
    : "";
}

function SmallDealCard({
  product,
  locale,
  showStock,
  area,
  image: imageStyle,
}: {
  product: StorefrontProductCard;
  locale: Locale;
  showStock: boolean;
  /** The grid area this card takes at lg. */
  area: string;
  image: DealImageStyle;
}) {
  const t = useTranslations();
  const { formatPrice } = useCurrency();
  const href = `/${locale}/products/${product.slug}`;
  const image = productImage(product);
  const discount = getProductDiscountPercentage(product);
  const compareAt = formatProductCompareAtPrice(product, formatPrice);
  const left = showStock ? lowStock(product) : null;

  return (
    // Below lg the card is an item in the deal rail: 74% of the panel on a
    // phone so the next deal peeks. At lg it takes its grid area, and its
    // WIDTH there is the layout's decision, not the card's — two deals in a
    // row are wide, five are narrow. So the card is a container and lays
    // itself out by the width it actually got: the photo beside the copy
    // when there is room for both, above it when there is not. In either
    // shape the photo takes whatever height the cell has to give, so a
    // tall cell means a bigger picture rather than a small card in a big
    // empty box.
    <div
      className="@container flex w-[74%] min-w-0 shrink-0 snap-start rounded-[var(--deal-card-radius,0.75rem)] bg-card sm:min-h-40 sm:w-[46%] lg:w-auto"
      style={{ gridArea: area }}
    >
      <div className="flex h-full w-full flex-col gap-2 p-2 @[260px]:flex-row @[260px]:items-center @[260px]:py-1.5 @[260px]:pe-0 @[260px]:ps-1.5">
        <Link
          href={href}
          className="relative min-h-[140px] flex-1 overflow-hidden rounded-[max(0px,calc(var(--deal-card-radius,0.75rem)-4px))] bg-muted @[260px]:w-[44%] @[260px]:min-h-[130px] @[260px]:flex-none @[260px]:self-stretch"
        >
          {discount > 0 ? (
            // What a deals panel is FOR. The struck-through price alone
            // leaves the shopper to do the arithmetic.
            <span className="absolute start-1.5 top-1.5 z-10 rounded bg-(--store-sale,#e11d48) px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-white">
              -{discount}%
            </span>
          ) : null}
          {image ? (
            <AppImage
              src={image}
              alt={product.name}
              fill
              sizes="(min-width: 1024px) 240px, 40vw"
              {...dealImageProps(imageStyle, "p-2", 16)}
            />
          ) : null}
        </Link>
        <div className="flex min-w-0 flex-col gap-1.5 px-1 pb-1 @[260px]:flex-1 @[260px]:gap-2 @[260px]:pe-3 @[260px]:pb-0 @[420px]:gap-3 @[420px]:ps-3">
          {/* Two lines, never an ellipsis after four characters: a narrow
              card has the height to wrap a name it lacks the width to fit. */}
          <Link
            href={href}
            className="line-clamp-2 text-[14px] font-semibold leading-tight tracking-[-0.03em] text-card-foreground @[260px]:text-[16px] @[420px]:text-[19px]"
          >
            {product.name}
          </Link>
          <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-[17px] font-bold leading-tight tracking-[-0.01em] text-primary @[260px]:text-[21px] @[420px]:text-[25px]">
              {formatProductPrice(product, formatPrice)}
            </span>
            {compareAt ? (
              <span className="text-[10.5px] leading-tight tracking-[-0.01em] text-foreground/30 line-through @[420px]:text-[13px]">
                {compareAt}
              </span>
            ) : null}
          </p>
          {left !== null ? (
            <p className="text-[10.5px] font-semibold leading-none text-(--store-sale,#e11d48)">
              {t.has("home.dealsOnlyLeft")
                ? t("home.dealsOnlyLeft", { count: left })
                : `Only ${left} left`}
            </p>
          ) : null}
          {/* The card's image and name already lead to the product; on a
              phone the row is short enough that a third link to the same
              place costs more than it earns. It returns from sm up. */}
          <Link
            href={href}
            data-slot="button"
            className="hidden h-[30px] w-full max-w-[140px] items-center justify-center rounded-md border-[0.713px] border-border text-[10px] font-bold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground sm:flex"
          >
            {t("common.view")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function FeaturedDealCard({
  product,
  locale,
  showStock,
  image: imageStyle,
}: {
  product: StorefrontProductCard;
  locale: Locale;
  showStock: boolean;
  image: DealImageStyle;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { currency, formatPrice } = useCurrency();
  const { addItem } = useCart();
  // Null while the shopper hasn't browsed the gallery by hand — the colour
  // swatch drives the image until they do, and each colour change hands
  // control back to the swatches.
  const [imageOverride, setImageOverride] = useState<number | null>(null);
  const [activeColor, setActiveColor] = useState(0);
  const [adding, setAdding] = useState(false);

  const href = `/${locale}/products/${product.slug}`;
  const allImages = product.images ?? [];
  const images = allImages.slice(0, 4);
  const rating = Math.round(product.rating ?? 0);
  const reviews = product.reviewCount ?? 0;
  const left = showStock ? lowStock(product) : null;
  const category = categoryName(product);
  const savings = getProductSavings(product);
  const colorOption = findColorOption(product.options);
  const colors = (colorOption?.values ?? []).slice(0, 4);

  // A swatch stands for a variant, and the variant brings its own photo:
  // picking Black shows the black phone, not whatever the cover image is.
  const colorImage = colors[activeColor]
    ? findColorVariantImage(product, colors[activeColor])
    : null;
  const colorImageIndex = colorImage ? allImages.indexOf(colorImage) : -1;
  const activeImage = imageOverride ?? Math.max(colorImageIndex, 0);
  // A colour whose photo sits outside the four-thumbnail strip still shows —
  // off-gallery, so no thumbnail is marked while it does.
  const image =
    imageOverride === null && colorImage && colorImageIndex < 0
      ? colorImage
      : (allImages[activeImage] ?? productImage(product));
  const priceRange = getProductPriceRange(product);
  const discount = getProductDiscountPercentage(product);
  const onlyVariant =
    Array.isArray(product.variants) && product.variants.length === 1
      ? product.variants[0]
      : null;

  const step = useCallback(
    (delta: number) => {
      if (images.length < 2) return;
      setImageOverride(
        ((activeImage + delta) % images.length + images.length) %
          images.length,
      );
    },
    [activeImage, images.length],
  );

  const handleAddToCart = useCallback(async () => {
    if (adding) return;
    // Same rule as the product card: a product whose price depends on a
    // choice cannot be added blind — hand over to the product page.
    if (productRequiresVariantSelection(product)) {
      router.push(href);
      return;
    }
    setAdding(true);
    try {
      await addItem({
        productId: product._id,
        variantId: onlyVariant?._id,
        name: onlyVariant
          ? `${product.name} - ${onlyVariant.name}`
          : product.name,
        price: onlyVariant?.price ?? priceRange.min,
        image: productImage(product),
        quantity: 1,
      });
      trackAddToCart({
        currency: currency.code,
        value: onlyVariant?.price ?? priceRange.min,
        items: [
          {
            item_id: String(product._id),
            item_name: product.name,
            item_variant: onlyVariant?._id,
            price: onlyVariant?.price ?? priceRange.min,
            quantity: 1,
          },
        ],
      });
      toast.success(t("cart.itemAdded"));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setAdding(false);
    }
  }, [
    adding,
    addItem,
    currency.code,
    href,
    onlyVariant,
    priceRange.min,
    product,
    router,
    t,
  ]);

  return (
    // `h-full` down the spine so a taller panel reaches the artwork: the
    // card fills its grid cell, the inner grid fills the card, and the image
    // box is the flexible track of its column — thumbnails and copy keep
    // their size, the photo takes the rest.
    // A container as well: on its own in a full-width layout the card is
    // twice the width the design drew it at, and the photo column would eat
    // most of it. Past 820px the columns split evenly and the copy steps up
    // a size, so the card reads as a spread rather than a stretched card.
    <div className="@container h-full rounded-[var(--deal-card-radius,0.75rem)] border-[0.5px] border-border bg-card p-3 shadow-[0px_41.78px_13.88px_rgba(0,0,0,0.06)] sm:p-4 sm:px-6 sm:pb-4 sm:pt-[22px]">
      {/* Photo beside copy only when the card itself is wide enough for
          both: the featured slot of a "Featured + 4" is a third of the
          panel, and two columns in 400px wrapped the name to four lines and
          ran the price off the card. Narrower than 540px the photo goes on
          top and grows into any height the cell has; the copy keeps its
          natural height beneath it. */}
      <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] gap-3 @[540px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] @[540px]:grid-rows-none @[540px]:items-stretch @[540px]:gap-[25.6px] @[820px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @[820px]:gap-10">
        <div className="flex flex-col gap-2.5">
          <div className="relative flex min-h-48 flex-1 items-center justify-center overflow-hidden rounded-[max(0px,calc(var(--deal-card-radius,0.75rem)-4px))] bg-muted @[540px]:min-h-[236px]">
            {discount > 0 ? (
              <span className="absolute start-2 top-2 z-10 rounded bg-(--store-sale,#e11d48) px-2 py-1 text-[10px] font-extrabold leading-none text-white">
                -{discount}%
              </span>
            ) : null}
            {image ? (
              <AppImage
                src={image}
                alt={product.name}
                fill
                sizes="(min-width: 640px) 280px, 100vw"
                {...dealImageProps(imageStyle, "p-4", 48)}
              />
            ) : null}
            {images.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => step(-1)}
                  aria-label={t("common.previous")}
                  className="absolute start-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-card/80 text-foreground/70 shadow-sm transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-card sm:start-[6.4px] sm:size-4"
                >
                  <ChevronLeft className="size-4 rtl:rotate-180 sm:size-2" />
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  aria-label={t("common.next")}
                  className="absolute end-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-card/80 text-foreground/70 shadow-sm transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-card sm:end-[6.4px] sm:size-4"
                >
                  <ChevronRight className="size-4 rtl:rotate-180 sm:size-2" />
                </button>
              </>
            ) : null}
          </div>
          {/* The thumbnail strip is a pointer affordance the swatches already
              cover on a phone — and the one below it changes the photo AND
              the variant, which is what a thumb is reaching for. */}
          {images.length > 1 ? (
            <div className="hidden justify-center gap-1.5 sm:flex">
              {images.map((thumb, index) => (
                <button
                  key={thumb}
                  type="button"
                  onClick={() => setImageOverride(index)}
                  aria-label={`${product.name} ${index + 1}`}
                  className={cn(
                    "relative size-[54px] overflow-hidden rounded-lg border",
                    index === activeImage
                      ? "border-[1.226px] border-border bg-muted"
                      : "border-[0.5px] border-border bg-card",
                  )}
                >
                  <AppImage
                    src={thumb}
                    alt=""
                    fill
                    sizes="54px"
                    className="object-contain p-1"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Centred as a group, with the button as its last line: on a card
            given more height than its copy needs, a button pinned to the
            floor and a name pinned to the ceiling read as two things with
            nothing between them. */}
        <div className="flex h-full flex-col justify-center gap-3 sm:gap-4">
          <div className="space-y-1.5">
            {category ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground @[820px]:text-[12px]">
                {category}
              </p>
            ) : null}
            <Link
              href={href}
              className="block text-[20.4px] font-semibold leading-tight tracking-[-0.02em] text-foreground @[820px]:text-[26px]"
            >
              {product.name}
            </Link>
            {/* A rating row only when there is a rating: five grey stars
                and "(0 Reviews)" on a deal is noise where the saving should
                be. With no reviews the line is the one signal a deals card
                needs — how few are left, when that is few. */}
            {reviews > 0 ? (
              <span className="flex items-center gap-[7.3px]">
                <span className="flex gap-[1.2px]" aria-hidden>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Star
                      key={index}
                      className={cn(
                        "size-3 sm:size-[11px]",
                        index < rating
                          ? "fill-amber-400 text-amber-400"
                          : "fill-muted-foreground/25 text-muted-foreground/25",
                      )}
                    />
                  ))}
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  ({reviews} {t("product.reviews")})
                </span>
              </span>
            ) : null}
            {left !== null ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-(--store-sale,#e11d48)/10 px-2.5 py-1 text-[11px] font-bold text-(--store-sale,#e11d48)">
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
                {t.has("home.dealsOnlyLeft")
                  ? t("home.dealsOnlyLeft", { count: left })
                  : `Only ${left} left`}
              </span>
            ) : null}
          </div>

          <div className="space-y-1">
            <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <span className="text-[25.2px] font-bold leading-[1.25] tracking-[-0.01em] text-primary @[820px]:text-[32px]">
                {formatProductPrice(product, formatPrice)}
              </span>
              {formatProductCompareAtPrice(product, formatPrice) ? (
                <span className="text-[13.6px] leading-[1.25] tracking-[-0.01em] text-foreground/30 line-through @[820px]:text-[15px]">
                  {formatProductCompareAtPrice(product, formatPrice)}
                </span>
              ) : null}
            </p>
            {/* The saving in money, next to the percentage on the badge: the
                two numbers a shopper weighs, both on the card. */}
            {savings > 0 ? (
              <p className="text-[12.5px] font-semibold text-[#15803d] @[820px]:text-[14px]">
                {t.has("home.dealsYouSave")
                  ? t("home.dealsYouSave", { amount: formatPrice(savings) })
                  : `You save ${formatPrice(savings)}`}
              </p>
            ) : null}
          </div>

          {colors.length > 0 ? (
            <div className="space-y-[8.1px]">
              <p className="text-[11px] leading-normal sm:text-[9.4px]">
                <span className="font-bold text-foreground">
                  {t("product.color")}:
                </span>{" "}
                <span className="font-medium text-muted-foreground">
                  {colors[activeColor]?.value}
                </span>
              </p>
              <div className="flex gap-[8.1px]">
                {colors.map((value, index) => {
                  const swatch =
                    getSwatchColor(value.value, value.colorCode) || "var(--border)";
                  const selected = index === activeColor;
                  return (
                    <button
                      key={value._id ?? value.value}
                      type="button"
                      onClick={() => {
                        setActiveColor(index);
                        setImageOverride(null);
                      }}
                      aria-label={value.value}
                      aria-pressed={selected}
                      className={cn(
                        "grid size-8 place-items-center rounded-full border sm:size-[24.3px]",
                        selected
                          ? "border-[1.349px] border-foreground"
                          : "border-[0.675px] border-border",
                      )}
                    >
                      <span
                        className="grid size-6 place-items-center rounded-full sm:size-[18.9px]"
                        style={{ backgroundColor: swatch }}
                      >
                        {selected ? (
                          // Difference blend keeps the tick visible on any
                          // swatch colour — dark on light, light on dark.
                          <Check className="size-3 text-white mix-blend-difference sm:size-[9.4px]" />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            data-slot="button"
            onClick={handleAddToCart}
            disabled={adding}
            // A button a thumb can land on: the design's 8.7px label was
            // drawn for a mockup, not a shopper.
            className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-foreground text-[13px] font-bold text-background transition-colors hover:bg-foreground/85 disabled:opacity-60 @[820px]:h-12 @[820px]:max-w-sm @[820px]:text-[14px]"
          >
            <ShoppingCart className="size-4" />
            {t("common.addToCart")}
          </button>
        </div>
      </div>
    </div>
  );
}
