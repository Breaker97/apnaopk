import { unstable_cache } from "next/cache";
import { connectDB } from "@/lib/db";
import { Coupon } from "@/models";

/**
 * One discount, read by its code for the storefront.
 *
 * The coupon banner is the only caller today: it advertises a code, so it has
 * to know what that code is actually worth, what it requires, and when it
 * stops working. Deriving those from the discount is what keeps a banner from
 * promising 20% while the code gives 15.
 *
 * Cached for a minute rather than tagged: discounts are edited rarely and a
 * banner that lags a change by under a minute is not a correctness problem,
 * whereas threading invalidation through every coupon write path is surface
 * this one reader does not justify.
 */
interface StorefrontCoupon {
  code: string;
  type: "percentage" | "fixed" | "free_shipping";
  value: number;
  /** 0 means no minimum. */
  minOrderAmount: number;
  /** ISO strings; the model requires both, older rows may lack them. */
  startDate: string | null;
  endDate: string | null;
  status: string;
}

export const getStorefrontCoupon = unstable_cache(
  async (code: string): Promise<StorefrontCoupon | null> => {
    // Codes are stored and redeemed upper-cased (see `validateAndCalculateCoupon` in
    // lib/catalog/coupons.ts); a banner typed in lower case must find the
    // same row checkout will.
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return null;

    await connectDB();
    const doc = await Coupon.findOne({ code: trimmed })
      .select("code type value minOrderAmount startDate endDate status")
      .lean<{
        code?: string;
        type?: string;
        value?: number;
        minOrderAmount?: number;
        startDate?: Date;
        endDate?: Date;
        status?: string;
      }>();
    if (!doc?.code) return null;

    return {
      code: doc.code,
      type:
        doc.type === "fixed" || doc.type === "free_shipping"
          ? doc.type
          : "percentage",
      value: typeof doc.value === "number" ? doc.value : 0,
      minOrderAmount:
        typeof doc.minOrderAmount === "number" ? doc.minOrderAmount : 0,
      startDate: doc.startDate ? new Date(doc.startDate).toISOString() : null,
      endDate: doc.endDate ? new Date(doc.endDate).toISOString() : null,
      status: typeof doc.status === "string" ? doc.status : "active",
    };
  },
  ["storefront-coupon"],
  { revalidate: 60 },
);

/**
 * Whether a code is worth advertising right now: active, started, and not
 * expired. A banner for a discount checkout will refuse is worse than no
 * banner, so the section hides itself rather than showing a dead code.
 */
export function isCouponLive(
  coupon: StorefrontCoupon,
  now = Date.now(),
): boolean {
  if (coupon.status !== "active") return false;
  if (coupon.startDate && new Date(coupon.startDate).getTime() > now) {
    return false;
  }
  if (coupon.endDate && new Date(coupon.endDate).getTime() < now) return false;
  return true;
}

/**
 * A translator that falls back to shipped English, so a locale missing one of
 * these keys prints the sentence rather than throwing out of the section.
 */
type CouponPhrase = (
  key: string,
  fallback: string,
  values?: Record<string, string>,
) => string;

/** The offer as a number: what a shopper reads first, and only once. */
export function describeCouponOffer(
  coupon: StorefrontCoupon,
  money: (value: number) => string,
  say: CouponPhrase,
): string {
  if (coupon.type === "free_shipping") {
    return say("couponOfferFreeShipping", "Free shipping");
  }
  if (coupon.type === "fixed") {
    const amount = money(coupon.value);
    return say("couponOfferFixed", `${amount} off`, { amount });
  }
  return say("couponOfferPercent", `${coupon.value}% off`, {
    value: String(coupon.value),
  });
}

/**
 * What the discount requires. Its absence is what turns a promotion into a
 * surprise at checkout, which is where carts are abandoned.
 */
export function describeCouponCondition(
  coupon: StorefrontCoupon,
  money: (value: number) => string,
  say: CouponPhrase,
): string {
  if (!coupon.minOrderAmount || coupon.minOrderAmount <= 0) return "";
  const amount = money(coupon.minOrderAmount);
  return say("couponMinOrder", `On orders over ${amount}`, { amount });
}

/** The deadline, and only a real one — it is read off the discount itself. */
export function formatCouponEnds(
  endDate: string,
  locale: string,
  say: CouponPhrase,
): string {
  const date = new Date(endDate);
  if (Number.isNaN(date.getTime())) return "";
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
    }).format(date);
  } catch {
    formatted = date.toISOString().slice(0, 10);
  }
  return say("couponEnds", `Ends ${formatted}`, { date: formatted });
}
