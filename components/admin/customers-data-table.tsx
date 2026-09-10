"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ChevronsUpDown,
  Download,
  Eye,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  UserMinus,
  ShieldBan,
  Upload,
} from "lucide-react";
import {
  DataTable,
  CurrencyCell,
  DateCell,
  NumberCell,
  StatusCell,
  TextCell,
  type DataTableAction,
  type DataTableBulkAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast-notification";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";

interface CustomerListItem {
  _id: string;
  userId: string;
  loyaltyPoints: number;
  loyaltyTier: "bronze" | "silver" | "gold" | "platinum";
  tags?: string[];
  notes?: string;
  acquisitionSource?: string;
  stats?: {
    totalOrders?: number;
    totalSpent?: number;
    averageOrderValue?: number;
    lastOrderDate?: string;
    totalReviews?: number;
    averageRating?: number;
    totalWishlistItems?: number;
  };
  lastActiveAt?: string;
  createdAt: string;
  /** Guest rows: customer records with no account — identity lives on the profile. */
  isGuest?: boolean;
  email?: string;
  name?: string;
  user?: {
    _id: string;
    name: string;
    email: string;
    image?: string;
    phone?: string;
    role: string;
    status?: "active" | "inactive" | "banned";
    createdAt: string;
  };
}

interface CustomersDataTableProps {
  locale: string;
  /**
   * "vendor" renders the read-only storefront-seller variant: no detail
   * links (vendors have no customer detail page), no platform CRM columns
   * (tier, points, tags), no filters or import/export — the rows' stats are
   * already vendor-scoped by the API.
   */
  area?: "admin" | "staff" | "vendor";
  readOnly?: boolean;
  /** Rows for the current query string, fetched by the page. */
  data: CustomerListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const CUSTOMER_FILTER_IDS = ["tier", "tag"];

function getInitials(name?: string) {
  if (!name) return "CU";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function CustomersDataTable({
  locale,
  area = "admin",
  readOnly = false,
  data,
  pagination,
}: CustomersDataTableProps) {
  const t = useTranslations();
  const tr = useAdminPhrase();
  const router = useRouter();
  const { confirm } = useConfirmation();

  const [selectedCustomers, setSelectedCustomers] = useState<CustomerListItem[]>([]);
  const basePath = `/${locale}/${area}`;
  const isVendorArea = area === "vendor";

  const list = useListNavigation<CustomerListItem>({
    items: data,
    pagination,
    filterIds: CUSTOMER_FILTER_IDS,
  });

  const tagOptions = useMemo(() => {
    const tags = Array.from(
      new Set(
        list.items.flatMap((customer) =>
          Array.isArray(customer.tags) ? customer.tags : [],
        ),
      ),
    ).sort();
    return [
      { label: tr("All", "সব"), value: "all" },
      ...tags.map((tag) => ({ label: tag, value: tag })),
    ];
  }, [list.items, tr]);

  const handleDelete = useCallback(
    async (customer: CustomerListItem) => {
      const confirmed = await confirm({
        title: tr("Delete customer", "গ্রাহক মুছুন"),
        description: t("admin.customersDataTable.deleteSingleDescription", {
          name:
            customer.user?.name ||
            customer.name ||
            customer.email ||
            t("admin.customersDataTable.thisCustomer"),
        }),
        confirmText: tr("Delete", "মুছুন"),
        cancelText: tr("Cancel", "বাতিল"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await apiClient.delete(`/api/admin/customers/${customer._id}`);
        toast.success(tr("Customer deleted successfully", "গ্রাহক সফলভাবে মুছে ফেলা হয়েছে"));
        list.refetch();
      } catch (error) {
        console.error("Delete customer failed:", error);
        toast.error(tr("Failed to delete customer", "গ্রাহক মুছতে ব্যর্থ"));
      }
    },
    [confirm, list, t, tr],
  );

  const handleBulkDelete = useCallback(
    async (items: CustomerListItem[]) => {
      const confirmed = await confirm({
        title: tr("Delete customers", "গ্রাহকসমূহ মুছুন"),
        description: t("admin.customersDataTable.deleteBulkDescription", {
          count: items.length,
        }),
        confirmText: tr("Delete", "মুছুন"),
        cancelText: tr("Cancel", "বাতিল"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await Promise.all(
          items.map((item) => apiClient.delete(`/api/admin/customers/${item._id}`)),
        );

        setSelectedCustomers([]);
        toast.success(t("admin.customersDataTable.deleteBulkSuccess", { count: items.length }));
        list.refetch();
      } catch (error) {
        console.error("Bulk delete failed:", error);
        toast.error(tr("Failed to delete some customers", "কিছু গ্রাহক মুছতে ব্যর্থ"));
      }
    },
    [confirm, list, t, tr],
  );

  const handleBulkStatusUpdate = useCallback(
    async (
      items: CustomerListItem[],
      status: NonNullable<NonNullable<CustomerListItem["user"]>["status"]>,
    ) => {
      // Guests have no account to activate, deactivate, or ban — a status
      // update can only ever apply to the rows with a user behind them.
      const accountItems = items.filter((item) => !item.isGuest);
      if (accountItems.length === 0) {
        toast.error(
          tr(
            "Guest customers have no account status",
            "অতিথি গ্রাহকদের অ্যাকাউন্ট স্ট্যাটাস নেই",
          ),
        );
        return;
      }
      const confirmed = await confirm({
        title: tr("Update Account Status", "অ্যাকাউন্ট স্ট্যাটাস আপডেট"),
        description: t("admin.customersDataTable.updateStatusDescription", {
          count: accountItems.length,
          status,
        }),
        confirmText: tr("Update", "আপডেট"),
        cancelText: tr("Cancel", "বাতিল"),
        variant: status === "banned" ? "destructive" : "default",
      });

      if (!confirmed) return;

      const results = await Promise.allSettled(
        accountItems.map((item) =>
          apiClient.put(`/api/admin/customers/${item._id}`, { status }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = accountItems.length - successCount;

      setSelectedCustomers([]);
      list.refetch();

      if (successCount > 0) {
        toast.success(t("admin.customersDataTable.updateSuccess", { count: successCount }));
      }
      if (failCount > 0) {
        toast.error(t("admin.customersDataTable.updateError", { count: failCount }));
      }
    },
    [confirm, list, t, tr],
  );

  const columns = useMemo<DataTableColumn<CustomerListItem>[]>(
    () => [
      {
        id: "customer",
        header: tr("Customer", "গ্রাহক"),
        cell: (row) => {
          const identity = (
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarImage src={row.user?.image} alt={row.user?.name || row.name || tr("Customer", "গ্রাহক")} />
                <AvatarFallback>{getInitials(row.user?.name || row.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className={cn("font-medium truncate", !isVendorArea && "hover:underline")}>{row.user?.name || row.name || tr("Unknown", "অজানা")}</p>
                <p className="text-xs text-muted-foreground truncate">{row.user?.email || row.email}</p>
              </div>
            </div>
          );
          // Vendors have no customer detail page to land on.
          if (isVendorArea) return identity;
          return (
            <Link href={`${basePath}/customers/${row._id}`} className="block">
              {identity}
            </Link>
          );
        },
        className: "w-[320px]",
      },
      {
        id: "accountStatus",
        header: tr("Account", "অ্যাকাউন্ট"),
        cell: (row) => (
          <StatusCell
            status={row.isGuest ? "guest" : row.user?.status || "active"}
            statusMap={{
              active: { label: tr("Active", "সক্রিয়"), variant: "default" },
              inactive: { label: tr("Inactive", "নিষ্ক্রিয়"), variant: "outline" },
              banned: { label: tr("Banned", "নিষিদ্ধ"), variant: "destructive" },
              guest: { label: tr("Guest", "অতিথি"), variant: "secondary" },
            }}
          />
        ),
        className: "w-[120px]",
      },
      {
        id: "tier",
        header: tr("Loyalty tier", "লয়্যালটি টিয়ার"),
        cell: (row) => (
          <StatusCell
            status={row.loyaltyTier || "bronze"}
            statusMap={{
              bronze: { label: tr("Bronze", "ব্রোঞ্জ"), variant: "secondary" },
              silver: { label: tr("Silver", "সিলভার"), variant: "outline" },
              gold: { label: tr("Gold", "গোল্ড"), variant: "default" },
              platinum: { label: tr("Platinum", "প্লাটিনাম"), variant: "default" },
            }}
          />
        ),
        className: "w-[140px]",
      },
      {
        id: "orders",
        header: tr("Orders", "অর্ডার"),
        cell: (row) => <NumberCell value={row.stats?.totalOrders ?? 0} />,
        className: "w-[110px]",
      },
      {
        id: "spent",
        header: tr("Spent", "খরচ"),
        cell: (row) => <CurrencyCell value={row.stats?.totalSpent ?? 0} />,
        className: "w-[140px]",
      },
      {
        id: "lastActive",
        // For vendors the honest timestamp is the last order with THEM —
        // platform-wide activity is none of their business.
        header: isVendorArea
          ? tr("Last order", "সর্বশেষ অর্ডার")
          : tr("Last active", "সর্বশেষ সক্রিয়"),
        cell: (row) =>
          isVendorArea ? (
            row.stats?.lastOrderDate ? (
              <DateCell date={row.stats.lastOrderDate} format="relative" />
            ) : (
              <span className="text-muted-foreground">-</span>
            )
          ) : (
            <DateCell date={row.lastActiveAt || row.createdAt} format="relative" />
          ),
        className: "w-[130px]",
      },
      {
        id: "points",
        header: tr("Points", "পয়েন্ট"),
        cell: (row) => <NumberCell value={row.loyaltyPoints ?? 0} />,
        className: "w-[110px]",
      },
      {
        id: "tags",
        header: tr("Tags", "ট্যাগ"),
        cell: (row) => (
          <TextCell
            value={row.tags?.length ? row.tags.slice(0, 2).join(", ") : tr("-", "-")}
            truncate
            maxWidth="200px"
          />
        ),
        className: "w-[220px]",
      },
    ],
    [tr, isVendorArea, basePath],
  );

  // Loyalty tier, points, and tags are platform CRM — the vendor list's API
  // doesn't even return them.
  const visibleColumns = useMemo(
    () =>
      isVendorArea
        ? columns.filter(
            (column) => !["tier", "points", "tags"].includes(column.id),
          )
        : columns,
    [columns, isVendorArea],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: tr("All", "সব") },
      { id: "active", label: tr("Active", "সক্রিয়") },
      { id: "inactive", label: tr("Inactive", "নিষ্ক্রিয়") },
      { id: "banned", label: tr("Banned", "নিষিদ্ধ") },
      { id: "guest", label: tr("Guest", "অতিথি") },
    ],
    [tr],
  );

  const filters = useMemo<DataTableFilter[]>(
    () =>
      isVendorArea
        ? []
        : [
      {
        id: "tier",
        label: tr("Tier", "টিয়ার"),
        type: "select",
        options: [
          { label: tr("All", "সব"), value: "all" },
          { label: tr("Bronze", "ব্রোঞ্জ"), value: "bronze" },
          { label: tr("Silver", "সিলভার"), value: "silver" },
          { label: tr("Gold", "গোল্ড"), value: "gold" },
          { label: tr("Platinum", "প্লাটিনাম"), value: "platinum" },
        ],
      },
      {
        id: "tag",
        label: tr("Tag", "ট্যাগ"),
        type: "select",
        options: tagOptions,
      },
    ],
    [isVendorArea, tr, tagOptions],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: tr("Customers", "গ্রাহক"),
        addAction: readOnly
          ? undefined
          : {
              id: "add",
              label: tr("Add customer", "গ্রাহক যোগ করুন"),
              href: `${basePath}/customers/new`,
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
            },
        importExportAction: isVendorArea
          ? undefined
          : {
              id: "import-export",
              label: t("admin.productsDataTable.actions.importExport"),
              icon: <ChevronsUpDown className="h-4 w-4" />,
              variant: "outline",
              items: [
                {
                  id: "toolbar-export",
                  label: tr("Export", "এক্সপোর্ট"),
                  icon: <Download className="h-4 w-4" />,
                },
                {
                  id: "toolbar-import",
                  label: t("admin.productsDataTable.actions.import"),
                  icon: <Upload className="h-4 w-4" />,
                  disabled: true,
                },
              ],
            },
      }),
    [tr, readOnly, basePath, isVendorArea, t],
  );

  const bulkActions = useMemo<DataTableBulkAction<CustomerListItem>[]>(
    () =>
      readOnly
        ? []
        : [
            {
              id: "set-active",
              label: tr("Set active", "সক্রিয় করুন"),
              icon: <UserCheck className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkStatusUpdate(items, "active"),
            },
            {
              id: "set-inactive",
              label: tr("Set inactive", "নিষ্ক্রিয় করুন"),
              icon: <UserMinus className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkStatusUpdate(items, "inactive"),
            },
            {
              id: "set-banned",
              label: tr("Set banned", "নিষিদ্ধ করুন"),
              icon: <ShieldBan className="h-4 w-4" />,
              variant: "destructive",
              onClick: (items) => handleBulkStatusUpdate(items, "banned"),
            },
            {
              id: "delete",
              label: tr("Delete", "মুছুন"),
              icon: <Trash2 className="h-4 w-4" />,
              variant: "destructive",
              onClick: handleBulkDelete,
            },
          ],
    [handleBulkDelete, handleBulkStatusUpdate, readOnly, tr],
  );

  const rowActions = useCallback(
    (row: CustomerListItem): DataTableAction[] =>
      isVendorArea
        ? []
        : readOnly
        ? [
            {
              id: "view",
              label: tr("View details", "বিস্তারিত দেখুন"),
              icon: <Eye className="h-4 w-4" />,
              href: `${basePath}/customers/${row._id}`,
            },
          ]
        : [
            {
              id: "view",
              label: tr("View details", "বিস্তারিত দেখুন"),
              icon: <Eye className="h-4 w-4" />,
              href: `${basePath}/customers/${row._id}`,
            },
            {
              id: "edit",
              label: tr("Edit", "এডিট"),
              icon: <Pencil className="h-4 w-4" />,
              href: `${basePath}/customers/${row._id}`,
            },
            {
              id: "delete",
              label: tr("Delete", "মুছুন"),
              icon: <Trash2 className="h-4 w-4" />,
              variant: "destructive",
              onClick: () => handleDelete(row),
            },
          ],
    [isVendorArea, readOnly, tr, basePath, handleDelete],
  );

  return (
    <DataTable
      data={list.items}
      columns={visibleColumns}
      keyField="_id"
      isLoading={list.isLoading}
      loadingMode="rows"
      title={tableHeader.title}
      tabs={tabs}
      activeTab={list.activeTab}
      onTabChange={list.handleTabChange}
      actions={tableHeader.actions}
      selectable={!isVendorArea}
      selectedItems={selectedCustomers}
      onSelectionChange={setSelectedCustomers}
      bulkActions={bulkActions}
      searchable
      searchPlaceholder={tr("Search by name or email", "নাম বা ইমেইল দিয়ে খুঁজুন")}
      searchValue={list.search}
      onSearchChange={list.handleSearchChange}
      filters={filters}
      filterValues={list.filters}
      onFilterChange={list.handleFilterChange}
      toolbarActions={tableHeader.toolbarActions}
      toolbarLayout={tableHeader.toolbarLayout}
      tabsVariant={tableHeader.tabsVariant}
      filtersVariant={tableHeader.filtersVariant}
      appearance={tableHeader.appearance}
      stackedTopControls={tableHeader.stackedTopControls}
      showToolbarSortButton={tableHeader.showToolbarSortButton}
      pagination={list.pagination}
      onPageChange={list.handlePageChange}
      onPageSizeChange={list.handlePageSizeChange}
      rowActions={rowActions}
      rowActionsHeader={tr("Actions", "অ্যাকশন")}
      rowActionsVariant="inline"
      onRowClick={(row) => router.push(`${basePath}/customers/${row._id}`)}
      emptyMessage={tr("No customers found", "কোনো গ্রাহক পাওয়া যায়নি")}
    />
  );
}
