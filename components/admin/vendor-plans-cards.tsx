"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Package,
  Sparkles,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { PricingPlanCard } from "@/components/vendor-plans/pricing-plan-card";
import {
  PlanBillingToggle,
  type BillingView,
} from "@/components/vendor-plans/plan-billing-toggle";
import { PlanGrid } from "@/components/vendor-plans/plan-grid";
import { planFeatureLines } from "@/components/vendor-plans/plan-feature-lines";
import {
  packsFromPlanCapabilities,
  planSellsPack,
  type VendorPlanCapabilityInput,
} from "@/config/permissions.config";

export interface VendorPlanCard {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  price: number;
  billingInterval: "monthly" | "yearly" | "none";
  commissionRate: number;
  trialDays: number;
  features: string[];
  limits?: { products?: number | null; staff?: number | null };
  capabilities?: VendorPlanCapabilityInput;
  isDefault: boolean;
  status: "active" | "archived";
  stripePriceId?: string | null;
  stripePriceActive?: boolean;
}

interface VendorPlansCardsProps {
  locale: string;
  plans: VendorPlanCard[];
}

export function VendorPlansCards({ locale, plans }: VendorPlansCardsProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const basePath = `/${locale}/admin/vendors/plans`;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [view, setView] = useState<BillingView>("monthly");

  // A monthly/yearly view shows plans of that interval plus always-relevant
  // free plans (billingInterval "none").
  const visiblePlans = useMemo(
    () =>
      plans.filter(
        (plan) =>
          plan.billingInterval === "none" || plan.billingInterval === view,
      ),
    [plans, view],
  );

  const hasMonthly = plans.some((p) => p.billingInterval === "monthly");
  const hasYearly = plans.some((p) => p.billingInterval === "yearly");
  const showToggle = hasMonthly && hasYearly;

  const handleDelete = useCallback(
    async (plan: VendorPlanCard) => {
      const confirmed = await confirm({
        title: "Delete plan",
        description: `Delete "${plan.name}"? This cannot be undone. Plans in use by vendors cannot be deleted — archive them instead.`,
        confirmText: "Delete",
        cancelText: "Cancel",
        variant: "destructive",
      });
      if (!confirmed) return;

      setDeletingId(plan._id);
      try {
        await apiClient.delete(`/api/admin/vendors/plans/${plan._id}`);
        toast.success("Plan deleted");
        router.refresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to delete plan",
        );
      } finally {
        setDeletingId(null);
      }
    },
    [confirm, router],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Plans</h1>
          <p className="text-sm text-muted-foreground">
            Seller packages offered to vendors on your marketplace.
          </p>
        </div>
        <Button size="sm" onClick={() => router.push(`${basePath}/new`)}>
          <Plus className="h-4 w-4" />
          Add plan
        </Button>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Package className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No plans yet. Create your first plan to get started.
            </p>
            <Button size="sm" onClick={() => router.push(`${basePath}/new`)}>
              <Plus className="h-4 w-4" />
              Add plan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {showToggle && (
            <div className="flex justify-center">
              <PlanBillingToggle value={view} onChange={setView} />
            </div>
          )}

          {visiblePlans.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No {view} plans. Switch the billing view or add one.
            </p>
          ) : (
            <PlanGrid count={visiblePlans.length}>
              {visiblePlans.map((plan) => (
                (() => {
                  const paid =
                    plan.billingInterval !== "none" && Number(plan.price) > 0;
                  const stripeReady =
                    paid && Boolean(plan.stripePriceId && plan.stripePriceActive);
                  return (
                    <PricingPlanCard
                      key={plan._id}
                      plan={{
                        id: plan._id,
                        name: plan.name,
                        description: plan.description,
                        price: plan.price,
                        billingInterval: plan.billingInterval,
                        commissionRate: plan.commissionRate,
                        trialDays: plan.trialDays,
                        // Derived from the packs the plan actually sells, so
                        // the pricing card cannot advertise what the
                        // entitlement layer will not grant.
                        features: planFeatureLines(plan.features, plan.limits, {
                          packs: packsFromPlanCapabilities(plan.capabilities),
                        }),
                      }}
                      highlighted={plan.isDefault && plan.status === "active"}
                      muted={plan.status === "archived"}
                      badges={
                        <>
                          {paid && (
                            <Badge
                              variant={stripeReady ? "secondary" : "outline"}
                              className="gap-1"
                            >
                              <CreditCard className="h-3 w-3" />
                              {stripeReady ? "Stripe" : "Needs Stripe"}
                            </Badge>
                          )}
                          {planSellsPack(plan.capabilities, "aiStudio") && (
                            <Badge variant="secondary" className="gap-1">
                              <Sparkles className="h-3 w-3" />
                              AI
                            </Badge>
                          )}
                        </>
                      }
                      footer={
                        <div className="flex gap-2">
                          <Button
                            variant={plan.isDefault ? "secondary" : "outline"}
                            size="sm"
                            className="flex-1"
                            onClick={() =>
                              router.push(`${basePath}/${plan._id}/edit`)
                            }
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="flex-1"
                            disabled={deletingId === plan._id}
                            onClick={() => handleDelete(plan)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      }
                    />
                  );
                })()
              ))}
            </PlanGrid>
          )}
        </>
      )}
    </div>
  );
}
