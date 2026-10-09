import "server-only";

import type { ModernProduct } from "@/lib/products/modern-product";
import { getProductDiscountPercentage } from "@/lib/products/price-display";
import { getStorefrontProductCards } from "@/lib/products/storefront-product-cards";
import { readOr, type SectionReadMode } from "./read-mode";

/**
 * The deadline the Countdown Offer counts down to, as epoch milliseconds, or
 * null when it has none (no date, or one that does not parse). Without a
 * deadline the section has nothing to say; past it, a countdown frozen at
 * zero advertises urgency that has expired, so the section goes quiet too.
 */
export function countdownDeadline(endsAt: unknown): number | null {
  if (typeof endsAt !== "string" || !endsAt) return null;
  const deadline = Date.parse(endsAt);
  return Number.isNaN(deadline) ? null : deadline;
}

/**
 * The deals the Countdown Offer's deals panel lays out: the hand-picked
 * products in slot order, else whatever is on sale, as many as the layout has
 * slots — and the biggest saving among them, read off the products rather
 * than typed, so the panel can never claim a discount it does not show.
 *
 * In page mode a failed read leaves the panel without deals (the countdown
 * still shows).
 */
export async function loadDeals(
  options: {
    productIds: string[];
    slots: number;
    /** A vendor's landing page: that store's deals alone. */
    vendorId?: string;
  },
  mode: SectionReadMode = "page",
): Promise<{ products: ModernProduct[]; topSaving: number }> {
  const chosen = options.productIds.filter(Boolean).slice(0, options.slots);
  const products = await readOr(
    mode,
    () =>
      getStorefrontProductCards({
        ...(chosen.length > 0
          ? { ids: chosen, limit: chosen.length }
          : { onSale: true, limit: options.slots }),
        ...(options.vendorId ? { vendorId: options.vendorId } : {}),
      }),
    () => [],
  );
  const topSaving = products.reduce(
    (best, product) => Math.max(best, getProductDiscountPercentage(product)),
    0,
  );
  return { products, topSaving };
}
