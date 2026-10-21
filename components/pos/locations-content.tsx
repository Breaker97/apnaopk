"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowUp,
  Circle,
  Plus,
  Pencil,
  Trash2,
  MapPin,
  Star,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import {
  DataTable,
  type DataTableColumn,
  type DataTableAction,
} from "@/components/ui/data-table";
import { InfoTip } from "@/components/ui/info-tip";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { LocationFormDialog } from "./location-form-dialog";
import {
  StoreProfileNotice,
  storeProfileCodeOf,
} from "@/components/admin/store-profile-notice";
import {
  dispatchesOnlineOrders,
  rankFulfillmentCandidates,
} from "@/lib/locations/dispatch-order";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { cn } from "@/lib/utils";

interface Location {
  _id: string;
  name: string;
  address?: string;
  isDefault: boolean;
  isActive: boolean;
  pickupEnabled?: boolean;
  fulfillsOnlineOrders?: boolean;
  sellsAtCounter?: boolean;
  acceptsReturns?: boolean;
  fulfillmentPriority?: number;
  createdAt: string;
  updatedAt: string;
}

const SERVICE_CHIP =
  "inline-flex items-center rounded-sm bg-slate-100 px-2 py-1 text-[12px] font-medium text-slate-800 dark:bg-slate-500/20 dark:text-slate-200";

