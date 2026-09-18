"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Heart,
  X,
  Loader2,
  ShoppingCart,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ImageIcon,
  Minus,
  Plus,
  Zap,
} from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { ExternalVideoPlayer } from "@/components/products/external-video-player";
import { ModelViewer } from "@/components/ui/model-viewer";
import { useCurrency } from "@/providers/currency-provider";
import { useCart } from "@/hooks/use-cart";
import { useWishlist } from "@/hooks/use-wishlist";
import { useAuth } from "@/hooks/use-auth";
import { useMultiVendorMode } from "@/providers/app-settings-provider";
import { toast } from "@/components/ui/toast-notification";
import { type Locale } from "@/config/i18n.config";
import { cn } from "@/lib/utils";
import { buildLoginUrl, currentBrowserPath } from "@/lib/auth/return-path";
import type { ModernProduct } from "@/lib/products/modern-product";
import { OptionValueSelector } from "./option-value-selector";
import {
  UNTRACKED_PURCHASE_CAP,
  getPurchasableQuantity,
} from "@/lib/products/stock-policy";
import {
  getQuoteButtonLabel,
  isQuoteOnlyProduct,
} from "@/lib/products/quote-pricing";
import { trackAddToCart } from "@/lib/analytics/events";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { NumberInput } from "@/components/ui/number-input";

// ============================================
// Types
// ============================================

type VariantOptionValue =
  | string
  | { optionId?: string; optionName?: string; valueId?: string; value: string };

type ProductPreorder = {
  enabled?: boolean;
  releaseDate?: string | Date | null;
  message?: string | null;
  limit?: number | null;
  reservedQuantity?: number | null;
  preorderOnly?: boolean;
  autoConvert?: boolean;
  paymentMode?: "full" | "deposit" | "pay_later";
  depositType?: "percentage" | "fixed";
  depositValue?: number | null;
  batchName?: string | null;
};

interface ProductVariant {
  _id: string;
  sku?: string;
  price?: number;
  comparePrice?: number;
  stock?: number;
  preorder?: ProductPreorder;
  image?: string;
  mediaId?: string;
  optionValues?: VariantOptionValue[];
}

interface ProductMedia {
  _id: string;
  url: string;
  type?: "image" | "video" | "model" | "external_video" | string;
  alt?: string;
  position?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  provider?: "youtube" | "vimeo";
  embedId?: string;
}

type QuickViewMediaKind = "image" | "video" | "model" | "external_video";

type QuickViewMedia = {
  type: QuickViewMediaKind;
  url: string;
  alt?: string;
  thumbnailUrl?: string;
  provider?: "youtube" | "vimeo";
  embedId?: string;
};

interface ProductOption {
  name: string;
  visual?: string;
  values: { _id: string; value: string; colorCode?: string; image?: string }[];
}

// ============================================
// Utility Functions
// ============================================

function findVariant(
  variants: ProductVariant[] | undefined,
  selectedOptions: Record<string, string>
): ProductVariant | undefined {
  if (!variants?.length) return undefined;

  const selected = Object.entries(selectedOptions).filter(([, value]) => value);
  if (selected.length === 0) return undefined;

  return variants.find((v) => {
    const optionValues = v.optionValues;
    if (!Array.isArray(optionValues) || optionValues.length === 0) return false;

    return selected.every(([optionName, value]) =>
      optionValues.some((ov) => {
        const ovName = typeof ov === "string" ? "" : ov.optionName || "";
        const ovValue = typeof ov === "string" ? ov : ov.value || "";
        const nameMatches = ovName
          ? ovName.toLowerCase() === optionName.toLowerCase()
          : true;
        return nameMatches && ovValue.toLowerCase() === value.toLowerCase();
      })
    );
  });
}

function inferMediaType(media: {
  type?: string;
  mimeType?: string;
  url: string;
}): QuickViewMediaKind {
  const declaredType = media.type?.toLowerCase();
  if (
    declaredType === "model" ||
    declaredType === "video" ||
    declaredType === "external_video"
  ) {
    return declaredType;
  }

  const mimeType = media.mimeType?.toLowerCase();
  if (mimeType?.startsWith("model/")) return "model";
  if (mimeType?.startsWith("video/")) return "video";

  const url = media.url.toLowerCase().split("?")[0] || "";
  if (
    url.endsWith(".glb") ||
    url.endsWith(".gltf") ||
    url.endsWith(".usdz")
  ) {
    return "model";
  }
  if (
    url.endsWith(".mp4") ||
    url.endsWith(".webm") ||
    url.endsWith(".mov") ||
    url.endsWith(".m4v")
  ) {
    return "video";
  }

  return "image";
}

