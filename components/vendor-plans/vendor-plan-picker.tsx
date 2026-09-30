"use client";

import { useMemo, useState } from "react";
import type { PublicVendorPlan } from "@/lib/vendors/vendor-onboarding";
import { PricingPlanCard } from "@/components/vendor-plans/pricing-plan-card";
import { PlanGrid } from "@/components/vendor-plans/plan-grid";
import {
  PlanBillingToggle,
  type BillingView,
} from "@/components/vendor-plans/plan-billing-toggle";
import {
  planCardLines,
  sharedPlanPacks,
  sharedPlanPacksSentence,
} from "@/components/vendor-plans/plan-copy";

interface VendorPlanPickerProps {
  plans: PublicVendorPlan[];
  selectedId: string | null;
  onSelect?: (planId: string) => void;
  /** Shows the choice without letting it change (admin previews). */
  disabled?: boolean;
}

/**
 * The plan choice exactly as a vendor meets it: the Monthly/Yearly switch when
 * the catalogue has both, the cards, and one line for the tools every plan in
 * view shares. The storefront wizard, the admin's wizard preview and the admin
 * "Vendor view" all render this, so the three cannot drift apart.
 */
export function VendorPlanPicker({
  plans,
  selectedId,
  onSelect,
  disabled = false,
}: VendorPlanPickerProps) {
  const showToggle =
    plans.some((p) => p.billingInterval === "monthly") &&
    plans.some((p) => p.billingInterval === "yearly");

  // Opens on the interval of the chosen plan (or the first paid one), so a
  // pre-selected yearly plan is on screen at first render.
  const [view, setView] = useState<BillingView>(() => {
    const seed =
      plans.find((p) => p.id === selectedId) ??
      plans.find((p) => p.billingInterval !== "none");
    return seed?.billingInterval === "yearly" ? "yearly" : "monthly";
  });

  // A monthly/yearly view shows plans of that interval plus the always
  // relevant free plans (billingInterval "none").
  const visiblePlans = useMemo(
    () =>
      showToggle
        ? plans.filter(
            (p) => p.billingInterval === "none" || p.billingInterval === view,
          )
        : plans,
    [plans, showToggle, view],
  );

  const shared = useMemo(() => sharedPlanPacks(visiblePlans), [visiblePlans]);
  const sharedSentence = sharedPlanPacksSentence(shared, visiblePlans.length);
  // "Recommended" means something only next to an alternative.
  const markRecommended = visiblePlans.length > 1;

  return (
    <div className="space-y-4">
      {showToggle ? (
        <div className="flex justify-center">
          <PlanBillingToggle value={view} onChange={setView} />
        </div>
      ) : null}

      <PlanGrid count={visiblePlans.length}>
        {visiblePlans.map((plan) => (
          <PricingPlanCard
            key={plan.id}
            plan={{ ...plan, lines: planCardLines(plan, shared) }}
            recommended={markRecommended && plan.isDefault}
            selected={plan.id === selectedId}
            disabled={disabled}
            onSelect={onSelect ? () => onSelect(plan.id) : undefined}
          />
        ))}
      </PlanGrid>

      {sharedSentence ? (
        <p className="text-center text-[13px] text-muted-foreground">
          {sharedSentence}
        </p>
      ) : null}
    </div>
  );
}