export function LocationsContent() {
  const t = useTranslations();
  const { confirm } = useConfirmation();

  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchValue, setSearchValue] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  // Set when the store's own profile is missing and could not be made: the
  // list would otherwise read as a store with no locations at all.
  const [profileProblem, setProfileProblem] = useState<string | null>(null);

  // Fetch locations
  const fetchLocations = useCallback(
    () =>
      fetch("/api/admin/locations?includeInactive=true")
        .then((res) => res.json())
        .then((json) => {
          if (json.success) {
            setProfileProblem(null);
            setLocations(json.data || []);
            return;
          }
          const problem = storeProfileCodeOf(json);
          setProfileProblem(problem);
          if (!problem) toast.error(json.message || t("locations.fetchError"));
        })
        .catch(() => {
          toast.error(t("locations.fetchError"));
        })
        .finally(() => setIsLoading(false)),
    [t],
  );
  // Reloads after an action show the spinner; the first load sets it during
  // render below.
  const refreshLocations = useCallback(() => {
    setIsLoading(true);
    return fetchLocations();
  }, [fetchLocations]);

  useApplyOnChange([fetchLocations], () => {
    setIsLoading(true);
  });
  useEffect(() => {
    void fetchLocations();
  }, [fetchLocations]);

  // Filtered data
  const filteredData = useMemo(() => {
    let data = locations;

    if (activeTab === "active") {
      data = data.filter((l) => l.isActive);
    } else if (activeTab === "inactive") {
      data = data.filter((l) => !l.isActive);
    }

    if (searchValue) {
      const q = searchValue.toLowerCase();
      data = data.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          l.address?.toLowerCase().includes(q)
      );
    }

    return data;
  }, [locations, activeTab, searchValue]);

  // Actions
  const handleDelete = useCallback(
    async (location: Location) => {
      if (location.isDefault) {
        toast.error(t("locations.cannotDeleteDefault"));
        return;
      }

      const confirmed = await confirm({
        title: t("locations.deleteTitle"),
        description: t("locations.deleteDescription", { name: location.name }),
        confirmText: t("common.delete"),
        cancelText: t("common.cancel"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        const res = await fetch(`/api/admin/locations/${location._id}`, {
          method: "DELETE",
        });
        const json = await res.json();
        if (json.success) {
          toast.success(t("locations.deleted"));
          refreshLocations();
        } else {
          toast.error(json.message || t("locations.deleteError"));
        }
      } catch {
        toast.error(t("locations.deleteError"));
      }
    },
    [confirm, refreshLocations, t]
  );

  const handleToggleActive = useCallback(
    async (location: Location) => {
      try {
        const res = await fetch(`/api/admin/locations/${location._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !location.isActive }),
        });
        const json = await res.json();
        if (json.success) {
          toast.success(
            location.isActive
              ? t("locations.deactivated")
              : t("locations.activated")
          );
          refreshLocations();
        } else {
          toast.error(json.message);
        }
      } catch {
        toast.error(t("locations.updateError"));
      }
    },
    [refreshLocations, t]
  );

  const handleSetDefault = useCallback(
    async (location: Location) => {
      if (location.isDefault) return;

      try {
        const res = await fetch(`/api/admin/locations/${location._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isDefault: true }),
        });
        const json = await res.json();
        if (json.success) {
          toast.success(t("locations.setAsDefault"));
          refreshLocations();
        } else {
          toast.error(json.message);
        }
      } catch {
        toast.error(t("locations.updateError"));
      }
    },
    [refreshLocations, t]
  );

  /**
   * The branches that dispatch delivery orders, first choice first.
   *
   * Ranked with the very function the checkout uses, so the numbers a merchant
   * reads here are the order their orders will actually be dispatched in — a
   * second, approximate copy of the rule would eventually disagree with the one
   * that moves stock, and only the stock would be right.
   */
  const dispatchOrder = useMemo(
    () => rankFulfillmentCandidates(locations.filter(dispatchesOnlineOrders)),
    [locations],
  );

  const dispatchRank = useCallback(
    (id: string) => dispatchOrder.findIndex((entry) => entry.id === id),
    [dispatchOrder],
  );

  /**
   * Swap a branch with its neighbour in the dispatch order.
   *
   * Two writes rather than one reorder endpoint: the list is short, the
   * priorities are already per-location, and a merchant nudging one shop up is
   * not restating the whole sequence. Both are written explicitly — moving A
   * above B by only lowering A's number breaks as soon as several branches
   * share the default priority of 0.
   */
  const handleMove = useCallback(
    async (location: Location, direction: -1 | 1) => {
      const index = dispatchRank(location._id);
      const swapWith = dispatchOrder[index + direction];
      if (index < 0 || !swapWith) return;

      try {
        await Promise.all([
          fetch(`/api/admin/locations/${location._id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fulfillmentPriority: index + direction }),
          }),
          fetch(`/api/admin/locations/${swapWith.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fulfillmentPriority: index }),
          }),
        ]);
        refreshLocations();
      } catch {
        toast.error(t("locations.saveError"));
      }
    },
    [dispatchOrder, dispatchRank, refreshLocations, t],
  );

  const handleEdit = useCallback((location: Location) => {
    setEditingLocation(location);
    setDialogOpen(true);
  }, []);

  const handleAdd = useCallback(() => {
    setEditingLocation(null);
    setDialogOpen(true);
  }, []);

  const handleDialogSuccess = useCallback(() => {
    setDialogOpen(false);
    setEditingLocation(null);
    refreshLocations();
  }, [refreshLocations]);

  // Columns
  const columns = useMemo<DataTableColumn<Location>[]>(
    () => [
      {
        id: "name",
        header: t("locations.name"),
        cell: (row) => (
          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 sm:flex">
              <MapPin className="size-4 text-primary" />
            </div>
            <div className="min-w-0 max-w-[136px] sm:max-w-[200px] xl:max-w-[240px] 2xl:max-w-[360px]">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold" title={row.name}>
                  {row.name}
                </span>
                {row.isDefault && (
                  <span className="shrink-0 rounded-sm bg-primary/10 px-1.5 text-[11px] font-semibold leading-4 text-primary">
                    {t("locations.default")}
                  </span>
                )}
                {/* The Status column is hidden below lg; an inactive branch
                    still has to read as one there. */}
                {!row.isActive && (
                  <span className="shrink-0 rounded-sm bg-slate-100 px-1.5 text-[11px] font-semibold leading-4 text-slate-800 lg:hidden dark:bg-slate-500/20 dark:text-slate-200">
                    {t("locations.inactive")}
                  </span>
                )}
              </div>
              {row.address && (
                <div
                  className="truncate text-muted-foreground"
                  title={row.address}
                >
                  {row.address}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        id: "delivery",
        header: (
          <span className="inline-flex items-center gap-1">
            {t("locations.deliveryOrder")}
            <InfoTip text={t("locations.deliveryOrderHint")} />
          </span>
        ),
        // Where this branch sits in the delivery queue. Without it the
        // reorder actions below would move a number nothing on screen showed.
        cell: (row) => {
          const rank = dispatchRank(row._id);
          return rank >= 0 ? (
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {t("locations.deliveryRank", { rank: rank + 1 })}
            </span>
          ) : (
            <span className="text-muted-foreground">
              <span aria-hidden="true">&mdash;</span>
              <span className="sr-only">{t("locations.noDelivery")}</span>
            </span>
          );
        },
        className: "hidden w-[140px] lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
      {
        id: "services",
        header: t("locations.services"),
        // Whether the public may collect here, and the two switches that
        // differ from the norm. Nothing is drawn for a branch that does
        // neither: most rows have no such flag, and a chip on every row would
        // say nothing.
        cell: (row) => (
          <div className="flex flex-wrap items-center gap-1.5">
            {row.pickupEnabled ? (
              <span className={SERVICE_CHIP}>{t("locations.pickup")}</span>
            ) : null}
            {/* Off by default, so the chip marks the few that are on. */}
            {row.acceptsReturns ? (
              <span className={SERVICE_CHIP}>{t("locations.returns")}</span>
            ) : null}
            {/* Shown only when OFF. It defaults on, so a "Counter" chip would
                sit on almost every row; the exception is what a merchant
                needs, because it is the answer to "why is this branch missing
                from my register". */}
            {row.sellsAtCounter === false ? (
              <span
                className={cn(
                  SERVICE_CHIP,
                  "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
                )}
              >
                {t("locations.noTill")}
              </span>
            ) : null}
          </div>
        ),
        className: "hidden w-[220px] xl:table-cell",
        headerClassName: "hidden xl:table-cell",
      },
      {
        id: "status",
        header: t("locations.status"),
        cell: (row) => (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] font-medium",
              row.isActive
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                : "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200",
            )}
          >
            <Circle className="h-2.5 w-2.5 fill-current stroke-0" />
            {row.isActive ? t("locations.active") : t("locations.inactive")}
          </span>
        ),
        className: "hidden w-[140px] lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
    ],
    [t, dispatchRank]
  );

  // Tabs
  const tabs = useMemo(
    () => [
      { id: "all", label: t("locations.all") },
      { id: "active", label: t("locations.active") },
      { id: "inactive", label: t("locations.inactive") },
    ],
    [t]
  );

  // Header: the same title row, underline tabs and search row as Orders.
  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("locations.title"),
        addAction: {
          id: "add",
          label: t("locations.addLocation"),
          icon: <Plus className="h-4 w-4" />,
          variant: "default",
          onClick: handleAdd,
          disabled: Boolean(profileProblem),
        },
      }),
    [t, handleAdd, profileProblem]
  );

  // Row actions
  const rowActions = useCallback(
    (row: Location): DataTableAction[] => {
      const actions: DataTableAction[] = [
        {
          id: "edit",
          label: t("common.edit"),
          icon: <Pencil className="h-4 w-4" />,
          onClick: () => handleEdit(row),
        },
      ];

      if (!row.isDefault) {
        actions.push({
          id: "setDefault",
          label: t("locations.setDefault"),
          icon: <Star className="h-4 w-4" />,
          onClick: () => handleSetDefault(row),
        });
      }

      // Only for a branch that is actually in the queue, and only in the
      // direction it can move — offering "move up" to the first entry is a
      // control that does nothing when pressed.
      const rank = dispatchRank(row._id);
      if (rank > 0) {
        actions.push({
          id: "dispatchUp",
          label: t("locations.shipSooner"),
          icon: <ArrowUp className="h-4 w-4" />,
          onClick: () => handleMove(row, -1),
        });
      }
      if (rank >= 0 && rank < dispatchOrder.length - 1) {
        actions.push({
          id: "dispatchDown",
          label: t("locations.shipLater"),
          icon: <ArrowDown className="h-4 w-4" />,
          onClick: () => handleMove(row, 1),
        });
      }

      actions.push({
        id: "toggle",
        label: row.isActive
          ? t("locations.deactivate")
          : t("locations.activate"),
        icon: row.isActive ? (
          <ToggleLeft className="h-4 w-4" />
        ) : (
          <ToggleRight className="h-4 w-4" />
        ),
        onClick: () => handleToggleActive(row),
      });

      if (!row.isDefault) {
        actions.push({
          id: "delete",
          label: t("common.delete"),
          icon: <Trash2 className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => handleDelete(row),
        });
      }

      return actions;
    },
    [
      t,
      handleEdit,
      handleSetDefault,
      handleToggleActive,
      handleDelete,
      handleMove,
      dispatchRank,
      dispatchOrder.length,
    ]
  );

  return (
    <>
      {profileProblem ? (
        <StoreProfileNotice code={profileProblem} className="mb-4" />
      ) : null}
      <DataTable
        data={filteredData}
        columns={columns}
        keyField="_id"
        isLoading={isLoading}
        loadingMode="rows"
        title={tableHeader.title}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={tableHeader.actions}
        searchable
        searchPlaceholder={t("locations.searchPlaceholder")}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        toolbarActions={tableHeader.toolbarActions}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        onRowClick={handleEdit}
        rowActions={rowActions}
        rowActionsHeader={t("locations.actions")}
        rowActionsVariant="dropdown"
        emptyMessage={t("locations.empty")}
        emptyIcon={<MapPin className="h-10 w-10" />}
        className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:text-xs"
      />

      <LocationFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingLocation(null);
        }}
        location={editingLocation}
        onSuccess={handleDialogSuccess}
      />
    </>
  );
}
