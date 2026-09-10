"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountrySelect } from "@/components/common/country-multi-select";
import { RegionSelect } from "@/components/common/region-select";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

type ShippingQuote = {
  available: boolean;
  cost: number;
};

type QuotedDeliveryDays = { min: number; max: number } | null;

/**
 * The delivery window belonging to the quoted cost. The server prices the
 * default option but doesn't say which one it was, so the cost is the join
 * key: the first option matching it is the one the number came from. No
 * match (legacy flat rate, fallback pricing) means no window — null, never
 * a guess borrowed from a different option.
 */
function deliveryDaysForQuote(
  data: unknown,
  cost: number,
): QuotedDeliveryDays {
  const options = Array.isArray(
    (data as { singleOptions?: unknown })?.singleOptions,
  )
    ? ((data as { singleOptions: unknown[] }).singleOptions as Array<{
        cost?: unknown;
        deliveryDays?: { min?: unknown; max?: unknown };
      }>)
    : [];
  const matched = options.find(
    (option) => Math.max(0, Number(option?.cost || 0)) === cost,
  );
  const days = matched?.deliveryDays;
  const min = Number(days?.min);
  const max = Number(days?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return null;
  return { min: Math.max(0, min), max };
}

type CartShippingEstimatorProps = {
  /** False for digital-only carts — nothing to estimate. */
  hasShippableItems: boolean;
  /**
   * Identity of the cart contents. Rates depend on the items (weight, subtotal
   * thresholds, vendor split), so an existing estimate is re-quoted whenever
   * this changes — a quantity bump can move the cart across a `free_over`
   * boundary.
   */
  cartSignature: string;
  formatPrice: (amount: number) => string;
  /**
   * Reports the current estimate to the page so the order total can include
   * it. `null` whenever there is no trustworthy number (no estimate yet,
   * destination unavailable, fetch failed) — the caller falls back to its
   * "calculated at checkout" convention rather than showing a guess.
   */
  onEstimate: (cost: number | null) => void;
  /**
   * Reports the delivery window quoted alongside the cost, for skins that
   * show one (the Electronics summary's delivery strip). Follows `onEstimate`
   * exactly: null whenever the cost is null or the quoted option carries no
   * window. Optional — the Classic summary doesn't subscribe.
   */
  onDeliveryDays?: (days: QuotedDeliveryDays) => void;
  /** Renders the summary row this estimator fills the value slot of. */
  renderRow: (value: ReactNode) => ReactNode;
};

/**
 * "Estimate shipping" affordance for the cart summary.
 *
 * Calls the same `/api/checkout/shipping-rates` endpoint checkout uses — the
 * server rates the real cart (true weights, digital lines excluded, per-vendor
 * split when active) for a country + region, so the number shown here is
 * exactly what checkout will quote for that destination, not a lookalike
 * computed client-side. Mirrors the tax row's "Calculate" pattern sitting a
 * few rows below.
 */
export function CartShippingEstimator({
  hasShippableItems,
  cartSignature,
  formatPrice,
  onEstimate,
  onDeliveryDays,
  renderRow,
}: CartShippingEstimatorProps) {
  const t = useTranslations();

  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  // Estimation starts only on the explicit button press — never on mount —
  // so the default country can sit in the select without firing a request
  // for a destination the shopper never chose.
  const [requested, setRequested] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [quote, setQuote] = useState<ShippingQuote | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const onEstimateRef = useRef(onEstimate);
  const onDeliveryDaysRef = useRef(onDeliveryDays);
  useEffect(() => {
    onEstimateRef.current = onEstimate;
    onDeliveryDaysRef.current = onDeliveryDays;
  });

  // Once requested, destination edits and cart changes re-quote on their own;
  // the button is only the initial consent.
  useApplyOnChange(
    [requested, country, region, cartSignature, attempt, hasShippableItems],
    () => {
      if (!requested || !country.trim() || !hasShippableItems) return;
      setLoading(true);
      setFailed(false);
    },
  );

  useEffect(() => {
    if (!requested || !country.trim() || !hasShippableItems) return;

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/checkout/shipping-rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ country, state: region }),
        });
        const json = await res.json().catch(() => null);
        if (!active) return;
        if (res.ok && json?.success) {
          const next: ShippingQuote = {
            available: json.data?.available !== false,
            cost: Math.max(0, Number(json.data?.shippingCost || 0)),
          };
          setQuote(next);
          onEstimateRef.current(next.available ? next.cost : null);
          onDeliveryDaysRef.current?.(
            next.available ? deliveryDaysForQuote(json.data, next.cost) : null,
          );
        } else {
          setQuote(null);
          setFailed(true);
          onEstimateRef.current(null);
          onDeliveryDaysRef.current?.(null);
        }
      } catch {
        if (active) {
          setQuote(null);
          setFailed(true);
          onEstimateRef.current(null);
          onDeliveryDaysRef.current?.(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [requested, country, region, cartSignature, attempt, hasShippableItems]);

  const calculateLabel = t.has("checkout.calculate")
    ? t("checkout.calculate")
    : "Calculate";
  const estimateLabel = t.has("cart.estimateShipping")
    ? t("cart.estimateShipping")
    : "Estimate shipping";
  const retryLabel = t.has("common.retry") ? t("common.retry") : "Retry";
  const linkButtonClass =
    "text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground";

  if (!hasShippableItems) {
    return (
      <>
        {renderRow(
          <span aria-label={t("cart.shippingCalculatedAtCheckout")}>
            &mdash;
          </span>,
        )}
      </>
    );
  }

  const rowValue = loading ? (
    <span
      role="status"
      aria-label={t("checkout.shippingUpdating")}
      className="inline-flex items-center"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
    </span>
  ) : quote?.available ? (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      className={linkButtonClass}
      title={estimateLabel}
    >
      {quote.cost > 0 ? formatPrice(quote.cost) : t("checkout.free")}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      className={linkButtonClass}
    >
      {estimateLabel}
    </button>
  );

  return (
    <>
      {renderRow(rowValue)}
      {open ? (
        <div className="space-y-3 rounded-lg border p-3">
          <CountrySelect
            value={country}
            onChange={(value) => {
              setCountry(value);
              // A region belongs to its country; carrying it across would
              // quote a zone the shopper is not in.
              setRegion("");
            }}
            placeholder={t("checkout.country")}
            searchPlaceholder={t("checkout.searchCountry")}
          />
          {country.trim() ? (
            <RegionSelect
              country={country}
              value={region}
              onChange={setRegion}
              label={t("checkout.state")}
            />
          ) : null}
          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              {t("checkout.shippingRateFailed")}
            </p>
          ) : quote && !quote.available ? (
            <p role="alert" className="text-sm text-destructive">
              {t("checkout.shippingUnavailable")}
            </p>
          ) : null}
          {!requested || failed ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!country.trim() || loading}
              onClick={() => {
                if (failed) setAttempt((value) => value + 1);
                setRequested(true);
              }}
            >
              {failed ? retryLabel : calculateLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
