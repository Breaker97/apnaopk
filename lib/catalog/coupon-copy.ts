import "server-only";

import { getTranslations } from "next-intl/server";
import { couponCopyFrom, type CouponCopy } from "@/lib/catalog/coupon-words";

/**
 * The coupon sentences in one language (`couponCopyFrom`), from the store's
 * message catalogue. The locale is passed in: nothing here reads the request.
 */
export async function getCouponCopy(locale: string): Promise<CouponCopy> {
  const t = await getTranslations({ locale });
  return couponCopyFrom(
    (key, fallback, values) => (t.has(key) ? t(key, values) : fallback),
    locale,
  );
}
