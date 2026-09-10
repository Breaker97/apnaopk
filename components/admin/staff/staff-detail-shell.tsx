"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  History,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  StickyNote,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from "@/components/admin/underline-tabs";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { AdminFormStickyHeader } from "@/components/admin/admin-form-sticky-header";
import { DetailFormSkeleton } from "@/components/admin/detail-form-skeleton";
import { cn } from "@/lib/utils";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import type { StaffPermission } from "@/config/permissions.config";
import { StaffDetailHeader } from "./staff-detail-header";
import {
  GRANTABLE_STAFF_PERMISSIONS,
  normalizeStaffPermissions,
} from "./staff-permissions";
import {
  defaultStaffFormValues,
  type StaffArea,
  type StaffFormValues,
  type StaffHeaderData,
  type StaffNoteEntry,
  type StaffScopeOption,
  type StaffStats,
} from "./staff-detail-types";
import { ProfileTab } from "./tabs/profile-tab";
import { PermissionsTab } from "./tabs/permissions-tab";
import { ScopeTab } from "./tabs/scope-tab";
import { OrdersTab } from "./tabs/orders-tab";
import { ActivityTab } from "./tabs/activity-tab";
import { NotesTab } from "./tabs/notes-tab";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface StaffDetailShellProps {
  locale: string;
  staffId: string;
  area?: StaffArea;
  readOnly?: boolean;
}

interface StaffResponse {
  _id?: string;
  name?: string;
  email?: string;
  phone?: string;
  image?: string;
  status?: StaffFormValues["status"];
  createdAt?: string;
  twoFactorEnabled?: boolean;
  hasPassword?: boolean;
  staffProfile?: {
    permissions?: StaffPermission[];
    vendorIds?: string[];
    locationIds?: string[];
    fulfillmentRegions?: string[];
    department?: string;
    jobTitle?: string;
    startDate?: string;
    notes?: string;
    noteEntries?: StaffNoteEntry[];
    isActive?: boolean;
    assignedBy?: { _id?: string; email?: string } | string | null;
  } | null;
}

/** Structural placeholder so the header renders its shape before data arrives. */
const LOADING_HEADER: StaffHeaderData = {
  name: "",
  email: "",
  status: "active",
};

