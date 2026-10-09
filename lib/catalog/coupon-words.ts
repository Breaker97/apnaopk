import type { CouponRefusal } from "@/lib/catalog/coupons";

/**
 * The store's sentences about a coupon, for the shopper app: what it gives,
 * what it needs, and why it cannot be used now. The app prints them as they
 * come; it never words a shortfall or a deadline itself.
 *
 * Pure: the words come from a translator (`getCouponCopy`, the store's
 * message catalogue for the path's locale), each with the English it falls
 * back to where a language lacks the key. The offer and condition lines are
 * the Coupon Banner's own keys (`home.coupon…`), so the app and the website
 * say a discount the same way.
 */

export type Say = (key: string, fallback: string, values?: Record<string, string>) => string;

export interface CouponCopy {
  locale: string;
  offerPercent(value: number): string;
  offerFixed(amount: string): string;
  offerFreeShipping(): string;
  minOrder(amount: string): string;
  maxDiscount(amount: string): string;
  selectedProducts(): string;
  sellerOnly(seller: string): string;
  perCustomer(limit: number): string;
  ends(at: Date): string;
  /** `reason` as a sentence. `shortBy` is MINIMUM_NOT_MET's, `startsAt` NOT_STARTED's. */
  refusal(reason: CouponRefusal, facts?: { shortBy?: string; startsAt?: Date }): string;
}

function shortDate(at: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function couponCopyFrom(say: Say, locale: string): CouponCopy {
  return {
    locale,
    offerPercent: (value) =>
      say("home.couponOfferPercent", `${value}% off`, { value: String(value) }),
    offerFixed: (amount) => say("home.couponOfferFixed", `${amount} off`, { amount }),
    offerFreeShipping: () => say("home.couponOfferFreeShipping", "Free shipping"),
    minOrder: (amount) => say("home.couponMinOrder", `On orders over ${amount}`, { amount }),
    maxDiscount: (amount) => say("coupon.upTo", `Up to ${amount} off`, { amount }),
    selectedProducts: () => say("coupon.selectedProductsOnly", "Selected products only"),
    sellerOnly: (seller) =>
      say("coupon.sellerOnly", `Only on products from ${seller}`, { seller }),
    perCustomer: (limit) =>
      limit === 1
        ? say("coupon.oncePerCustomer", "Once per customer")
        : say("coupon.usesPerCustomer", `${limit} uses per customer`, { count: String(limit) }),
    ends: (at) => {
      const date = shortDate(at, locale);
      return say("home.couponEnds", `Ends ${date}`, { date });
    },
    refusal: (reason, facts = {}) => {
      switch (reason) {
        case "NOT_FOUND":
          return say("coupon.refusedNotFound", "This code doesn't exist");
        case "NOT_ACTIVE":
          return say("coupon.refusedNotActive", "This code is not active");
        case "NOT_STARTED": {
          if (!facts.startsAt) return say("coupon.refusedNotStartedYet", "This code is not active yet");
          const date = shortDate(facts.startsAt, locale);
          return say("coupon.refusedNotStarted", `Starts ${date}`, { date });
        }
        case "EXPIRED":
          return say("coupon.refusedExpired", "This code has expired");
        case "USAGE_LIMIT_REACHED":
          return say("coupon.refusedUsedUp", "This code has been fully claimed");
        case "ALREADY_USED":
          return say("coupon.refusedAlreadyUsed", "You've already used this code");
        case "MINIMUM_NOT_MET":
          return facts.shortBy
            ? say("coupon.refusedSpendMore", `Add ${facts.shortBy} more to use this code`, {
                amount: facts.shortBy,
              })
            : say("coupon.refusedMinimum", "Your order is below this code's minimum");
        case "NOT_FOR_THIS_CART":
          return say("coupon.refusedNotForCart", "Not for the items in your cart");
        case "QUOTED_PRICE":
          return say("coupon.refusedQuoted", "Codes can't be used on a quoted price");
        case "SHIPPING_ALREADY_FREE":
          return say("coupon.refusedShippingFree", "Delivery is already free on this order");
        case "NO_SELLER_DELIVERY":
          return say(
            "coupon.refusedNoSellerDelivery",
            "This code covers one seller's delivery, and there is none in this order",
          );
      }
    },
  };
}
