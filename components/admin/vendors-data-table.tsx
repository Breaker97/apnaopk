"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BadgeCheck,
  ChevronsUpDown,
  CheckCircle2,
  Download,
  FileText,
  Pencil,
  ExternalLink,
  Plus,
  ShieldBan,
  Store,
  Trash2,
  Upload,
  UserCheck,
} from "lucide-react";
import {
  DataTable,
  DateCell,
  NumberCell,
  StatusCell,
  TextCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableTab,
} from "@/components/ui/data-table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast-notification";
import { USER_ACCOUNT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import { useCurrency } from "@/providers/currency-provider";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import { useAdminPhrase } from "@/hooks/use-admin-phrase";

interface Vendor {
  _id: string;
  storeName: string;
  slug: string;
  logo?: string;
  status: string;
  /** Admin-awarded storefront badge; shown as a tick beside the store name. */
  verified?: boolean;
  commission: number;
  totalSales: number;
  createdAt: string;
  user?: {
    name?: string;
    email?: string;
    image?: string;
    status?: "active" | "inactive" | "banned";
  };
}

interface VendorsDataTableProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: Vendor[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function getInitials(name?: string) {
  if (!name) return "VE";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function VendorsDataTable({
  locale,
  data,
  pagination,
}: VendorsDataTableProps) {
  const t = useTranslations();
  const tr = useAdminPhrase();
  const router = useRouter();
  const { formatPrice } = useCurrency();

  const list = useListNavigation<Vendor>({
    items: data,
    pagination,
  });

  const handleUpdateStatus = useCallback(
    async (vendorId: string, status: string) => {
      try {
        await apiClient.put(`/api/admin/vendors/${vendorId}`, { status });
        toast.success(tr("Vendor status updated", "ভেন্ডরের স্ট্যাটাস আপডেট হয়েছে"));
        list.refetch();
      } catch (error) {
        console.error("Failed to update vendor status:", error);
        toast.error(tr("Failed to update vendor status", "ভেন্ডরের স্ট্যাটাস আপডেট করা যায়নি"));
      }
    },
    [list, tr],
  );

  const handleUpdateUserStatus = useCallback(
    async (vendorId: string, userStatus: string) => {
      try {
        await apiClient.put(`/api/admin/vendors/${vendorId}`, { userStatus });
        toast.success(tr("Vendor account status updated", "ভেন্ডর অ্যাকাউন্ট স্ট্যাটাস আপডেট হয়েছে"));
        list.refetch();
      } catch (error) {
        console.error("Failed to update account status:", error);
        toast.error(tr("Failed to update account status", "অ্যাকাউন্ট স্ট্যাটাস আপডেট করা যায়নি"));
      }
    },
    [list, tr],
  );

  const handleDeleteVendor = useCallback(
    async (vendorId: string) => {
      try {
        await apiClient.delete(`/api/admin/vendors/${vendorId}`);
        toast.success(tr("Vendor deleted", "ভেন্ডর মুছে ফেলা হয়েছে"));
        list.refetch();
      } catch (error) {
        console.error("Failed to delete vendor:", error);
        toast.error(tr("Failed to delete vendor", "ভেন্ডর মুছতে ব্যর্থ"));
      }
    },
    [list, tr],
  );

  const columns = useMemo<DataTableColumn<Vendor>[]>(
    () => [
      {
        id: "vendor",
        header: tr("Store & Owner", "স্টোর ও মালিক"),
        cell: (row) => (
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={row.logo || row.user?.image} alt={row.storeName} />
              <AvatarFallback>{getInitials(row.storeName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate font-medium">
                <span className="truncate">{row.storeName}</span>
                {row.verified && (
                  <BadgeCheck
                    className="h-4 w-4 shrink-0 text-emerald-600"
                    aria-label={tr("Verified vendor", "যাচাইকৃত ভেন্ডর")}
                  />
                )}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {row.user?.name || tr("Unknown owner", "অজানা মালিক")}
                {row.user?.email ? ` • ${row.user.email}` : ""}
              </p>
            </div>
          </div>
        ),
        className: "w-[360px]",
      },
      {
        id: "status",
        header: tr("Vendor Status", "ভেন্ডর স্ট্যাটাস"),
        cell: (row) => (
          <StatusCell
            status={row.status}
            statusMap={{
              approved: { label: tr("Approved", "অনুমোদিত"), variant: "default" },
              pending: { label: tr("Pending", "অপেক্ষমাণ"), variant: "outline" },
              suspended: { label: tr("Suspended", "স্থগিত"), variant: "destructive" },
              rejected: { label: tr("Rejected", "প্রত্যাখ্যাত"), variant: "destructive" },
            }}
          />
        ),
        className: "w-[140px]",
      },
      {
        id: "account",
        header: tr("Account", "অ্যাকাউন্ট"),
        cell: (row) => (
          <StatusCell
            status={row.user?.status || USER_ACCOUNT_STATUS.ACTIVE}
            statusMap={{
              active: { label: tr("Active", "সক্রিয়"), variant: "default" },
              inactive: { label: tr("Inactive", "নিষ্ক্রিয়"), variant: "outline" },
              banned: { label: tr("Banned", "নিষিদ্ধ"), variant: "destructive" },
            }}
          />
        ),
        className: "w-[120px]",
      },
      {
        id: "commission",
        header: tr("Commission", "কমিশন"),
        cell: (row) => <NumberCell value={row.commission} suffix="%" />,
        className: "w-[110px]",
      },
      {
        id: "sales",
        header: tr("Sales", "বিক্রি"),
        cell: (row) => <TextCell value={formatPrice(row.totalSales || 0)} />,
        className: "w-[140px]",
      },
      {
        id: "joined",
        header: tr("Joined", "যোগদানের তারিখ"),
        cell: (row) => <DateCell date={row.createdAt} format="medium" />,
        className: "w-[130px]",
      },
    ],
    [formatPrice, tr],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: tr("All", "সব") },
      { id: VENDOR_STATUS.PENDING, label: tr("Pending", "অপেক্ষমাণ") },
      {
        id: VENDOR_STATUS.PAYMENT_REQUIRED,
        label: tr("Payment Required", "পেমেন্ট প্রয়োজন"),
      },
      { id: VENDOR_STATUS.APPROVED, label: tr("Approved", "অনুমোদিত") },
      { id: VENDOR_STATUS.SUSPENDED, label: tr("Suspended", "স্থগিত") },
      { id: VENDOR_STATUS.REJECTED, label: tr("Rejected", "প্রত্যাখ্যাত") },
    ],
    [tr],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: tr("Vendors", "ভেন্ডর"),
        addAction: {
          id: "add-vendor",
          label: tr("Add Vendor", "ভেন্ডর যোগ করুন"),
          icon: <Plus className="h-4 w-4" />,
          href: `/${locale}/admin/vendors/new`,
          variant: "default",
        },
        importExportAction: {
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
    [locale, t, tr],
  );

  const rowActions = useCallback(
    (row: Vendor): DataTableAction[] => {
      const actionsList: DataTableAction[] = [
        {
          id: "details",
          label: tr("Details", "বিস্তারিত"),
          icon: <FileText className="h-4 w-4" />,
          href: `/${locale}/admin/vendors/${row._id}`,
        },
        {
          id: "edit",
          label: tr("Edit vendor", "ভেন্ডর এডিট"),
          icon: <Pencil className="h-4 w-4" />,
          href: `/${locale}/admin/vendors/${row._id}`,
        },
        {
          id: "visit-store",
          label: tr("Visit store", "স্টোর দেখুন"),
          icon: <ExternalLink className="h-4 w-4" />,
          href: `/${locale}/vendors/${row.slug}`,
        },
      ];

      if (row.status !== VENDOR_STATUS.APPROVED) {
        actionsList.push({
          id: "approve",
          label:
            row.status === VENDOR_STATUS.PAYMENT_REQUIRED
              ? tr("Restart setup access", "সেটআপ সময় পুনরায় চালু")
              : tr("Approve vendor", "ভেন্ডর অনুমোদন"),
          icon: <CheckCircle2 className="h-4 w-4" />,
          onClick: () => handleUpdateStatus(row._id, VENDOR_STATUS.APPROVED),
        });
      }

      if (row.status !== VENDOR_STATUS.SUSPENDED) {
        actionsList.push({
          id: "suspend",
          label: tr("Suspend vendor", "ভেন্ডর স্থগিত"),
          icon: <ShieldBan className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => handleUpdateStatus(row._id, VENDOR_STATUS.SUSPENDED),
        });
      }

      if ((row.user?.status || USER_ACCOUNT_STATUS.ACTIVE) !== USER_ACCOUNT_STATUS.BANNED) {
        actionsList.push({
          id: "ban-account",
          label: tr("Ban account", "অ্যাকাউন্ট নিষিদ্ধ"),
          icon: <Store className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => handleUpdateUserStatus(row._id, USER_ACCOUNT_STATUS.BANNED),
        });
      } else {
        actionsList.push({
          id: "activate-account",
          label: tr("Activate account", "অ্যাকাউন্ট সক্রিয়"),
          icon: <UserCheck className="h-4 w-4" />,
          onClick: () => handleUpdateUserStatus(row._id, USER_ACCOUNT_STATUS.ACTIVE),
        });
      }

      actionsList.push({
        id: "delete",
        label: tr("Delete vendor", "ভেন্ডর মুছুন"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: () => handleDeleteVendor(row._id),
      });

      return actionsList;
    },
    [handleDeleteVendor, handleUpdateStatus, handleUpdateUserStatus, locale, tr],
  );

  return (
    <DataTable
      data={list.items}
      columns={columns}
      keyField="_id"
      isLoading={list.isLoading}
      loadingMode="rows"
      title={tableHeader.title}
      tabs={tabs}
      activeTab={list.activeTab}
      onTabChange={list.handleTabChange}
      actions={tableHeader.actions}
      searchable
      searchPlaceholder={tr("Search vendors...", "ভেন্ডর খুঁজুন...")}
      searchValue={list.search}
      onSearchChange={list.handleSearchChange}
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
      onRowClick={(row) => router.push(`/${locale}/admin/vendors/${row._id}`)}
      emptyMessage={tr("No vendors found", "কোনো ভেন্ডর পাওয়া যায়নি")}
    />
  );
}
