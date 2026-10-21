"use client";

import { useRouter } from "@/hooks/use-locale-navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import {
  type DataTableAction,
  type DataTableFilter,
} from "@/components/ui/data-table";
import {
  PayoutsTableCard,
  usePayoutStatusTabs,
  type PayoutTableRow,
} from "@/components/payouts/payouts-table-card";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { CreatePayoutDialog } from "@/components/admin/payouts/create-payout-dialog";

type VendorOption = { _id: string; storeName: string };

interface AdminPayoutsContentProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: PayoutTableRow[];
  /** Vendors for the filter dropdown and the create-payout form. */
  vendorOptions: VendorOption[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function AdminPayoutsContent({
  locale,
  data,
  pagination,
  vendorOptions,
}: AdminPayoutsContentProps) {
  const t = useTranslations();
  const router = useRouter();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const list = useListNavigation<PayoutTableRow>({
    items: data,
    pagination,
    filterIds: ["vendorId"],
    defaultPageSize: 20,
  });

  const tabs = usePayoutStatusTabs();

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "vendorId",
        label: t("admin.payoutsPage.listSection.columns.vendor"),
        type: "select",
        options: [
          {
            label: t("admin.vendorsManagement.allVendors"),
            value: "all",
          },
          ...vendorOptions.map((vendor) => ({
            label: vendor.storeName,
            value: vendor._id,
          })),
        ],
      },
    ],
    [t, vendorOptions],
  );

  const tableActions = useMemo<DataTableAction[]>(
    () => [
      {
        id: "create-payout",
        label: t("admin.payoutsPage.createSection.title"),
        icon: <Plus className="h-4 w-4" />,
        onClick: () => setIsCreateDialogOpen(true),
        variant: "default",
      },
    ],
    [t],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          {t("admin.payoutsPage.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("admin.payoutsPage.subtitle")}
        </p>
      </div>

      <PayoutsTableCard
        locale={locale}
        data={list.items}
        isLoading={list.isLoading}
        title={t("admin.payoutsPage.listSection.title")}
        detailHref={(row) => `/${locale}/admin/payouts/${row._id}`}
        onRowOpen={(row) => router.push(`/admin/payouts/${row._id}`)}
        showVendorColumn
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={list.handleTabChange}
        actions={tableActions}
        searchPlaceholder={t("admin.payoutsPage.listSection.searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={{ ...list.filters, status: list.activeTab }}
        onFilterChange={list.handleFilterChange}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        sortColumn={list.sortBy}
        sortDirection={list.sortOrder}
        onSortChange={list.handleSortChange}
        rowActionsHeader={t("admin.payoutsPage.listSection.columns.details")}
        emptyMessage={t("admin.payoutsPage.listSection.empty")}
      />

      <CreatePayoutDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onCreated={() => list.refetch()}
      />
    </div>
  );
}
