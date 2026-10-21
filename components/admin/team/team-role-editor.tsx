"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock, Save, Trash2 } from "lucide-react";
import { useRouter } from "@/hooks/use-locale-navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast-notification";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { DetailFormSkeleton } from "@/components/admin/detail-form-skeleton";
import { PermissionList } from "@/components/admin/team/permission-list";
import { useTeamRoles } from "@/components/admin/team/team-member-role-card";
import { StaffPresetPicker } from "@/components/admin/team/staff-preset-picker";
import { cn } from "@/lib/utils";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";
import {
  isStaffTierPermission,
  type TeamRoleTier,
} from "@/config/team-permissions.config";
import type { TeamRoleView } from "@/lib/access/team-role-service";
import type { TeamGrantScope } from "@/lib/access/team-member-roles";

interface TeamRoleEditorProps {
  locale: string;
  /** Absent: a new role. */
  roleId?: string;
  /**
   * What the person editing may give: only those boxes can be ticked, and only
   * the store owner decides which roles a role may give. Absent: all.
   */
  grantScope?: TeamGrantScope | null;
}

/**
 * One team role: its name, the dashboard its members use, and what they may
 * do — the store's records (the staff matrix) and, for the admin dashboard,
 * its own areas. Saving changes every member on the role at once.
 */
