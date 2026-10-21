"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { PermissionList } from "@/components/admin/team/permission-list";
import { AccessSummaryCard } from "@/components/admin/team/access-summary-card";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";
import {
  ALL_TEAM_PERMISSIONS,
  BUILT_IN_TEAM_ROLE_KEYS,
  isStaffTierPermission,
  type TeamRoleTier,
} from "@/config/team-permissions.config";
import type { StaffPermission } from "@/config/permissions.config";
import { actionChanges, permissionGroupsFor } from "@/lib/access/permission-list";
import type { TeamRoleView } from "@/lib/access/team-role-service";
import type { TeamGrantScope } from "@/lib/access/team-member-roles";

export interface MemberRoleValue {
  /** Which dashboard the member works in: the admin dashboard or the staff area. */
  role: TeamRoleTier;
  /**
   * The team role. Null on an administrator = the Administrator; null on staff
   * = a staff member from before roles, whose own list (`permissions`) is
   * shown against the built-in Staff role until it is saved onto it.
   */
  teamRoleId: string | null;
  teamExtraPermissions: string[];
  teamRevokedPermissions: string[];
  /** The staff permissions they hold (a staff member's list, as stored). */
  permissions: StaffPermission[];
}

/** The store's team roles, read once for the screen (not in the vendor area, which has none). */
export function useTeamRoles(enabled = true) {
  const [roles, setRoles] = useState<TeamRoleView[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch("/api/admin/team-roles")
      .then((response) => response.json())
      .then((payload) => (payload?.success ? (payload.data as TeamRoleView[]) : []))
      .catch(() => [])
      .then((loaded) => {
        if (live) setRoles(loaded);
      });
    return () => {
      live = false;
    };
  }, [enabled]);

  const addRole = useCallback((role: TeamRoleView) => {
    setRoles((current) => [...(current ?? []), role]);
  }, []);

  return { roles, addRole };
}

/** A role's own permissions, as a member of it starts out. */
function roleBase(role: TeamRoleView | null): string[] {
  if (!role) return [];
  return role.allPermissions ? [...ALL_TEAM_PERMISSIONS] : role.permissions;
}

export interface ResolvedMemberAccess {
  /** The role whose card is picked. */
  role: TeamRoleView | null;
  tier: TeamRoleTier;
  base: string[];
  effective: string[];
  /** Boxes that differ from the role. */
  changes: number;
}

/** What a member holds and how it differs from their role; null until the roles are read. */
export function resolveMemberAccess(
  value: MemberRoleValue,
  roles: TeamRoleView[] | null,
  isOwner = false,
): ResolvedMemberAccess | null {
  if (!roles) return null;
  const builtIn = (key: string) => roles.find((role) => role.key === key) ?? null;
  const role = value.teamRoleId
    ? roles.find((candidate) => candidate._id === value.teamRoleId) ?? null
    : builtIn(value.role === "admin" ? BUILT_IN_TEAM_ROLE_KEYS.ADMINISTRATOR : BUILT_IN_TEAM_ROLE_KEYS.STAFF);
  if (isOwner) {
    return { role, tier: "admin", base: [...ALL_TEAM_PERMISSIONS], effective: [...ALL_TEAM_PERMISSIONS], changes: 0 };
  }
  const base = roleBase(role);
  let effective: string[];
  if (value.role === "staff" && !value.teamRoleId) {
    effective = [...value.permissions];
  } else {
    const revoked = new Set(value.teamRevokedPermissions);
    effective = Array.from(new Set([...base, ...value.teamExtraPermissions])).filter(
      (permission) => !revoked.has(permission),
    );
  }
  const changes = actionChanges(new Set(effective), new Set(base), permissionGroupsFor(value.role)).length;
  return { role, tier: value.role, base, effective, changes };
}

