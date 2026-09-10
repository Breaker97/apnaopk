"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  Mail,
  RefreshCcw,
  RotateCcw,
  ShoppingCart,
} from "lucide-react";
import {
  DataTable,
  DateCell,
  TextCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { useCurrency } from "@/providers/currency-provider";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";

interface AbandonedCheckoutItem {
  name: string;
  quantity: number;
  price: number;
  productId?: string | { _id?: string } | null;
}

interface AbandonedCheckout {
  _id: string;
  email?: string;
  phone?: string;
  customerName?: string;
  checkoutUrl?: string;
  gateway?: string;
  sourceName?: string;
  recoveryEmailStatus?: string;
  recoveryStatus?: string;
  abandonedAt?: string;
  checkoutStartedAt?: string;
  updatedAt: string;
  totalPrice?: number;
  subtotalPrice?: number;
  itemCount?: number;
  items: AbandonedCheckoutItem[];
}

interface AbandonedCheckoutsDataTableProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: AbandonedCheckout[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const ABANDONED_FILTER_IDS = ["emailStatus"];

function getCustomerLabel(row: AbandonedCheckout) {
  return row.customerName || row.email || row.phone || "Guest";
}

function getFirstProduct(row: AbandonedCheckout) {
  const first = row.items?.[0];
  if (!first) return "No items";
  return row.items.length > 1
    ? `${first.name} + ${row.items.length - 1} more`
    : first.name;
}

function getStatusBadgeClasses(status?: string) {
  if (status === "recovered") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300";
  }
  return "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";
}

function getEmailBadgeClasses(status?: string) {
  if (status === "sent") {
    return "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300";
  }
  if (status === "failed") {
    return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300";
  }
  if (status === "not_applicable") {
    return "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-200";
  }
  return "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-200";
}

function formatStatus(value?: string) {
  return (value || "not_sent").replace(/_/g, " ");
}

export function AbandonedCheckoutsDataTable({
  locale,
  data,
  pagination,
}: AbandonedCheckoutsDataTableProps) {
  const router = useRouter();
  const { formatPrice } = useCurrency();
  const [isDetecting, setIsDetecting] = useState(false);

  const list = useListNavigation<AbandonedCheckout>({
    items: data,
    pagination,
    tabParam: "view",
    filterIds: ABANDONED_FILTER_IDS,
    defaultSortBy: "abandonedAt",
  });

  const handleDetect = useCallback(async () => {
    setIsDetecting(true);
    try {
      const data = await apiClient.post<{ modified?: number }>(
        "/api/admin/abandoned-checkouts/detect",
        { minutes: 10, locale },
      );
      toast.success(`${data?.modified || 0} abandoned checkouts marked`);
      router.refresh();
      list.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Detection failed");
    } finally {
      setIsDetecting(false);
    }
  }, [list, locale, router]);

  const handleSendEmail = useCallback(
    async (row: AbandonedCheckout) => {
      try {
        const data = await apiClient.post<{ sent?: boolean }>(
          "/api/admin/abandoned-checkouts/send",
          { checkoutId: row._id, locale },
        );
        if (data?.sent) {
          toast.success("Recovery email sent");
        } else {
          toast.error("Recovery email could not be sent");
        }
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to send recovery email",
        );
      }
    },
    [list, locale],
  );

  const handleCopyLink = useCallback((row: AbandonedCheckout) => {
    if (!row.checkoutUrl) {
      toast.error("No recovery link is available");
      return;
    }
    void navigator.clipboard.writeText(row.checkoutUrl);
    toast.success("Recovery link copied");
  }, []);

  const columns = useMemo<DataTableColumn<AbandonedCheckout>[]>(
    () => [
      {
        id: "customer",
        header: "Customer",
        cell: (row) => (
          <div className="min-w-0">
            <TextCell value={getCustomerLabel(row)} className="font-medium" />
            <div className="text-xs text-muted-foreground">
              <TextCell value={row.email || row.phone || "No contact"} truncate maxWidth="240px" />
            </div>
          </div>
        ),
        className: "w-[280px]",
      },
      {
        id: "items",
        header: "Products",
        cell: (row) => (
          <TextCell
            value={getFirstProduct(row)}
            truncate
            maxWidth="260px"
            className="font-medium text-slate-700 dark:text-slate-300"
          />
        ),
        className: "w-[280px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
      },
      {
        id: "abandonedAt",
        header: "Abandoned",
        cell: (row) => (
          <DateCell
            date={row.abandonedAt || row.checkoutStartedAt || row.updatedAt}
            format="relative"
          />
        ),
        className: "w-[150px]",
        sortable: true,
      },
      {
        id: "totalPrice",
        header: "Total",
        cell: (row) => (
          <TextCell
            value={formatPrice(row.totalPrice || row.subtotalPrice || 0)}
            className="block w-full text-right font-medium"
          />
        ),
        className: "w-[130px]",
        headerClassName: "text-right [&>div]:justify-center",
        sortable: true,
      },
      {
        id: "recoveryEmailStatus",
        header: "Email",
        cell: (row) => (
          <span
            className={`inline-flex rounded-sm px-2 py-1 text-[12px] font-medium capitalize ${getEmailBadgeClasses(row.recoveryEmailStatus)}`}
          >
            {formatStatus(row.recoveryEmailStatus)}
          </span>
        ),
        className: "w-[150px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
        sortable: true,
      },
      {
        id: "recoveryStatus",
        header: "Recovery",
        cell: (row) => (
          <span
            className={`inline-flex rounded-sm px-2 py-1 text-[12px] font-medium capitalize ${getStatusBadgeClasses(row.recoveryStatus)}`}
          >
            {formatStatus(row.recoveryStatus || "not_recovered")}
          </span>
        ),
        className: "w-[150px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
        sortable: true,
      },
    ],
    [formatPrice],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: "All" },
      { id: "open", label: "Open" },
      { id: "recovered", label: "Recovered" },
    ],
    [],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "emailStatus",
        label: "Email status",
        type: "select",
        options: [
          { label: "All", value: "all" },
          { label: "Not sent", value: "not_sent" },
          { label: "Sent", value: "sent" },
          { label: "Failed", value: "failed" },
          { label: "No email", value: "not_applicable" },
        ],
      },
    ],
    [],
  );

  const tableHeader = buildAdminCommerceTableHeader({
    title: "Abandoned checkouts",
    secondaryActions: [
      {
        id: "detect",
        label: isDetecting ? "Detecting..." : "Detect now",
        icon: <RefreshCcw className={`h-4 w-4 ${isDetecting ? "animate-spin" : ""}`} />,
        onClick: handleDetect,
        disabled: isDetecting,
      },
    ],
  });

  return (
    <DataTable
      data={list.items}
      columns={columns}
      keyField="_id"
      title={tableHeader.title}
      titleIcon={<ShoppingCart className="h-5 w-5" />}
      actions={tableHeader.actions}
      tabs={tabs}
      activeTab={list.activeTab}
      onTabChange={list.handleTabChange}
      searchable
      searchPlaceholder="Search customer, email, phone, or product"
      searchValue={list.search}
      onSearchChange={list.handleSearchChange}
      filters={filters}
      filterValues={list.filters}
      onFilterChange={list.handleFilterChange}
      pagination={list.pagination}
      onPageChange={list.handlePageChange}
      onPageSizeChange={list.handlePageSizeChange}
      sortColumn={list.sortBy}
      sortDirection={list.sortOrder}
      onSortChange={list.handleSortChange}
      isLoading={list.isLoading}
      loadingMode="rows"
      rowActions={(row): DataTableAction[] => [
        {
          id: "send-email",
          label: "Send recovery email",
          icon: <Mail className="h-4 w-4" />,
          onClick: () => void handleSendEmail(row),
          disabled: !row.email || row.recoveryStatus === "recovered",
        },
        {
          id: "copy-link",
          label: "Copy recovery link",
          icon: <Copy className="h-4 w-4" />,
          onClick: () => handleCopyLink(row),
          disabled: !row.checkoutUrl,
        },
        ...(row.checkoutUrl
          ? [
              {
                id: "open-recovery",
                label: "Open checkout",
                icon: <RotateCcw className="h-4 w-4" />,
                href: row.checkoutUrl,
              },
            ]
          : []),
      ]}
      emptyMessage="Abandoned checkouts will show here after a customer starts checkout and leaves before payment."
      emptyIcon={<ShoppingCart className="h-8 w-8" />}
      appearance={tableHeader.appearance}
      toolbarLayout={tableHeader.toolbarLayout}
      tabsVariant={tableHeader.tabsVariant}
      filtersVariant={tableHeader.filtersVariant}
      stackedTopControls={tableHeader.stackedTopControls}
      showToolbarSortButton={tableHeader.showToolbarSortButton}
      className="shadow-none"
    />
  );
}