export function TeamRoleEditor({ locale, roleId, grantScope = null }: TeamRoleEditorProps) {
  const tr = useAdminPhrase();
  const router = useRouter();
  const rolesPath = `/${locale}/admin/staff/roles`;

  const [loading, setLoading] = useState(Boolean(roleId));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [role, setRole] = useState<TeamRoleView | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tier, setTier] = useState<TeamRoleTier>("admin");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [assignableRoleIds, setAssignableRoleIds] = useState<string[]>([]);
  const { roles: allRoles } = useTeamRoles();
  const isOwner = !grantScope || grantScope.isOwner;
  const grantable = grantScope ? new Set(grantScope.grantable) : null;

  useEffect(() => {
    if (!roleId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/admin/team-roles/${roleId}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || tr("Failed to load the role", "রোল লোড করা যায়নি"));
        }
        if (cancelled) return;
        const loaded = payload.data as TeamRoleView;
        setRole(loaded);
        setName(loaded.name);
        setDescription(loaded.description);
        setTier(loaded.tier);
        setPermissions(loaded.permissions);
        setAssignableRoleIds(loaded.assignableRoleIds ?? []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleId, tr]);

  const locked = Boolean(role?.allPermissions);

  const save = async () => {
    if (!name.trim()) {
      toast.error(tr("Name is required", "নাম দিতে হবে"));
      return;
    }
    setSaving(true);
    try {
      // Only the store owner decides which roles a role may give.
      const giving = isOwner && tier === "admin" ? { assignableRoleIds } : {};
      const body = roleId
        ? { name: name.trim(), description: description.trim(), ...(locked ? {} : { permissions }), ...giving }
        : { name: name.trim(), description: description.trim(), tier, permissions, ...giving };
      const response = await fetch(roleId ? `/api/admin/team-roles/${roleId}` : "/api/admin/team-roles", {
        method: roleId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        const fieldError = payload?.errors
          ? Object.values(payload.errors as Record<string, string[]>)[0]?.[0]
          : undefined;
        throw new Error(fieldError || payload?.message || tr("Failed to save the role", "রোল সেভ করা যায়নি"));
      }
      toast.success(roleId ? tr("Role updated", "রোল আপডেট হয়েছে") : tr("Role created", "রোল তৈরি হয়েছে"));
      router.push(rolesPath);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!roleId) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/admin/team-roles/${roleId}`, { method: "DELETE" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || tr("Failed to delete the role", "রোল মুছে ফেলা যায়নি"));
      }
      toast.success(tr("Role deleted", "রোল মুছে ফেলা হয়েছে"));
      router.push(rolesPath);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loading) return <DetailFormSkeleton />;

  return (
    <div className="space-y-6">
      <AdminFormStickyHeader
        title={roleId ? tr("Edit role", "রোল এডিট") : tr("New role", "নতুন রোল")}
        description={tr(
          "A role is what its members may do. Changing it changes every member on it.",
          "রোল ঠিক করে এর সদস্যরা কী করতে পারবে। রোল বদলালে সব সদস্যের জন্য বদলায়।",
        )}
        actions={
          <div className="flex gap-2">
            {role && !role.builtIn ? (
              <Button
                type="button"
                variant="outline"
                className="gap-1.5 text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
              >
                <Trash2 className="h-4 w-4" />
                {tr("Delete", "মুছুন")}
              </Button>
            ) : null}
            <Button type="button" className="gap-1.5" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {tr("Save role", "রোল সেভ করুন")}
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{tr("Role details", "রোলের তথ্য")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="team-role-name">{tr("Name", "নাম")}</Label>
            <Input
              id="team-role-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{tr("Dashboard", "ড্যাশবোর্ড")}</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["admin", "staff"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={Boolean(roleId)}
                  onClick={() => {
                    setTier(option);
                    if (option === "staff") setPermissions((current) => current.filter(isStaffTierPermission));
                  }}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-70",
                    tier === option ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  )}
                >
                  <p className="text-sm font-medium">
                    {option === "admin" ? tr("Admin dashboard", "অ্যাডমিন ড্যাশবোর্ড") : tr("Staff area", "স্টাফ এরিয়া")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {option === "admin"
                      ? tr("Any permission, in the admin dashboard", "অ্যাডমিন ড্যাশবোর্ডে যেকোনো পারমিশন")
                      : tr("Store records and the till, in the staff area", "স্টাফ এরিয়ায় স্টোরের রেকর্ড আর POS")}
                  </p>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="team-role-description">{tr("Description", "বিবরণ")}</Label>
            <Textarea
              id="team-role-description"
              value={description}
              maxLength={300}
              rows={2}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {locked ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              {tr("Every permission", "সব পারমিশন")}
            </CardTitle>
            <CardDescription>
              {tr(
                "The Administrator always holds every permission, including ones added later. To limit an administrator, give them another role.",
                "অ্যাডমিনিস্ট্রেটর সবসময় সব পারমিশন রাখে, পরে যোগ হওয়াগুলোসহ। কাউকে সীমিত করতে অন্য রোল দিন।",
              )}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{tr("Permissions", "পারমিশন")}</CardTitle>
            <CardDescription>
              {tier === "admin"
                ? tr(
                    "Everything a member of the admin dashboard can be given, by area.",
                    "অ্যাডমিন ড্যাশবোর্ডের একজন সদস্যকে যা যা দেওয়া যায়, এরিয়া অনুযায়ী।",
                  )
                : tr(
                    "Everything a member of the staff area can be given, by area.",
                    "স্টাফ এরিয়ার একজন সদস্যকে যা যা দেওয়া যায়, এরিয়া অনুযায়ী।",
                  )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {tier === "staff" ? (
              <StaffPresetPicker permissions={permissions} onApply={(next) => setPermissions(next)} />
            ) : null}
            <PermissionList
              tier={tier}
              permissions={permissions}
              onChange={setPermissions}
              canGrant={grantable ? (permission) => grantable.has(permission) : undefined}
            />
          </CardContent>
        </Card>
      )}

      {tier === "admin" && !locked ? (
        <Card>
          <CardHeader>
            <CardTitle>{tr("Roles it can give", "যে রোলগুলো দিতে পারে")}</CardTitle>
            <CardDescription>
              {isOwner
                ? tr(
                    "A member on this role who may add people or change roles gives only these. Full access is yours alone to give.",
                    "এই রোলের যে সদস্য লোক যোগ বা রোল বদলাতে পারে, সে শুধু এগুলো দিতে পারবে। ফুল অ্যাক্সেস শুধু আপনি দিতে পারেন।",
                  )
                : tr("Only the store owner decides which roles a role can give.", "কোন রোল কোন রোল দিতে পারবে তা শুধু স্টোরের মালিক ঠিক করেন।")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {(allRoles ?? [])
              .filter((candidate) => !candidate.allPermissions && candidate._id !== roleId)
              .map((candidate) => {
                const checked = assignableRoleIds.includes(candidate._id);
                return (
                  <label
                    key={candidate._id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-2.5 text-sm",
                      isOwner ? "cursor-pointer hover:bg-accent/50" : "cursor-not-allowed opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!isOwner}
                      onChange={() =>
                        setAssignableRoleIds((current) =>
                          checked ? current.filter((id) => id !== candidate._id) : [...current, candidate._id],
                        )
                      }
                    />
                    {candidate.name}
                  </label>
                );
              })}
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        onConfirm={() => void remove()}
        type="warning"
        title={tr("Delete this role?", "এই রোল মুছবেন?")}
        description={tr(
          "A role with members cannot be deleted; give them another role first.",
          "সদস্য থাকলে রোল মোছা যায় না; আগে তাদের অন্য রোল দিন।",
        )}
        confirmText={tr("Delete", "মুছুন")}
        loading={deleting}
      />
    </div>
  );
}