/** Administrator, Manager, the store's own admin roles, Staff, the store's own staff roles. */
function orderRoles(roles: TeamRoleView[]): TeamRoleView[] {
  const rank = (role: TeamRoleView) => {
    if (role.key === BUILT_IN_TEAM_ROLE_KEYS.ADMINISTRATOR) return 0;
    if (role.key === BUILT_IN_TEAM_ROLE_KEYS.MANAGER) return 1;
    if (role.tier === "admin") return 2;
    if (role.key === BUILT_IN_TEAM_ROLE_KEYS.STAFF) return 3;
    return 4;
  };
  return [...roles].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The value for a member who holds `effective` on `role`: the role plus their changes. */
function valueOnRole(role: TeamRoleView, effective: readonly string[]): MemberRoleValue {
  const base = new Set(roleBase(role));
  const wanted = new Set(effective);
  return {
    role: role.tier,
    teamRoleId: role._id,
    teamExtraPermissions: effective.filter((permission) => !base.has(permission)),
    teamRevokedPermissions: Array.from(base).filter((permission) => !wanted.has(permission)),
    permissions: effective.filter(isStaffTierPermission) as StaffPermission[],
  };
}

interface TeamMemberRoleCardProps {
  value: MemberRoleValue;
  onChange: (next: MemberRoleValue) => void;
  roles: TeamRoleView[] | null;
  /** A role made here ("Save as a role") joins the list. */
  onRoleCreated?: (role: TeamRoleView) => void;
  /** Whether the person editing may make roles (Manage roles). */
  canManageRoles?: boolean;
  memberName?: string;
  readOnly?: boolean;
  /** The store owner always holds everything: shown, never changed. */
  isOwner?: boolean;
  /**
   * What the person editing may give (lib/access/team-member-roles.ts): only
   * those roles are offered and only those boxes can be ticked. Absent: all.
   */
  grantScope?: TeamGrantScope | null;
  /** Whether they may move this member onto another role. */
  canChangeRole?: boolean;
  /** Whether they may change what this member holds on top of their role. */
  canChangePermissions?: boolean;
}

/**
 * A team member's role and permissions. The role is one card (Administrator,
 * Manager, Staff, or a role the store made); every permission is listed below
 * and can be ticked or unticked for this member alone, on top of the role.
 * What differs from the role is marked, and can be reset or saved as a role.
 */
export function TeamMemberRoleCard({
  value,
  onChange,
  roles,
  onRoleCreated,
  canManageRoles = false,
  memberName = "",
  readOnly = false,
  isOwner = false,
  grantScope = null,
  canChangeRole = true,
  canChangePermissions = true,
}: TeamMemberRoleCardProps) {
  const tr = useAdminPhrase();
  const t = useTranslations("admin.teamAccess");
  const radioName = useId();
  const [savingAsRole, setSavingAsRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [creating, setCreating] = useState(false);

  const access = resolveMemberAccess(value, roles, isOwner);
  const selected = access?.role ?? null;
  const locked = readOnly || isOwner;

  // Only what the person editing may give: the roles their own role may give
  // (full access only from the store owner), each within what they may give.
  const grantable = useMemo(() => (grantScope ? new Set(grantScope.grantable) : null), [grantScope]);
  const canGrant = useCallback((permission: string) => !grantable || grantable.has(permission), [grantable]);
  const mayGive = useCallback(
    (role: TeamRoleView) => {
      if (!grantScope || grantScope.isOwner) return true;
      if (role.allPermissions) return grantScope.canGiveFullAccess;
      if (grantScope.assignableRoleIds && !grantScope.assignableRoleIds.includes(role._id)) return false;
      return roleBase(role).every(canGrant);
    },
    [grantScope, canGrant],
  );
  // The member's own role stays on the list even when it is not one to give.
  const ordered = useMemo(
    () => orderRoles(roles ?? []).filter((role) => role._id === selected?._id || mayGive(role)),
    [roles, selected?._id, mayGive],
  );

  const pick = (role: TeamRoleView) => {
    if (role._id === selected?._id) return;
    setSavingAsRole(false);
    onChange(valueOnRole(role, roleBase(role)));
  };

  /** Back to exactly the role: this member's changes go. */
  const reset = () => {
    if (selected) onChange(valueOnRole(selected, roleBase(selected)));
  };

  const setEffective = (next: string[]) => {
    if (!selected) return;
    onChange(valueOnRole(selected, next));
  };

  const createRole = async () => {
    const name = newRoleName.trim();
    if (!name || !access) return;
    setCreating(true);
    try {
      const response = await fetch("/api/admin/team-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, tier: value.role, permissions: access.effective }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        const fieldError = payload?.errors
          ? Object.values(payload.errors as Record<string, string[]>)[0]?.[0]
          : undefined;
        throw new Error(fieldError || payload?.message || tr("Failed to save the role", "রোল সেভ করা যায়নি"));
      }
      const created = payload.data as TeamRoleView;
      onRoleCreated?.(created);
      onChange(valueOnRole(created, access.effective));
      setSavingAsRole(false);
      setNewRoleName("");
      toast.success(t("roleSaved", { name: created.name }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const whereLabel = (tier: TeamRoleTier) =>
    tier === "admin" ? tr("Admin dashboard", "অ্যাডমিন ড্যাশবোর্ড") : tr("Staff area & POS", "স্টাফ এরিয়া ও POS");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            {tr("Role", "রোল")}
          </CardTitle>
          <CardDescription>
            {isOwner
              ? tr("The store owner always holds every permission.", "স্টোরের মালিক সবসময় সব পারমিশন পায়।")
              : tr(
                  "Where they work and what they start with. You can change any permission below for this member.",
                  "কোথায় কাজ করবে আর কী নিয়ে শুরু করবে। নিচে এই সদস্যের জন্য যেকোনো পারমিশন বদলাতে পারেন।",
                )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            role="radiogroup"
            aria-label={tr("Role", "রোল")}
            className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2"
          >
            {roles === null
              ? Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-20 rounded-lg" />)
              : ordered.map((role) => {
                  const checked = role._id === selected?._id;
                  return (
                    <label
                      key={role._id}
                      className={cn(
                        "flex items-start gap-3 rounded-lg border p-3 text-sm",
                        checked && "border-primary bg-primary/5",
                        locked || !canChangeRole ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-accent/50",
                      )}
                    >
                      <input
                        type="radio"
                        name={radioName}
                        className="mt-0.5"
                        checked={checked}
                        disabled={locked || !canChangeRole || !mayGive(role)}
                        onChange={() => pick(role)}
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="flex flex-wrap items-center gap-1.5 font-medium">
                          {role.name}
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-px text-[10px] font-semibold whitespace-nowrap",
                              role.tier === "admin"
                                ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
                            )}
                          >
                            {whereLabel(role.tier)}
                          </span>
                        </span>
                        {role.description ? (
                          <span className="line-clamp-2 text-xs text-muted-foreground" title={role.description}>
                            {role.description}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
          </div>
          {canManageRoles && !locked ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {tr("Roles you create on the Roles screen show up here as more cards.", "রোল স্ক্রিনে বানানো রোলগুলো এখানে আরও কার্ড হিসেবে দেখায়।")}
            </p>
          ) : null}
          {grantScope && !grantScope.isOwner && !locked ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {tr(
                "Only the roles you may give are shown. Full access and the power to manage the team are given by the store owner.",
                "আপনি যে রোলগুলো দিতে পারেন শুধু সেগুলো দেখানো হয়েছে। ফুল অ্যাক্সেস আর টিম পরিচালনার ক্ষমতা স্টোরের মালিক দেন।",
              )}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr("Permissions", "পারমিশন")}</CardTitle>
          <CardDescription>
            {tr(
              "Everything this role can be given, by area. Dashed boxes differ from the role.",
              "এই রোলকে যা যা দেওয়া যায়, এরিয়া অনুযায়ী। ড্যাশ দেওয়া বক্স রোল থেকে আলাদা।",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {access === null ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : (
            <>
              {isOwner ? null : savingAsRole ? (
                <form
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 dark:bg-amber-500/10"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void createRole();
                  }}
                >
                  <Input
                    autoFocus
                    value={newRoleName}
                    maxLength={60}
                    onChange={(event) => setNewRoleName(event.target.value)}
                    placeholder={tr("Role name, e.g. Floor lead", "রোলের নাম, যেমন ফ্লোর লিড")}
                    aria-label={tr("Role name", "রোলের নাম")}
                    className="h-8 min-w-0 flex-1 basis-48 bg-background"
                  />
                  <Button type="submit" size="sm" disabled={creating || !newRoleName.trim()}>
                    {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    {tr("Save role", "রোল সেভ করুন")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSavingAsRole(false)}>
                    {tr("Cancel", "বাতিল")}
                  </Button>
                </form>
              ) : access.changes > 0 && selected ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  <span>{t("changesFromRole", { count: access.changes, role: selected.name })}</span>
                  {locked || !canChangePermissions ? null : (
                    <>
                      <button type="button" className="font-medium underline underline-offset-2" onClick={reset}>
                        {t("resetTo", { role: selected.name })}
                      </button>
                      {canManageRoles ? (
                        <button
                          type="button"
                          className="font-medium underline underline-offset-2"
                          onClick={() => setSavingAsRole(true)}
                        >
                          {tr("Save as a role", "রোল হিসেবে সেভ করুন")}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              ) : selected ? (
                <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  {t("matchesRole", { role: selected.name, name: memberName.trim() || tr("this member", "এই সদস্য") })}
                </p>
              ) : null}
              <PermissionList
                tier={access.tier}
                permissions={access.effective}
                base={isOwner ? null : access.base}
                readOnly={locked || !selected || !canChangePermissions}
                onChange={setEffective}
                canGrant={grantScope ? canGrant : undefined}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface MemberAccessSummaryProps {
  value: MemberRoleValue;
  roles: TeamRoleView[] | null;
  name: string;
  isOwner?: boolean;
}

/** The summary column for a member of the store's own team. */
export function MemberAccessSummary({ value, roles, name, isOwner = false }: MemberAccessSummaryProps) {
  const access = resolveMemberAccess(value, roles, isOwner);
  if (!access) return <Skeleton className="h-64 w-full rounded-xl" />;
  return (
    <AccessSummaryCard
      name={name}
      roleName={isOwner ? null : access.role?.name}
      tier={access.tier}
      permissions={access.effective}
      changes={access.changes}
    />
  );
}
