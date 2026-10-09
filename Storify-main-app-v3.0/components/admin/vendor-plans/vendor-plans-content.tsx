"use client";

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { Eye, LayoutGrid, Layers, Plus, Rows3 } from "lucide-react";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { VendorPlansList } from "@/components/admin/vendor-plans/vendor-plans-list";
import { VendorPlansGrid } from "@/components/admin/vendor-plans/vendor-plans-grid";
import { VendorPlansPreview } from "@/components/admin/vendor-plans/vendor-plans-preview";
import type {
  AdminPlanAction,
  AdminVendorPlan,
  CommissionOnlySummary,
} from "@/components/admin/vendor-plans/types";

type PlansView = "list" | "cards";

// Each admin keeps the view they picked, in this browser only.
const VIEW_STORAGE_KEY = "admin-vendor-plans-view";
const VIEW_CHANGE_EVENT = "admin-vendor-plans-view-change";

function subscribeToView(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(VIEW_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(VIEW_CHANGE_EVENT, callback);
  };
}

function getViewSnapshot(): PlansView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "cards"
      ? "cards"
      : "list";
  } catch {
    return "list";
  }
}

function getServerViewSnapshot(): PlansView {
  return "list";
}

function setStoredView(view: PlansView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Private mode or blocked storage: the switch still works for this visit.
  }
  window.dispatchEvent(new Event(VIEW_CHANGE_EVENT));
}

const PLANS_API = "/api/admin/vendors/plans";

interface VendorPlansContentProps {
  locale: string;
  plans: AdminVendorPlan[];
  commissionOnly: CommissionOnlySummary;
}

