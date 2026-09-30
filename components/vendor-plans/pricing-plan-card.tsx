"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import { planPriceParts } from "@/components/vendor-plans/plan-copy";

type PlanBillingInterval = "monthly" | "yearly" | "none";

/**
 * Minimal shape the onboarding wizard, its admin preview and the admin's
 * "Vendor view" can all satisfy.
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
  /** The checklist, already trimmed to what sets this plan apart. */
  lines?: string[];
}

interface PricingPlanCardProps {
  plan: PricingPlanData;
  /** The store's default plan. Only worth saying beside other plans. */
  recommended?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /** Shows the choice without letting it change (admin previews). */
  disabled?: boolean;
  className?: string;
}

/**
 * One plan as a vendor weighs it. The choose button sits right under the
 * price, so every card's button lines up whatever the length of its list, and
 * the list below only carries what differs from the plans beside it.
 */
export function PricingPlanCard({
  plan,
  recommended = false,
  selected = false,
  onSelect,
  disabled = false,
  className,
}: PricingPlanCardProps) {
  const { currency: storeCurrency } = useCurrency();
  const { amount, cadence } = planPriceParts(plan, storeCurrency.code);
  const paid = plan.billingInterval !== "none" && plan.price > 0;
  const trialDays = paid ? Math.max(0, Math.floor(plan.trialDays ?? 0)) : 0;
  const lines = plan.lines ?? [];

  return (
    <div
      data-selected={selected || undefined}
      className={cn(
        "relative flex h-full flex-col gap-4 rounded-2xl border bg-card p-5 pt-6 text-left text-card-foreground shadow-xs transition-[border-color,box-shadow]",
        selected
          ? "border-primary shadow-md shadow-primary/10 ring-1 ring-primary"
          : "border-border",
        className,
      )}
    >
      {recommended ? (
        <span className="absolute -top-2.5 left-5 inline-flex h-5 items-center rounded-full bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground">
          Recommended
        </span>
      ) : null}

      <div className="min-h-[68px] space-y-1">
        <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
        {plan.description ? (
          <p className="line-clamp-2 text-[13px] leading-5 text-muted-foreground">
            {plan.description}
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold tracking-tight text-foreground">
            {amount}
          </span>
          {cadence ? (
            <span className="text-[13px] text-muted-foreground">{cadence}</span>
          ) : null}
        </div>
        <p className="text-[13px] text-muted-foreground">
          {paid ? "+ " : ""}
          {plan.commissionRate}% commission per sale
        </p>
      </div>

      <div className="space-y-2">
        <Button
          type="button"
          variant={selected ? "default" : "outline"}
          aria-pressed={selected}
          disabled={disabled}
          onClick={onSelect}
          className="h-10 w-full font-semibold"
        >
          {selected ? (
            <>
              <Check className="size-4" />
              Selected
            </>
          ) : (
            <span className="truncate">Choose {plan.name}</span>
          )}
        </Button>
        {trialDays > 0 ? (
          <p className="text-center text-xs text-muted-foreground">
            {trialDays} days free · no card needed
          </p>
        ) : null}
      </div>

      {lines.length > 0 ? (
        <>
          <div className="h-px bg-border" />
          <ul className="space-y-2.5 text-[13px] text-foreground">
            {lines.map((line, i) => (
              <li key={`${i}-${line}`} className="flex items-start gap-2.5">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span className="min-w-0 break-words">{line}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
