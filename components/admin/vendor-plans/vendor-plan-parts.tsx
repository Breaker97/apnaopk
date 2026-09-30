"use client";

import type { ComponentProps } from "react";
import { GripVertical, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/providers/currency-provider";
import {
  missingPlanPacksLabel,
  planPriceParts,
  planToolsSummary,
} from "@/components/vendor-plans/plan-copy";
import type { AdminVendorPlan } from "@/components/admin/vendor-plans/types";

export function PlanDefaultBadge() {
  return (
    <Badge
      variant="secondary"
      className="border-transparent bg-primary/10 text-[11px] font-semibold text-primary"
    >
      Default
    </Badge>
  );
}

export function PlanStatusBadge({ status }: { status: AdminVendorPlan["status"] }) {
  return status === "archived" ? (
    <Badge
      variant="secondary"
      className="bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300"
    >
      Archived
    </Badge>
  ) : (
    <Badge
      variant="secondary"
      className="bg-green-100 text-green-800 dark:bg-emerald-500/20 dark:text-emerald-300"
    >
      Active
    </Badge>
  );
}

/** Only a problem gets a line: an active paid plan with no live Stripe price. */
export function PlanStripeMissing({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-medium whitespace-nowrap text-amber-700 dark:text-amber-400",
        className,
      )}
      title="Card auto-renew is off for this plan until its Stripe price is linked. Open the plan and save it to relink."
    >
      <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
      Stripe not linked
    </span>
  );
}

/** "$29 /month" — the number carries the weight, the cadence stays quiet. */
export function PlanPrice({
  plan,
  amountClassName,
  cadenceClassName,
}: {
  plan: AdminVendorPlan;
  amountClassName?: string;
  cadenceClassName?: string;
}) {
  const { currency } = useCurrency();
  const { amount, cadence } = planPriceParts(plan, currency.code);
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className={cn("font-semibold text-foreground", amountClassName)}>
        {amount}
      </span>
      {cadence ? (
        <span className={cn("text-muted-foreground", cadenceClassName)}>
          {cadence}
        </span>
      ) : null}
    </span>
  );
}

/** "All tools" / "All but AI Studio" / "7 of 11 tools", with the gaps on hover. */
export function PlanToolsSummary({
  plan,
  className,
}: {
  plan: Pick<AdminVendorPlan, "packs">;
  className?: string;
}) {
  const summary = planToolsSummary(plan.packs);
  const missing = missingPlanPacksLabel(plan.packs);
  if (!missing || !summary.includes(" of ")) {
    return <span className={className}>{summary}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "cursor-default underline decoration-dotted underline-offset-2",
            className,
          )}
        >
          {summary}
        </span>
      </TooltipTrigger>
      <TooltipContent>{missing}</TooltipContent>
    </Tooltip>
  );
}

/** The grip a plan is dragged by; keyboard users pick it up with Space. */
export function PlanDragHandle({
  planName,
  className,
  ...props
}: { planName: string } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={`Reorder ${planName}`}
      className={cn(
        "grid size-7 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-muted-foreground active:cursor-grabbing",
        className,
      )}
      {...props}
    >
      <GripVertical className="size-4" />
    </button>
  );
}