export function VendorPlansContent({
  locale,
  plans,
  commissionOnly,
}: VendorPlansContentProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const isMobile = useIsMobile();
  const basePath = `/${locale}/admin/vendors/plans`;

  const storedView = useSyncExternalStore(
    subscribeToView,
    getViewSnapshot,
    getServerViewSnapshot,
  );
  // A click wins for the rest of the visit even where storage is blocked.
  const [pickedView, setPickedView] = useState<PlansView | null>(null);
  const view = pickedView ?? storedView;
  const chooseView = (next: PlansView) => {
    setPickedView(next);
    setStoredView(next);
  };

  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Offered plans in the order vendors see them. Held locally so a drag shows
  // at once; the server's order takes over again whenever it re-renders.
  const [order, setOrder] = useState<string[]>([]);
  useApplyOnChange([plans], () => {
    setOrder(plans.filter((p) => p.status === "active").map((p) => p.id));
  });

  const byId = useMemo(
    () => new Map(plans.map((plan) => [plan.id, plan])),
    [plans],
  );
  const activePlans = useMemo(
    () =>
      order
        .map((id) => byId.get(id))
        .filter((plan): plan is AdminVendorPlan => Boolean(plan)),
    [order, byId],
  );
  const archivedPlans = useMemo(
    () => plans.filter((plan) => plan.status === "archived"),
    [plans],
  );

  const handleReorder = useCallback(
    async (activeId: string, overId: string) => {
      const from = order.indexOf(activeId);
      const to = order.indexOf(overId);
      if (from < 0 || to < 0 || from === to) return;

      const previous = order;
      const next = arrayMove(order, from, to);
      setOrder(next);
      try {
        await apiClient.put(`${PLANS_API}/reorder`, {
          ids: [...next, ...archivedPlans.map((plan) => plan.id)],
        });
        toast.success("Plan order saved");
        router.refresh();
      } catch (error) {
        setOrder(previous);
        toast.error(
          error instanceof Error ? error.message : "Couldn't save the new order",
        );
      }
    },
    [order, archivedPlans, router],
  );

  const runUpdate = useCallback(
    async (
      plan: AdminVendorPlan,
      body: Record<string, unknown>,
      success: string,
      failure: string,
    ) => {
      setBusyId(plan.id);
      try {
        await apiClient.put(`${PLANS_API}/${plan.id}`, body);
        toast.success(success);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : failure);
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  const handleAction = useCallback(
    async (action: AdminPlanAction, plan: AdminVendorPlan) => {
      switch (action) {
        case "edit":
          router.push(`${basePath}/${plan.id}/edit`);
          return;
        case "makeDefault":
          await runUpdate(
            plan,
            { isDefault: true },
            `“${plan.name}” is now the default plan`,
            "Couldn't change the default plan",
          );
          return;
        case "archive":
          await runUpdate(
            plan,
            { status: "archived" },
            `“${plan.name}” archived. New vendors won't see it.`,
            "Couldn't archive the plan",
          );
          return;
        case "restore":
          await runUpdate(
            plan,
            { status: "active" },
            `“${plan.name}” is offered to vendors again`,
            "Couldn't restore the plan",
          );
          return;
        case "delete": {
          const confirmed = await confirm({
            title: "Delete plan",
            description: `Delete "${plan.name}"? This cannot be undone.`,
            confirmText: "Delete",
            cancelText: "Cancel",
            variant: "destructive",
          });
          if (!confirmed) return;
          setBusyId(plan.id);
          try {
            await apiClient.delete(`${PLANS_API}/${plan.id}`);
            toast.success("Plan deleted");
            router.refresh();
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Failed to delete plan",
            );
          } finally {
            setBusyId(null);
          }
        }
      }
    },
    [basePath, confirm, router, runUpdate],
  );

  const addPlan = () => router.push(`${basePath}/new`);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Vendor plans</h1>
          <p className="text-sm text-muted-foreground">
            Seller packages offered to vendors on your marketplace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {plans.length > 0 ? (
            <div
              role="group"
              aria-label="Layout"
              className="flex items-center gap-0.5 rounded-lg border bg-card p-0.5"
            >
              <ViewButton
                label="List"
                active={view === "list"}
                onClick={() => chooseView("list")}
              >
                <Rows3 className="size-4" />
              </ViewButton>
              <ViewButton
                label="Cards"
                active={view === "cards"}
                onClick={() => chooseView("cards")}
              >
                <LayoutGrid className="size-4" />
              </ViewButton>
            </div>
          ) : null}
          {activePlans.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPreviewOpen(true)}
              aria-label="Vendor view"
            >
              <Eye className="size-4" />
              <span className="hidden sm:inline">Vendor view</span>
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={addPlan}>
            <Plus className="size-4" />
            Add plan
          </Button>
        </div>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
              <Layers className="size-5" />
            </span>
            <div className="space-y-1">
              <h2 className="text-base font-semibold">No plans yet</h2>
              <p className="max-w-md text-[13px] leading-5 text-muted-foreground">
                Create a plan to charge vendors a monthly or yearly fee. Until
                then, every vendor sells on the {commissionOnly.rate}% store
                commission.
              </p>
            </div>
            <Button type="button" size="sm" onClick={addPlan}>
              <Plus className="size-4" />
              Add plan
            </Button>
          </CardContent>
        </Card>
      ) : view === "cards" ? (
        <VendorPlansGrid
          activePlans={activePlans}
          archivedPlans={archivedPlans}
          commissionOnly={commissionOnly}
          basePath={basePath}
          busyId={busyId}
          onAction={handleAction}
          onReorder={handleReorder}
          onAdd={addPlan}
        />
      ) : (
        <VendorPlansList
          activePlans={activePlans}
          archivedPlans={archivedPlans}
          commissionOnly={commissionOnly}
          basePath={basePath}
          busyId={busyId}
          compact={isMobile}
          onAction={handleAction}
          onReorder={handleReorder}
        />
      )}

      <VendorPlansPreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        plans={activePlans}
      />
    </div>
  );
}

function ViewButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            "grid size-7 place-items-center rounded-md transition-colors",
            active
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
