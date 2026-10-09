"use client";

import type { ReactNode } from "react";
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "@/components/language/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { COMMISSION_ONLY_PACKS } from "@/config/permissions.config";
import { planLimitsSummary } from "@/components/vendor-plans/plan-copy";
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

interface VendorPlansListProps {
  /** Offered plans, in the order vendors see them; these can be dragged. */
  activePlans: AdminVendorPlan[];
  /** Hidden from new vendors, so their order does not matter; listed last. */
  archivedPlans: AdminVendorPlan[];
  commissionOnly: CommissionOnlySummary;
  basePath: string;
  busyId: string | null;
  /** Phones: one stacked row per plan instead of table columns. */
  compact: boolean;
  onAction: (action: AdminPlanAction, plan: AdminVendorPlan) => void;
  onReorder: (activeId: string, overId: string) => void;
}

// Columns the admin reaches for least go first as the screen narrows, the way
// the Orders table sheds its columns.
const LIMITS_COL = "hidden w-[190px] xl:table-cell";
const TOOLS_COL = "hidden w-[150px] min-[1400px]:table-cell";

type RowRenderer = (
  plan: AdminVendorPlan,
  handle: ReactNode,
) => ReactNode;

/**
 * Admin → Vendors → Plans as one calm list, sized like the Orders table: a row
 * per plan with what an admin compares tiers by, the ⋮ menu, and a grip to set
 * the order vendors see the plans in.
 */
export function VendorPlansList({
  activePlans,
  archivedPlans,
  commissionOnly,
  basePath,
  busyId,
  compact,
  onAction,
  onReorder,
}: VendorPlansListProps) {
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

  const renderRow: RowRenderer = (plan, handle) =>
    compact ? (
      <CompactPlanRow
        plan={plan}
        handle={handle}
        basePath={basePath}
        busy={busyId === plan.id}
        onAction={onAction}
      />
    ) : (
      <PlanRowCells
        plan={plan}
        handle={handle}
        basePath={basePath}
        busy={busyId === plan.id}
        onAction={onAction}
      />
    );

  const sortableRows = (
    <SortableContext
      items={activePlans.map((plan) => plan.id)}
      strategy={verticalListSortingStrategy}
    >
      {activePlans.map((plan) => (
        <SortablePlanRow
          key={plan.id}
          plan={plan}
          compact={compact}
          // One plan has nowhere to move to.
          sortable={activePlans.length > 1}
          render={renderRow}
        />
      ))}
    </SortableContext>
  );

  // Outside the table on purpose: DndContext renders its screen-reader
  // helpers where it sits, and a <div> inside <tbody> is invalid HTML. The
  // fixed id keeps its aria ids equal on the server and in the browser.
  const withDnd = (children: ReactNode) => (
    <DndContext
      id="vendor-plans-list"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {children}
    </DndContext>
  );

  if (compact) {
    return withDnd(
      <div className="overflow-hidden rounded-[12px] border bg-card shadow-sm">
        {sortableRows}
        {archivedPlans.map((plan) => (
          <div key={plan.id} className="border-b">
            {renderRow(plan, <span className="size-7 shrink-0" />)}
          </div>
        ))}
        <div className="bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <p className="text-[13px] font-semibold text-foreground/80">
            Commission only
          </p>
          <p className="mt-0.5">
            {commissionOnly.vendorCount === 0
              ? `${commissionOnly.rate}% store commission for vendors not on any plan`
              : `${commissionOnly.rate}% store commission · ${vendorsLabel(
                  commissionOnly.vendorCount,
                )} not on any plan`}
          </p>
        </div>
      </div>,
    );
  }

  return withDnd(
    <div className="overflow-hidden rounded-[12px] border bg-card shadow-sm">
      <Table className="[&_tbody_td]:text-xs [&_thead_th]:text-xs">
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="w-10 pr-0">
              <span className="sr-only">Order</span>
            </TableHead>
            <TableHead className="min-w-[200px]">Plan</TableHead>
            <TableHead className="w-[140px]">Price</TableHead>
            <TableHead className="w-[100px]">Commission</TableHead>
            <TableHead className={LIMITS_COL}>Limits</TableHead>
            <TableHead className={TOOLS_COL}>Tools</TableHead>
            <TableHead className="w-[80px] text-right">Vendors</TableHead>
            <TableHead className="w-[96px]">Status</TableHead>
            <TableHead className="w-[52px]">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortableRows}
          {archivedPlans.map((plan) => (
            <TableRow key={plan.id}>{renderRow(plan, null)}</TableRow>
          ))}
          <TableRow className="bg-muted/30 text-muted-foreground hover:bg-muted/30">
            <TableCell className="pr-0" />
            <TableCell>
              <p className="font-semibold text-foreground/80">Commission only</p>
              <p>Vendors not on any plan</p>
            </TableCell>
            <TableCell>—</TableCell>
            <TableCell>{commissionOnly.rate}%</TableCell>
            <TableCell className={LIMITS_COL}>No limits</TableCell>
            <TableCell className={TOOLS_COL}>
              <PlanToolsSummary plan={{ packs: COMMISSION_ONLY_PACKS }} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {commissionOnly.vendorCount}
            </TableCell>
            <TableCell />
            <TableCell />
          </TableRow>
        </TableBody>
      </Table>
    </div>,
  );
}

