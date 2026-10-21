"use client";

import { ArrowLeft, Lock, Plus, ShieldCheck, Users } from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";
import type { TeamRoleView } from "@/lib/access/team-role-service";

/**
 * The store's team roles: the built-ins (Administrator, Manager) and the
 * ones it made, with how many members each has and how much they reach.
 */
export function TeamRolesList({ roles, canManage }: { roles: TeamRoleView[]; canManage: boolean }) {
  const tr = useAdminPhrase();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/staff" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            {tr("Team Members", "টিম সদস্য")}
          </Link>
          <h1 className="text-2xl font-semibold">{tr("Roles", "রোল")}</h1>
          <p className="text-sm text-muted-foreground">
            {tr(
              "What each kind of team member may do. Give a member a role on their page.",
              "প্রতিটি ধরনের টিম সদস্য কী করতে পারবে। সদস্যের পেজে তাকে রোল দিন।",
            )}
          </p>
        </div>
        {canManage ? (
          <Button asChild className="gap-1.5">
            <Link href="/admin/staff/roles/new">
              <Plus className="h-4 w-4" />
              {tr("Create role", "রোল তৈরি করুন")}
            </Link>
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => {
          const reach = role.allPermissions
            ? tr("Every permission", "সব পারমিশন")
            : `${role.permissions.length} ${role.permissions.length === 1 ? tr("permission", "পারমিশন") : tr("permissions", "পারমিশন")}`;
          return (
            <Card key={role._id} className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {role.allPermissions ? <Lock className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                  {role.name}
                  {role.builtIn ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {tr("Built-in", "বিল্ট-ইন")}
                    </span>
                  ) : null}
                </CardTitle>
                <CardDescription className="line-clamp-2">
                  {role.description || "—"}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {role.tier === "admin" ? tr("Admin dashboard", "অ্যাডমিন ড্যাশবোর্ড") : tr("Staff area", "স্টাফ এরিয়া")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    {role.memberCount} {role.memberCount === 1 ? tr("member", "সদস্য") : tr("members", "সদস্য")}
                  </span>
                  <span>{reach}</span>
                </div>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href={`/admin/staff/roles/${role._id}`}>
                    {canManage ? tr("Edit role", "রোল এডিট") : tr("View role", "রোল দেখুন")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
