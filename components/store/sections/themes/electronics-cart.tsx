"use client";

/**
 * Electronics' take on the `cart-main` contract: the "View Cart" spec-table
 * design — column headers over the lines, a carded order summary with the
 * delivery strip, gradient-free token CTAs. Same brain as Classic's bag
 * (`useCartPageState`), different skin; every state the Classic cart serves
 * (per-seller grouping, pre-order, low stock, coupon, deferred tax and
 * shipping) renders here too, so switching theme loses nothing.
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
import {
  ArrowRight,
  CalendarClock,
  Clock3,
  Loader2,
  Lock,
  Minus,
  Plus,
  ShoppingBag,
  Store,
  Truck,
  X,
} from "lucide-react";
import {
  formatPreorderDate,
  getPreorderPaymentLabel,
  useCartPageState,
  type CartLineMetadata,
} from "@/components/cart/use-cart-page-state";

/**
 * One template string, used by the header row and every line, so the columns
 * can never drift apart: tile / name / price / qty / subtotal / remove.
 */
const LINE_GRID =
  "md:grid-cols-[104px_minmax(0,1fr)_112px_128px_120px_44px]";

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-6 text-[14px] leading-5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{children}</span>
    </div>
  );
}

function QtyStepper({
  quantity,
  stock,
  isUpdating,
  onChange,
}: {
  quantity: number;
  stock?: number | null;
  isUpdating: boolean;
  onChange: (quantity: number) => void;
}) {
  // The select this replaces capped at max(10, quantity) regardless of
  // stock; the stepper can do better — stop at the shelf when we know
  // where it is, and let the store's own clamp handle it when we don't.
  const atMax = typeof stock === "number" && stock > 0 && quantity >= stock;

  return (
    <div className="inline-flex h-9 items-center overflow-hidden rounded-[9px] border border-input bg-background">
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={isUpdating || quantity <= 1}
        onClick={() => onChange(quantity - 1)}
        className="grid h-full w-8 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Minus className="h-3.5 w-3.5" aria-hidden />
      </button>
      <span
        aria-live="polite"
        className="grid h-full min-w-[30px] place-items-center border-x border-input px-1 text-[13px] font-semibold tabular-nums text-foreground"
      >
        {isUpdating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : (
          quantity
        )}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={isUpdating || atMax}
        onClick={() => onChange(quantity + 1)}
        className="grid h-full w-8 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function ElectronicsCart() {
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
    unitCount,
    deliveryEstimateText,
    setEstimatedDeliveryDays,
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
    return <ElectronicsCartSkeleton />;
  }

  const titleLabel = t.has("cart.viewCartTitle")
    ? t("cart.viewCartTitle")
    : "View Cart";

  if (items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card px-8 py-14 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_28px_-20px_rgba(16,24,40,0.35)]">
          <span className="grid h-[76px] w-[76px] place-items-center rounded-[20px] bg-muted text-muted-foreground">
            <ShoppingBag className="h-9 w-9" aria-hidden />
          </span>
          <h1 className="text-2xl font-bold tracking-[-0.03em]">
            {t("cart.emptyCart")}
          </h1>
          <p className="text-[14px] leading-5 text-muted-foreground">
            {t("cart.emptyCartDescription")}
          </p>
          <Button asChild className="mt-2">
            <Link href={`/${locale}/products`}>
              {t("common.shopNow")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const subtitleLabel = t.has("cart.viewCartSubtitle")
    ? t("cart.viewCartSubtitle")
    : "Review your selected items before checkout.";
  const productColumnLabel = t.has("cart.productColumn")
    ? t("cart.productColumn")
    : "Product";
  const orLabel = t.has("common.or") ? t("common.or") : "or";
  /**
   * One cart line — the desktop columns and the phone card are the same
   * article rearranged by breakpoint, so the list renders once whether it
   * is flat or under per-seller headers.
   */
  const renderCartLine = (item: CartItem) => {
    // Same heading arithmetic as Classic: a product name sits one level
    // below whatever introduces it — the page's <h1> on a single-seller
    // bag, the seller's <h2> once the list is grouped.
    const NameHeading = sellerGroups.length > 1 ? "h3" : "h2";
    const productId = String(item.productId);
    const variantId = item.variantId?.toString();
    const itemKey = variantId ? `${productId}-${variantId}` : productId;
    const isUpdating = updatingItems.has(itemKey);
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

    const removeButton = (extraClasses: string) => (
      <button
        type="button"
        aria-label={`${t("common.remove")} — ${item.name}`}
        onClick={() => handleRemoveItem(productId, variantId)}
        className={`h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive ${extraClasses}`}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    );

    return (
      <article
        key={itemKey}
        className={`grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-4 gap-y-3 border-b border-border py-4 md:items-center md:gap-x-0 ${LINE_GRID}`}
      >
        <div className="relative h-[72px] w-[88px] overflow-hidden rounded-xl bg-muted md:w-[104px]">
          {item.image ? (
            <AppImage
              src={item.image}
              alt={item.name}
              fill
              className="object-cover"
              sizes="104px"
            />
          ) : (
            <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-muted-foreground">
              No Image
            </div>
          )}
          <WishlistButton
            productId={productId}
            size="sm"
            className="absolute right-1.5 top-1.5 h-6 w-6 border-0 bg-background/90 text-foreground shadow-sm hover:bg-background"
          />
        </div>

        <div className="min-w-0 md:pr-6">
          <div className="flex items-start justify-between gap-3 md:block">
            <div className="min-w-0">
              <NameHeading
                className="line-clamp-2 text-[15px] font-semibold leading-5 tracking-[-0.01em] text-foreground"
                title={item.name}
              >
                {item.name}
              </NameHeading>
              {item.variantName ? (
                <p className="mt-1 truncate text-[12.5px] leading-4 text-muted-foreground">
                  {item.variantName}
                </p>
              ) : null}
              {item.purchaseType === "preorder" && (
                <div className="mt-1.5 space-y-0.5 text-[12.5px] leading-4">
                  <p className="flex items-center gap-1.5 font-medium text-primary">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {formatPreorderDate(item.preorderReleaseDate)
                      ? `Pre-order · ships around ${formatPreorderDate(
                          item.preorderReleaseDate,
                        )}`
                      : "Pre-order"}
                  </p>
                  {preorderPayment ? (
                    <p className="text-muted-foreground">
                      Due now {formatCartPrice(preorderPayment.dueNow)} / later{" "}
                      {formatCartPrice(preorderPayment.dueLater)}
                    </p>
                  ) : null}
                </div>
              )}
              {isLowStock && (
                <p className="mt-1.5 flex items-center gap-1 text-[12.5px] font-medium leading-4 text-[#ff5c00]">
                  <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Only {stock} left
                </p>
              )}
            </div>
            {removeButton("grid md:hidden")}
          </div>
        </div>

        <div className="hidden md:block">
          {hasComparePrice && (
            <span className="block text-[12px] leading-4 text-muted-foreground line-through">
              {formatCartPrice(comparePrice)}
            </span>
          )}
          <span
            className={`text-[15px] font-semibold leading-5 tabular-nums ${
              hasComparePrice ? "text-destructive" : "text-foreground"
            }`}
          >
            {formatCartPrice(item.price)}
          </span>
        </div>

        <div className="col-span-2 flex items-center justify-between gap-3 md:col-span-1 md:block">
          <QtyStepper
            quantity={item.quantity}
            stock={stock}
            isUpdating={isUpdating}
            onChange={(quantity) =>
              handleUpdateQuantity(productId, quantity, variantId)
            }
          />
          <span className="text-[15px] font-bold leading-5 tabular-nums text-foreground md:hidden">
            {formatCartPrice(item.price * item.quantity)}
          </span>
        </div>

        <div className="hidden text-[15px] font-bold leading-5 tabular-nums text-foreground md:block">
          {formatCartPrice(item.price * item.quantity)}
        </div>

        {removeButton("hidden md:grid")}
      </article>
    );
  };

  const renderLineList = (lineItems: CartItem[]) => lineItems.map(renderCartLine);

  return (
    <div className="mx-auto max-w-[1298px] px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8 lg:pt-[42px] xl:px-0">
      {/* No structured data: the bag is never indexed, and a BreadcrumbList
          pointing at it would only confuse the crawler. */}
      <StoreBreadcrumb
        className="mb-5 sm:mb-7"
        locale={locale}
        jsonLd={false}
        items={[{ label: t("common.cart") }]}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_334px] lg:gap-9">
        <section aria-labelledby="view-cart-heading" className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1
              id="view-cart-heading"
              className="text-[24px] font-bold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-[28px]"
            >
              {titleLabel}
            </h1>
            <span className="text-[13.5px] font-medium leading-5 text-muted-foreground">
              {t.has("cart.itemCount")
                ? t("cart.itemCount", { count: unitCount })
                : `${unitCount} items`}
            </span>
          </div>
          <p className="mt-1.5 text-[14px] leading-5 text-muted-foreground">
            {subtitleLabel}
          </p>

          {/* Stated where the shopper can still act on it — moving an item to
              a wishlist here is cheap, discovering the same fact after filling
              in an address is not. Only when collection was genuinely on the
              table: with COD off the store has no pickup option at all, so
              nothing was lost by the mix. */}
          {showMixedCartNotice ? (
            <p className="mt-6 rounded-[10px] border bg-muted/40 p-3 text-[13px] leading-5 text-muted-foreground">
              {t.has("cart.mixedCartDeliveryOnly")
                ? t("cart.mixedCartDeliveryOnly", { count: sellerGroups.length })
                : `Your bag has items from ${sellerGroups.length} sellers, so this order will be delivered. In-store collection is only offered when everything comes from one seller.`}
            </p>
          ) : null}

          <div
            className={`mt-6 hidden border-b border-border pb-3 text-[12px] font-medium uppercase leading-4 tracking-[0.06em] text-muted-foreground sm:mt-8 md:grid ${LINE_GRID}`}
          >
            <span className="col-span-2">{productColumnLabel}</span>
            <span>{t("common.price")}</span>
            <span>{t("common.quantity")}</span>
            <span>{t("common.subtotal")}</span>
            <span />
          </div>

          <div className="mt-4 md:mt-0">
            {sellerGroups.length > 1
              ? sellerGroups.map((group) => (
                  <section key={group.vendorId ?? "unknown-seller"}>
                    <h2 className="flex items-center gap-2 pb-1 pt-5 text-[13px] font-medium leading-5 text-muted-foreground">
                      <Store className="h-4 w-4 shrink-0" aria-hidden />
                      {soldByLabel(group.vendorName)}
                    </h2>
                    {renderLineList(group.items)}
                  </section>
                ))
              : renderLineList(items)}
          </div>
        </section>

        <aside
          aria-labelledby="order-summary-heading"
          className="self-start rounded-2xl border border-border bg-card p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_28px_-20px_rgba(16,24,40,0.35)] lg:sticky lg:top-24"
        >
          <h2
            id="order-summary-heading"
            className="text-[18px] font-bold leading-6 tracking-[-0.02em] text-foreground"
          >
            {t("checkout.orderSummary")}
          </h2>

          <div className="mt-5 space-y-3.5">
            <SummaryRow label={t("common.subtotal")}>
              <span className="font-semibold tabular-nums">
                {formatCartPrice(subtotal)}
              </span>
            </SummaryRow>
            <CartShippingEstimator
              hasShippableItems={hasShippableItems}
              cartSignature={cartViewSignature}
              formatPrice={formatCartPrice}
              onEstimate={setEstimatedShipping}
              onDeliveryDays={setEstimatedDeliveryDays}
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
                  <span className="font-semibold tabular-nums">
                    {formatCartPrice(tax)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {taxNotApplicableLabel}
                  </span>
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
                <span className="font-semibold uppercase">
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
                <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">
                  -{formatCartPrice(discount)}
                </span>
              </SummaryRow>
            ) : null}
            {saleSavings > 0 ? (
              <SummaryRow label={t("common.sale")}>
                <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">
                  -{formatCartPrice(saleSavings)}
                </span>
              </SummaryRow>
            ) : null}
          </div>

          <div className="mt-4 flex items-baseline justify-between gap-6 border-t border-border pt-4">
            <span className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-foreground">
              {t("common.total")}
            </span>
            <span className="text-right">
              <span className="mr-2 text-[11px] font-medium uppercase leading-none text-muted-foreground">
                {currency.code}
              </span>
              <span className="text-[19px] font-bold leading-none tracking-[-0.02em] tabular-nums text-foreground">
                {formatCartPrice(total)}
              </span>
            </span>
          </div>

          {deliveryEstimateText ? (
            <div className="mt-4 flex items-start gap-3 rounded-[10px] bg-primary/[0.07] p-3">
              <Truck
                className="mt-0.5 h-[18px] w-[18px] shrink-0 text-primary"
                aria-hidden
              />
              <p className="text-[12.5px] leading-5 text-muted-foreground">
                {deliveryEstimateText}
              </p>
            </div>
          ) : null}

          {/* data-slot="button": the Theme-settings Button-style hook, so
              these raw CTAs reshape with the merchant's choice too. */}
          <button
            type="button"
            data-slot="button"
            onClick={handleCheckout}
            className="mt-5 flex h-[46px] w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-4 text-[14px] font-semibold leading-none text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <Lock className="h-4 w-4" aria-hidden />
            {t("cart.proceedToCheckout")}
          </button>

          <div className="my-3.5 flex items-center gap-3 text-[12px] leading-4 text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden />
            {orLabel}
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>

          <Link
            href={`/${locale}/products`}
            data-slot="button"
            className="flex h-[44px] w-full items-center justify-center gap-2 rounded-[10px] border border-primary/25 bg-background px-4 text-[14px] font-semibold leading-none text-primary transition-colors hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {t("cart.continueShopping")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </aside>
      </div>

      {/* No sticky checkout bar on phones, deliberately: the store chrome
          already pins its bottom nav (`StoreBottomNav`, fixed z-40 up to xl)
          to that edge, and a second bar stacked above it would spend ~120px
          of a phone viewport on chrome. The summary card — checkout button
          included — stacks directly under the lines instead. */}
    </div>
  );
}

function ElectronicsCartSkeleton() {
  return (
    <div className="mx-auto max-w-[1298px] px-4 pb-16 pt-6 sm:px-6 sm:pt-10 lg:px-8 lg:pt-[42px] xl:px-0">
      <Skeleton className="h-5 w-36" />
      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_334px] lg:gap-9">
        <section>
          <Skeleton className="h-10 w-56" />
          <Skeleton className="mt-3 h-4 w-72" />
          <Skeleton className="mt-10 h-4 w-full" />
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 border-b border-border py-4"
            >
              <Skeleton className="h-[72px] w-[104px] shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-5 w-full max-w-48" />
                <Skeleton className="mt-2 h-4 w-20" />
              </div>
              <Skeleton className="hidden h-5 w-16 md:block" />
              <Skeleton className="h-9 w-[100px] rounded-[9px]" />
              <Skeleton className="hidden h-5 w-16 md:block" />
              <Skeleton className="hidden h-8 w-8 rounded-full md:block" />
            </div>
          ))}
        </section>
        <Skeleton className="h-[430px] w-full rounded-2xl" />
      </div>
    </div>
  );
}