function getCurrentMedia({
  currentVariant,
  media,
  images,
  productName,
}: {
  currentVariant?: ProductVariant;
  media?: ProductMedia[];
  images: string[];
  productName: string;
}): QuickViewMedia | null {
  if (currentVariant?.image) {
    return {
      type: "image",
      url: currentVariant.image,
      alt: productName,
    };
  }

  const variantMedia =
    currentVariant?.mediaId && Array.isArray(media)
      ? media.find((item) => item._id === currentVariant.mediaId)
      : undefined;

  const selectedMedia =
    variantMedia ||
    (Array.isArray(media)
      ? [...media]
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .find((item) => item.url)
      : undefined);

  if (selectedMedia) {
    return {
      type: inferMediaType(selectedMedia),
      url: selectedMedia.url,
      alt: selectedMedia.alt || productName,
      thumbnailUrl: selectedMedia.thumbnailUrl,
      provider: selectedMedia.provider,
      embedId: selectedMedia.embedId,
    };
  }

  const image = images.find(Boolean);
  return image
    ? {
        type: "image",
        url: image,
        alt: productName,
      }
    : null;
}

function getPreorderRemaining(preorder?: ProductPreorder) {
  const limit = Number(preorder?.limit || 0);
  if (!Number.isFinite(limit) || limit <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, limit - Number(preorder?.reservedQuantity || 0));
}

function isPreorderOpen(preorder?: ProductPreorder) {
  if (!preorder?.enabled) return false;
  const releaseDate = preorder.releaseDate
    ? new Date(preorder.releaseDate)
    : null;

  if (
    preorder.autoConvert !== false &&
    releaseDate &&
    !Number.isNaN(releaseDate.getTime()) &&
    releaseDate.getTime() < Date.now()
  ) {
    return false;
  }

  return getPreorderRemaining(preorder) > 0;
}

