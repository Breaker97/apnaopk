import "server-only";

import { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/intl/money";
import { getStoreCurrency, readStoreCurrency } from "@/lib/intl/server-currency";
import {
  describeCouponCondition,
  describeCouponOffer,
  formatCouponEnds,
  getStorefrontCoupon,
  isCouponLive,
} from "@/lib/storefront/storefront-coupon";
import type { SectionReadMode } from "./read-mode";

/** What the Coupon Banner has to say, or why it says nothing. */
type CouponBannerData =
  /** No discount picked. */
  | { kind: "unset" }
  /** The discount has ended, is paused, or has not started. */
  | { kind: "notLive"; code: string }
  /** No offer to print: a code this system does not know, and no copy for it. */
  | { kind: "silent" }
  | {
      kind: "live";
      /** As checkout knows it (stored upper-case), else as the merchant typed it. */
      code: string;
      offer: string;
      condition: string;
      /** "Ends 12 Oct", when the banner shows its end and the discount has one. */
      endsOn: string;
      /** The discount's own end, ISO, when it has one. */
      endsAt?: string;
    };

/**
 * The Coupon Banner's copy, read off the discount it advertises: what it is
 * worth, what it needs, when it ends — unless the merchant wrote their own
 * offer or condition line. A discount checkout would refuse is not
 * advertised (`notLive`).
 */
export async function loadCouponBanner(
  options: {
    code: string;
    /** The merchant's own offer line; empty means "say what it is worth". */
    offer: string;
    /** The merchant's own condition line; empty means "say what it needs". */
    condition: string;
    showExpiry: boolean;
    locale: string;
  },
  mode: SectionReadMode = "page",
): Promise<CouponBannerData> {
  const { code } = options;
  if (!code.trim()) return { kind: "unset" };

  const [tHome, coupon] = await Promise.all([
    getTranslations({ locale: options.locale, namespace: "home" }),
    getStorefrontCoupon(code),
  ]);
  const say = (key: string, fallback: string, values?: Record<string, string>) =>
    tHome.has(key) ? tHome(key, values) : fallback;

  // A discount that has ended, been paused, or has not started yet: the strip
  // goes quiet rather than sending shoppers to a rejection at checkout.
  if (coupon && !isCouponLive(coupon)) return { kind: "notLive", code: coupon.code };

  const currency = mode === "strict" ? await readStoreCurrency() : await getStoreCurrency();
  const money = (value: number) => formatCurrency(value, currency.code, currency.locale);
  // A code with no discount behind it is left as the merchant wrote it —
  // some stores run codes this system never sees — so their own copy carries
  // the banner instead of derived text that would be a guess.
  const offer =
    options.offer.trim() || (coupon ? describeCouponOffer(coupon, money, say) : "");
  const condition =
    options.condition.trim() || (coupon ? describeCouponCondition(coupon, money, say) : "");
  if (!offer) return { kind: "silent" };

  const endsOn =
    options.showExpiry && coupon?.endDate
      ? formatCouponEnds(coupon.endDate, options.locale, say)
      : "";
  return {
    kind: "live",
    code: coupon?.code || code,
    offer,
    condition,
    endsOn,
    ...(coupon?.endDate ? { endsAt: coupon.endDate } : {}),
  };
}
