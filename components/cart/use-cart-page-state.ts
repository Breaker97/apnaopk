"use client";

/**
 * The cart page's brain, extracted from `CartPageContent` so the Electronics
 * theme's `cart-main` override can wear a different skin over the exact same
 * behavior. Everything stateful lives here — cart store, per-seller grouping,
 * order config, coupon, deferred tax, shipping estimate, analytics — and the
 * two skins render from the one return value. Markup-only helpers stay with
 * their skins; parsing/formatting helpers both need are exported below.
 */

import { useCart } from "@/hooks/use-cart";
import { groupCartItemsBySeller } from "@/lib/cart/cart-sellers";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import {
  calculateCheckoutTotals,
  isFreeShippingCouponType,
} from "@/lib/catalog/discounts";
import {
  analyticsItemsFromCart,
  trackCartView,
} from "@/lib/analytics/events";

type VariantDetails = {
  color: string | null;
  size: string | null;
};

export type CartLineMetadata = {
  availableStock?: number | null;
  categoryId?: string | null;
  comparePrice?: number | null;
  stock?: number | null;
};

type AppliedCoupon = {
  code: string;
  discount: number;
  type: string;
  discountTarget?: "subtotal" | "shipping";
  maxDiscount?: number;
};

type OrderConfig = {
  taxRate: number;
  /**
   * `orders.freeShippingThreshold`, plus the flag that decides whether it means
   * anything. The threshold only reaches the bill on the legacy flat-rate path;
   * see `FreeShippingProgress`.
   */
  freeShippingThreshold: number;
  zoneShippingEnabled: boolean;
  /** `shipping.delivery.showEstimatedDelivery` — gates the delivery strip. */
  showEstimatedDelivery: boolean;
};

type DeliveryDays = { min: number; max: number };

const CART_SUMMARY_SHIPPING_COST = 0;

function stripZeroDecimals(price: string) {
  return price.replace(/([.,]00)(?!\d)/, "");
}

