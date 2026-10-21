"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, MapPin, Store } from "lucide-react";
import { useRouter } from "@/hooks/use-locale-navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "@/components/ui/toast-notification";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import {
  MemberAccessSummary,
  TeamMemberRoleCard,
  resolveMemberAccess,
  useTeamRoles,
} from "@/components/admin/team/team-member-role-card";
import { PermissionList } from "@/components/admin/team/permission-list";
import { StaffPresetPicker } from "@/components/admin/team/staff-preset-picker";
import { AccessSummaryCard } from "@/components/admin/team/access-summary-card";
import { ScopeChoice } from "@/components/admin/team/scope-choice";
import {
  MemberStatusControl,
  statusFieldsFor,
  type MemberStatusChoice,
} from "@/components/admin/team/member-status-control";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";
import {
  DEFAULT_STAFF_PERMISSIONS,
  staffPermissionsSellerMayGive,
  type StaffPermission,
} from "@/config/permissions.config";
import type { TeamGrantScope } from "@/lib/access/team-member-roles";
import { isStaffTierPermission } from "@/config/team-permissions.config";
import {
  StoreProfileNotice,
  storeProfileCodeOf,
} from "@/components/admin/store-profile-notice";

interface StaffFormProps {
  locale: string;
  area?: "admin" | "vendor";
  /** The person adding may make roles (Save as a role). */
  canManageRoles?: boolean;
  /** What the person adding may give (the Role card offers only that). */
  grantScope?: TeamGrantScope | null;
  /** The vendor area: the seller's own permissions, which bound what its staff may be given. */
  sellerPermissions?: readonly string[] | null;
}

type TeamFormRole = "admin" | "staff";

interface FormValues {
  name: string;
  email: string;
  phone: string;
  role: TeamFormRole;
  permissions: StaffPermission[];
  vendorIds: string[];
  locationIds: string[];
  fulfillmentRegions: string;
  department: string;
  notes: string;
  sendInvite: boolean;
  /** The admin area: the member's team role, with their own changes. */
  teamRoleId: string | null;
  teamExtraPermissions: string[];
  teamRevokedPermissions: string[];
}

const defaultValues: FormValues = {
  name: "",
  email: "",
  phone: "",
  role: "staff",
  permissions: [...DEFAULT_STAFF_PERMISSIONS],
  vendorIds: [],
  locationIds: [],
  fulfillmentRegions: "",
  department: "",
  notes: "",
  sendInvite: true,
  teamRoleId: null,
  teamExtraPermissions: [],
  teamRevokedPermissions: [],
};

interface ScopeOption {
  _id: string;
  name: string;
}