/** `yyyy-mm-dd`, which is what a native date input reads and writes. */
function toDateInputValue(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

/** `assignedBy` arrives populated when the API could resolve the admin. */
function assignedByEmail(assignedBy: unknown): string | undefined {
  if (!assignedBy || typeof assignedBy !== "object") return undefined;
  const email = (assignedBy as { email?: unknown }).email;
  return typeof email === "string" ? email : undefined;
}

export function StaffDetailShell({
  locale,
  staffId,
  area = "admin",
  readOnly = false,
}: StaffDetailShellProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();

  const apiBasePath =
    area === "vendor" ? "/api/vendor/staff" : "/api/admin/staff";
  const staffListPath = `/${locale}/${area}/staff`;
  const orderBasePath = `/${locale}/${area}/orders`;

  const [isFetching, setIsFetching] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");

  const [form, setForm] = useState<StaffFormValues>(defaultStaffFormValues);
  const [savedForm, setSavedForm] = useState<StaffFormValues>(
    defaultStaffFormValues,
  );
  const [header, setHeader] = useState<StaffHeaderData | null>(null);
  const [noteEntries, setNoteEntries] = useState<StaffNoteEntry[]>([]);

  const [stats, setStats] = useState<StaffStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  const [vendors, setVendors] = useState<StaffScopeOption[]>([]);
  const [locations, setLocations] = useState<StaffScopeOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(area === "admin");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(savedForm),
    [form, savedForm],
  );

  const applyStaff = useCallback(
    (staff: StaffResponse, options?: { keepEdits?: boolean }) => {
      const profile = staff.staffProfile;
      const loaded: StaffFormValues = {
        name: staff.name || "",
        email: staff.email || "",
        phone: staff.phone || "",
        status: staff.status || "active",
        permissions: normalizeStaffPermissions(profile?.permissions || []),
        vendorIds: (profile?.vendorIds || []).map(String),
        locationIds: (profile?.locationIds || []).map(String),
        fulfillmentRegions: (profile?.fulfillmentRegions || []).join("\n"),
        department: profile?.department || "",
        jobTitle: profile?.jobTitle || "",
        startDate: toDateInputValue(profile?.startDate),
        notes: profile?.notes || "",
        isActive: profile?.isActive ?? true,
      };

      setSavedForm(loaded);
      // A manual refresh must not throw away what an admin has typed into
      // another tab — only the saved baseline moves.
      if (!options?.keepEdits) setForm(loaded);

      setHeader({
        name: loaded.name,
        email: loaded.email,
        phone: loaded.phone,
        image: staff.image,
        status: loaded.status,
        department: loaded.department,
        jobTitle: loaded.jobTitle,
        createdAt: staff.createdAt,
        hasPassword: staff.hasPassword,
        twoFactorEnabled: staff.twoFactorEnabled,
        assignedByEmail: assignedByEmail(profile?.assignedBy),
      });
      setNoteEntries(
        (profile?.noteEntries || []).map((entry) => ({
          ...entry,
          _id: String(entry._id),
        })),
      );
    },
    [],
  );

  const fetchStaff = useCallback(
    (options?: { keepEdits?: boolean }) => {
      const request = async () => {
        const res = await fetch(`${apiBasePath}/${staffId}`);
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || "Failed to load staff member");
        }
        return data.data;
      };
      return request().then((staff) => {
        if (mountedRef.current) applyStaff(staff, options);
      });
    },
    [apiBasePath, applyStaff, staffId],
  );

  const fetchStats = useCallback(() => {
    const request = async () => {
      const res = await fetch(
        `${apiBasePath}/${staffId}/orders?statsOnly=true`,
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error("Failed to load stats");
      return data.data.stats as StaffStats;
    };
    return request()
      .then((stats) => {
        if (mountedRef.current) setStats(stats);
      })
      .catch((error) => {
        console.error("Failed to load staff order stats:", error);
        if (mountedRef.current) setStatsError(true);
      })
      .finally(() => {
        if (mountedRef.current) setStatsLoading(false);
      });
  }, [apiBasePath, staffId]);
  // Manual refreshes show the stats spinner; the effect below sets it during
  // render instead.
  const refreshStats = useCallback(() => {
    setStatsLoading(true);
    setStatsError(false);
    return fetchStats();
  }, [fetchStats]);

  useApplyOnChange([fetchStaff], () => {
    setIsFetching(true);
  });
  useEffect(() => {
    let active = true;
    fetchStaff()
      .catch((error) => {
        if (!active) return;
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to load staff member",
        );
      })
      .finally(() => {
        if (active && mountedRef.current) setIsFetching(false);
      });
    return () => {
      active = false;
    };
  }, [fetchStaff]);

  useApplyOnChange([fetchStats], () => {
    setStatsLoading(true);
    setStatsError(false);
  });
  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // Scope options are an admin-only concern: vendor staff are scoped to the
  // store that owns them, so the vendor area never renders the Scope tab.
  useEffect(() => {
    if (area !== "admin") return;
    let active = true;

    const load = async () => {
      const [vendorsRes, locationsRes] = await Promise.allSettled([
        fetch("/api/admin/vendors?limit=100"),
        fetch("/api/admin/locations?includeInactive=false"),
      ]);

      if (!active) return;

      if (vendorsRes.status === "fulfilled" && vendorsRes.value.ok) {
        const data = await vendorsRes.value.json();
        const rows = data.data?.data || data.data || [];
        if (active && Array.isArray(rows)) {
          setVendors(
            rows.map(
              (vendor: { _id: string; storeName?: string; name?: string }) => ({
                _id: String(vendor._id),
                name: vendor.storeName || vendor.name || "Vendor",
              }),
            ),
          );
        }
      }

      if (locationsRes.status === "fulfilled" && locationsRes.value.ok) {
        const data = await locationsRes.value.json();
        const rows = data.data || [];
        if (active && Array.isArray(rows)) {
          setLocations(
            rows.map((location: { _id: string; name?: string }) => ({
              _id: String(location._id),
              name: location.name || "Location",
            })),
          );
        }
      }
    };

    load()
      .catch(() => {
        if (!active) return;
        setVendors([]);
        setLocations([]);
      })
      .finally(() => {
        if (active) setOptionsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [area]);

  const setField = useCallback(
    <K extends keyof StaffFormValues>(key: K, value: StaffFormValues[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (readOnly) return;
    if (!form.name.trim()) {
      toast.error("Name is required");
      setActiveTab("profile");
      return;
    }
    if (form.permissions.length === 0) {
      toast.error("Select at least one permission");
      setActiveTab("permissions");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        status: form.status,
        permissions: form.permissions,
        ...(area === "admin"
          ? {
              vendorIds: form.vendorIds,
              locationIds: form.locationIds,
              fulfillmentRegions: form.fulfillmentRegions
                .split(/[\n,]+/)
                .map((value) => value.trim())
                .filter(Boolean),
            }
          : {}),
        department: form.department.trim() || undefined,
        jobTitle: form.jobTitle.trim() || undefined,
        startDate: form.startDate || null,
        notes: form.notes.trim() || undefined,
        isActive: form.isActive,
      };

      const res = await fetch(`${apiBasePath}/${staffId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to save staff member");
      }

      applyStaff(data.data);
      toast.success("Staff member updated successfully");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save staff member",
      );
    } finally {
      if (mountedRef.current) setIsSaving(false);
    }
  }, [apiBasePath, applyStaff, area, form, readOnly, router, staffId]);

  const handleDelete = useCallback(async () => {
    if (readOnly) return;
    const shouldDelete = await confirm({
      title: "Remove staff member",
      description:
        "This will remove staff access and revert the user to a customer account. This action cannot be undone.",
      confirmText: "Remove",
      variant: "destructive",
    });
    if (!shouldDelete) return;

    setIsDeleting(true);
    try {
      const res = await fetch(`${apiBasePath}/${staffId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to remove staff member");
      }
      toast.success("Staff member removed successfully");
      router.push(staffListPath);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to remove staff member",
      );
    } finally {
      if (mountedRef.current) setIsDeleting(false);
    }
  }, [apiBasePath, confirm, readOnly, router, staffId, staffListPath]);

  const handleSendInvite = useCallback(async () => {
    setIsSendingInvite(true);
    try {
      const res = await fetch(
        `${apiBasePath}/${staffId}/invite?locale=${encodeURIComponent(locale)}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to send invite email");
      }
      toast.success(data.data?.message || "Invite email sent successfully");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send invite email",
      );
    } finally {
      if (mountedRef.current) setIsSendingInvite(false);
    }
  }, [apiBasePath, locale, staffId]);

  const handleAddNote = useCallback(
    async (body: string) => {
      try {
        const res = await fetch(`${apiBasePath}/${staffId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || "Failed to add note");
        }
        if (mountedRef.current) {
          setNoteEntries(
            (data.data.noteEntries || []).map((entry: StaffNoteEntry) => ({
              ...entry,
              _id: String(entry._id),
            })),
          );
        }
        toast.success("Note added");
        return true;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to add note",
        );
        return false;
      }
    },
    [apiBasePath, staffId],
  );

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([fetchStaff({ keepEdits: true }), refreshStats()]);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to refresh",
      );
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [fetchStaff, refreshStats]);

  const grantedCount = useMemo(
    () =>
      normalizeStaffPermissions(form.permissions).filter((permission) =>
        GRANTABLE_STAFF_PERMISSIONS.includes(permission),
      ).length,
    [form.permissions],
  );

  const scopeCount =
    form.vendorIds.length +
    form.locationIds.length +
    form.fulfillmentRegions
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean).length;

  const tabs = [
    { value: "profile", label: "Profile", icon: UserRound },
    {
      value: "permissions",
      label: "Permissions",
      icon: ShieldCheck,
      count: grantedCount,
    },
    ...(area === "admin"
      ? [
          {
            value: "scope",
            label: "Scope",
            icon: MapPin,
            count: scopeCount,
          },
        ]
      : []),
    { value: "orders", label: "Orders", icon: ShoppingBag },
    // The audit-log endpoint is admin-only, and vendor staff writes are not
    // audited, so the vendor area would only ever show an empty tab.
    ...(area === "admin"
      ? [{ value: "activity", label: "Activity", icon: History }]
      : []),
    {
      value: "notes",
      label: "Notes",
      icon: StickyNote,
      count: noteEntries.length,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <AdminFormStickyHeader
        className="!mx-0 -mt-2 border-b-0 px-0 shadow-none md:px-0"
        title="Staff Details"
        description="View and update this staff member's profile and access"
        status={
          isDirty && !readOnly ? (
            <span className="text-xs font-medium text-amber-600">
              Unsaved changes
            </span>
          ) : null
        }
        actions={
          <>
            {!readOnly && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={isFetching || isSaving || isDeleting || !isDirty}
              >
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={isFetching || isSaving || isDeleting || isRefreshing}
              title="Reload profile and order figures"
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
              />
              <span className="sr-only">Refresh</span>
            </Button>
            {!readOnly && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={isFetching || isSaving || isDeleting}
                title="Remove staff member"
                className="text-destructive hover:text-destructive"
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                <span className="sr-only">Remove staff member</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => router.push(staffListPath)}
              disabled={isSaving || isDeleting}
            >
              Back to staff
            </Button>
          </>
        }
      />

      <StaffDetailHeader
        data={header ?? LOADING_HEADER}
        stats={stats}
        permissionCount={grantedCount}
        totalPermissions={GRANTABLE_STAFF_PERMISSIONS.length}
        accessEnabled={form.isActive}
        hasPosAccess={form.permissions.includes(STAFF_PERMISSIONS.ACCESS_POS)}
        loading={isFetching}
        statsLoading={statsLoading}
        statsError={statsError}
        onSendInvite={readOnly ? undefined : handleSendInvite}
        invitePending={isSendingInvite}
        inviteDisabled={isFetching}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-6">
        <UnderlineTabsList>
          {tabs.map((tab) => (
            <UnderlineTabsTrigger
              key={tab.value}
              value={tab.value}
              icon={tab.icon}
              count={"count" in tab ? tab.count : undefined}
            >
              {tab.label}
            </UnderlineTabsTrigger>
          ))}
        </UnderlineTabsList>

        <TabsContent value="profile">
          {isFetching ? (
            <DetailFormSkeleton />
          ) : (
            <ProfileTab
              form={form}
              setField={setField}
              header={header ?? LOADING_HEADER}
              stats={stats}
              onSendInvite={handleSendInvite}
              invitePending={isSendingInvite}
              readOnly={readOnly}
            />
          )}
        </TabsContent>

        <TabsContent value="permissions">
          {isFetching ? (
            <DetailFormSkeleton cards={1} fieldsPerCard={8} />
          ) : (
            <PermissionsTab
              permissions={form.permissions}
              onChange={(next) => setField("permissions", next)}
              readOnly={readOnly}
            />
          )}
        </TabsContent>

        {area === "admin" && (
          <TabsContent value="scope">
            {isFetching ? (
              <DetailFormSkeleton />
            ) : (
              <ScopeTab
                form={form}
                setField={setField}
                vendors={vendors}
                locations={locations}
                optionsLoading={optionsLoading}
                readOnly={readOnly}
              />
            )}
          </TabsContent>
        )}

        <TabsContent value="orders">
          <OrdersTab
            apiBasePath={apiBasePath}
            staffId={staffId}
            orderBasePath={orderBasePath}
            onStatsChange={setStats}
          />
        </TabsContent>

        {area === "admin" && (
          <TabsContent value="activity">
            <ActivityTab staffId={staffId} />
          </TabsContent>
        )}

        <TabsContent value="notes">
          {isFetching ? (
            <DetailFormSkeleton cards={1} />
          ) : (
            <NotesTab
              form={form}
              setField={setField}
              entries={noteEntries}
              onAddNote={handleAddNote}
              onDelete={handleDelete}
              isDeleting={isDeleting}
              readOnly={readOnly}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