export function formatPreorderDate(value?: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function getPreorderPaymentLabel(item: {
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
}) {
  const dueNow = Number(item.preorderDepositAmount || 0);
  const dueLater = Number(item.preorderOutstandingAmount || 0);
  if (dueLater <= 0) return "";
  return { dueNow, dueLater };
}

export function getQuantityOptions(quantity: number) {
  const maxQuantity = Math.max(10, quantity);

  return Array.from({ length: maxQuantity }, (_, index) => index + 1);
}

export function parseVariantDetails(variantName?: string): VariantDetails {
  if (!variantName) {
    return { color: null, size: null };
  }

  const parts = variantName
    .split(/\s*(?:\/|,|\||;)\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  const details: VariantDetails = { color: null, size: null };

  for (const part of parts) {
    const [rawLabel, ...rawValue] = part.split(":");
    const value = rawValue.join(":").trim();

    if (!value) {
      continue;
    }

    const label = rawLabel.trim().toLowerCase();

    if (label.includes("color") || label.includes("colour")) {
      details.color = value;
    }

    if (label.includes("size")) {
      details.size = value;
    }
  }

  if (!details.color && !details.size) {
    return {
      color: parts[0] || variantName,
      size: parts[1] || null,
    };
  }

  return details;
}

export function useCartPageState() {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams();
  const locale = params.locale as string;

  const {
    items,
    isLoading,
    subtotal,
    sellerCount,
    anySellerOffersPickup,
    hasShippableItems,
    updateItem,
    removeItem,
  } = useCart();
  const { currency, formatPrice } = useCurrency();

  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());

  // Named only when it matters. On a single-seller cart a "Sold by" header on
  // every line is noise; on a mixed one it is the reason the order behaves the
  // way it does further down the funnel.
  //
  // Two different numbers live here on purpose, and it matters which is used
  // where. `sellerCount` counts PHYSICAL lines only, because that is the rule
  // `resolvePickupEligibility` uses to refuse collection — so it, and only it,
  // decides whether the explanation appears. `sellerGroups.length` counts every
  // seller with a line in the bag, including one selling only a download, so it
  // is what the shopper can actually count on screen — and therefore the number
  // the sentence has to say. Using `sellerCount` in the copy printed "items
  // from 2 sellers" directly above three group headers.
  const unknownSellerLabel = t.has("cart.unknownSeller")
    ? t("cart.unknownSeller")
    : "Another seller";
  const sellerGroups = useMemo(
    () => groupCartItemsBySeller(items, unknownSellerLabel),
    [items, unknownSellerLabel],
  );
  const soldByLabel = (name: string) =>
    t.has("cart.soldBy") ? t("cart.soldBy", { seller: name }) : `Sold by ${name}`;

  const [orderConfig, setOrderConfig] = useState<OrderConfig>({
    taxRate: 0,
    freeShippingThreshold: 0,
    zoneShippingEnabled: false,
    showEstimatedDelivery: false,
  });
  const [isCouponOpen, setIsCouponOpen] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(
    null,
  );
  const [taxRequested, setTaxRequested] = useState(false);
  // Shipping estimate from the summary's estimator, once the shopper asks for
  // one. Null until then — the total keeps the "calculated at checkout"
  // convention rather than assuming zero is a price.
  const [estimatedShipping, setEstimatedShipping] = useState<number | null>(
    null,
  );
  // The delivery window that came with the shipping estimate, when the quoted
  // option carries one. Same convention as the cost: null means "no
  // trustworthy number", and the delivery strip stays hidden rather than
  // promising dates nobody quoted.
  const [estimatedDeliveryDays, setEstimatedDeliveryDays] =
    useState<DeliveryDays | null>(null);
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
    let active = true;

    (async () => {
      try {
        const res = await fetch("/api/settings/public");
        const json = await res.json().catch(() => null);
        if (!active) return;

        if (res.ok && json?.success) {
          setOrderConfig({
            taxRate: Number(json.data?.orders?.taxRate || 0),
            freeShippingThreshold: Number(
              json.data?.orders?.freeShippingThreshold || 0,
            ),
            zoneShippingEnabled: Boolean(json.data?.shipping?.enabled),
            showEstimatedDelivery: Boolean(
              json.data?.shipping?.delivery?.showEstimatedDelivery,
            ),
          });
        }
      } catch {
        if (active) {
          // Falling back to a zero threshold hides the free-shipping nudge
          // rather than showing one built from a subtotal we cannot price.
          setOrderConfig({
            taxRate: 0,
            freeShippingThreshold: 0,
            zoneShippingEnabled: false,
            showEstimatedDelivery: false,
          });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const formatCartPrice = (amount: number) =>
    stripZeroDecimals(formatPrice(amount));

  const handleUpdateQuantity = async (
    productId: string,
    quantity: number,
    variantId?: string,
  ) => {
    const key = variantId ? `${productId}-${variantId}` : productId;
    setUpdatingItems((prev) => new Set(prev).add(key));

    try {
      await updateItem(productId, quantity, variantId);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setUpdatingItems((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleRemoveItem = async (productId: string, variantId?: string) => {
    try {
      await removeItem(productId, variantId);
      toast.success(t("cart.itemRemoved"));
    } catch {
      toast.error(t("common.error"));
    }
  };

  const handleCheckout = () => {
    const couponQuery = appliedCoupon?.code
      ? `?coupon=${encodeURIComponent(appliedCoupon.code)}`
      : "";
    router.push(`/${locale}/checkout${couponQuery}`);
  };

  const saleSavings = items.reduce((sum, item) => {
    const comparePrice = (item as CartLineMetadata).comparePrice;

    if (!comparePrice || comparePrice <= item.price) {
      return sum;
    }

    return sum + (comparePrice - item.price) * item.quantity;
  }, 0);
  const couponCartItems = useMemo(
    () =>
      items.map((item) => {
        const metadata = item as CartLineMetadata;

        return {
          productId: String(item.productId),
          price: item.price,
          quantity: item.quantity,
          categoryId: metadata.categoryId
            ? String(metadata.categoryId)
            : undefined,
        };
      }),
    [items],
  );
  // Both numbers have to agree before the notice appears, and they come from
  // different places: `sellerCount` is the server's last answer, `sellerGroups`
  // is derived from the lines on screen right now. `updateItem` drops a line
  // optimistically and only then refreshes, so dropping a seller's last unit
  // leaves a window where the server still says 2 while one group remains —
  // which rendered "items from 1 sellers". Requiring both keeps the notice off
  // until the two views of the bag agree.
  //
  // `anySellerOffersPickup` is the last gate, and the one that keeps the
  // sentence honest: `resolvePickupEligibility` short-circuits on
  // `multi_vendor` before it looks at a single branch, so "more than one
  // seller" says nothing about whether either of them runs a counter. Without
  // this the cart would blame the mix for collection that was never on offer.
  const showMixedCartNotice =
    sellerCount > 1 && sellerGroups.length > 1 && anySellerOffersPickup;

  const taxRate = Math.max(0, Number(orderConfig.taxRate || 0));
  const isTaxConfigured = taxRate > 0;
  // Once the shopper has estimated shipping, the total includes it — a row
  // showing 70 above a total that ignores it would contradict itself.
  const summaryShippingCost = estimatedShipping ?? CART_SUMMARY_SHIPPING_COST;
  const totals = calculateCheckoutTotals({
    subtotal,
    shippingCost: summaryShippingCost,
    taxRate: taxRequested && isTaxConfigured ? taxRate : 0,
    coupon: appliedCoupon,
    currency: currency.code,
  });
  const discount = totals.subtotalDiscount;
  const shippingDiscount = totals.shippingDiscount;
  const tax = totals.tax;
  const total = totals.total;
  const calculateTaxLabel = t.has("checkout.calculate")
    ? t("checkout.calculate")
    : "Calculate";
  const taxNotApplicableLabel = t.has("cart.taxNotApplicable")
    ? t("cart.taxNotApplicable")
    : "Tax is not applicable";
  const appliedCouponForDisplay = appliedCoupon
    ? {
        ...appliedCoupon,
        discount: isFreeShippingCouponType(appliedCoupon.type)
          ? shippingDiscount
          : discount,
      }
    : null;

  useEffect(() => {
    if (!items.length || !cartViewSignature) return;

    trackCartView({
      currency: currency.code,
      value: subtotal,
      items: analyticsItemsFromCart(items),
    });
  }, [cartViewSignature, currency.code, items, subtotal]);

  // Units, not lines — the header's cart badge counts units, and two numbers
  // that both claim to be "how much is in my cart" must agree.
  const unitCount = items.reduce((sum, item) => sum + item.quantity, 0);

  // The delivery strip promises dates, so it needs two consents: the
  // merchant's (`showEstimatedDelivery`) and a real quote carrying a window
  // (`estimatedDeliveryDays`, set by the estimator). No quote, no strip —
  // never a guess dressed up as a promise. Worded here so every cart design
  // promises exactly the same thing.
  let deliveryEstimateText = "";
  if (orderConfig.showEstimatedDelivery && estimatedDeliveryDays) {
    const dateFormat = new Intl.DateTimeFormat(locale || undefined, {
      month: "short",
      day: "numeric",
    });
    const from = new Date();
    from.setDate(from.getDate() + estimatedDeliveryDays.min);
    const to = new Date();
    to.setDate(to.getDate() + estimatedDeliveryDays.max);
    const dateRange = `${dateFormat.format(from)} – ${dateFormat.format(to)}`;
    deliveryEstimateText = t.has("cart.deliveryEstimate")
      ? t("cart.deliveryEstimate", { dateRange })
      : `Delivered by ${dateRange} via Standard Shipping`;
  }

  return {
    t,
    locale,
    items,
    unitCount,
    deliveryEstimateText,
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
  };
}
