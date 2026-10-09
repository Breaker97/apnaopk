import { Fragment, Suspense, type CSSProperties, type ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { messageTemplate } from "@/lib/i18n/message-template";
import {
  ChevronDown,
  ChevronRight,
  Home,
  Plus,
  Star,
  Store,
} from "lucide-react";
import Link from "@/components/language/link";
import { AppImage } from "@/components/ui/app-image";
import { Badge } from "@/components/ui/badge";
import { ElectronicsSectionHeading } from "@/components/store/sections/themes/electronics-section-heading";
import { VendorExternalChannels } from "@/components/chat/vendor-external-channels";
import { type Locale } from "@/config/i18n.config";
import type { ProductFulfillmentNotes } from "@/lib/products/fulfillment-notes";
import {
  productInfoSectionKind,
  toPurchaseProduct,
  type ProductPageProduct,
} from "@/lib/products/purchase-product";
import {
  DEFAULT_PRODUCT_DETAIL_GROUPS,
  visibleProductDetailGroups,
  type ProductDetailRow,
  type ProductDetailRowItem,
} from "@/lib/storefront/sections/product-detail-rows";
import type { ProductDetailConfig } from "@/lib/storefront/sections/product-detail-style";
import { typographyCss } from "@/lib/storefront/sections/product-detail-css";
import { buildStorefrontUrl } from "@/lib/storefront/storefront-metadata";
import { getStorefrontSettings } from "@/lib/storefront/storefront-settings";
import { cn } from "@/lib/utils";
import { ProductIsland, ProductPurchaseProvider } from "./product-details-lazy";
import { ProductDetailsSkeleton } from "./product-details-skeleton";
import { ProductShareRow } from "./product-share-row";

/* The buy box's Description row is a summary, not the whole
   article — the full rich text still renders in the page's Description
   section below. Merchants who wrote a short description get theirs
   verbatim; otherwise we trim the long copy down to its opening sentences. */
const DESCRIPTION_SUMMARY_MAX_CHARS = 240;

function getDescriptionSummary(product: ProductPageProduct) {
  const short = product.shortDescription?.trim();
  if (short) return short;

  const plain = (product.description || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= DESCRIPTION_SUMMARY_MAX_CHARS) return plain;

  // Cut on the last whole word so the ellipsis never lands mid-word.
  const clipped = plain.slice(0, DESCRIPTION_SUMMARY_MAX_CHARS);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).replace(/[,;:.\s]+$/, "")}…`;
}

interface ProductDetailsProps {
  product: ProductPageProduct;
  locale: Locale;
  /**
   * What the "Delivery info" row may promise: the delivery window checkout
   * would quote and the return terms in force, resolved on the server from
   * the store's settings (lib/products/product-fulfillment-notes.ts). Absent
   * or empty, the row draws nothing — never the old placeholder copy.
   */
  fulfillment?: ProductFulfillmentNotes | null;
  /**
   * Whether the product — and each variant, by id — is final sale, resolved on
   * the server with the store's final-sale collections (lib/returns/final-sale.ts).
   * A final-sale choice replaces the return terms in the "Delivery info" row.
   */
  finalSale?: { product: boolean; variants: Record<string, boolean> } | null;
  /**
   * The product template's `galleryLayout` setting (product-main section).
   * "full", "carousel" and "vertical" also change the page arrangement:
   * "full" and "carousel" stack the gallery above the buy box at every
   * width (the carousel needs the page width to show several slides at
   * once); "vertical" keeps the two
   * columns but makes the BUY BOX the sticky side while the media list
   * scrolls.
   */
  galleryLayout?: "bottom" | "left" | "grid" | "carousel" | "vertical" | "full";
  /**
   * The Minimal design's row arrangement: visible row keys per group, a
   * hairline between groups. Resolved by the section definition from the
   * stored `rows` setting.
   */
  rowGroups?: ProductDetailRowItem[][];
  /**
   * The Minimal design's Visibility + Style knobs, resolved by the section
   * definition from the stored `detailStyle` setting.
   */
  detail: ProductDetailConfig;
  /**
   * The template also renders the standalone `product-specification`
   * section (the Electronics preset does), so the inline spec block here
   * stands down — two spec tables on one page is the bug this prevents.
   */
  standaloneSpecs: boolean;
  /**
   * Which sections the tab strip may send the shopper to, besides the
   * description. A section the page does not draw gets no tab, and without
   * a reviews section the rating's review count stops linking to one.
   */
  sectionTargets: { specifications: boolean; reviews: boolean };
  /** The store runs as a marketplace, so third-party sellers are named. */
  isMultiVendor: boolean;
}

/**
 * The product page's main section: gallery, buy box, description.
 *
 * Drawn on the server. What does not change while the shopper is on the page
 * — the breadcrumb, the title, the rating, the seller, the summary, the
 * description and the specification table, the whole arrangement — is plain
 * markup that ships no code. The controls that answer to the shopper (the
 * variant picker and everything it moves: the gallery, the price and stock,
 * the cart buttons, the details list, the pinned tab strip) are client
 * islands sharing one purchase state (product-purchase.tsx), loaded as one
 * chunk through product-details-lazy.tsx.
 */
export async function ProductDetails({
  product,
  locale,
  fulfillment = null,
  finalSale = null,
  galleryLayout = "bottom",
  rowGroups,
  detail,
  standaloneSpecs,
  sectionTargets,
  isMultiVendor,
}: ProductDetailsProps) {
  const [t, { shareSettings }, shareUrl] = await Promise.all([
    getTranslations({ locale }),
    getStorefrontSettings(),
    buildStorefrontUrl(locale, `/products/${product.slug}`),
  ]);
  const tf = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ) => {
    if (t.has(key)) {
      return t(key as never, values as never);
    }
    if (!values) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (_, token) =>
      String(values[token] ?? `{${token}}`),
    );
  };
  /**
   * Same as `tf`, for templates whose {placeholders} are substituted by the
   * component that RECEIVES them rather than here: the placeholder survives to
   * the consumer instead of being resolved (or stripped) at this layer.
   */
  const traw = (key: string, fallback: string) =>
    messageTemplate(t, key, fallback);

  const directVendor =
    product.vendorId && product.vendorId.isDefault !== true
      ? product.vendorId
      : undefined;
  const messaging = directVendor?.messaging || product.platformMessaging;
  // "Sold by" attribution — only in a marketplace (multi-vendor on), and only
  // for third-party sellers: the default vendor IS the store itself and has no
  // public /vendors page to stand behind the link.
  const soldByVendor = isMultiVendor ? directVendor : undefined;

  const hasSpecifications =
    Array.isArray(product.attributes) && product.attributes.length > 0;
  const hasDescription = !!product.description?.trim();
  const descriptionSummary = getDescriptionSummary(product);
  const hasOptions =
    Array.isArray(product.options) && product.options.length > 0;
  const productInfoSectionKindValue = productInfoSectionKind(product);
  const productInfoSectionTitle = {
    sizeFit: tf("product.sizeAndFit", "Size & Fit"),
    technicalDetails: tf("product.technicalDetails", "Technical Details"),
    dimensionsDetails: tf("product.dimensionsDetails", "Dimensions & Details"),
    productInformation: tf("product.productInformation", "Product Information"),
    productDetails: tf("product.productDetails", "Product Details"),
  }[productInfoSectionKindValue];

  // "full" stacks everything in one column and renders the gallery in its
  // classic bottom arrangement; "carousel" stacks the same way, so its strip
  // runs the page width with the next slides in view instead of one slide
  // squeezed into a column; "vertical" flips which column is sticky — the
  // media list scrolls while the buy box holds.
  const isFullWidthLayout =
    galleryLayout === "full" || galleryLayout === "carousel";
  const isVerticalLayout = galleryLayout === "vertical";
  const galleryInternalLayout = galleryLayout === "full" ? "bottom" : galleryLayout;

  /* "Sold by {seller}" line, used by the Sold by row. The template is
     split around its placeholder so the seller name can carry emphasis and
     the link while translators keep control of word order. `cart.soldBy` is
     the phrase's existing home (the bag's per-seller group headers). */
  const renderSoldBy = () => {
    if (!soldByVendor) return null;
    const template = traw("cart.soldBy", "Sold by {seller}");
    const [beforeSeller, afterSeller = ""] = template.split("{seller}");
    return (
      <Link
        href={`/vendors/${encodeURIComponent(soldByVendor.slug)}`}
        className="group/vendor flex w-fit max-w-full items-center gap-2 text-sm text-muted-foreground"
      >
        {soldByVendor.logo ? (
          <span className="relative h-5 w-5 shrink-0 overflow-hidden rounded-full border border-border">
            <AppImage
              src={soldByVendor.logo}
              alt=""
              fill
              sizes="20px"
              className="object-cover"
            />
          </span>
        ) : (
          <Store className="h-4 w-4 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 truncate">
          {beforeSeller}
          <span className="font-semibold text-foreground group-hover/vendor:underline">
            {soldByVendor.storeName}
          </span>
          {afterSeller}
        </span>
      </Link>
    );
  };

  /* Live chat plus the seller's click-to-chat channels, used by the Sold by
     and Chat rows. Live chat follows the server's rule — on unless switched
     off, so a seller with no saved messaging settings still gets the button —
     while the external channels need those settings to exist. */
  const renderChatControls = () => (
    <div className="flex flex-wrap items-center gap-2">
      {messaging?.liveChatEnabled !== false ? (
        <ProductIsland
          island="chat"
          vendorId={directVendor?._id}
          vendorName={
            directVendor?.storeName || tf("chat.storeSupport", "Store support")
          }
          label={
            directVendor
              ? tf("chat.chatWithSeller", "Chat with Seller")
              : tf("chat.chatWithStore", "Chat with store")
          }
        />
      ) : null}
      {messaging ? (
        <VendorExternalChannels
          // raw(): the messages keep their {vendor}/{channel}/{product}
          // placeholders for VendorExternalChannels to substitute, since
          // only that component knows the values.
          chatOnLabel={traw(
            "chat.externalChannels.chatOn",
            "Chat with {vendor} on {channel}",
          )}
          whatsappProductMessage={traw(
            "chat.externalChannels.whatsappProductMessage",
            "Hello {vendor}, I have a question about {product}.",
          )}
          whatsappStoreMessage={traw(
            "chat.externalChannels.whatsappStoreMessage",
            "Hello {vendor}, I have a question about your store.",
          )}
          settings={messaging}
          vendorName={
            directVendor?.storeName || tf("chat.storeSupport", "Store support")
          }
          productName={product.name}
        />
      ) : null}
    </div>
  );

  // ── Minimal design rows (Figma 774:4992) ────────────────────────────────
  // Merchant-ordered rows from the section's "Order" setting. Groups come
  // from that setting; a hairline is drawn between some of them.
  const minimalGroups =
    rowGroups && rowGroups.length > 0
      ? rowGroups
      : visibleProductDetailGroups(DEFAULT_PRODUCT_DETAIL_GROUPS);
  const { visibility: vis, style: sty } = detail;
  const typo = sty.typography;
  /** The accordion "Open first" applies to: the first one in page order. */
  const minimalFirstAccordion = minimalGroups
    .flat()
    .find((item) => item.key === "description" || item.key === "details")
    ?.key;
  const pinColumn = sty.stickyColumn;
  const hasChatRow = minimalGroups.some((items) =>
    items.some((item) => item.key === "chat"),
  );
  /**
   * The gallery's bleeds. A max content width puts the page in a narrower
   * box than the one the inset measures, so the left bleed stands down there
   * rather than running to the wrong edge.
   */
  const bleedLeft = sty.galleryBleedLeft && !(sty.contentMaxWidth > 0);
  const bleedTop = sty.galleryBleedTop;

  /**
   * The Delivery info card has something to say for good when the store
   * promises a delivery window or return terms. Without either it speaks
   * only for a pre-order — so for a product that can be pre-ordered it is
   * there exactly while the shopper's choice is one.
   */
  const infoCardAlways = Boolean(
    fulfillment?.deliveryDays || fulfillment?.returns,
  );
  const infoCardForPreorder =
    !infoCardAlways &&
    Boolean(
      product.preorder?.enabled ||
        product.variants?.some((variant) => variant.preorder?.enabled),
    );

  /* Accordion rows per the Figma: hairline-separated, title with a plus on
     the end edge that turns into an X when open — no boxed chrome. Native
     <details> so open state needs no React state. */
  const minimalAccordion = (
    key: ProductDetailRow,
    title: string,
    content: ReactNode,
  ) => (
    <details
      className="group/acc py-4 first:pt-0 last:pb-0"
      // Initial state only: the shopper's own toggles stay theirs.
      open={minimalFirstAccordion === key && vis.accordionOpenFirst}
    >
      <summary
        className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-medium text-foreground [&::-webkit-details-marker]:hidden"
        style={typographyCss(typo.accordion)}
      >
        {title}
        {sty.accordionIcon === "chevron" ? (
          <ChevronDown
            className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-open/acc:rotate-180"
            aria-hidden
          />
        ) : (
          <Plus
            className="h-[18px] w-[18px] shrink-0 transition-transform duration-200 group-open/acc:rotate-45"
            aria-hidden
          />
        )}
      </summary>
      <div className="pt-3">{content}</div>
    </details>
  );

  const renderMinimalRow = (item: ProductDetailRowItem): ReactNode => {
    const row: ProductDetailRow = item.key;
    switch (row) {
      case "breadcrumb":
        return (
          <nav
            aria-label={tf("common.breadcrumb", "Breadcrumb")}
            className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
            style={typographyCss(typo.category)}
          >
            <Link
              href="/"
              aria-label={t("common.home")}
              // A 14px icon is the whole link. The pseudo-element takes the
              // reach to ~30x22 without moving anything; it stops there
              // rather than at 44 because the breadcrumb's own items sit
              // 6px apart and overlapping hit areas mis-fire.
              className="relative transition-colors before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] hover:text-foreground"
            >
              <Home className="h-3.5 w-3.5" />
            </Link>
            {product.category ? (
              <>
                <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
                <Link
                  href={`/categories/${product.category.slug}`}
                  className="transition-colors hover:text-foreground"
                >
                  {product.category.name}
                </Link>
              </>
            ) : null}
            {product.brand?.name ? (
              <>
                <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
                <Link
                  href={`/brands/${encodeURIComponent(product.brand.slug)}`}
                  className="transition-colors hover:text-foreground"
                >
                  {product.brand.name}
                </Link>
              </>
            ) : null}
          </nav>
        );
      case "brand":
        // Only the brand logo is shown here — never the brand name. When the
        // brand has no logo the row still reserves its height so the blocks
        // below it do not shift.
        if (!product.brand?.name) return null;
        return product.brand.logo ? (
          <Link
            href={`/brands/${encodeURIComponent(product.brand.slug)}`}
            className="flex w-fit items-center hover:opacity-80"
            style={{ height: sty.brandLogoHeight }}
            aria-label={product.brand.name}
          >
            <span
              className="relative shrink-0"
              style={{
                height: sty.brandLogoHeight,
                width: sty.brandLogoMaxWidth,
              }}
            >
              <AppImage
                src={product.brand.logo}
                alt={product.brand.name}
                fill
                sizes="224px"
                className="object-contain object-left"
              />
            </span>
          </Link>
        ) : (
          <div style={{ height: sty.brandLogoHeight }} aria-hidden />
        );
      case "title":
        return (
          <h1
            className="text-xl font-semibold tracking-tight text-foreground md:text-2xl"
            style={typographyCss(typo.product)}
          >
            {product.name}
          </h1>
        );
      case "vendor": {
        // A marketplace shopper reaches the seller from its name, so the
        // "Sold by" row — on in every arrangement, and rendered only for a
        // third-party seller in multi-vendor mode — carries the chat
        // controls. A store that placed the `chat` row itself keeps them
        // there instead of showing them twice.
        const soldBy = renderSoldBy();
        const chat = soldBy && !hasChatRow ? renderChatControls() : null;
        return chat ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {soldBy}
            {chat}
          </div>
        ) : (
          soldBy
        );
      }
      case "rating": {
        const starStyle = sty.ratingColor
          ? { color: sty.ratingColor, fill: sty.ratingColor }
          : undefined;
        return (
          <div className="flex flex-wrap items-center gap-2">
            {vis.ratingMinimized ? (
              <span className="flex items-center gap-1.5">
                <Star
                  className="h-4 w-4 fill-amber-500 text-amber-500"
                  style={starStyle}
                />
                <span className="text-sm font-semibold text-foreground">
                  {product.rating.toFixed(1)}
                </span>
              </span>
            ) : (
              <div className="flex items-center">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Star
                    key={`minimal-rating-star-${index}`}
                    className={cn(
                      "h-4 w-4",
                      index < Math.round(product.rating)
                        ? "fill-amber-500 text-amber-500"
                        : "fill-muted-foreground text-muted-foreground opacity-30",
                    )}
                    style={
                      index < Math.round(product.rating) ? starStyle : undefined
                    }
                  />
                ))}
              </div>
            )}
            {vis.ratingCount ? (
              sectionTargets.reviews ? (
                <Link
                  href="#reviews"
                  className="relative text-xs font-medium text-muted-foreground before:absolute before:-inset-x-1 before:-inset-y-2 before:content-[''] hover:text-foreground"
                >
                  ({product.reviewCount})
                </Link>
              ) : (
                <span className="text-xs font-medium text-muted-foreground">
                  ({product.reviewCount})
                </span>
              )
            ) : null}
          </div>
        );
      }
      case "price":
        return <ProductIsland island="price" />;
      case "variants":
        return hasOptions ? <ProductIsland island="variants" /> : null;
      case "quantity-cart":
        return <ProductIsland island="cart" />;
      case "description":
        // This row only holds the short summary — the full rich-text
        // description keeps its own "Description" section further down, so the
        // label here has to differ or the page reads two of the same heading.
        return minimalAccordion(
          "description",
          tf("product.overview", "Overview"),
          <p className="text-sm leading-relaxed text-muted-foreground">
            {descriptionSummary ||
              tf("product.noDescription", "No description available.")}
          </p>,
        );
      case "details":
        return minimalAccordion(
          "details",
          productInfoSectionTitle,
          <ProductIsland
            island="details"
            sectionKind={productInfoSectionKindValue}
          />,
        );
      case "info-card":
        return infoCardAlways || infoCardForPreorder ? (
          <ProductIsland island="infoCard" />
        ) : null;
      case "share":
        // The Figma's two-row arrangement: a "Share" title, then the icons
        // as gray rounded tiles. Nothing at all — title included — when the
        // store offers no way to share.
        return (
          <ProductShareRow
            url={shareUrl}
            productName={product.name}
            image={product.images?.[0]}
            settings={shareSettings}
            networks={sty.shareNetworks}
            tileStyle={{
              width: sty.shareSize,
              height: sty.shareSize,
              borderRadius: sty.shareRadius,
              ...(sty.shareBackground
                ? { backgroundColor: sty.shareBackground }
                : {}),
              ...(sty.shareIconColor ? { color: sty.shareIconColor } : {}),
            }}
            tf={tf}
          />
        );
      case "chat":
        return renderChatControls();
      // Layout rows: space or a rule, with the settings the Order editor set
      // on this one instance (parseProductDetailGroups clamps them).
      case "gap":
        return <div aria-hidden style={{ height: item.size ?? 24 }} />;
      case "divider":
        return (
          <hr
            aria-hidden
            className="shrink-0 border-0"
            style={{
              height: item.size ?? 1,
              backgroundColor: item.color || "var(--border)",
              marginBlock: item.spacing ?? 16,
            }}
          />
        );
      default:
        return null;
    }
  };

  /* A row can render nothing for a given product — `variants` on a product
     with no options is the everyday case. Its group wrapper still carried the
     hairline and the half-gap padding, so those products showed an empty
     bordered strip between the price and the cart row. Render the rows first
     and drop any group that came back with nothing in it, so the hairline and
     the gap leave together.

     The one row whose presence the shopper decides is a pre-order-only
     Delivery info card; a group holding nothing else is handed to the card
     itself, which draws the group's frame only while it has something to
     show. So the first group's missing top padding, the last group's missing
     bottom padding and the hairline "between" groups are CSS structure
     (first/last child) rather than indexes counted here — they have to hold
     for whichever groups are actually in the page. */
  const minimalRenderedGroups = minimalGroups
    .map((items) => ({
      keys: items.map((item) => item.key),
      // Keyed by the row's id: a gap or a line can appear more than once.
      rows: items
        .map((item) => ({
          key: item.id,
          row: item.key,
          node: renderMinimalRow(item),
        }))
        .filter((entry) => entry.node != null),
    }))
    .filter((group) => group.rows.length > 0);

  const productForClient = toPurchaseProduct(product);

  // The skeleton while the controls' chunk loads — see product-details-lazy.tsx.
  return (
    <Suspense fallback={<ProductDetailsSkeleton />}>
      <ProductPurchaseProvider
        product={productForClient}
        locale={locale}
        fulfillment={fulfillment}
        finalSale={finalSale}
        detail={detail}
      >
        <div
          className={cn(
            "space-y-14",
            sty.contentMaxWidth > 0 && "mx-auto w-full",
          )}
          style={
            sty.contentMaxWidth > 0 ? { maxWidth: sty.contentMaxWidth } : undefined
          }
        >
          <div
            className={cn(
              "grid grid-cols-1 gap-8",
              // The split used to wait for xl (1280): a 13" laptop at default
              // zoom never reached it, so 1024 rendered the phone layout — a
              // 992px-wide gallery with the price a full screen below it.
              // The gallery's share of the row is the merchant's; the buy box
              // takes what is left.
              !isFullWidthLayout &&
                "lg:grid-cols-[minmax(0,var(--pdp-gallery-w,50%))_minmax(0,1fr)] lg:gap-10 xl:gap-12",
            )}
            style={
              !isFullWidthLayout
                ? ({ "--pdp-gallery-w": `${sty.galleryWidth}%` } as CSSProperties)
                : undefined
            }
          >
            {/* Sticky offset tracks the real header height (--storefront-header-height,
                published by store-header) instead of a hardcoded value that pushed the
                gallery below the buy box at scroll 0. Pinned from lg, where the
                two-column layout starts. */}
            <div
              className={cn(
                !isFullWidthLayout &&
                  !isVerticalLayout &&
                  pinColumn &&
                  (bleedTop
                    ? // Flush under the header while it scrolls, too.
                      "lg:sticky lg:top-[var(--storefront-header-height,4rem)] lg:self-start"
                    : "lg:sticky lg:top-[calc(var(--storefront-header-height,4rem)+1.5rem)] lg:self-start"),
                // Stacked, the gallery runs edge to edge; beside the buy box it
                // runs out to the left edge only. Negative margins on a stretched
                // grid item widen it by exactly the inset.
                bleedLeft &&
                  (isFullWidthLayout
                    ? "-mx-[var(--store-content-inset,1rem)]"
                    : "-mx-[var(--store-content-inset,1rem)] lg:mr-0"),
                // Cancels the page's own top space (product-main.tsx: pt-6 lg:pt-8).
                bleedTop && "-mt-6 lg:-mt-8",
              )}
            >
              <ProductIsland island="gallery" layout={galleryInternalLayout} />
            </div>

            <div
              className={cn(
                // Same cap the gallery carries (GALLERY_STACK_CLASS) so the two
                // read as one centred column while stacked, instead of a label
                // pinned left and its values flung 400px away at the right edge.
                !isFullWidthLayout && "mx-auto w-full max-w-xl lg:max-w-none",
                isVerticalLayout &&
                  pinColumn &&
                  "lg:sticky lg:top-[calc(var(--storefront-header-height,4rem)+1.5rem)] lg:self-start",
              )}
            >
              {/* ── Minimal buy box (Figma 774:4992) ──────────────────────────
                Merchant-ordered rows from the section's "Order" setting.
                Hairlines are not between every pair of groups: per the Figma
                they sit ON TOP of the variants block, the cart row, and each
                accordion row — the heading, price, and info-card runs separate
                by whitespace alone. */}
              <div
                style={
                  { "--pdp-group-pad": `${sty.groupGap / 2}px` } as CSSProperties
                }
              >
                {minimalRenderedGroups.map(({ keys, rows }, groupIndex) => {
                  // A group of nothing but accordions renders as one hairline
                  // list (the Figma's Description / Technical Details run)
                  // instead of gap-spaced rows.
                  const accordionsOnly = keys.every(
                    (key) => key === "description" || key === "details",
                  );
                  const groupClassName = cn(
                    "flex flex-col py-(--pdp-group-pad) first:pt-0 last:pb-0",
                    (accordionsOnly ||
                      keys[0] === "variants" ||
                      keys[0] === "quantity-cart") &&
                      "border-border not-first:border-t",
                  );
                  const groupStyle = { rowGap: accordionsOnly ? 0 : sty.itemGap };
                  if (
                    infoCardForPreorder &&
                    rows.length === 1 &&
                    rows[0].row === "info-card"
                  ) {
                    return (
                      <ProductIsland
                        key={`minimal-group-${groupIndex}`}
                        island="infoCard"
                        group={{ className: groupClassName, style: groupStyle }}
                      />
                    );
                  }
                  return (
                    <div
                      key={`minimal-group-${groupIndex}`}
                      className={groupClassName}
                      style={groupStyle}
                    >
                      {accordionsOnly ? (
                        <div
                          className="divide-y divide-border"
                          // The hairline colour, scoped to this list.
                          style={
                            sty.accordionDivider
                              ? ({
                                  "--border": sty.accordionDivider,
                                } as CSSProperties)
                              : undefined
                          }
                        >
                          {rows.map(({ key, node }) => (
                            <Fragment key={key}>{node}</Fragment>
                          ))}
                        </div>
                      ) : (
                        rows.map(({ key, node }) => (
                          <Fragment key={key}>{node}</Fragment>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <section className="py-8">
            {vis.sectionTabs ? (
              <ProductIsland island="tabs" sectionTargets={sectionTargets} />
            ) : null}

            <div className="max-w-4xl space-y-8 text-sm leading-7 text-muted-foreground">
              <div data-section="description" className="scroll-mt-24">
                {/* Same two-tone heading as the Specifications and Reviews
                    sections below, so the page's three titles read as one set. */}
                <ElectronicsSectionHeading
                  title={tf("product.description", "Description")}
                  className="mb-5 text-left text-xl sm:text-2xl"
                />
                {hasDescription ? (
                  <div
                    className="rich-text-content max-w-none text-muted-foreground [&_img]:h-auto [&_img]:max-h-[640px] [&_img]:w-auto [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border [&_img]:object-contain"
                    // Already sanitized by getStorefrontProductBySlug on the
                    // server — see lib/products/storefront-product-detail.ts.
                    dangerouslySetInnerHTML={{ __html: product.description }}
                  />
                ) : (
                  <p>{tf("product.noDescription", "No description available.")}</p>
                )}
              </div>

              {/* A template carrying the standalone `product-specification`
                  section (the Electronics preset does) makes this copy stand
                  down. */}
              {standaloneSpecs ? null : (
                <div data-section="specifications" className="scroll-mt-24">
                  <ElectronicsSectionHeading
                    title={tf("product.specifications", "Specifications")}
                    className="mb-5 text-left text-xl sm:text-2xl"
                  />
                  {hasSpecifications ? (
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-border">
                          {product.attributes.map((attr, index) => (
                            <tr key={`${attr.name}-${index}`}>
                              <th
                                scope="row"
                                className="w-1/3 bg-muted/30 px-4 py-3 text-left align-top font-medium text-foreground"
                              >
                                {attr.name}
                              </th>
                              <td className="px-4 py-3 align-top text-foreground/90">
                                {attr.value}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>
                      {tf(
                        "product.noSpecifications",
                        "No specifications available for this product.",
                      )}
                    </p>
                  )}
                </div>
              )}
            </div>

            {product.tags?.length > 0 && (
              <div className="mt-7 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {tf("common.tags", "Tags")}:
                </span>
                {product.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="secondary"
                    className="rounded-full px-3 py-1 text-xs"
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </section>
        </div>
      </ProductPurchaseProvider>
    </Suspense>
  );
}
