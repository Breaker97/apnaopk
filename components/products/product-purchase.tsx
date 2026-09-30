"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useCurrency } from "@/providers/currency-provider";
import { useSession } from "@/lib/auth/auth-client";
import { useQuoteOffers } from "@/hooks/use-quote-offers";
import { useCollectionOffer } from "@/hooks/use-collection-offer";
import { useCart } from "@/hooks/use-cart";
import { toast } from "@/components/ui/toast-notification";
import { type Locale } from "@/config/i18n.config";
import type { ProductFulfillmentNotes } from "@/lib/products/fulfillment-notes";
import { formatCurrency } from "@/lib/intl/money";
import { trackAddToCart, trackProductView } from "@/lib/analytics/events";
import {
  UNTRACKED_PURCHASE_CAP,
  getPurchasableQuantity,
} from "@/lib/products/stock-policy";
import type { ProductDetailConfig } from "@/lib/storefront/sections/product-detail-style";
import {
  getQuoteButtonLabel,
  isQuoteOnlyProduct,
} from "@/lib/products/quote-pricing";
import {
  getProductCompareAtPrice,
  getProductPriceRange,
} from "@/lib/products/price-display";
import { productRequiresVariantSelection } from "@/lib/products/variant-selection";
import { isColorOptionName } from "@/lib/products/color-swatch";
import type {
  ProductPreorderSettings,
  PurchaseProduct,
} from "@/lib/products/purchase-product";
import { useHydrated } from "@/hooks/use-client-value";
import { useRenderNow } from "@/components/store/render-clock";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { formatPreorderReleaseDate } from "@/lib/products/preorder-date";

// Deferred so the large size-chart tables/modal load only when opened.
// Client-only, which gives it a Suspense boundary of its own: without one the
// first open suspended up to the product section's and swapped the whole buy
// box for its skeleton until the chunk arrived.
const ProductSizeGuide = dynamic(() => import("./product-size-guide"), {
  ssr: false,
});
// Only a quote-only product mounts the quote dialog.
const QuoteRequestDialog = dynamic(() =>
  import("@/components/products/quote-request-dialog").then(
    (module) => module.QuoteRequestDialog,
  ),
);

type Translate = (
  key: string,
  fallback: string,
  values?: Record<string, string | number>,
) => string;

export function isSizeOptionName(optionName: string) {
  return ["size", "sizing"].some((keyword) =>
    optionName.toLowerCase().includes(keyword),
  );
}

/** "Color" / "Size" for those options, the merchant's own name otherwise. */
export function normalizeOptionLabel(name: string) {
  if (isColorOptionName(name)) return "Color";
  if (isSizeOptionName(name)) return "Size";
  return name;
}

function getPreorderRemaining(settings?: ProductPreorderSettings) {
  const limit = Number(settings?.limit || 0);
  if (!Number.isFinite(limit) || limit <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - Number(settings?.reservedQuantity || 0));
}

/**
 * The release window alone, ignoring the quota — what `isPreorderOpen` checks
 * before it also asks for a free spot. Separated so a FULL pre-order can be
 * told apart from a closed one: the first can take a waiting list, the second
 * has passed its release date and cannot.
 *
 * `now` is the render's clock (useRenderNow), so the page hydrates to the
 * answer its cached HTML was drawn with.
 */
function isPreorderWindowOpen(
  settings: ProductPreorderSettings | undefined,
  now: number,
) {
  if (!settings?.enabled) return false;
  const releaseDate = settings.releaseDate
    ? new Date(settings.releaseDate)
    : null;
  return !(
    settings.autoConvert !== false &&
    releaseDate &&
    !Number.isNaN(releaseDate.getTime()) &&
    releaseDate.getTime() < now
  );
}

function isPreorderOpen(
  settings: ProductPreorderSettings | undefined,
  now: number,
) {
  return (
    isPreorderWindowOpen(settings, now) && getPreorderRemaining(settings) > 0
  );
}

