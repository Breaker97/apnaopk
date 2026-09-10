"use client";

import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";
import { useCurrency } from "@/providers/currency-provider";

type PlanBillingInterval = "monthly" | "yearly" | "none";

/**
 * Minimal shape both the admin catalog and the onboarding wizard can satisfy.
 * Optional fields degrade gracefully when a surface doesn't provide them.
 */
interface PricingPlanData {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency?: string;
  billingInterval: PlanBillingInterval;
  commissionRate: number;
  trialDays?: number;
  features?: string[];
}

interface PricingPlanCardProps {
  plan: PricingPlanData;
  /** Gradient emphasis treatment (used for the default plan). */
  highlighted?: boolean;
  /** Dim + non-interactive look (e.g. archived plans in the admin catalog). */
  muted?: boolean;
  /** Ring + selected state (onboarding). */
  selected?: boolean;
  /** Makes the whole card a button (onboarding selection). */
  onSelect?: () => void;
  /** Extra badges shown top-right (e.g. Default / Archived in admin). */
  badges?: ReactNode;
  /** Footer action area (admin: Edit/Delete; onboarding: none). */
  footer?: ReactNode;
  className?: string;
}

/**
 * Plan prices carry no currency of their own — `VendorPlan.price` is charged in
 * the store currency (see `lib/vendor-plan-stripe.ts`), so the card falls back
 * to the store default rather than to a hardcoded USD that would mislabel every
 * plan on a non-dollar marketplace.
 */
function priceParts(
  plan: PricingPlanData,
  storeCurrencyCode: string,
): { amount: string; cadence: string } {
  if (plan.billingInterval === "none" || plan.price <= 0) {
    return { amount: "Free", cadence: "" };
  }
  const currency = resolveCurrency(plan.currency || storeCurrencyCode);
  return {
    amount: formatCurrency(plan.price, currency.code, currency.locale, {
      minimumFractionDigits: plan.price % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }),
    cadence: plan.billingInterval === "yearly" ? "/yr" : "/mo",
  };
}

export function PricingPlanCard({
  plan,
  highlighted = false,
  muted = false,
  selected = false,
  onSelect,
  badges,
  footer,
  className,
}: PricingPlanCardProps) {
  const { currency: storeCurrency } = useCurrency();
  const { amount, cadence } = priceParts(plan, storeCurrency.code);
  const interactive = Boolean(onSelect);

  const body = (
    <div
      className={cn(
        "relative flex h-full flex-col rounded-2xl border p-6 text-left transition-all",
        highlighted
          ? // Storify theme gradient: primary blue (#2065D1 → a deeper shade of
            // the same hue) instead of the old violet/indigo. Uses the primary
            // token so it tracks any theme recolor.
            "border-transparent bg-gradient-to-br from-primary to-[oklch(0.45_0.2_255)] text-white shadow-lg shadow-primary/20"
          : "border-border bg-card text-card-foreground",
        interactive && !highlighted && "hover:border-primary/50 hover:shadow-sm",
        interactive && "cursor-pointer",
        selected &&
          (highlighted
            ? "ring-2 ring-white/70 ring-offset-2 ring-offset-background"
            : "border-primary ring-2 ring-primary/40"),
        muted && "opacity-60",
        className,
      )}
    >
      {badges && (
        <div className="mb-3 flex items-center justify-end gap-1.5">{badges}</div>
      )}

      {/* Name + description */}
      <div className="space-y-1">
        <h3
          className={cn(
            "text-lg font-semibold",
            !highlighted && "text-foreground",
          )}
        >
          {plan.name}
        </h3>
        {plan.description ? (
          <p
            className={cn(
              "text-sm",
              highlighted ? "text-white/80" : "text-muted-foreground",
            )}
          >
            {plan.description}
          </p>
        ) : null}
      </div>

      {/* Price */}
      <div className="mt-5 flex items-baseline gap-1">
        <span className="text-4xl font-bold tracking-tight">{amount}</span>
        {cadence && (
          <span
            className={cn(
              "text-sm font-medium",
              highlighted ? "text-white/70" : "text-muted-foreground",
            )}
          >
            {cadence}
          </span>
        )}
      </div>
      <p
        className={cn(
          "mt-1 text-xs",
          highlighted ? "text-white/70" : "text-muted-foreground",
        )}
      >
        {plan.commissionRate}% commission per sale
        {plan.billingInterval !== "none" &&
        plan.trialDays &&
        plan.trialDays > 0
          ? ` · ${plan.trialDays} days free, no card needed`
          : ""}
      </p>

      {/* Features */}
      {plan.features && plan.features.length > 0 && (
        <ul className="mt-5 space-y-2.5 text-sm">
          {plan.features.map((feature, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <CheckCircle2
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  highlighted ? "text-white" : "text-primary",
                )}
              />
              <span className={highlighted ? "text-white/90" : undefined}>
                {feature}
              </span>
            </li>
          ))}
        </ul>
      )}

      {footer ? <div className="mt-auto pt-6">{footer}</div> : null}
    </div>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="block h-full w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 rounded-2xl"
      >
        {body}
      </button>
    );
  }

  return body;
}
