"use client";

/**
 * The whole shopping-bag experience — lines, per-seller grouping, summary,
 * estimator, coupon — extracted verbatim from the old /cart page so the
 * cart TEMPLATE's `cart-main` core can render it as a section. All state
 * lives in `useCartPageState` (shared with the Electronics theme's skin of
 * this same page); this file is the Classic markup over that state.
 */

import Link from "next/link";
import type { CartItem } from "@/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AppImage } from "@/components/ui/app-image";
import { CouponInput } from "@/components/checkout/coupon-input";
import { FreeShippingProgress } from "@/components/cart/free-shipping-progress";
import { CartShippingEstimator } from "@/components/cart/cart-shipping-estimator";
import { StoreBreadcrumb } from "@/components/store/store-breadcrumb";
import { WishlistButton } from "@/components/products/wishlist-button";
import { ChevronDown, Clock3, Loader2, ShoppingBag } from "lucide-react";
import {
  formatPreorderDate,
  getPreorderPaymentLabel,
  getQuantityOptions,
  parseVariantDetails,
  useCartPageState,
  type CartLineMetadata,
} from "@/components/cart/use-cart-page-state";

function CartAttribute({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[13px] leading-5 text-muted-foreground sm:text-[14px]">
        {label}
      </p>
      <span className="mt-[7px] flex min-h-8 min-w-0 max-w-full items-center rounded-lg border border-input bg-background px-[10px] py-[6px] text-[12px] leading-none text-foreground sm:inline-flex">
        <span className="truncate" title={value}>
          {value}
        </span>
      </span>
    </div>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 text-[14px] leading-5">
      <span className="text-foreground">{label}</span>
      <span className="text-right text-muted-foreground">{children}</span>
    </div>
  );
}