function formatPreorderDate(value?: ProductPreorder["releaseDate"]) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function calculatePreorderDueNow(params: {
  unitPrice: number;
  quantity: number;
  settings?: ProductPreorder;
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

// ============================================
// Props
// ============================================

interface ProductQuickViewModalProps {
  product: ModernProduct | null;
  locale: Locale;
  open: boolean;
  onClose: () => void;
}

// ============================================
// Component
// ============================================

export function ProductQuickViewModal({
  product,
  locale,
  open,
  onClose,
}: ProductQuickViewModalProps) {
  const t = useTranslations();
  const router = useRouter();
  const { currency, formatPrice } = useCurrency();
  const { addItem } = useCart();
  const { isInWishlist, addToWishlist, removeFromWishlist } = useWishlist();
  const { isAuthenticated } = useAuth();
  const { isMultiVendor } = useMultiVendorMode();
  const tf = useFallbackTranslator(t);

  const modalRef = useRef<HTMLDivElement>(null);
  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [isBuyingNow, setIsBuyingNow] = useState(false);
  const [isTogglingWishlist, setIsTogglingWishlist] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isModelInteractive, setIsModelInteractive] = useState(false);
  const productId = product?._id;

  // Animation handling
  useEffect(() => {
    let frame: number | undefined;

    if (open) {
      frame = requestAnimationFrame(() => {
        setIsVisible(true);
      });
      document.body.style.overflow = "hidden";
    } else {
      frame = requestAnimationFrame(() => {
        setIsVisible(false);
      });
      document.body.style.overflow = "";
    }

    return () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      document.body.style.overflow = "";
    };
  }, [open]);

  // Reset state when product changes
  useEffect(() => {
    if (!productId) return;

    const frame = requestAnimationFrame(() => {
      setQuantity(1);
      setSelectedOptions({});
      setIsModelInteractive(false);
    });

    return () => cancelAnimationFrame(frame);
  }, [productId]);

  // Keyboard handler (ESC to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Click outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!open || !product) return null;

  const inWishlist = isInWishlist(product._id);
  const images = product.images || [];
  const options = (product.options || []) as ProductOption[];
  const variants = product.variants as ProductVariant[] | undefined;

  // Find current variant based on selections
  const currentVariant = findVariant(variants, selectedOptions);

  const media = (product as unknown as { media?: ProductMedia[] }).media;
  const currentMedia = getCurrentMedia({
    currentVariant,
    media,
    images,
    productName: product.name,
  });
  const currentImage =
    currentMedia?.type === "image"
      ? currentMedia.url
      : currentMedia?.thumbnailUrl || images[0];

  // Get current price and stock
  const currentPrice = currentVariant?.price ?? product.price;
  const currentComparePrice = currentVariant?.comparePrice ?? product.comparePrice;
  const currentStock = currentVariant?.stock ?? product.stock;
  // Digital / untracked products aren't limited by `stock` — same rule as the
  // full product page and the cart guard.
  const availableStock = getPurchasableQuantity(product, currentStock);
  const selectedPreorder = currentVariant?.preorder?.enabled
    ? currentVariant.preorder
    : product.preorder;
  const preorderAvailable =
    isPreorderOpen(selectedPreorder) &&
    (selectedPreorder?.preorderOnly || availableStock <= 0);
  const preorderRemaining = getPreorderRemaining(selectedPreorder);
  const maxPurchasableQuantity = preorderAvailable
    ? Math.min(
        UNTRACKED_PURCHASE_CAP,
        Number.isFinite(preorderRemaining)
          ? preorderRemaining
          : UNTRACKED_PURCHASE_CAP,
      )
    : availableStock;
  const isUnavailable = availableStock === 0 && !preorderAvailable;
  const preorderDateLabel = formatPreorderDate(selectedPreorder?.releaseDate);
  const preorderLimit = Number(selectedPreorder?.limit || 0);
  const preorderReserved = Math.max(
    0,
    Number(selectedPreorder?.reservedQuantity || 0),
  );
  const preorderTerms = calculatePreorderDueNow({
    unitPrice: currentPrice,
    quantity,
    settings: selectedPreorder,
  });

  /**
   * Sold by quote: no price to print and nothing to add to a cart. The modal
   * does not host the request form itself — a dialog inside a dialog is a
   * focus-trap fight nobody wins — it sends the shopper to the product page,
   * which is where the form lives.
   */
  const quoteOnly = isQuoteOnlyProduct(product);
  const quoteButtonText = getQuoteButtonLabel(
    product,
    tf("product.requestQuote", "Request a quote"),
  );
  const openQuoteOnProductPage = () => {
    onClose();
    router.push(`/${locale}/products/${product.slug}`);
  };

  // Calculate discount percentage
  const discountPercentage =
    !quoteOnly && currentComparePrice && currentComparePrice > currentPrice
      ? Math.round(((currentComparePrice - currentPrice) / currentComparePrice) * 100)
      : 0;

  // Get category from product
  const category =
    isMultiVendor && product.vendorId?.storeName
      ? product.vendorId.storeName
      : t("product.category");

  const handleQuantityChange = (delta: number) => {
    setQuantity((prev) => {
      const newValue = prev + delta;
      if (newValue < 1) return 1;
      if (newValue > maxPurchasableQuantity) return maxPurchasableQuantity;
      return newValue;
    });
  };

  const handleOptionSelect = (optionName: string, value: string) => {
    setSelectedOptions((prev) => ({
      ...prev,
      [optionName]: value,
    }));
  };

  const handleAddToCart = async () => {
    if (isUnavailable || isAddingToCart) return;

    setIsAddingToCart(true);
    try {
      await addItem({
        productId: product._id,
        name: product.name,
        price: currentPrice,
        image: currentImage,
        quantity,
        variantId: currentVariant?._id,
      });
      trackAddToCart({
        currency: currency.code,
        value: currentPrice * quantity,
        items: [
          {
            item_id: String(product._id),
            item_name: product.name,
            item_variant: currentVariant?._id,
            sku: currentVariant?.sku,
            price: currentPrice,
            quantity,
          },
        ],
      });
      toast.success(t("cart.itemAdded"));
      onClose();
    } catch {
      toast.error(t("common.error"));
    } finally {
      setIsAddingToCart(false);
    }
  };

  const handleBuyNow = async () => {
    if (isUnavailable || isBuyingNow) return;

    setIsBuyingNow(true);
    try {
      await addItem({
        productId: product._id,
        name: product.name,
        price: currentPrice,
        image: currentImage,
        quantity,
        variantId: currentVariant?._id,
      });
      trackAddToCart({
        currency: currency.code,
        value: currentPrice * quantity,
        items: [
          {
            item_id: String(product._id),
            item_name: product.name,
            item_variant: currentVariant?._id,
            sku: currentVariant?.sku,
            price: currentPrice,
            quantity,
          },
        ],
      });
      onClose();
      router.push(`/${locale}/checkout`);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setIsBuyingNow(false);
    }
  };

  const handleWishlistToggle = async () => {
    if (isTogglingWishlist) return;

    // Sign in and come back to this page — the tap didn't save the item, so
    // an empty wishlist page would be a dead end.
    if (!isAuthenticated) {
      router.push(buildLoginUrl(locale, currentBrowserPath()));
      onClose();
      return;
    }

    setIsTogglingWishlist(true);
    try {
      if (inWishlist) {
        const success = await removeFromWishlist(product._id);
        if (success) {
          toast.success(t("wishlist.removed"));
        }
      } else {
        const success = await addToWishlist(product._id);
        if (success) {
          toast.success(t("wishlist.added"));
        }
      }
    } catch {
      toast.error(t("common.error"));
    } finally {
      setIsTogglingWishlist(false);
    }
  };

  // Render a product option's value chooser according to its `visual`
  // (falls back to name-based detection for legacy options).
  const renderOption = (option: ProductOption) => {
    const selectedValue = selectedOptions[option.name];

    return (
      <div key={option.name} className="mb-2 sm:mb-5">
        <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-foreground sm:mb-3 sm:gap-2 sm:text-sm">
          <span>{option.name}:</span>
          {selectedValue && (
            <span className="font-normal text-muted-foreground">{selectedValue}</span>
          )}
        </label>
        <div className="mt-1.5 sm:mt-2">
          <OptionValueSelector
            option={option}
            selectedValue={selectedValue}
            onSelect={(value) => handleOptionSelect(option.name, value)}
            size="sm"
          />
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        // z-[60]: above the AI sales agent's z-50 floating bubble — at z-50 the
        // bubble painted over the sheet's quantity + Buy Now corner — and
        // below the cart drawer's z-[80]/z-[90] sheet layer.
        "fixed inset-0 z-[60] flex items-end justify-center transition-all duration-300 sm:items-center sm:p-4",
        isVisible ? "bg-black/50 backdrop-blur-sm" : "bg-transparent"
      )}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-view-title"
    >
      {/* Phones (< sm): a bottom-sheet variant picker, not a shrunken desktop
          modal. Identity compresses into a thumbnail header row (no empty
          media band), colour options render swatch-only with the selected
          name in the caption — the admin's "color with label" pills stay a
          product-page treatment — and both CTAs share one row in the thumb
          zone. Closes from the backdrop or ESC, like the card. */}
      <div
        className={cn(
          "max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-background pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-300 sm:hidden",
          isVisible ? "translate-y-0" : "translate-y-full"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-muted-foreground/25" />

        {/* Media leads, full-width and tall enough to recognise the product —
            contain, not cover, so tall items (dresses, phones) aren't
            cropped. Tapping it opens the product page. */}
        <div className="relative mt-2">
          <Link
            href={`/${locale}/products/${product.slug}`}
            onClick={onClose}
            className="relative block h-48 w-full bg-muted/30"
          >
            {currentImage ? (
              <AppImage
                src={currentImage}
                alt={product.name}
                fill
                className="object-contain p-3"
                sizes="(max-width: 640px) 100vw, 400px"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                <ImageIcon className="h-8 w-8" />
              </span>
            )}
          </Link>
          <button
            onClick={handleWishlistToggle}
            disabled={isTogglingWishlist}
            className={cn(
              "absolute right-3 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-colors",
              inWishlist
                ? "border-red-200 bg-red-50 text-red-500 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300"
                : "border-border/60 bg-background/85 text-muted-foreground backdrop-blur hover:text-foreground"
            )}
            aria-label={
              inWishlist
                ? t("wishlist.removeFromWishlist")
                : t("wishlist.addToWishlist")
            }
          >
            {isTogglingWishlist ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Heart
                className={cn(
                  "h-4 w-4",
                  inWishlist && "fill-red-500 text-red-500"
                )}
              />
            )}
          </button>
        </div>

        <div className="px-4 pb-4 pt-3">
          {/* Identity on its own lines under the media. The discount stays a
              chip beside the price instead of a badge floating on the image. */}
          <p className="text-[11px] text-muted-foreground">{category}</p>
          <h2 className="line-clamp-2 text-base font-semibold leading-snug text-foreground">
            {product.name}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {quoteOnly ? (
              <span className="text-lg font-bold leading-none text-foreground">
                {tf("product.priceOnRequest", "Price on request")}
              </span>
            ) : (
              <>
                <span className="text-lg font-bold leading-none text-orange-500">
                  {formatPrice(currentPrice)}
                </span>
                {currentComparePrice && currentComparePrice > currentPrice && (
                  <>
                    <span className="text-xs text-muted-foreground line-through">
                      {formatPrice(currentComparePrice)}
                    </span>
                    <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                      -{discountPercentage}%
                    </span>
                  </>
                )}
              </>
            )}
          </div>

          {/* Options — the caption carries the selected value so the swatches
              can stay label-free. */}
          {options.map((option) => {
            const selectedValue = selectedOptions[option.name];
            return (
              <div key={option.name} className="mt-3 border-t pt-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {option.name}
                  {selectedValue && (
                    <span className="font-semibold normal-case tracking-normal text-foreground">
                      {" "}
                      · {selectedValue}
                    </span>
                  )}
                </p>
                <div className="mt-2">
                  <OptionValueSelector
                    option={option}
                    selectedValue={selectedValue}
                    onSelect={(value) =>
                      handleOptionSelect(option.name, value)
                    }
                    size="xs"
                    colorSwatchesOnly
                  />
                </div>
              </div>
            );
          })}

          {/* Quantity */}
          <div className="mt-3 flex items-center justify-between border-t pt-2.5">
            <span className="text-xs font-semibold">
              {t("common.quantity")}
            </span>
            <div className="flex h-8 items-center rounded-full border">
              <button
                onClick={() => handleQuantityChange(-1)}
                disabled={quantity <= 1}
                className="flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Decrease quantity"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <NumberInput
                value={quantity}
                min={1}
                max={maxPurchasableQuantity}
                step={1}
                whenEmpty="keep"
                normalize={Math.trunc}
                onValueChange={(next) => {
                  if (next !== undefined) setQuantity(next);
                }}
                className="h-full w-8 rounded-none border-0 bg-transparent p-0 text-center text-[13px] font-semibold shadow-none focus-visible:ring-0 dark:bg-transparent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label={t("common.quantity")}
              />
              <button
                onClick={() => handleQuantityChange(1)}
                disabled={quantity >= maxPurchasableQuantity}
                className="flex h-full w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Increase quantity"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Pre-order / low stock — same slot as the card, above the CTAs. */}
          {preorderAvailable && (
            <div className="mt-2.5 space-y-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 text-[11px] text-blue-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {preorderDateLabel
                    ? `Ships ${preorderDateLabel}`
                    : tf("product.preorder", "Pre-order")}
                </span>
                {Number.isFinite(preorderRemaining) ? (
                  <span>{Math.max(0, preorderRemaining)} left</span>
                ) : null}
              </div>
              {preorderLimit > 0 ? (
                <p>
                  {preorderReserved} of {preorderLimit} reservations claimed
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2 rounded-md bg-white/70 p-2">
                <span>Due today {formatPrice(preorderTerms.dueNow)}</span>
                <span>Later {formatPrice(preorderTerms.dueLater)}</span>
                {/* "Due today" covers the item alone — checkout still charges
                    shipping and tax. See the note in product-details. */}
                {preorderTerms.dueLater > 0 ? (
                  <span className="col-span-2 opacity-80">
                    {tf(
                      "product.preorderShippingAtCheckout",
                      "Shipping and tax are charged at checkout.",
                    )}
                  </span>
                ) : null}
              </div>
            </div>
          )}
          {!preorderAvailable && currentStock > 0 && currentStock <= 10 && (
            <p className="mt-2.5 text-[11px] text-orange-500">
              {t("product.lowStock", {
                count: currentStock,
                defaultMessage: `Only ${currentStock} left in stock`,
              })}
            </p>
          )}

          {/* One decision row: both CTAs filled, Buy Now as the primary. */}
          <div className="mt-3 flex gap-2.5">
            {quoteOnly ? (
              <button
                onClick={openQuoteOnProductPage}
                data-slot="button"
                className="flex h-9 flex-1 items-center justify-center gap-1.5 bg-foreground px-2 text-xs font-semibold text-background transition-all hover:bg-foreground/90"
              >
                {quoteButtonText}
              </button>
            ) : (
              <>
            <button
              onClick={handleAddToCart}
              disabled={isUnavailable || isAddingToCart}
              data-slot="button"
              className={cn(
                "flex h-9 flex-1 items-center justify-center gap-1.5 px-2 text-xs font-semibold transition-all",
                isUnavailable
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-foreground text-background hover:bg-foreground/90"
              )}
            >
              {isAddingToCart ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShoppingCart className="h-3.5 w-3.5" />
              )}
              {preorderAvailable
                ? tf("product.preorderNow", "Pre-order now")
                : isUnavailable
                ? t("common.outOfStock")
                : t("common.addToCart")}
            </button>
            <button
              onClick={handleBuyNow}
              disabled={isUnavailable || isBuyingNow}
              data-slot="button"
              className={cn(
                "flex h-9 flex-1 items-center justify-center gap-1.5 px-2 text-xs font-semibold transition-all",
                isUnavailable
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {isBuyingNow ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              {preorderAvailable
                ? tf("product.preorderCheckout", "Pre-order checkout")
                : t("common.buyNow")}
            </button>
              </>
            )}
          </div>

          <Link
            href={`/${locale}/products/${product.slug}`}
            onClick={onClose}
            className="mt-2.5 flex items-center justify-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            {t("product.viewFullDetails")}
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div
        ref={modalRef}
        className={cn(
          "relative hidden max-h-[calc(100dvh-1rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-background shadow-2xl transition-all duration-300 sm:block md:max-w-5xl md:overflow-hidden",
          isVisible
            ? "opacity-100 scale-100 translate-y-0"
            : "opacity-0 scale-95 translate-y-4"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:bg-background hover:text-foreground sm:right-4 sm:top-4 sm:h-8 sm:w-8"
          aria-label={t("common.close")}
        >
          <X className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        </button>

        <div className="grid md:grid-cols-2">
          {/* Left: Product Media - Full Width */}
          <div className="relative h-[10.25rem] min-h-0 bg-muted/10 sm:h-72 md:h-full md:min-h-[500px]">
            {currentMedia?.type === "model" ? (
              <div
                className="h-full w-full"
                onMouseEnter={() => setIsModelInteractive(true)}
                onMouseLeave={() => setIsModelInteractive(false)}
                onFocus={() => setIsModelInteractive(true)}
                onBlur={() => setIsModelInteractive(false)}
              >
                <ModelViewer
                  src={currentMedia.url}
                  alt={currentMedia.alt || product.name}
                  autoRotate={!isModelInteractive}
                  cameraControls={isModelInteractive}
                  loading="lazy"
                  preferProxy
                  poster={currentMedia.thumbnailUrl}
                />
              </div>
            ) : currentMedia?.type === "external_video" &&
              currentMedia.provider &&
              currentMedia.embedId ? (
              <ExternalVideoPlayer
                key={currentMedia.url}
                provider={currentMedia.provider}
                embedId={currentMedia.embedId}
                title={currentMedia.alt || product.name}
                thumbnailUrl={currentMedia.thumbnailUrl}
              />
            ) : currentMedia?.type === "video" ? (
              <video
                src={currentMedia.url}
                poster={currentMedia.thumbnailUrl}
                controls
                playsInline
                className="h-full w-full object-cover"
              />
            ) : currentMedia?.url ? (
              <AppImage
                src={currentMedia.url}
                alt={currentMedia.alt || product.name}
                fill
                className="object-contain p-3 sm:p-5 md:p-0 md:object-cover"
                sizes="(max-width: 640px) 350px, (max-width: 768px) 448px, 50vw"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                {t("common.noImage")}
              </div>
            )}

            {/* Discount Badge - Top Left */}
            {discountPercentage > 0 && (
              <div className="absolute left-3 top-3 sm:left-4 sm:top-4">
                <span className="inline-flex items-center rounded-full bg-destructive px-2 py-0.5 text-[10px] font-medium text-white sm:px-2.5 sm:py-1 sm:text-xs">
                  -{discountPercentage}%
                </span>
              </div>
            )}

            {/* Wishlist Button - Top Right on Image */}
            <button
              onClick={handleWishlistToggle}
              disabled={isTogglingWishlist}
              className={cn(
                "absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full shadow-sm transition-all sm:right-4 sm:top-4 sm:h-10 sm:w-10",
                inWishlist
                  ? "bg-red-100 text-red-500 dark:bg-red-500/20 dark:text-red-300"
                  : "bg-background/85 text-muted-foreground hover:bg-background hover:text-foreground backdrop-blur border border-border/60"
              )}
              aria-label={
                inWishlist
                  ? t("wishlist.removeFromWishlist")
                  : t("wishlist.addToWishlist")
              }
            >
              {isTogglingWishlist ? (
                <Loader2 className="h-4 w-4 animate-spin sm:h-5 sm:w-5" />
              ) : (
                <Heart
                  className={cn("h-4 w-4 sm:h-5 sm:w-5", inWishlist && "fill-red-500 text-red-500")}
                />
              )}
            </button>
          </div>

          {/* Right: Product Details */}
          <div className="flex max-h-none flex-col overflow-visible p-3 sm:p-6 md:max-h-none md:overflow-visible md:p-8">
            {/* Category */}
            <p className="mb-0.5 text-[11px] text-muted-foreground sm:mb-1 sm:text-sm">{category}</p>

            {/* Product Name */}
            <h2
              id="quick-view-title"
              className="mb-2 text-[13px] font-semibold leading-snug text-foreground sm:text-xl md:mb-4 md:text-2xl"
            >
              {product.name}
            </h2>

            {/* Price */}
            <div className="mb-3 flex items-baseline gap-2 sm:mb-6 sm:gap-3">
              {quoteOnly ? (
                <span className="text-base font-bold text-foreground sm:text-xl">
                  {tf("product.priceOnRequest", "Price on request")}
                </span>
              ) : (
                <>
                  {currentComparePrice && currentComparePrice > currentPrice && (
                    <span className="text-sm text-muted-foreground line-through sm:text-base">
                      {formatPrice(currentComparePrice)}
                    </span>
                  )}
                  <span className="text-base font-bold text-orange-500 sm:text-xl">
                    {formatPrice(currentPrice)}
                  </span>
                </>
              )}
            </div>

            {/* Product Options */}
            <div className="flex-1">
              {options.map((option) => renderOption(option))}
            </div>

            {/* Quantity and Actions */}
            <div className="mt-2 space-y-2 border-t pt-2.5 sm:mt-4 sm:space-y-3 sm:pt-4">
              {quoteOnly ? (
                <button
                  onClick={openQuoteOnProductPage}
                  data-slot="button"
                  className="flex h-8 w-full items-center justify-center gap-1.5 bg-foreground px-3 text-[11px] font-medium text-background transition-all hover:bg-foreground/90 sm:h-11 sm:gap-2 sm:px-6 sm:text-sm"
                >
                  {quoteButtonText}
                </button>
              ) : (
                <>
              {/* First Row: Quantity + Add to Cart */}
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Quantity Selector */}
                <div className="flex items-center border rounded-button overflow-hidden bg-background">
                  <NumberInput
                    value={quantity}
                    min={1}
                    max={maxPurchasableQuantity}
                    step={1}
                    whenEmpty="keep"
                    normalize={Math.trunc}
                    onValueChange={(next) => {
                      if (next !== undefined) setQuantity(next);
                    }}
                    className="h-8 w-9 rounded-none border-0 bg-transparent p-0 text-center text-[11px] font-medium shadow-none focus-visible:ring-0 dark:bg-transparent [appearance:textfield] sm:h-11 sm:w-12 sm:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label={t("common.quantity")}
                  />
                  <div className="flex flex-col border-l">
                    <button
                      onClick={() => handleQuantityChange(1)}
                      disabled={quantity >= maxPurchasableQuantity}
                      className="flex h-4 w-6 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-[22px] sm:w-8"
                      aria-label="Increase quantity"
                    >
                      <ChevronUp className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    </button>
                    <button
                      onClick={() => handleQuantityChange(-1)}
                      disabled={quantity <= 1}
                      className="flex h-4 w-6 items-center justify-center border-t text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:h-[22px] sm:w-8"
                      aria-label="Decrease quantity"
                    >
                      <ChevronDown className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    </button>
                  </div>
                </div>

                {/* Add to Cart Button */}
                <button
                  onClick={handleAddToCart}
                  disabled={isUnavailable || isAddingToCart}
                  data-slot="button"
                  className={cn(
                    "flex h-8 flex-1 items-center justify-center gap-1.5 px-3 text-[11px] font-medium transition-all sm:h-11 sm:gap-2 sm:px-6 sm:text-sm",
                    isUnavailable
                      ? "bg-muted text-muted-foreground cursor-not-allowed"
                      : "bg-foreground text-background hover:bg-foreground/90"
                  )}
                >
                  {isAddingToCart ? (
                    <Loader2 className="h-3 w-3 animate-spin sm:h-4 sm:w-4" />
                  ) : (
                    <ShoppingCart className="h-3 w-3 sm:h-4 sm:w-4" />
                  )}
                  {preorderAvailable
                    ? tf("product.preorderNow", "Pre-order now")
                    : isUnavailable
                    ? t("common.outOfStock")
                    : t("common.addToCart")}
                </button>
              </div>

              {/* Second Row: Buy Now Button */}
              <button
                onClick={handleBuyNow}
                disabled={isUnavailable || isBuyingNow}
                data-slot="button"
                className={cn(
                  "flex h-8 w-full items-center justify-center gap-1.5 px-3 text-[11px] font-medium transition-all sm:h-11 sm:gap-2 sm:px-6 sm:text-sm",
                  isUnavailable
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {isBuyingNow ? (
                  <Loader2 className="h-3 w-3 animate-spin sm:h-4 sm:w-4" />
                ) : (
                  <Zap className="h-3 w-3 sm:h-4 sm:w-4" />
                )}
                {preorderAvailable
                  ? tf("product.preorderCheckout", "Pre-order checkout")
                  : t("common.buyNow")}
              </button>
                </>
              )}

              {/* Stock Info - reserved height to keep layout stable */}
              <div className="min-h-3">
                {preorderAvailable && (
                  <div className="space-y-2 rounded-md border border-blue-200 bg-blue-50 p-2.5 text-[11px] text-blue-800 sm:p-3 sm:text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {preorderDateLabel
                          ? `Ships ${preorderDateLabel}`
                          : tf("product.preorder", "Pre-order")}
                      </span>
                      {Number.isFinite(preorderRemaining) ? (
                        <span>{Math.max(0, preorderRemaining)} left</span>
                      ) : null}
                    </div>
                    {preorderLimit > 0 ? (
                      <p>
                        {preorderReserved} of {preorderLimit} reservations claimed
                      </p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2 rounded-md bg-white/70 p-2">
                      <span>Due today {formatPrice(preorderTerms.dueNow)}</span>
                      <span>Later {formatPrice(preorderTerms.dueLater)}</span>
                      {preorderTerms.dueLater > 0 ? (
                        <span className="col-span-2 opacity-80">
                          {tf(
                            "product.preorderShippingAtCheckout",
                            "Shipping and tax are charged at checkout.",
                          )}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
                {!preorderAvailable && currentStock > 0 && currentStock <= 10 && (
                  <p className="text-[11px] text-orange-500 sm:text-xs">
                    {t("product.lowStock", {
                      count: currentStock,
                      defaultMessage: `Only ${currentStock} left in stock`,
                    })}
                  </p>
                )}
              </div>

              {/* View Full Details Link */}
              <Link
                href={`/${locale}/products/${product.slug}`}
                onClick={onClose}
                className="block pt-0.5 text-center text-[11px] text-primary hover:underline sm:pt-1 sm:text-sm"
              >
                {t("product.viewFullDetails")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
