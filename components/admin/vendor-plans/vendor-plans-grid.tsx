"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Info, Plus, Users } from "lucide-react";
import Link from "@/components/language/link";
import { cn } from "@/lib/utils";
import {
  PlanDefaultBadge,
  PlanDragHandle,
  PlanPrice,
  PlanStatusBadge,
  PlanStripeMissing,
  PlanToolsSummary,
} from "@/components/admin/vendor-plans/vendor-plan-parts";
import { VendorPlanMenu } from "@/components/admin/vendor-plans/vendor-plan-menu";
import type {
  AdminPlanAction,
  AdminVendorPlan,
  CommissionOnlySummary,
} from "@/components/admin/vendor-plans/types";

interface VendorPlansGridProps {
  activePlans: AdminVendorPlan[];
  archivedPlans: AdminVendorPlan[];
  commissionOnly: CommissionOnlySummary;
  basePath: string;
  busyId: string | null;
  onAction: (action: AdminPlanAction, plan: AdminVendorPlan) => void;
  onReorder: (activeId: string, overId: string) => void;
  onAdd: () => void;
}

/**
 * The same catalogue as white cards, for admins who would rather look at plans
 * than scan columns. Cards drag by their grip like the list's rows; a dashed
 * card at the end adds the next plan.
 */
export function VendorPlansGrid({
  activePlans,
  archivedPlans,
  commissionOnly,
  basePath,
  busyId,
  onAction,
  onReorder,
  onAdd,
}: VendorPlansGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
  };

  const sortable = activePlans.length > 1;

  return (
    <div className="space-y-4">
      {/* Around the grid rather than in it, so its screen-reader helpers
          never land in a grid cell; the fixed id keeps SSR ids stable. */}
      <DndContext
        id="vendor-plans-grid"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <SortableContext
            items={activePlans.map((plan) => plan.id)}
            strategy={rectSortingStrategy}
          >
            {activePlans.map((plan) => (
              <SortablePlanCard
                key={plan.id}
                plan={plan}
                sortable={sortable}
                basePath={basePath}
                busy={busyId === plan.id}
                onAction={onAction}
              />
            ))}
          </SortableContext>

          {archivedPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              handle={null}
              basePath={basePath}
              busy={busyId === plan.id}
              onAction={onAction}
            />
          ))}

          <button
            type="button"
            onClick={onAdd}
            className="flex min-h-24 flex-col items-center justify-center gap-2.5 rounded-2xl sm:min-h-[260px] border-[1.5px] border-dashed border-border text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
              <Plus className="size-4" />
            </span>
            Add plan
          </button>
        </div>
      </DndContext>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        {commissionOnly.vendorCount === 0
          ? `Vendors not on any plan pay the ${commissionOnly.rate}% store commission.`
          : `${
              commissionOnly.vendorCount === 1
                ? "1 vendor isn’t"
                : `${commissionOnly.vendorCount} vendors aren’t`
            } on any plan. They pay the ${commissionOnly.rate}% store commission.`}
      </p>
    </div>
  );
}

function SortablePlanCard({
  plan,
  sortable,
  ...rest
}: Omit<PlanCardProps, "handle" | "dragRef" | "dragStyle" | "dragging"> & {
  sortable: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: plan.id, disabled: !sortable });

  return (
    <PlanCard
      plan={plan}
      {...rest}
      dragRef={setNodeRef}
      dragStyle={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
      handle={
        sortable ? (
          <PlanDragHandle
            planName={plan.name}
            className="-ml-1.5"
            {...attributes}
            {...listeners}
          />
        ) : null
      }
    />
  );
}

interface PlanCardProps {
  plan: AdminVendorPlan;
  handle: ReactNode;
  basePath: string;
  busy: boolean;
  onAction: (action: AdminPlanAction, plan: AdminVendorPlan) => void;
  dragRef?: (node: HTMLElement | null) => void;
  dragStyle?: CSSProperties;
  dragging?: boolean;
}

function PlanCard({
  plan,
  handle,
  basePath,
  busy,
  onAction,
  dragRef,
  dragStyle,
  dragging = false,
}: PlanCardProps) {
  const archived = plan.status === "archived";
  const paid = plan.billingInterval !== "none" && plan.price > 0;
  const dim = archived && "opacity-55";

  return (
    <div
      ref={dragRef}
      style={dragStyle}
      className={cn(
        "flex min-h-[260px] flex-col gap-3.5 rounded-2xl border bg-card p-5 pr-3 text-card-foreground shadow-xs",
        dragging && "relative z-10 shadow-lg",
      )}
    >
      <div className="flex items-start gap-1.5">
        {handle}
        <div className={cn("min-w-0 flex-1 space-y-0.5", dim)}>
          <div className="flex min-w-0 items-center gap-1.5">
            <Link
              href={`${basePath}/${plan.id}/edit`}
              title={plan.name}
              className="truncate text-[15px] font-semibold text-foreground hover:text-primary hover:underline"
            >
              {plan.name}
            </Link>
            {plan.isDefault ? <PlanDefaultBadge /> : null}
            {archived ? <PlanStatusBadge status="archived" /> : null}
          </div>
          {plan.description ? (
            <p
              className="truncate text-[13px] text-muted-foreground"
              title={plan.description}
            >
              {plan.description}
            </p>
          ) : null}
        </div>
        <VendorPlanMenu plan={plan} busy={busy} onAction={onAction} />
      </div>

      <div className={cn("space-y-0.5 pr-2", dim)}>
        <PlanPrice
          plan={plan}
          amountClassName="text-[28px] leading-9 font-bold tracking-tight"
          cadenceClassName="text-[13px]"
        />
        {paid && plan.trialDays > 0 ? (
          <p className="text-xs text-muted-foreground">
            {plan.trialDays}-day free trial
          </p>
        ) : null}
        {plan.stripeMissing ? (
          <PlanStripeMissing className="flex text-xs" />
        ) : null}
      </div>

      <div className="mr-2 h-px bg-border" />

      <dl className={cn("grid grid-cols-2 gap-x-3 gap-y-3 pr-2", dim)}>
        <Fact label="Commission">{plan.commissionRate}%</Fact>
        <Fact label="Products">{plan.limits.products ?? "Unlimited"}</Fact>
        <Fact label="Staff">{plan.limits.staff ?? "Unlimited"}</Fact>
        <Fact label="Tools">
          <PlanToolsSummary plan={plan} />
        </Fact>
      </dl>

      <p
        className={cn(
          "mt-auto flex items-center gap-1.5 text-xs text-muted-foreground",
          dim,
        )}
      >
        <Users className="size-3.5" aria-hidden="true" />
        {plan.vendorCount === 0
          ? "No vendors yet"
          : plan.vendorCount === 1
            ? "1 vendor"
            : `${plan.vendorCount} vendors`}
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-[13px] font-semibold text-foreground">
        {children}
      </dd>
    </div>
  );
}