export function CartPageContent() {
  const {
    t,
    locale,
    items,
    isLoading,
    subtotal,
    hasShippableItems,
    sellerGroups,
    soldByLabel,
    showMixedCartNotice,
    orderConfig,
    updatingItems,
    handleUpdateQuantity,
    handleRemoveItem,
    handleCheckout,
    isCouponOpen,
    setIsCouponOpen,
    appliedCoupon,
    setAppliedCoupon,
    appliedCouponForDisplay,
    taxRequested,
    setTaxRequested,
    isTaxConfigured,
    taxNotApplicableLabel,
    calculateTaxLabel,
    setEstimatedShipping,
    summaryShippingCost,
    cartViewSignature,
    couponCartItems,
    currency,
    formatCartPrice,
    saleSavings,
    discount,
    tax,
    total,
  } = useCartPageState();

  if (isLoading) {
    return <CartSkeleton />;
  }

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="mx-auto max-w-md text-center">
          <ShoppingBag className="mx-auto mb-6 h-24 w-24 text-muted-foreground/30" />
          <h1 className="mb-2 text-2xl font-bold">{t("cart.emptyCart")}</h1>
          <p className="mb-6 text-muted-foreground">
            {t("cart.emptyCartDescription")}
          </p>
          <Button asChild>
            <Link href={`/${locale}/products`}>{t("common.shopNow")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  /**
   * One cart line. Extracted so the list can be rendered either flat or
   * under per-seller headers without the markup existing twice.
   */
  const renderCartLine = (item: CartItem) => {
    // A product name sits one level below whatever introduces it: directly
    // under the page's <h1> on a single-seller bag, under the seller's <h2>
    // once the list is grouped. Hard-coding <h2> put the group and the things
    // it groups at the same level.
    const NameHeading = sellerGroups.length > 1 ? "h3" : "h2";
    const productId = String(item.productId);
    const variantId = item.variantId?.toString();
    const itemKey = variantId ? `${productId}-${variantId}` : productId;
    const isUpdating = updatingItems.has(itemKey);
    const details = parseVariantDetails(item.variantName);
    const metadata = item as CartLineMetadata;
    const comparePrice = metadata.comparePrice;
    const hasComparePrice =
      typeof comparePrice === "number" && comparePrice > item.price;
    const stock =
      typeof metadata.stock === "number"
        ? metadata.stock
        : metadata.availableStock;
    const isLowStock = typeof stock === "number" && stock > 0 && stock <= 5;
    const preorderPayment = getPreorderPaymentLabel(item);

    return (
      <article
        key={itemKey}
        // Phones keep the thumbnail beside the title/price and drop the
        // attribute row to full width underneath; from `sm` the thumbnail
        // spans both rows as the original two-column layout.
        className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-4 py-6 first:pt-0 sm:grid-cols-[128px_minmax(0,1fr)] sm:gap-x-5 sm:gap-y-0"
      >
        <div className="relative h-32 w-24 overflow-hidden rounded-xl bg-muted sm:row-span-2 sm:h-40 sm:w-32">
          {item.image ? (
            <AppImage
              src={item.image}
              alt={item.name}
              fill
              className="object-cover"
              sizes="(min-width: 640px) 128px, 96px"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
              No Image
            </div>
          )}
          <WishlistButton
            productId={productId}
            size="sm"
            className="absolute right-2 top-2 h-7 w-7 border-white/80 bg-background text-foreground shadow-none hover:bg-accent"
          />
        </div>

        <div className="min-w-0 pt-1">
          <div>
            <NameHeading
              className="line-clamp-2 text-[15px] font-normal leading-5 text-foreground sm:text-[16px]"
              title={item.name}
            >
              {item.name}
            </NameHeading>
            {item.purchaseType === "preorder" && (
              <div className="mt-2 space-y-1 text-[13px] font-semibold leading-5 text-blue-600 dark:text-blue-300">
                <p>
                  {formatPreorderDate(item.preorderReleaseDate)
                    ? `Pre-order - ships around ${formatPreorderDate(
                        item.preorderReleaseDate,
                      )}`
                    : "Pre-order"}
                </p>
                {preorderPayment ? (
                  <p className="font-medium text-muted-foreground">
                    Due now {formatCartPrice(preorderPayment.dueNow)} / later{" "}
                    {formatCartPrice(preorderPayment.dueLater)}
                  </p>
                ) : null}
              </div>
            )}
            <div className="mt-[9px] flex items-center gap-1.5 text-[14px] font-semibold leading-5">
              {hasComparePrice && (
                <span className="text-muted-foreground line-through">
                  {formatCartPrice(comparePrice)}
                </span>
              )}
              <span
                className={
                  hasComparePrice ? "text-destructive" : "text-foreground"
                }
              >
                {formatCartPrice(item.price)}
              </span>
            </div>
            {isLowStock && (
              <p className="mt-1 flex items-center gap-1 text-[14px] leading-5 text-[#ff5c00]">
                <Clock3 className="h-3.5 w-3.5" />
                Low in stock
              </p>
            )}
          </div>
        </div>

        <div className="col-span-2 min-w-0 sm:col-span-1 sm:mt-[14px]">
          <div className="grid grid-cols-3 gap-3 sm:gap-[42px]">
            {details.color && (
              <CartAttribute
                label={t("products.color")}
                value={details.color}
              />
            )}
            {details.size && (
              <CartAttribute label={t("products.size")} value={details.size} />
            )}
            <div className="min-w-0">
              <p className="truncate text-[13px] leading-5 text-muted-foreground sm:text-[14px]">
                {t("common.quantity")}
              </p>
              <div className="relative mt-[7px] inline-flex">
                <select
                  aria-label={t("common.quantity")}
                  value={String(item.quantity)}
                  disabled={isUpdating}
                  onChange={(event) =>
                    handleUpdateQuantity(
                      productId,
                      Number(event.target.value),
                      variantId,
                    )
                  }
                  className="h-8 w-[56px] appearance-none rounded-lg border border-input bg-background py-0 pl-[10px] pr-7 text-[12px] leading-none text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {getQuantityOptions(item.quantity).map((quantity) => (
                    <option key={quantity} value={quantity}>
                      {quantity}
                    </option>
                  ))}
                </select>
                {isUpdating ? (
                  <Loader2 className="pointer-events-none absolute right-[9px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronDown className="pointer-events-none absolute right-[9px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleRemoveItem(productId, variantId)}
            className="mt-4 text-[14px] leading-5 text-foreground underline underline-offset-2 transition-colors hover:text-destructive sm:mt-[17px]"
          >
            {t("common.remove")}
          </button>
        </div>
      </article>
    );
  };

  return (
    <div className="mx-auto max-w-[1298px] px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8 lg:pt-[42px] xl:px-0">
      {/* No structured data: the bag is never indexed, and a BreadcrumbList
          pointing at it would only confuse the crawler. */}
      <StoreBreadcrumb
        className="mb-4 sm:mb-6"
        locale={locale}
        jsonLd={false}
        items={[{ label: t("common.cart") }]}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,837px)_minmax(320px,378px)] lg:justify-between lg:gap-12">
        <section aria-labelledby="shopping-bag-heading" className="min-w-0">
          <h1
            id="shopping-bag-heading"
            className="mb-4 text-[20px] font-semibold leading-6 text-foreground sm:mb-[26px]"
          >
            Shopping bag
          </h1>

          {/* Stated where the shopper can still act on it — moving an item to
              a wishlist here is cheap, discovering the same fact after filling
              in an address is not. Only when collection was genuinely on the
              table: with COD off the store has no pickup option at all, so
              nothing was lost by the mix. */}
          {showMixedCartNotice ? (
            <p className="mb-6 rounded-lg border bg-muted/40 p-3 text-[13px] leading-5 text-muted-foreground">
              {t.has("cart.mixedCartDeliveryOnly")
                ? t("cart.mixedCartDeliveryOnly", { count: sellerGroups.length })
                : `Your bag has items from ${sellerGroups.length} sellers, so this order will be delivered. In-store collection is only offered when everything comes from one seller.`}
            </p>
          ) : null}

          <div className="divide-y divide-[var(--border)]">
            {sellerGroups.length > 1
              ? sellerGroups.map((group) => (
                  <section key={group.vendorId ?? "unknown-seller"} className="py-6 first:pt-0">
                    <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {soldByLabel(group.vendorName)}
                    </h2>
                    <div className="divide-y divide-[var(--border)]">
                      {group.items.map(renderCartLine)}
                    </div>
                  </section>
                ))
              : items.map(renderCartLine)}
          </div>
        </section>

        <aside
          aria-labelledby="order-summary-heading"
          // Stacked under the bag on phones, so it needs its own rule to read
          // as a separate block rather than a continuation of the last line.
          className="border-t border-border pt-6 lg:sticky lg:top-24 lg:border-0 lg:pt-0"
        >
          <h2
            id="order-summary-heading"
            className="text-[16px] font-semibold leading-6 text-foreground"
          >
            {t("checkout.orderSummary")}
          </h2>

          <div className="mt-[22px] space-y-[12px]">
            <SummaryRow label={t("common.subtotal")}>
              <span className="font-semibold text-foreground">
                {formatCartPrice(subtotal)}
              </span>
            </SummaryRow>
            <CartShippingEstimator
              hasShippableItems={hasShippableItems}
              cartSignature={cartViewSignature}
              formatPrice={formatCartPrice}
              onEstimate={setEstimatedShipping}
              renderRow={(value) => (
                <SummaryRow label={t("common.shipping")}>{value}</SummaryRow>
              )}
            />
            <FreeShippingProgress
              subtotal={subtotal}
              threshold={orderConfig.freeShippingThreshold}
              zoneShippingEnabled={orderConfig.zoneShippingEnabled}
              hasShippableItems={hasShippableItems}
              formatPrice={formatCartPrice}
              className="pt-1"
            />
            <SummaryRow label={t("checkout.estimatedTax")}>
              {taxRequested ? (
                isTaxConfigured ? (
                  <span>{formatCartPrice(tax)}</span>
                ) : (
                  <span>{taxNotApplicableLabel}</span>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => setTaxRequested(true)}
                  className="text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  {calculateTaxLabel}
                </button>
              )}
            </SummaryRow>
            <SummaryRow label={t("checkout.promoCode")}>
              {appliedCoupon ? (
                <span className="font-medium uppercase text-foreground">
                  {appliedCoupon.code}
                </span>
              ) : isCouponOpen ? (
                <span />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCouponOpen(true)}
                  className="text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                >
                  {t("checkout.enterCode")}
                </button>
              )}
            </SummaryRow>
            {isCouponOpen || appliedCoupon ? (
              <CouponInput
                cartItems={couponCartItems}
                subtotal={subtotal}
                shippingCost={summaryShippingCost}
                appliedCoupon={appliedCouponForDisplay}
                onApply={(coupon) => {
                  setAppliedCoupon(coupon);
                  setIsCouponOpen(true);
                }}
                onRemove={() => {
                  setAppliedCoupon(null);
                  setIsCouponOpen(false);
                }}
              />
            ) : null}
            {discount > 0 ? (
              <SummaryRow
                label={`${t("common.discount")}${
                  appliedCoupon ? ` (${appliedCoupon.code})` : ""
                }`}
              >
                <span className="text-green-700 dark:text-green-400">
                  -{formatCartPrice(discount)}
                </span>
              </SummaryRow>
            ) : null}
            <SummaryRow label={t("common.sale")}>
              {saleSavings > 0 ? (
                <span>-{formatCartPrice(saleSavings)}</span>
              ) : (
                <span>&mdash;</span>
              )}
            </SummaryRow>
          </div>

          <div className="mt-[16px] flex items-baseline justify-between gap-6">
            <span className="text-[14px] font-semibold leading-5 text-foreground">
              {t("common.total")}
            </span>
            <div className="text-right">
              <span className="mr-2 text-[11px] font-medium uppercase leading-none text-muted-foreground">
                {currency.code}
              </span>
              <span className="text-[18px] font-semibold leading-none text-foreground">
                {formatCartPrice(total)}
              </span>
            </div>
          </div>

          {/* data-slot="button": the Theme-settings Button-style hook, so
              these raw CTAs reshape with the merchant's choice too. */}
          <button
            type="button"
            data-slot="button"
            onClick={handleCheckout}
            className="mt-[22px] h-[46px] w-full rounded-lg bg-primary px-4 text-[14px] font-semibold leading-none text-primary-foreground transition-colors hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {t("checkout.checkout")}
          </button>

          <Link
            href={`/${locale}/products`}
            data-slot="button"
            className="mt-3 flex h-[46px] w-full items-center justify-center rounded-lg border border-input bg-background px-4 text-center text-[14px] font-semibold leading-none text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {t("cart.continueShopping")}
          </Link>
        </aside>
      </div>
    </div>
  );
}