/** Adds a team member; an existing one is edited on their page (StaffDetailShell). */
export function StaffForm({
  locale,
  area = "admin",
  canManageRoles = false,
  grantScope = null,
  sellerPermissions = null,
}: StaffFormProps) {
  // A seller gives its staff only what its plan gives the seller.
  const sellerGivable = useMemo(
    () => (sellerPermissions ? new Set<string>(staffPermissionsSellerMayGive(sellerPermissions)) : null),
    [sellerPermissions],
  );
  const sellerMayGive = sellerGivable ? (permission: string) => sellerGivable.has(permission) : undefined;
  const router = useRouter();
  const tr = useAdminPhrase();
  const apiBasePath = area === "vendor" ? "/api/vendor/staff" : "/api/admin/staff";
  const staffListPath = `/${locale}/${area}/staff`;

  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormValues>(defaultValues);
  const [status, setStatus] = useState<MemberStatusChoice>("active");
  const [scopeLimited, setScopeLimited] = useState(false);
  const [vendors, setVendors] = useState<ScopeOption[]>([]);
  const [locations, setLocations] = useState<ScopeOption[]>([]);
  // The store profile the locations belong to is missing and could not be made.
  const [locationsProblem, setLocationsProblem] = useState<string | null>(null);
  const { roles, addRole } = useTeamRoles(area === "admin");

  // Vendors manage staff only; the role is an admin-area concept.
  const isAdminRole = area === "admin" && form.role === "admin";
  const memberValue = useMemo(
    () => ({
      role: form.role,
      teamRoleId: form.teamRoleId,
      teamExtraPermissions: form.teamExtraPermissions,
      teamRevokedPermissions: form.teamRevokedPermissions,
      permissions: form.permissions,
    }),
    [form.role, form.teamRoleId, form.teamExtraPermissions, form.teamRevokedPermissions, form.permissions],
  );

  useEffect(() => {
    if (area !== "admin") return;
    const fetchScopeOptions = async () => {
      const [vendorsRes, locationsRes] = await Promise.allSettled([
        fetch("/api/admin/vendors?limit=100"),
        fetch("/api/admin/locations?includeInactive=false"),
      ]);

      if (vendorsRes.status === "fulfilled" && vendorsRes.value.ok) {
        const data = await vendorsRes.value.json();
        const rows = data.data?.data || data.data || [];
        if (Array.isArray(rows)) {
          setVendors(
            rows.map((vendor: { _id: string; storeName?: string; name?: string }) => ({
              _id: String(vendor._id),
              name: vendor.storeName || vendor.name || "Vendor",
            })),
          );
        }
      }

      if (locationsRes.status === "fulfilled" && locationsRes.value.ok) {
        const data = await locationsRes.value.json();
        const rows = data.data || [];
        if (Array.isArray(rows)) {
          setLocations(
            rows.map((location: { _id: string; name?: string }) => ({
              _id: String(location._id),
              name: location.name || "Location",
            })),
          );
        }
      } else if (locationsRes.status === "fulfilled") {
        setLocationsProblem(
          storeProfileCodeOf(await locationsRes.value.json().catch(() => null)),
        );
      }
    };

    fetchScopeOptions().catch(() => {
      setVendors([]);
      setLocations([]);
    });
  }, [area]);

  const setField = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const toggleStringListValue = (
    key: "vendorIds" | "locationIds",
    value: string,
    checked: boolean,
  ) => {
    setForm((prev) => {
      const next = new Set(prev[key]);
      if (checked) next.add(value);
      else next.delete(value);
      return { ...prev, [key]: Array.from(next) };
    });
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!form.email.trim()) {
      toast.error("Email is required");
      return;
    }
    // A staff member needs something to do; an administrator's role always gives it.
    const staffHolds =
      area === "admin"
        ? (resolveMemberAccess(memberValue, roles)?.effective ?? form.permissions).filter(isStaffTierPermission)
        : form.permissions;
    if (!isAdminRole && staffHolds.length === 0) {
      toast.error("Select at least one permission");
      return;
    }

    setIsSaving(true);
    try {
      const statusFields = statusFieldsFor(status);
      const scoped = area === "admin" && !isAdminRole && scopeLimited;
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        status: statusFields.status,
        isActive: statusFields.isActive,
        // The vendor API has no role concept — its staff are always staff.
        ...(area === "admin"
          ? {
              role: form.role,
              // Before the roles have loaded there is no role id yet: the
              // list alone puts a staff member on Staff, an administrator on
              // Administrator.
              ...(form.teamRoleId
                ? {
                    teamRoleId: form.teamRoleId,
                    teamExtraPermissions: form.teamExtraPermissions,
                    teamRevokedPermissions: form.teamRevokedPermissions,
                  }
                : {}),
              vendorIds: scoped ? form.vendorIds : [],
              locationIds: scoped ? form.locationIds : [],
              fulfillmentRegions: scoped
                ? form.fulfillmentRegions
                    .split(/[\n,]+/)
                    .map((value) => value.trim())
                    .filter(Boolean)
                : [],
            }
          : {}),
        permissions: form.permissions,
        department: form.department.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };

      const res = await fetch(apiBasePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to save staff member");
      }

      toast.success("Team member created successfully");

      // Send invite email on creation if enabled
      if (form.sendInvite && data.data?._id) {
        try {
          const inviteRes = await fetch(
            `${apiBasePath}/${data.data._id}/invite?locale=${encodeURIComponent(locale)}`,
            { method: "POST" },
          );
          const inviteData = await inviteRes.json();
          if (inviteRes.ok && inviteData.success) {
            toast.success("Invite email sent successfully");
          } else {
            toast.error(
              inviteData.message ||
                "Team member created but invite email failed",
            );
          }
        } catch {
          toast.error("Team member created but failed to send invite email");
        }
      }

      router.push(staffListPath);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save staff member",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 -mx-2 md:mx-0">
      <AdminFormStickyHeader
        flushWithAdminShell
        title="Add Team Member"
        description="Create a new team member with a role and permissions"
        actions={
          <>
            <Button size="sm" onClick={handleSubmit} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create team member
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(staffListPath)}
              disabled={isSaving}
            >
              Back to team
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>
                Team member identity and contact details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full name *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    placeholder="e.g. John Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setField("email", e.target.value)}
                    placeholder="e.g. john@example.com"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={form.phone}
                    onChange={(e) => setField("phone", e.target.value)}
                    placeholder="e.g. +1 555 0123"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Input
                    id="department"
                    value={form.department}
                    onChange={(e) => setField("department", e.target.value)}
                    placeholder="e.g. Sales, Warehouse"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Role and permissions — the store's own team */}
          {area === "admin" ? (
            <TeamMemberRoleCard
              roles={roles}
              onRoleCreated={addRole}
              canManageRoles={canManageRoles}
              grantScope={grantScope}
              canChangeRole={grantScope ? grantScope.duties.create : true}
              canChangePermissions={grantScope ? grantScope.duties.editPermissions : true}
              memberName={form.name}
              value={memberValue}
              onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
            />
          ) : (
            // A vendor's own staff: permissions one by one, no roles.
            <Card>
              <CardHeader>
                <CardTitle>{tr("Permissions", "পারমিশন")}</CardTitle>
                <CardDescription>
                  {tr("What this staff member can do, by area.", "এই স্টাফ সদস্য কী করতে পারবে, এরিয়া অনুযায়ী।")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <StaffPresetPicker
                  area="vendor"
                  permissions={form.permissions}
                  onApply={(next) =>
                    setField(
                      "permissions",
                      sellerMayGive ? next.filter((permission) => form.permissions.includes(permission) || sellerMayGive(permission)) : next,
                    )
                  }
                />
                <PermissionList
                  tier="staff"
                  area="vendor"
                  permissions={form.permissions}
                  onChange={(next) => setField("permissions", next as StaffPermission[])}
                  canGrant={sellerMayGive}
                />
              </CardContent>
            </Card>
          )}

          {/* Scope — a data-access restriction, so staff only */}
          {area === "admin" && !isAdminRole && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="h-5 w-5" />
                  {tr("Scope", "স্কোপ")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <ScopeChoice limited={scopeLimited} onChange={setScopeLimited} />

                {scopeLimited ? (
                  <>
                    {vendors.length > 0 && (
                      <div className="space-y-3">
                        <Label>Vendors</Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {vendors.map((vendor) => (
                            <label
                              key={vendor._id}
                              className="flex items-center gap-2 rounded-lg border p-3 text-sm"
                            >
                              <Checkbox
                                checked={form.vendorIds.includes(vendor._id)}
                                onCheckedChange={(checked) =>
                                  toggleStringListValue("vendorIds", vendor._id, Boolean(checked))
                                }
                              />
                              <span className="truncate">{vendor.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {locations.length === 0 && locationsProblem ? (
                      <StoreProfileNotice code={locationsProblem} compact />
                    ) : null}

                    {locations.length > 0 && (
                      <div className="space-y-3">
                        <Label className="flex items-center gap-2">
                          <MapPin className="h-4 w-4" />
                          Locations
                        </Label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {locations.map((location) => (
                            <label
                              key={location._id}
                              className="flex items-center gap-2 rounded-lg border p-3 text-sm"
                            >
                              <Checkbox
                                checked={form.locationIds.includes(location._id)}
                                onCheckedChange={(checked) =>
                                  toggleStringListValue("locationIds", location._id, Boolean(checked))
                                }
                              />
                              <span className="truncate">{location.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor="fulfillmentRegions">Fulfillment regions</Label>
                      <Textarea
                        id="fulfillmentRegions"
                        value={form.fulfillmentRegions}
                        onChange={(e) => setField("fulfillmentRegions", e.target.value)}
                        placeholder={"US\nCalifornia\nBangladesh"}
                        rows={3}
                      />
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* Notes — stored on the staff profile, which admins do not have */}
          {!isAdminRole && (
            <Card>
              <CardHeader>
                <CardTitle>Internal Notes</CardTitle>
                <CardDescription>
                  Private notes visible only to admins
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={form.notes}
                  onChange={(e) => setField("notes", e.target.value)}
                  placeholder="Add any notes about this team member..."
                  rows={4}
                />
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          {area === "admin" ? (
            <MemberAccessSummary value={memberValue} roles={roles} name={form.name} />
          ) : (
            <AccessSummaryCard name={form.name} tier="staff" area="vendor" permissions={form.permissions} />
          )}

          <Card>
            <CardHeader>
              <CardTitle>{tr("Status", "স্ট্যাটাস")}</CardTitle>
            </CardHeader>
            <CardContent>
              <MemberStatusControl value={status} onChange={setStatus} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tr("Invite", "আমন্ত্রণ")}</CardTitle>
            </CardHeader>
            <CardContent>
              <label className="flex items-center gap-2 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors">
                <Checkbox
                  checked={form.sendInvite}
                  onCheckedChange={(checked) => setField("sendInvite", Boolean(checked))}
                />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium leading-none flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" />
                    Send invite email
                  </p>
                  <p className="text-xs text-muted-foreground">
                    They will receive a link to set their password
                  </p>
                </div>
              </label>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
