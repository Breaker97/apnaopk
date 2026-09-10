"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  PayoutsTableCard,
  usePayoutStatusTabs,
  type PayoutTableRow,
} from "@/components/payouts/payouts-table-card";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { VendorCommissionCard } from "@/components/vendor/payouts/vendor-commission-card";

interface VendorPayoutsContentProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: PayoutTableRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function VendorPayoutsContent({
  locale,
  data,
  pagination,
}: VendorPayoutsContentProps) {
  const t = useTranslations();
  const router = useRouter();
  const tabs = usePayoutStatusTabs();

  const list = useListNavigation<PayoutTableRow>({
    items: data,
    pagination,
    defaultPageSize: 20,
  });

  return (
    <div className="space-y-6">
      <div className="-mt-2">
        <h1 className="text-3xl font-bold">
          {t("vendor.payoutsPage.title")}
        </h1>
        <p className="text-muted-foreground">
          {t("vendor.payoutsPage.subtitle")}
        </p>
      </div>

      {/*
        Renders itself away when nothing is owed, so the payouts screen is
        unchanged for the merchants this does not apply to. Above the table on
        purpose: it is the only thing here the vendor has to act on.
      */}
      <VendorCommissionCard locale={locale} />

      <PayoutsTableCard
        locale={locale}
        data={list.items}
        isLoading={list.isLoading}
        title={t("vendor.payoutsPage.listSection.title")}
        detailHref={(row) => `/${locale}/vendor/payouts/${row._id}`}
        onRowOpen={(row) => router.push(`/${locale}/vendor/payouts/${row._id}`)}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={list.handleTabChange}
        searchPlaceholder={t("vendor.payoutsPage.listSection.searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filterValues={{ status: list.activeTab }}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        sortColumn={list.sortBy}
        sortDirection={list.sortOrder}
        onSortChange={list.handleSortChange}
        rowActionsHeader={t("vendor.payoutsPage.listSection.columns.details")}
        emptyMessage={t("vendor.payoutsPage.listSection.empty")}
      />
    </div>
  );
}
