"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { X, ShoppingBag, Loader2, ArrowRight, Minus, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AppImage } from "@/components/ui/app-image";
import { useCurrency } from "@/providers/currency-provider";
import { useCart } from "@/hooks/use-cart";
import { useFreeShippingConfig } from "@/hooks/use-free-shipping-config";
import { FreeShippingProgress } from "@/components/cart/free-shipping-progress";
import { groupCartItemsBySeller } from "@/lib/cart/cart-sellers";
import type { CartItem } from "@/types";
import { toast } from "@/components/ui/toast-notification";
import { type Locale } from "@/config/i18n.config";
import { analyticsItemsFromCart, trackCartView } from "@/lib/analytics/events";

interface CartDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
}

function formatPreorderDate(value?: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getPreorderPaymentLabel(item: {
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
}) {
  const dueNow = Number(item.preorderDepositAmount || 0);
  const dueLater = Number(item.preorderOutstandingAmount || 0);
  if (dueLater <= 0) return "";
  return { dueNow, dueLater };
}

export function CartDrawer({ open, onOpenChange, locale }: CartDrawerProps) {
  const t = useTranslations();
  const { currency, formatPrice } = useCurrency();
  const {
    items,
    subtotal,
    isLoading,
    hasShippableItems,
    updateItem,
    removeItem,
  } = useCart();
  // Only fetched once the bag is actually open.
  const freeShippingConfig = useFreeShippingConfig(open);

  // Grouped only when the bag actually holds more than one seller — on a
  // single-seller cart the header is noise on every line.
  const sellerGroups = useMemo(
    () =>
      groupCartItemsBySeller(
        items,
        t.has("cart.unknownSeller") ? t("cart.unknownSeller") : "Another seller",
      ),
    [items, t],
  );
  const [removingItems, setRemovingItems] = useState<Set<string>>(new Set());
  const cartViewSignature = useMemo(
    () =>
      items
        .map(
          (item) =>
            `${String(item.productId)}:${String(item.variantId || "")}:${
              item.quantity
            }`,
        )
        .join("|"),
    [items],
  );

  useEffect(() => {
    if (!open || !items.length || !cartViewSignature) return;

    trackCartView({
      currency: currency.code,
      value: subtotal,
      items: analyticsItemsFromCart(items),
    });
  }, [cartViewSignature, currency.code, items, open, subtotal]);

  const getItemKey = (productId: string, variantId?: string) =>
    variantId ? `${productId}-${variantId}` : productId;

  const handleQuantityChange = async (
    productId: string,
    quantity: number,
    variantId?: string
  ) => {
    try {
      await updateItem(productId, quantity, variantId);
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleRemoveItem = async (productId: string, variantId?: string) => {
    const key = getItemKey(productId, variantId);
    setRemovingItems((prev) => new Set(prev).add(key));
    try {
      await removeItem(productId, variantId);
      toast.success(t("cart.itemRemoved"));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setRemovingItems((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  /**
   * One drawer line. Extracted so the list can render flat or under
   * per-seller headers without duplicating the markup.
   */
  const renderLine = (item: CartItem) => {
        const key = getItemKey(
          item.productId.toString(),
          item.variantId?.toString()
        );
        const isRemoving = removingItems.has(key);
        const preorderPayment = getPreorderPaymentLabel(item);

        return (
          <div key={key} className="px-6 py-5">
            <div className="flex gap-4">
              {/* Product Image */}
              <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-[#f5f5f5] dark:bg-zinc-800">
                {item.image ? (
                  <AppImage
                    src={item.image}
                    alt={item.name}
                    fill
                    className="object-contain p-2"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <ShoppingBag className="h-6 w-6" />
                  </div>
                )}
              </div>

              {/* Product Details */}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm leading-tight line-clamp-2 mb-1">
                  {item.name}
                </h3>

                {/* Variant Info - if available */}
                {item.variantId && (
                  <p className="text-sm text-muted-foreground mb-2">
                    {/* Variant details would be displayed here */}
                  </p>
                )}
                {item.purchaseType === "preorder" && (
                  <div className="mb-2 space-y-1 text-xs font-medium text-blue-600 dark:text-blue-300">
                    <p>
                      {formatPreorderDate(item.preorderReleaseDate)
                        ? `Pre-order - ships around ${formatPreorderDate(
                            item.preorderReleaseDate,
                          )}`
                        : "Pre-order"}
                    </p>
                    {preorderPayment ? (
                      <p className="text-muted-foreground">
                        Due now {formatPrice(preorderPayment.dueNow)} /
                        later {formatPrice(preorderPayment.dueLater)}
                      </p>
                    ) : null}
                  </div>
                )}

                {/* Quantity stepper — the same control as the product page,
                    so a shopper adjusts the line without opening a keyboard. */}
                <div className="mt-2">
                  <div className="inline-flex h-9 items-center justify-between rounded-md border border-input bg-background px-1">
                    <button
                      type="button"
                      onClick={() =>
                        void handleQuantityChange(
                          item.productId.toString(),
                          item.quantity - 1,
                          item.variantId?.toString(),
                        )
                      }
                      disabled={isRemoving || item.quantity <= 1}
                      aria-label={
                        t.has("common.decreaseQuantity")
                          ? t("common.decreaseQuantity")
                          : "Decrease quantity"
                      }
                      className="inline-flex h-full w-8 items-center justify-center rounded-sm text-foreground transition hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span
                      aria-live="polite"
                      aria-label={t("cart.quantity")}
                      className="min-w-6 text-center text-sm font-semibold tabular-nums text-foreground"
                    >
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void handleQuantityChange(
                          item.productId.toString(),
                          item.quantity + 1,
                          item.variantId?.toString(),
                        )
                      }
                      disabled={isRemoving}
                      aria-label={
                        t.has("common.increaseQuantity")
                          ? t("common.increaseQuantity")
                          : "Increase quantity"
                      }
                      className="inline-flex h-full w-8 items-center justify-center rounded-sm text-foreground transition hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Price & Remove */}
              <div className="flex flex-col items-end justify-between shrink-0">
                <span className="inline-flex items-center rounded-full border border-emerald-500 px-2.5 py-0.5 text-sm font-semibold text-emerald-600 dark:border-emerald-600 dark:text-emerald-500">
                  {formatPrice(item.price * item.quantity)}
                </span>
                <button
                  onClick={() =>
                    handleRemoveItem(
                      item.productId.toString(),
                      item.variantId?.toString()
                    )
                  }
                  disabled={isRemoving}
                  className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
                >
                  {isRemoving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("common.remove")
                  )}
                </button>
              </div>
            </div>
          </div>
        );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(92vw,420px)] flex flex-col p-0 gap-0"
      >
        {/* Header */}
        <SheetHeader className="px-6 py-5 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-xl font-semibold">
              {t("cart.title")}
            </SheetTitle>
            <SheetClose className="rounded-full p-1 hover:bg-muted transition-colors -mr-1">
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
        </SheetHeader>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 px-6">
              <ShoppingBag className="h-16 w-16 text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-2">
                {t("cart.empty")}
              </p>
              <p className="text-sm text-muted-foreground text-center mb-4">
                {t("cart.emptyDescription")}
              </p>
              <Button asChild onClick={() => onOpenChange(false)}>
                <Link href={`/${locale}/products`}>
                  {t("cart.startShopping")}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {sellerGroups.length > 1
                ? sellerGroups.map((group) => (
                    // Labelled as a region so the grouping is not purely
                    // visual — a screen reader announces whose items these are
                    // rather than reading one undifferentiated list.
                    <section
                      key={group.vendorId ?? "unknown-seller"}
                      aria-label={
                        t.has("cart.soldBy")
                          ? t("cart.soldBy", { seller: group.vendorName })
                          : `Sold by ${group.vendorName}`
                      }
                    >
                      <p className="bg-muted/40 px-6 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t.has("cart.soldBy")
                          ? t("cart.soldBy", { seller: group.vendorName })
                          : `Sold by ${group.vendorName}`}
                      </p>
                      <div className="divide-y">
                        {group.items.map(renderLine)}
                      </div>
                    </section>
                  ))
                : items.map(renderLine)}
            </div>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t px-6 py-5 space-y-4">
            {/* Subtotal */}
            <div className="flex items-center justify-between">
              <span className="text-base font-medium">
                {t("cart.subtotal")}
              </span>
              <span className="text-lg font-semibold">
                {formatPrice(subtotal)}
              </span>
            </div>

            <FreeShippingProgress
              subtotal={subtotal}
              threshold={freeShippingConfig.threshold}
              zoneShippingEnabled={freeShippingConfig.zoneShippingEnabled}
              hasShippableItems={hasShippableItems}
              formatPrice={formatPrice}
            />

            {/* Shipping Notice */}
            <p className="text-sm text-muted-foreground">
              {t("cart.shippingNotice")}
            </p>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="outline"
                className="rounded-full"
                asChild
                onClick={() => onOpenChange(false)}
              >
                <Link href={`/${locale}/cart`}>
                  {t("cart.viewCart")}
                </Link>
              </Button>
              <Button
                className="rounded-full"
                asChild
                onClick={() => onOpenChange(false)}
              >
                <Link href={`/${locale}/checkout`}>
                  {t("cart.checkout")}
                </Link>
              </Button>
            </div>

            {/* Continue Shopping */}
            <button
              onClick={() => onOpenChange(false)}
              className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
            >
              <span>{t("common.or")}</span>
              <Link
                href={`/${locale}/products`}
                className="uppercase font-medium tracking-wide hover:underline"
              >
                {t("cart.continueShopping")}
              </Link>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