function calculatePreorderDueNow(params: {
  unitPrice: number;
  quantity: number;
  settings?: ProductPreorderSettings;
}) {
  const lineTotal = Math.max(0, params.unitPrice * params.quantity);
  const mode = params.settings?.paymentMode || "full";
  if (mode === "pay_later") return { dueNow: 0, dueLater: lineTotal };
  if (mode !== "deposit") return { dueNow: lineTotal, dueLater: 0 };

  const rawValue = Number(params.settings?.depositValue || 0);
  const value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
  const dueNow =
    params.settings?.depositType === "fixed"
      ? Math.min(lineTotal, value * params.quantity)
      : Math.min(lineTotal, (lineTotal * Math.min(value, 100)) / 100);
  return { dueNow, dueLater: Math.max(0, lineTotal - dueNow) };
}

function useProductPurchaseState({
  product,
  locale,
  fulfillment,
  finalSale,
  detail,
}: Omit<ProductPurchaseProviderProps, "children">) {
  const t = useTranslations();
  const router = useRouter();
  const { currency, formatPrice } = useCurrency();
  const { addItem, clearCart, items } = useCart();

  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [isBuyingNow, setIsBuyingNow] = useState(false);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [isQuoteOpen, setIsQuoteOpen] = useState(false);
  const hasMounted = useHydrated();
  const now = useRenderNow();

  const tf: Translate = (key, fallback, values) => {
    if (t.has(key)) {
      return t(key as never, values as never);
    }
    if (!values) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (_, token) =>
      String(values[token] ?? `{${token}}`),
    );
  };

  /**
   * "Price on request": this product has no price a shopper may read and no
   * cart line they may create. The buy box and the pinned bar swap its money
   * for a "Price on request" line and its Add to cart / Buy now pair for the single
   * button that opens the request form — the cart API refuses these products
   * anyway, so leaving a live Add to cart on screen would only produce an
   * error toast at the end of a click the shopper had every reason to expect
   * to work.
   */
  const quoteOnly = isQuoteOnlyProduct(product);

  const selectedVariant = useMemo(() => {
    if (!Array.isArray(product.variants) || product.variants.length === 0) {
      return undefined;
    }
    // Nothing to answer: the single variant IS the product. The same rule the
    // card and the quick view read, so a product one of them sends here to be
    // chosen is never answered on the shopper's behalf once it arrives.
    if (
      !productRequiresVariantSelection({
        options: product.options,
        variants: product.variants,
      })
    ) {
      return product.variants[0];
    }
    const options = Array.isArray(product.options) ? product.options : [];
    // It asks, but has no options to ask with — several variants and no way to
    // tell them apart. Nothing is picked; the buy box stays shut.
    if (options.length === 0) return undefined;
    // Nothing is picked on the shopper's behalf, so until every option has an
    // answer there is no variant. Falling back to the first one is what let a
    // shopper add a colour and a size they never chose — the buy box read as
    // "Blue Black, 12/128GB, Dual" on a page they had not touched.
    if (options.some((_, index) => !selectedOptions[index])) {
      return undefined;
    }
    const key = selectedOptions.join("||");
    // A combination the merchant does not stock resolves to nothing either,
    // rather than quietly selling whichever variant happens to be first.
    return product.variants.find((v) => {
      const vKey = (v.optionValues ?? [])
        .map((ov) => (typeof ov === "string" ? ov : ov.value))
        .join("||");
      return vKey === key;
    });
  }, [product.options, product.variants, selectedOptions]);

  const variantOptions = useMemo(
    () => (Array.isArray(product.options) ? product.options : []),
    [product.options],
  );
  const requiresVariantChoice = productRequiresVariantSelection(product);
  /** The options still waiting for an answer, in the product's own order. */
  const unansweredOptions = requiresVariantChoice
    ? variantOptions.filter((_, index) => !selectedOptions[index])
    : [];
  /**
   * The buy box is waiting on the shopper: an option is unanswered, or the
   * combination they built is one the merchant does not stock. Either way the
   * purchase controls stay shut — the cart API rejects a variant product added
   * without a variant, so letting the click through would spend a round trip
   * to show a generic error.
   */
  const awaitingVariantChoice = requiresVariantChoice && !selectedVariant;

  /**
   * The merchant may have answered this shopper's request with a price. If so
   * this buy box stops being a lead form and becomes a normal one — for them
   * alone, and only for the exact lot that was quoted.
   *
   * Fetched client-side (see useQuoteOffers): the rendered page is cached and
   * shared, so a price resolved during render would leak to other visitors.
   */
  const { data: authSession } = useSession();
  const quoteOffers = useQuoteOffers(
    product._id,
    quoteOnly && Boolean(authSession?.user),
  );
  const quoteOffer = quoteOffers.find(
    (offer) => (offer.variantId ?? "") === (selectedVariant?._id ?? ""),
  );
  // A price is for one variant, and the page opens with every option
  // unanswered — so a shopper sent back here to buy what they were quoted saw
  // "Price on request" until they rebuilt the exact combination by hand. When
  // their price arrives and nothing is picked yet, the quoted variant is.
  // Offers come newest first, so with prices for several variants the latest
  // one wins.
  useApplyOnChange([quoteOffers], () => {
    if (!requiresVariantChoice) return;
    if (selectedOptions.some(Boolean)) return;
    for (const offer of quoteOffers) {
      if (!offer.variantId) continue;
      const variant = product.variants?.find(
        (candidate) => String(candidate._id) === offer.variantId,
      );
      const values = (variant?.optionValues ?? []).map((value) =>
        typeof value === "string" ? value : value.value,
      );
      if (values.length > 0 && values.every(Boolean)) {
        setSelectedOptions(values);
        return;
      }
    }
  });
  // Start on the quantity that can actually be bought, so the default state of
  // the page is the buyable one rather than a price the shopper has to hunt
  // for by nudging the stepper.
  useApplyOnChange([quoteOffer?.quoteId, quoteOffer?.quantity], () => {
    if (quoteOffer) setQuantity(quoteOffer.quantity);
  });
  /**
   * The offer covers a quantity, not a unit, so the buy box tells the truth at
   * every setting of the stepper: at the quoted quantity there is a price and
   * an Add to cart; at any other, the shopper is back to asking.
   */
  const quotedNow = Boolean(quoteOffer && quantity === quoteOffer.quantity);

  // The page opens with every option unanswered. A pre-selected first variant
  // reads as a decision the shopper made, and they carry it to checkout
  // without noticing; asking them to pick is one click against a wrong order.
  //
  // Keyed on the product ID alone. `product.options` and `product.variants`
  // are arrays off a server-rendered prop, so they arrive with a new identity
  // after every `router.refresh()` — which the storefront does on back/forward
  // navigation and on tab refocus (components/store/storefront-refresh.tsx).
  // Listing them here threw the shopper's choice away each time: verified in a
  // browser, a picked colour/size/storage silently cleared mid-visit. Only
  // landing on a DIFFERENT product is a reason to start over.
  useApplyOnChange([product._id], () => {
    setSelectedOptions([]);
    setSelectedImage(0);
    setQuantity(1);
  });

  // A variant with its own picture brings the gallery to it.
  useApplyOnChange([product.media, selectedVariant], () => {
    if (selectedVariant?.mediaIndex !== undefined) {
      setSelectedImage(selectedVariant.mediaIndex);
    }
  });

  // Before a variant is picked the buy box prints what the product card that
  // sent the shopper here printed: the cheapest variant's price, and only the
  // compare-at that belongs to it. `product.comparePrice` is the HIGHEST of
  // the range, so pairing it with the lowest price would advertise a discount
  // no single variant actually offers.
  const displayedPrice =
    selectedVariant?.price ?? getProductPriceRange(product).min;
  const displayedComparePrice = selectedVariant
    ? selectedVariant.comparePrice
    : (getProductCompareAtPrice(product) ?? undefined);
  // Zero for a quote-only product: a "% OFF" badge computed against a price
  // the shopper is never shown is a discount off nothing.
  const discountPercentage =
    !quoteOnly &&
    displayedComparePrice &&
    displayedComparePrice > displayedPrice
      ? Math.round(
          ((displayedComparePrice - displayedPrice) / displayedComparePrice) *
            100,
        )
      : 0;
  /**
   * The nearest branch that can hand this over, for the place in the page's
   * URL — asked from the browser like the quote price, since the rendered page
   * is shared. The per-branch counts behind it never leave the server (see
   * lib/locations/product-collection.ts).
   */
  const collectionOffer = useCollectionOffer(product.slug);
  /**
   * The collection offer, once it is checked against what is actually selected.
   *
   * `variantIds` is `null` for a product with no variants, where the offer
   * stands as given. With variants it lists exactly the ones that branch holds,
   * so switching from a size it stocks to one it does not withdraws the line
   * rather than leaving a promise on screen for a different item.
   */
  const collectionAtBranch =
    collectionOffer &&
    (collectionOffer.variantIds === null ||
      (selectedVariant?._id
        ? collectionOffer.variantIds.includes(String(selectedVariant._id))
        : false))
      ? collectionOffer
      : null;
  const currentStock = selectedVariant?.stock ?? product.stock;
  // What the buyer may actually take: `currentStock` for a tracked product,
  // otherwise the untracked cap (digital downloads, tracking off, or
  // "continue selling when out of stock").
  const availableStock = getPurchasableQuantity(product, currentStock);
  const selectedPreorder = selectedVariant?.preorder?.enabled
    ? selectedVariant.preorder
    : product.preorder;
  const preorderOpen = isPreorderOpen(selectedPreorder, now);
  const preorderPurchase =
    preorderOpen && (selectedPreorder?.preorderOnly || availableStock <= 0);
  const preorderRemaining = getPreorderRemaining(selectedPreorder);
  // Taking pre-orders, but every spot is taken and there is no stock to sell
  // instead — the state this page used to show as a bare "Out of stock", a dead
  // end for a product that may well open up again. It gets a waiting list.
  const preorderFull =
    isPreorderWindowOpen(selectedPreorder, now) &&
    Number.isFinite(preorderRemaining) &&
    preorderRemaining <= 0 &&
    (Boolean(selectedPreorder?.preorderOnly) || availableStock <= 0);
  const maxPurchasableQuantity = preorderPurchase
    ? Math.min(
        UNTRACKED_PURCHASE_CAP,
        Number.isFinite(preorderRemaining)
          ? preorderRemaining
          : UNTRACKED_PURCHASE_CAP,
      )
    : availableStock;
  // In the page's language, not the browser's: the server has no browser
  // locale to format with, and the two disagreeing is a hydration mismatch.
  const preorderDateLabel = formatPreorderReleaseDate(
    selectedPreorder?.releaseDate,
    { locale },
  );
  const preorderTerms = calculatePreorderDueNow({
    unitPrice: selectedVariant?.price ?? product.price,
    quantity,
    settings: selectedPreorder,
  });
  const analyticsItem = useMemo(
    () => ({
      item_id: String(product._id),
      item_name: product.name,
      item_variant: selectedVariant?._id
        ? String(selectedVariant._id)
        : undefined,
      item_category: product.category?.name,
      item_brand: product.brand?.name,
      sku: selectedVariant?.sku || product.sku,
      price: selectedVariant?.price ?? product.price,
      quantity,
    }),
    [
      product._id,
      product.name,
      product.price,
      product.sku,
      product.category?.name,
      product.brand?.name,
      quantity,
      selectedVariant?._id,
      selectedVariant?.price,
      selectedVariant?.sku,
    ],
  );

  useEffect(() => {
    trackProductView({
      currency: currency.code,
      value: selectedVariant?.price ?? product.price,
      items: [analyticsItem],
    });
  }, [analyticsItem, currency.code, product.price, selectedVariant?.price]);

  /**
   * What the shopper is waiting to be told when the purchase controls are
   * shut: which option is still open, or that the combination they built is
   * not sold. Without it a greyed-out Add to cart reads as a broken page.
   */
  const variantChoicePrompt = !awaitingVariantChoice
    ? null
    : unansweredOptions.length > 0
      ? tf("product.selectOptionsFirst", "Please select {options}", {
          options: unansweredOptions
            .map((option) => normalizeOptionLabel(option.name))
            .join(", "),
        })
      : tf(
          "product.variantUnavailable",
          "That combination is not available — please pick another.",
        );

  const cartLine = () => ({
    productId: product._id,
    variantId: selectedVariant?._id,
    name: selectedVariant
      ? `${product.name} - ${selectedVariant.name}`
      : product.name,
    price: quoteOffer?.unitPrice ?? selectedVariant?.price ?? product.price,
    image:
      product.media[selectedImage]?.type === "image"
        ? product.media[selectedImage].url
        : product.previewImage,
    quantity,
  });

  const handleAddToCart = async () => {
    // A quote-only product is buyable only at the lot this shopper was quoted;
    // the server re-reads the offer and prices the line from it either way, so
    // the price passed here is for the optimistic render alone.
    if (quoteOnly && !quotedNow) return;
    // Every purchase control is disabled while this holds, but the guard is
    // here rather than only in the markup: the buy box and the pinned bar
    // both call this, and one of them will be redesigned without the
    // disabled prop.
    if (awaitingVariantChoice) {
      toast.error(
        variantChoicePrompt || tf("product.chooseOptions", "Choose options"),
      );
      return;
    }
    setIsAddingToCart(true);
    try {
      await addItem(cartLine());
      trackAddToCart({
        currency: currency.code,
        value: (selectedVariant?.price ?? product.price) * quantity,
        items: [analyticsItem],
      });
      toast.success(t("cart.itemAdded"));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setIsAddingToCart(false);
    }
  };

  const handleBuyNow = async () => {
    if (quoteOnly && !quotedNow) return;
    if (awaitingVariantChoice) {
      toast.error(
        variantChoicePrompt || tf("product.chooseOptions", "Choose options"),
      );
      return;
    }
    setIsBuyingNow(true);
    try {
      // "Buy Now" goes straight to checkout for this single item, so clear
      // the existing cart when it contains items of a different purchase type
      // (the API rejects mixed standard/pre-order carts).
      const requestedPurchaseType = preorderPurchase ? "preorder" : "standard";
      const hasMixedCart = items.some(
        (item) => (item.purchaseType || "standard") !== requestedPurchaseType,
      );
      if (hasMixedCart) {
        await clearCart();
      }

      await addItem(cartLine());
      trackAddToCart({
        currency: currency.code,
        value: (selectedVariant?.price ?? product.price) * quantity,
        items: [analyticsItem],
      });
      router.push("/checkout");
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t("common.error");
      toast.error(message);
    } finally {
      setIsBuyingNow(false);
    }
  };

  // Shut until the options are answered, like Add to cart: a price is quoted
  // for one variant, and a request with none attached came back as a price
  // the cart could never take.
  const requestQuote = () => {
    if (awaitingVariantChoice) {
      toast.error(
        variantChoicePrompt || tf("product.chooseOptions", "Choose options"),
      );
      return;
    }
    setIsQuoteOpen(true);
  };

  const selectOptionValue = (index: number, value: string) => {
    setSelectedOptions((current) => {
      // One dense slot per option. Spreading the previous array and writing at
      // an index leaves holes when the shopper answers the last option first,
      // and a hole reads back as `undefined` from every check downstream.
      const next = variantOptions.map((_, position) => current[position] ?? "");
      next[index] = value;
      return next;
    });
    setQuantity(1);
  };

  const formatDisplayPrice = (price: number) => {
    if (hasMounted) {
      return formatPrice(price);
    }

    // Keep SSR and first client render deterministic to avoid hydration
    // mismatches. The currency still comes from the store (seeded during render
    // by <CurrencyApplier>, so both passes agree) — pinning it to USD here made
    // every non-dollar store flash a "$" before mount.
    return formatCurrency(price, currency.code, currency.locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const sty = detail.style;
  const buyNowLabel = t.has("common.buyNow")
    ? t("common.buyNow")
    : t.has("product.buyNow")
      ? t("product.buyNow")
      : "Buy now";
  // What the purchase buttons say and when they are shut — one answer for
  // the buy box row and the pinned tab bar. A pre-order keeps its own
  // wording: a custom "Add to bag" would promise stock the product does not
  // have.
  const cartButtonText = preorderPurchase
    ? tf("product.preorderNow", "Pre-order now")
    : sty.cartLabel || t("common.addToCart");
  const buyButtonText = preorderPurchase
    ? tf("product.preorderCheckout", "Pre-order checkout")
    : sty.buyLabel || buyNowLabel;
  const purchaseShut =
    awaitingVariantChoice ||
    maxPurchasableQuantity <= 0 ||
    isAddingToCart ||
    isBuyingNow;

  return {
    product,
    locale,
    detail,
    fulfillment: fulfillment ?? null,
    finalSale: finalSale ?? null,
    t,
    tf,
    formatPrice,
    formatDisplayPrice,
    signedInEmail: authSession?.user?.email || undefined,

    selectedImage,
    setSelectedImage,
    quantity,
    setQuantity,
    selectedOptions,
    selectOptionValue,
    selectedVariant,
    unansweredOptions,
    awaitingVariantChoice,
    variantChoicePrompt,

    quoteOnly,
    quoteOffer,
    quotedNow,
    quoteButtonText: getQuoteButtonLabel(
      product,
      tf("product.requestQuote", "Request a quote"),
    ),
    requestQuote,

    displayedPrice,
    displayedComparePrice,
    discountPercentage,
    collectionAtBranch,
    currentStock,
    availableStock,
    preorderPurchase,
    preorderFull,
    preorderRemaining,
    preorderDateLabel,
    preorderTerms,
    maxPurchasableQuantity,

    cartButtonText,
    buyButtonText,
    purchaseShut,
    isAddingToCart,
    handleAddToCart,
    handleBuyNow,

    isSizeGuideOpen,
    setIsSizeGuideOpen,
    isQuoteOpen,
    setIsQuoteOpen,
  };
}

type ProductPurchase = ReturnType<typeof useProductPurchaseState>;

const ProductPurchaseContext = createContext<ProductPurchase | null>(null);

/** The purchase state, for a control inside ProductPurchaseProvider. */
export function useProductPurchase(): ProductPurchase {
  const purchase = useContext(ProductPurchaseContext);
  if (!purchase) {
    throw new Error("useProductPurchase needs a ProductPurchaseProvider");
  }
  return purchase;
}

interface ProductPurchaseProviderProps {
  product: PurchaseProduct;
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
  /** The section's Visibility + Style settings, parsed on the server. */
  detail: ProductDetailConfig;
  children: ReactNode;
}

/**
 * What the shopper has chosen on the product page — options, quantity, the
 * picture in view — and everything that follows from it: the variant, its
 * price and stock, the pre-order terms, the cart actions.
 *
 * The page itself is drawn on the server (components/products/product-
 * details.tsx); the controls inside it that answer to the shopper read this
 * through `useProductPurchase`. The dialogs they open are mounted here, once.
 */
export function ProductPurchaseProvider({
  children,
  ...props
}: ProductPurchaseProviderProps) {
  const purchase = useProductPurchaseState(props);
  const { product, selectedVariant, quantity } = purchase;

  return (
    <ProductPurchaseContext.Provider value={purchase}>
      {children}

      {purchase.isSizeGuideOpen && (
        <ProductSizeGuide
          product={product}
          onClose={() => purchase.setIsSizeGuideOpen(false)}
        />
      )}

      {/* The buy box's quote button and the pinned bar's drive the same
          dialog. */}
      {purchase.quoteOnly ? (
        <QuoteRequestDialog
          open={purchase.isQuoteOpen}
          onOpenChange={purchase.setIsQuoteOpen}
          target={{
            productId: product._id,
            productName: product.name,
            variantId: selectedVariant?._id,
            variantName: selectedVariant?.name,
            quantity,
          }}
        />
      ) : null}
    </ProductPurchaseContext.Provider>
  );
}
