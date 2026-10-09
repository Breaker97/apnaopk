"use client";

import { cn } from "@/lib/utils";

export type BillingView = "monthly" | "yearly";

interface PlanBillingToggleProps {
  value: BillingView;
  onChange: (value: BillingView) => void;
  className?: string;
}

const OPTIONS: { value: BillingView; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

/**
 * Segmented Monthly/Yearly switch used above the pricing grid. Styled to match
 * the onboarding Builder/Preview tabs: a bordered pill container with the active
 * option filled in the primary color.
 */
export function PlanBillingToggle({
  value,
  onChange,
  className,
}: PlanBillingToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Billing interval"
      className={cn(
        "inline-flex h-11 items-center gap-1 rounded-xl border border-border bg-background p-1 shadow-sm",
        className,
      )}
    >
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-lg px-6 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