function CartSkeleton() {
  return (
    <div className="mx-auto max-w-[1298px] px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8 lg:pt-[42px] xl:px-0">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,837px)_minmax(320px,378px)] lg:justify-between lg:gap-12">
        <section>
          <Skeleton className="mb-4 h-6 w-32 sm:mb-[26px]" />
          <div className="divide-y divide-[var(--border)]">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-4 py-6 first:pt-0 sm:grid-cols-[128px_minmax(0,1fr)] sm:gap-x-5 sm:gap-y-0"
              >
                <Skeleton className="h-32 w-24 rounded-xl sm:row-span-2 sm:h-40 sm:w-32" />
                <div className="min-w-0 pt-1">
                  <Skeleton className="h-5 w-full max-w-48" />
                  <Skeleton className="mt-[9px] h-5 w-16" />
                </div>
                <div className="col-span-2 min-w-0 sm:col-span-1 sm:mt-[14px]">
                  <div className="grid grid-cols-3 gap-3 sm:gap-[42px]">
                    <div>
                      <Skeleton className="h-5 w-12" />
                      <Skeleton className="mt-[7px] h-8 w-14 rounded-lg" />
                    </div>
                    <div>
                      <Skeleton className="h-5 w-10" />
                      <Skeleton className="mt-[7px] h-8 w-14 rounded-lg" />
                    </div>
                    <div>
                      <Skeleton className="h-5 w-20" />
                      <Skeleton className="mt-[7px] h-8 w-14 rounded-lg" />
                    </div>
                  </div>
                  <Skeleton className="mt-4 h-5 w-16 sm:mt-[17px]" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="border-t border-border pt-6 lg:border-0 lg:pt-0">
          <Skeleton className="h-6 w-32" />
          <div className="mt-[22px] space-y-[12px]">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </div>
          <Skeleton className="mt-[16px] h-6 w-full" />
          <Skeleton className="mt-[22px] h-[46px] w-full rounded-lg" />
          <Skeleton className="mt-3 h-[46px] w-full rounded-lg" />
        </aside>
      </div>
    </div>
  );
}
