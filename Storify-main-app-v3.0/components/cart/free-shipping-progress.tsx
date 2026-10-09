"use client";

import { useTranslations } from "next-intl";
import { Truck } from "lucide-react";
import { cn } from "@/lib/utils";

type FreeShippingProgressProps = {
  /** Cart subtotal in the store's currency. */
  subtotal: number;
  /** `orders.freeShippingThreshold`. 0 or below means the store has none. */
  threshold: number;
  /**
   * `shipping.enabled`. When the store rates by zone, the threshold is dead
   * config — see the note on the qualifying rule below.
   */
  zoneShippingEnabled: boolean;
  /** False for digital-only carts, which are never shipped. */
  hasShippableItems: boolean;
  formatPrice: (amount: number) => string;
  className?: string;
};

/**
 * "Add X more for free shipping" nudge for the cart.
 *
 * Deliberately silent unless the promise is actually true. `freeShippingThreshold`
 * only reaches the shopper's bill through `legacyShipping()`, which
 * `calculateShipping()` calls only while `shipping.enabled` is false. A store on
 * zone-based rates keeps the old threshold value in its settings but the rate
 * engine never reads it, so rendering the bar there would promise free delivery
 * the shopper then gets charged for at checkout. Stores on zone rates express
 * the same thing per zone with a `free_over` rate, which is a different number
 * and only applies to the zone the address falls in — not something the cart can
 * state before it knows the address.
 */
export function FreeShippingProgress({
  subtotal,
  threshold,
  zoneShippingEnabled,
  hasShippableItems,
  formatPrice,
  className,
}: FreeShippingProgressProps) {
  const t = useTranslations();

  if (zoneShippingEnabled) return null;
  if (!hasShippableItems) return null;
  if (!Number.isFinite(threshold) || threshold <= 0) return null;
  if (subtotal <= 0) return null;

  const qualified = subtotal >= threshold;
  const remaining = Math.max(0, threshold - subtotal);
  const percent = Math.min(100, Math.max(0, (subtotal / threshold) * 100));

  const qualifiedLabel = t.has("cart.freeShipping")
    ? t("cart.freeShipping")
    : "You qualify for free shipping!";
  const remainingLabel = t.has("cart.freeShippingRemaining")
    ? t("cart.freeShippingRemaining", { amount: formatPrice(remaining) })
    : `Add ${formatPrice(remaining)} more for free shipping`;

  const message = qualified ? qualifiedLabel : remainingLabel;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Truck
          className={cn(
            "h-4 w-4 shrink-0",
            qualified ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
        {/* Polite rather than assertive: the amount changes on every quantity
            edit, and an assertive region would interrupt the shopper mid-edit
            each time. */}
        <p
          aria-live="polite"
          className={cn(
            "text-sm",
            qualified
              ? "font-medium text-emerald-700 dark:text-emerald-400"
              : "text-muted-foreground",
          )}
        >
          {message}
        </p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label={message}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 ease-out",
            qualified ? "bg-emerald-600 dark:bg-emerald-500" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
