"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { apiClient } from "@/lib/api/client";

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
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [form, setForm] = useState({
    vendorId: "",
    periodStart: "",
    periodEnd: "",
    note: "",
  });

  const list = useListNavigation<PayoutTableRow>({
    items: data,
    pagination,
    filterIds: ["vendorId"],
    defaultPageSize: 20,
  });

  const createPayout = async () => {
    if (!form.vendorId || !form.periodStart || !form.periodEnd) {
      toast.error(
        t("admin.payoutsPage.toast.requiredFields"),
      );
      return;
    }
    setIsCreating(true);
    try {
      await apiClient.post("/api/admin/payouts", form);
      toast.success(
        t("admin.payoutsPage.toast.createSuccess"),
      );
      setIsCreateDialogOpen(false);
      setForm({
        vendorId: "",
        periodStart: "",
        periodEnd: "",
        note: "",
      });
      list.refetch();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin.payoutsPage.toast.createError"),
      );
    } finally {
      setIsCreating(false);
    }
  };

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
        onRowOpen={(row) => router.push(`/${locale}/admin/payouts/${row._id}`)}
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

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void createPayout();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t("admin.payoutsPage.createSection.title")}
              </DialogTitle>
              <DialogDescription>
                {t("admin.payoutsPage.subtitle")}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="payout-vendor">
                  {t("admin.payoutsPage.listSection.columns.vendor")}
                </Label>
                <select
                  id="payout-vendor"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={form.vendorId}
                  disabled={isCreating}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, vendorId: e.target.value }))
                  }
                >
                  <option value="">
                    {t("admin.payoutsPage.createSection.selectVendor")}
                  </option>
                  {vendorOptions.map((vendor) => (
                    <option key={vendor._id} value={vendor._id}>
                      {vendor.storeName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payout-period-start">
                  {t("admin.payoutsPage.createSection.periodStart")}
                </Label>
                <Input
                  id="payout-period-start"
                  type="date"
                  value={form.periodStart}
                  disabled={isCreating}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      periodStart: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="payout-period-end">
                  {t("admin.payoutsPage.createSection.periodEnd")}
                </Label>
                <Input
                  id="payout-period-end"
                  type="date"
                  value={form.periodEnd}
                  disabled={isCreating}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, periodEnd: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="payout-note">
                  {t("admin.payoutsPage.createSection.optionalNote")}
                </Label>
                <Input
                  id="payout-note"
                  value={form.note}
                  disabled={isCreating}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, note: e.target.value }))
                  }
                  placeholder={t("admin.payoutsPage.createSection.optionalNote")}
                />
              </div>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isCreating}>
                  {t("common.cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isCreating}>
                {isCreating
                  ? t("admin.payoutsPage.createSection.creating")
                  : t("admin.payoutsPage.createSection.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
