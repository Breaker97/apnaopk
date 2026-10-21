"use client";

import { useMemo } from "react";
import { Check, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";
import { PERMISSION_RISKS, type PermissionAction } from "@/config/team-permission-groups";
import { isOwnerOnlyPermission, type TeamRoleTier } from "@/config/team-permissions.config";
import {
  adminDashboardOnlyRows,
  isActionHeld,
  permissionGroupsFor,
  setRows,
  toggleAction,
  type ListedRow,
  type PermissionArea,
} from "@/lib/access/permission-list";

interface PermissionListProps {
  /** The dashboard the member works in: a staff-area member is offered staff permissions only. */
  tier: TeamRoleTier;
  /** A vendor's own staff are offered only what a vendor may give. */
  area?: PermissionArea;
  permissions: readonly string[];
  /** The role's own permissions: a box that differs is marked. Absent: no marks. */
  base?: readonly string[] | null;
  onChange: (next: string[]) => void;
  readOnly?: boolean;
  /**
   * Whether the person editing may give a permission. A box they may not give
   * stays as it is when unticked (they may always take one away); absent:
   * every box may be ticked.
   */
  canGrant?: (permission: string) => boolean;
}

/**
 * Every permission a member can be given (config/team-permission-groups.ts),
 * grouped by area, each area with its own actions. Always shown in full; a
 * box that differs from the member's role is dashed and dotted.
 */
export function PermissionList({
  tier,
  area = "admin",
  permissions,
  base = null,
  onChange,
  readOnly = false,
  canGrant,
}: PermissionListProps) {
  const tr = useAdminPhrase();
  const groups = useMemo(() => permissionGroupsFor(tier, area), [tier, area]);
  const held = useMemo(() => new Set(permissions), [permissions]);
  /** A change, with anything newly ticked that the editor may not give left off. */
  const change = (next: string[]) =>
    onChange(canGrant ? next.filter((permission) => held.has(permission) || canGrant(permission)) : next);
  const whyLocked = (permission: string) =>
    isOwnerOnlyPermission(permission)
      ? tr("Only the store owner can give this", "এটি শুধু স্টোরের মালিক দিতে পারেন")
      : tr("You cannot give a permission you do not have", "নিজের নেই এমন পারমিশন দেওয়া যায় না");
  const baseSet = useMemo(() => (base ? new Set(base) : null), [base]);
  const adminOnly = tier === "staff" && area === "admin" ? adminDashboardOnlyRows() : [];

  const changedFrom = (listed: ListedRow, action: PermissionAction) =>
    baseSet !== null && isActionHeld(held, listed.row, action) !== isActionHeld(baseSet, listed.row, action);

  return (
    <div className="space-y-6">
      {groups.map(({ group, rows }) => {
        const total = rows.reduce((sum, listed) => sum + listed.actions.length, 0);
        const on = rows.reduce(
          (sum, listed) => sum + listed.actions.filter((action) => isActionHeld(held, listed.row, action)).length,
          0,
        );
        return (
          <section key={group.key} aria-label={tr(group.label)}>
            <div className="flex items-center justify-between gap-3 border-b pb-2">
              <h3 className="flex items-baseline gap-2 text-sm font-semibold">
                {tr(group.label)}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {on}/{total}
                </span>
              </h3>
              {readOnly ? null : (
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-primary disabled:pointer-events-none disabled:opacity-40"
                    disabled={on === total}
                    onClick={() => change(setRows(permissions, rows, true))}
                  >
                    {tr("All", "সব")}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-primary disabled:pointer-events-none disabled:opacity-40"
                    disabled={on === 0}
                    onClick={() => change(setRows(permissions, rows, false))}
                  >
                    {tr("None", "কোনোটি না")}
                  </button>
                </div>
              )}
            </div>
            <div className="divide-y">
              {rows.map((listed) => {
                const rowChanged = listed.actions.some((action) => changedFrom(listed, action));
                return (
                  <div
                    key={listed.row.key}
                    className="grid gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {tr(listed.row.label)}
                        {rowChanged ? (
                          <span className="rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-500/15 dark:text-amber-300">
                            {tr("Changed", "বদলানো")}
                          </span>
                        ) : null}
                      </p>
                      {listed.hint ? (
                        <p className="text-xs text-muted-foreground">{tr(listed.hint)}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1.5 sm:justify-end">
                      {listed.actions.map((action) => {
                        const checked = isActionHeld(held, listed.row, action);
                        const changed = changedFrom(listed, action);
                        const locked = !checked && canGrant !== undefined && !canGrant(action.permission);
                        return (
                          <button
                            key={action.permission}
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            aria-label={`${tr(listed.row.label)}: ${tr(action.label)}`}
                            disabled={readOnly || locked}
                            onClick={() => change(toggleAction(permissions, listed, action, !checked))}
                            title={
                              locked
                                ? whyLocked(action.permission)
                                : changed
                                  ? checked
                                    ? tr("Added for this member", "এই সদস্যের জন্য যোগ করা")
                                    : tr("Taken away for this member", "এই সদস্যের জন্য সরানো")
                                  : undefined
                            }
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                              "disabled:cursor-not-allowed disabled:opacity-60",
                              checked
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border bg-background text-muted-foreground hover:border-primary/60",
                              changed && "border-dashed border-amber-500",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "grid size-3.5 shrink-0 place-items-center rounded-[4px] border",
                                checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                              )}
                            >
                              {checked ? <Check className="size-2.5" strokeWidth={3} /> : null}
                            </span>
                            {locked ? <Lock aria-hidden="true" className="size-3 shrink-0" /> : null}
                            {tr(action.label)}
                            {action.risk ? (
                              <span className="rounded-full bg-red-50 px-1.5 text-[10px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                {tr(PERMISSION_RISKS[action.risk])}
                              </span>
                            ) : null}
                            {changed ? (
                              <>
                                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                                <span className="sr-only">{tr("Changed from the role", "রোল থেকে বদলানো")}</span>
                              </>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {adminOnly.length > 0 ? (
        <div className="flex gap-3 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">{tr("Only in the admin dashboard", "শুধু অ্যাডমিন ড্যাশবোর্ডে")}</p>
            <p>{adminOnly.map((row) => tr(row.label)).join(", ")}</p>
            <p className="text-xs">
              {tr(
                "Pick Manager or Administrator to give any of these. Staff work in the staff area and at the till.",
                "এগুলোর কোনোটি দিতে ম্যানেজার বা অ্যাডমিনিস্ট্রেটর বেছে নিন। স্টাফ কাজ করে স্টাফ এরিয়ায় আর POS-এ।",
              )}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