function vendorsLabel(count: number) {
  if (count === 0) return "no vendors";
  return count === 1 ? "1 vendor" : `${count} vendors`;
}

function SortablePlanRow({
  plan,
  compact,
  sortable,
  render,
}: {
  plan: AdminVendorPlan;
  compact: boolean;
  sortable: boolean;
  render: RowRenderer;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: plan.id, disabled: !sortable });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };
  const dragClass = isDragging && "relative z-10 bg-card shadow-lg";
  const handle = sortable ? (
    <PlanDragHandle planName={plan.name} {...attributes} {...listeners} />
  ) : compact ? (
    <span className="size-7 shrink-0" />
  ) : null;

  if (compact) {
    return (
      <div ref={setNodeRef} style={style} className={cn("border-b", dragClass)}>
        {render(plan, handle)}
      </div>
    );
  }
  return (
    <TableRow ref={setNodeRef} style={style} className={cn(dragClass)}>
      {render(plan, handle)}
    </TableRow>
  );
}

interface PlanRowProps {
  plan: AdminVendorPlan;
  handle: ReactNode;
  basePath: string;
  busy: boolean;
  onAction: (action: AdminPlanAction, plan: AdminVendorPlan) => void;
}

function PlanRowCells({ plan, handle, basePath, busy, onAction }: PlanRowProps) {
  const dim = plan.status === "archived" && "opacity-55";
  const paid = plan.billingInterval !== "none" && plan.price > 0;

  return (
    <>
      <TableCell className="pr-0 pl-3">{handle}</TableCell>
      <TableCell className={cn("max-w-0", dim)}>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`${basePath}/${plan.id}/edit`}
            title={plan.name}
            className="truncate font-semibold text-foreground hover:text-primary hover:underline"
          >
            {plan.name}
          </Link>
          {plan.isDefault ? <PlanDefaultBadge /> : null}
        </div>
        {plan.description ? (
          <p
            className="mt-0.5 truncate text-muted-foreground"
            title={plan.description}
          >
            {plan.description}
          </p>
        ) : null}
      </TableCell>
      <TableCell className={cn(dim)}>
        <PlanPrice plan={plan} />
        {paid && plan.trialDays > 0 ? (
          <p className="mt-0.5 text-muted-foreground">
            {plan.trialDays}-day trial
          </p>
        ) : null}
        {plan.stripeMissing ? (
          <PlanStripeMissing className="mt-0.5 flex" />
        ) : null}
      </TableCell>
      <TableCell className={cn(dim)}>{plan.commissionRate}%</TableCell>
      <TableCell className={cn(LIMITS_COL, dim)}>
        <span className="block truncate" title={planLimitsSummary(plan.limits)}>
          {planLimitsSummary(plan.limits)}
        </span>
      </TableCell>
      <TableCell className={cn(TOOLS_COL, dim)}>
        <PlanToolsSummary plan={plan} />
      </TableCell>
      <TableCell className={cn("text-right tabular-nums", dim)}>
        {plan.vendorCount}
      </TableCell>
      <TableCell>
        <PlanStatusBadge status={plan.status} />
      </TableCell>
      <TableCell className="pr-3">
        <div className="flex justify-end">
          <VendorPlanMenu plan={plan} busy={busy} onAction={onAction} />
        </div>
      </TableCell>
    </>
  );
}

function CompactPlanRow({ plan, handle, basePath, busy, onAction }: PlanRowProps) {
  const archived = plan.status === "archived";
  const facts = [
    planLimitsSummary(plan.limits),
    vendorsLabel(plan.vendorCount),
  ].join(" · ");

  return (
    <div className="flex items-start gap-2 px-2 py-3">
      <div className="pt-0.5">{handle}</div>
      <div className={cn("min-w-0 flex-1 space-y-0.5", archived && "opacity-55")}>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`${basePath}/${plan.id}/edit`}
            className="truncate text-sm font-semibold text-foreground"
          >
            {plan.name}
          </Link>
          {plan.isDefault ? <PlanDefaultBadge /> : null}
          {archived ? <PlanStatusBadge status="archived" /> : null}
        </div>
        <p className="text-[13px] text-foreground">
          <PlanPrice plan={plan} /> · {plan.commissionRate}% commission
        </p>
        {plan.stripeMissing ? (
          <PlanStripeMissing className="text-xs" />
        ) : (
          <p className="truncate text-xs text-muted-foreground">{facts}</p>
        )}
      </div>
      <VendorPlanMenu plan={plan} busy={busy} onAction={onAction} />
    </div>
  );
}
