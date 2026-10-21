"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";
import { PERMISSION_RISKS } from "@/config/team-permission-groups";
import type { TeamRoleTier } from "@/config/team-permissions.config";
import {
  permissionGroupsFor,
  summarizeAccess,
  type PermissionArea,
} from "@/lib/access/permission-list";

interface AccessSummaryCardProps {
  /** The member's name as typed; empty shows a placeholder. */
  name: string;
  roleName?: string | null;
  tier: TeamRoleTier;
  area?: PermissionArea;
  permissions: readonly string[];
  /** Boxes that differ from the role. */
  changes?: number;
}

/** What a member can and can't do, in words, beside the permission list. */
export function AccessSummaryCard({
  name,
  roleName = null,
  tier,
  area = "admin",
  permissions,
  changes = 0,
}: AccessSummaryCardProps) {
  const tr = useAdminPhrase();
  const t = useTranslations("admin.teamAccess");
  const summary = useMemo(
    () => summarizeAccess(new Set(permissions), permissionGroupsFor(tier, area)),
    [permissions, tier, area],
  );
  const percent = summary.total === 0 ? 0 : Math.round((summary.held / summary.total) * 100);
  const cant = summary.none.map((row) => tr(row.label));
  if (tier === "staff" && area === "admin") {
    cant.push(tr("anything only in the admin dashboard", "শুধু অ্যাডমিন ড্যাশবোর্ডের কিছু"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("Summary", "সারাংশ")}</CardTitle>
        <CardDescription className="break-words">
          {name.trim() || tr("New team member", "নতুন টিম সদস্য")}
          {roleName ? ` · ${roleName}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          {tier === "admin"
            ? tr("Works in the admin dashboard", "অ্যাডমিন ড্যাশবোর্ডে কাজ করে")
            : tr("Works in the staff area and at the till", "স্টাফ এরিয়ায় আর POS-এ কাজ করে")}
        </p>

        <div className="space-y-1.5">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={tr("Permissions given", "দেওয়া পারমিশন")}
          >
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            {summary.held}/{summary.total}
            {changes > 0 ? ` · ${t("changes", { count: changes })}` : ""}
          </p>
        </div>

        {summary.watch.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {tr("Watch", "খেয়াল রাখুন")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {summary.watch.map(({ row, action, risk }) => (
                <span
                  key={action.permission}
                  title={tr(PERMISSION_RISKS[risk])}
                  className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700 dark:bg-red-500/15 dark:text-red-300"
                >
                  {tr(row.label)}: {tr(action.label)}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {tr("Can", "পারে")}
          </p>
          {summary.can.length > 0 ? (
            <ul className="space-y-1">
              {summary.can.map(({ row, actions }) => (
                <li key={row.key} className="leading-snug">
                  <span className="font-medium">{tr(row.label)}</span>{" "}
                  <span className="text-muted-foreground">{actions.map((action) => tr(action.label)).join(", ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{tr("Nothing yet", "এখনো কিছু না")}</p>
          )}
        </div>

        {cant.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {tr("Can't", "পারে না")}
            </p>
            <p className="leading-snug text-muted-foreground">{cant.join(", ")}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
