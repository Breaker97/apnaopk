"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  Megaphone,
  PanelBottom,
  PanelTop,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import {
  DataTable,
  type DataTableAction,
  type DataTableColumn,
  type DataTableTab,
} from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useRouter } from "@/hooks/use-locale-navigation";
import { apiClient, describeApiError } from "@/lib/api/client";
import {
  campaignBannerState,
  type CampaignBanner,
  type CampaignBannerState,
} from "@/lib/campaign-banners/types";
import {
  editBannerHref,
  newBannerHref,
  type CampaignBannerScope,
} from "./campaign-banner-scope";

const STATE_VARIANT: Record<
  CampaignBannerState,
  "default" | "secondary" | "outline"
> = {
  live: "default",
  scheduled: "secondary",
  draft: "outline",
  paused: "outline",
  ended: "outline",
};

const TAB_IDS = ["all", "live", "scheduled", "draft", "paused", "ended"] as const;

/** A moment in the viewer's own time zone, short. */
function formatMoment(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * The list of Campaign Banners: one table for the admin, the staff area and a
 * vendor's dashboard (the scope says where each reads, writes and links).
 */
export function CampaignBannersTable({ scope }: { scope: CampaignBannerScope }) {
  const t = useTranslations("admin.campaignBanners");
  const router = useRouter();
  const { confirm } = useConfirmation();

  const [banners, setBanners] = useState<CampaignBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<(typeof TAB_IDS)[number]>("all");
  // Read once per render of the list: "live" and "ended" are decided by it.
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (tab !== "all") params.set("state", tab);
      const query = params.toString();
      const items = await apiClient.get<CampaignBanner[]>(
        `${scope.apiBase}${query ? `?${query}` : ""}`,
      );
      setBanners(items);
      setNow(new Date());
    } catch (error) {
      toast.error(describeApiError(error, t("toast.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [scope.apiBase, search, tab, t]);

  useEffect(() => {
    // Typing in the search box re-queries; wait for a pause.
    const timer = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  const toggleStatus = useCallback(
    async (banner: CampaignBanner) => {
      const next = banner.status === "active" ? "paused" : "active";
      try {
        await apiClient.put(`${scope.apiBase}/${banner.id}`, { status: next });
        toast.success(next === "active" ? t("toast.resumed") : t("toast.paused"));
        void load();
      } catch (error) {
        toast.error(describeApiError(error, t("toast.updateFailed")));
      }
    },
    [scope.apiBase, load, t],
  );

  const duplicate = useCallback(
    async (banner: CampaignBanner) => {
      try {
        await apiClient.post(`${scope.apiBase}/${banner.id}/duplicate`, {});
        toast.success(t("toast.duplicated"));
        void load();
      } catch (error) {
        toast.error(describeApiError(error, t("toast.updateFailed")));
      }
    },
    [scope.apiBase, load, t],
  );

  const remove = useCallback(
    async (banner: CampaignBanner) => {
      const ok = await confirm({
        title: t("confirm.deleteTitle"),
        description: t("confirm.deleteDescription", { name: banner.name }),
        confirmText: t("actions.delete"),
        cancelText: t("actions.cancel"),
        variant: "destructive",
      });
      if (!ok) return;
      try {
        await apiClient.delete(`${scope.apiBase}/${banner.id}`);
        toast.success(t("toast.deleted"));
        void load();
      } catch (error) {
        toast.error(describeApiError(error, t("toast.deleteFailed")));
      }
    },
    [confirm, scope.apiBase, load, t],
  );

  const columns = useMemo<DataTableColumn<CampaignBanner>[]>(
    () => [
      {
        id: "name",
        header: t("table.name"),
        cell: (row) => (
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              {row.type === "bar" ? (
                row.content.barPosition === "bottom" ? (
                  <PanelBottom className="h-4 w-4" />
                ) : (
                  <PanelTop className="h-4 w-4" />
                )
              ) : (
                <Megaphone className="h-4 w-4" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{row.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {row.content.headline || t(`type.${row.type}`)}
              </p>
            </div>
          </div>
        ),
        className: "w-[320px]",
      },
      {
        id: "type",
        header: t("table.type"),
        cell: (row) => <span className="text-sm">{t(`type.${row.type}`)}</span>,
        className: "w-[110px]",
      },
      {
        id: "status",
        header: t("table.status"),
        cell: (row) => {
          const state = campaignBannerState(row, now);
          return <Badge variant={STATE_VARIANT[state]}>{t(`state.${state}`)}</Badge>;
        },
        className: "w-[130px]",
      },
      {
        id: "schedule",
        header: t("table.schedule"),
        cell: (row) => {
          const { start, end } = row.schedule;
          const text =
            start && end
              ? t("schedule.range", {
                  start: formatMoment(start),
                  end: formatMoment(end),
                })
              : start
                ? t("schedule.from", { start: formatMoment(start) })
                : end
                  ? t("schedule.until", { end: formatMoment(end) })
                  : t("schedule.always");
          return <span className="text-sm text-muted-foreground">{text}</span>;
        },
        className: "w-[280px]",
      },
      {
        id: "devices",
        header: t("table.devices"),
        cell: (row) => (
          <span className="text-sm">
            {row.rules.devices.length === 2
              ? t("devices.both")
              : t(`devices.${row.rules.devices[0]}`)}
          </span>
        ),
        className: "w-[110px]",
      },
      {
        id: "priority",
        header: t("table.priority"),
        cell: (row) => <span className="text-sm tabular-nums">{row.priority}</span>,
        className: "w-[90px]",
      },
    ],
    [now, t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => TAB_IDS.map((id) => ({ id, label: t(`tabs.${id}`) })),
    [t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("title"),
        ...(scope.canEdit
          ? {
              addAction: {
                id: "add",
                label: t("actions.add"),
                href: newBannerHref(scope),
                icon: <Plus className="h-4 w-4" />,
                variant: "default" as const,
              },
            }
          : {}),
      }),
    [scope, t],
  );

  const rowActions = useCallback(
    (row: CampaignBanner): DataTableAction[] => {
      const actions: DataTableAction[] = [
        {
          id: "edit",
          label: scope.canEdit ? t("actions.edit") : t("actions.view"),
          icon: <Pencil className="h-4 w-4" />,
          href: editBannerHref(scope, row.id),
        },
      ];
      if (!scope.canEdit) return actions;
      actions.push(
        {
          id: "duplicate",
          label: t("actions.duplicate"),
          icon: <Copy className="h-4 w-4" />,
          onClick: () => duplicate(row),
        },
        {
          id: "toggle",
          label:
            row.status === "active" ? t("actions.pause") : t("actions.activate"),
          icon:
            row.status === "active" ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            ),
          onClick: () => toggleStatus(row),
        },
        {
          id: "delete",
          label: t("actions.delete"),
          icon: <Trash2 className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => remove(row),
        },
      );
      return actions;
    },
    [scope, duplicate, toggleStatus, remove, t],
  );

  return (
    <DataTable
      data={banners}
      columns={columns}
      keyField="id"
      isLoading={loading}
      loadingMode="rows"
      title={tableHeader.title}
      tabs={tabs}
      activeTab={tab}
      onTabChange={(id) => setTab(id as (typeof TAB_IDS)[number])}
      actions={tableHeader.actions}
      searchable
      searchPlaceholder={t("searchPlaceholder")}
      searchValue={search}
      onSearchChange={setSearch}
      toolbarActions={tableHeader.toolbarActions}
      toolbarLayout={tableHeader.toolbarLayout}
      tabsVariant={tableHeader.tabsVariant}
      filtersVariant={tableHeader.filtersVariant}
      appearance={tableHeader.appearance}
      stackedTopControls={tableHeader.stackedTopControls}
      showToolbarSortButton={tableHeader.showToolbarSortButton}
      rowActions={rowActions}
      rowActionsHeader={t("table.actions")}
      rowActionsVariant="inline"
      onRowClick={(row) => router.push(editBannerHref(scope, row.id))}
      emptyMessage={search || tab !== "all" ? t("emptyFiltered") : t("empty")}
      emptyIcon={<Megaphone className="h-8 w-8" />}
    />
  );
}
