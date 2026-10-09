"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "@/hooks/use-locale-navigation";
import {
  ChevronsUpDown,
  Download,
  Eye,
  Pencil,
  Plus,
  Tag,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DataTable,
  ProductCell,
  StatusCell,
  NumberCell,
  type DataTableAction,
  type DataTableColumn,
  type DataTableTab,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { useCsvImportExport } from "@/hooks/use-csv-import-export";

type BrandApprovalStatus = "approved" | "pending" | "rejected";

interface VendorBrand {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  website?: string;
  isActive: boolean;
  featured: boolean;
  productCount: number;
  approvalStatus: BrandApprovalStatus;
  rejectionReason?: string;
  // True when the brand was created by this vendor (editable by them).
  isOwn: boolean;
}

interface VendorBrandsDataTableProps {
  locale: string;
  canCreate?: boolean;
  canEdit?: boolean;
  /** Rows for the current query string, fetched by the page. */
  data: VendorBrand[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function VendorBrandsDataTable({
  locale,
  canCreate = false,
  canEdit = false,
  data,
  pagination,
}: VendorBrandsDataTableProps) {
  const t = useTranslations();
  const router = useRouter();

  const list = useListNavigation<VendorBrand>({
    items: data,
    pagination,
  });

  const csv = useCsvImportExport({
    endpoint: "/api/vendor/brands/import-export",
    noun: "brands",
    onImported: list.refetch,
  });
  // Export needs only the view permission the page already requires. An import
  // creates brands (CREATE_BRANDS) and updates the vendor's own (EDIT_BRANDS).
  const canImport = canCreate || canEdit;

  const columns = useMemo<DataTableColumn<VendorBrand>[]>(
    () => [
      {
        id: "brand",
        header: "Brand",
        cell: (row) => (
          <ProductCell
            image={row.logo}
            title={row.name}
            subtitle={`/${row.slug}`}
            href={
              canEdit && row.isOwn
                ? `/${locale}/vendor/brands/${row._id}/edit`
                : undefined
            }
          />
        ),
        className: "w-[380px]",
      },
      {
        id: "products",
        header: "Your products",
        cell: (row) => <NumberCell value={row.productCount} />,
        className: "w-[130px]",
      },
      {
        id: "approval",
        header: "Approval",
        cell: (row) => {
          if (!row.isOwn) {
            return (
              <span className="text-sm text-muted-foreground">Catalog</span>
            );
          }
          if (row.approvalStatus === "pending") {
            return (
              <Badge variant="secondary" title="Awaiting admin review">
                Pending review
              </Badge>
            );
          }
          if (row.approvalStatus === "rejected") {
            return (
              <Badge
                variant="destructive"
                title={row.rejectionReason || "Rejected by admin"}
              >
                Rejected
              </Badge>
            );
          }
          return <Badge variant="default">Approved</Badge>;
        },
        className: "w-[150px]",
      },
      {
        id: "status",
        header: "Status",
        cell: (row) => (
          <StatusCell
            status={row.isActive ? "active" : "inactive"}
            statusMap={{
              active: { label: "Active", variant: "default" },
              inactive: { label: "Inactive", variant: "outline" },
            }}
          />
        ),
        className: "w-[120px]",
      },
    ],
    [canEdit, locale],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: "All" },
      { id: "active", label: "Active" },
      { id: "featured", label: "Featured" },
      { id: "inactive", label: "Inactive" },
    ],
    [],
  );

  const rowActions = useCallback(
    (row: VendorBrand): DataTableAction[] => {
      const actions: DataTableAction[] = [
        {
          id: "view-products",
          label: "View products",
          icon: <Eye className="h-4 w-4" />,
          href: `/vendor/products?search=${encodeURIComponent(row.name)}`,
        },
      ];

      // Vendors can only edit brands they created.
      if (canEdit && row.isOwn) {
        actions.push({
          id: "edit",
          label: "Edit",
          icon: <Pencil className="h-4 w-4" />,
          href: `/vendor/brands/${row._id}/edit`,
        });
      }

      return actions;
    },
    [locale, canEdit],
  );

  // The same commerce header the vendor Categories and Products tables use. It
  // is also what gives the table a toolbar that can hold the Import / Export
  // menu: the plain layout has nowhere to render toolbar actions.
  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: "Brands",
        ...(canCreate
          ? {
              addAction: {
                id: "add",
                label: "Add brand",
                icon: <Plus className="h-4 w-4" />,
                href: "/vendor/brands/new",
                variant: "default" as const,
              },
            }
          : {}),
        importExportAction: {
          id: "import-export",
          label: t("admin.productsDataTable.actions.importExport"),
          icon: <ChevronsUpDown className="h-4 w-4" />,
          variant: "outline",
          items: [
            {
              id: "toolbar-import",
              label: "Import CSV",
              icon: <Upload className="h-4 w-4" />,
              onClick: csv.openFilePicker,
              disabled: !canImport || csv.isImporting,
              hint: canImport
                ? undefined
                : "You do not have permission to import brands",
            },
            {
              id: "toolbar-export",
              label: "Export",
              icon: <Download className="h-4 w-4" />,
              onClick: csv.exportCsv,
              disabled: csv.isExporting,
            },
          ],
        },
      }),
    [
      canCreate,
      canImport,
      csv.exportCsv,
      csv.isExporting,
      csv.isImporting,
      csv.openFilePicker,
      t,
    ],
  );

  return (
    <>
      <input
        id={csv.fileInputId}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        aria-label="Import brands from a CSV file"
        onChange={csv.handleFileChange}
      />
      <DataTable
        data={list.items}
        columns={columns}
        keyField="_id"
        isLoading={list.isLoading}
        loadingMode="rows"
        title={tableHeader.title}
        actions={tableHeader.actions}
        toolbarActions={tableHeader.toolbarActions}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        tabs={tabs}
        activeTab={list.activeTab}
        onTabChange={list.handleTabChange}
        searchable
        searchPlaceholder="Search brands..."
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        sortColumn={list.sortBy}
        sortDirection={list.sortOrder}
        onSortChange={list.handleSortChange}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        rowActions={rowActions}
        rowActionsHeader="Actions"
        rowActionsVariant="inline"
        onRowClick={(row) =>
          router.push(
            canEdit && row.isOwn
              ? `/${locale}/vendor/brands/${row._id}/edit`
              : `/${locale}/vendor/products?search=${encodeURIComponent(row.name)}`,
          )
        }
        emptyMessage="No brands are available yet."
        emptyIcon={<Tag className="h-8 w-8" />}
      />
    </>
  );
}
