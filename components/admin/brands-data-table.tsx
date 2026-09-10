"use client";

import {
  Plus,
  Pencil,
  Trash2,
  Archive,
  Tag,
  CheckCircle2,
  CircleOff,
  Star,
  Check,
  X,
  RotateCcw,
} from "lucide-react";
import {
  DataTable,
  ProductCell,
  StatusCell,
  NumberCell,
  type DataTableColumn,
  type DataTableTab,
  type DataTableAction,
  type DataTableBulkAction,
} from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { Badge } from "@/components/ui/badge";
import { useRouter } from "next/navigation";
import { useState, useCallback, useMemo } from "react";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";

interface Brand {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  website?: string;
  isActive: boolean;
  featured?: boolean;
  productCount?: number;
  ownerVendorId?: string | null;
  approvalStatus?: "approved" | "pending" | "rejected";
  deletedAt?: string | null;
}

interface BrandsDataTableProps {
  locale: string;
  /** Rows for the current query string, fetched by the page. */
  data: Brand[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function BrandsDataTable({
  locale,
  data,
  pagination,
}: BrandsDataTableProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();

  const [selectedBrands, setSelectedBrands] = useState<Brand[]>([]);

  const list = useListNavigation<Brand>({
    items: data,
    pagination,
    // The "products" column sorts by the productCount field server-side.
    defaultSortBy: "name",
    defaultSortOrder: "asc",
  });

  const handleArchive = useCallback(
    async (brand: Brand) => {
      const confirmed = await confirm({
        title: "Archive brand",
        description: `Archive "${brand.name}"? It will be hidden from the storefront and product filters. Products keep their reference and the brand can be restored later.`,
        confirmText: "Archive",
        cancelText: "Cancel",
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await apiClient.delete(`/api/brands/${brand._id}`);
        toast.success("Brand archived");
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to archive brand",
        );
      }
    },
    [confirm, list],
  );

  const handlePermanentDelete = useCallback(
    async (brand: Brand) => {
      const confirmed = await confirm({
        title: "Permanently delete brand",
        description: `Permanently delete "${brand.name}"? This cannot be undone. Products using this brand will keep the product, but the brand field will be cleared.`,
        confirmText: "Delete permanently",
        cancelText: "Cancel",
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await apiClient.delete(`/api/brands/${brand._id}?permanent=true`);
        toast.success("Brand permanently deleted");
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to delete brand",
        );
      }
    },
    [confirm, list],
  );

  const handleModeration = useCallback(
    async (brand: Brand, approvalStatus: "approved" | "rejected") => {
      if (approvalStatus === "rejected") {
        const confirmed = await confirm({
          title: "Reject brand",
          description: `Reject "${brand.name}"? The vendor will see it was rejected and it stays hidden from the storefront.`,
          confirmText: "Reject",
          cancelText: "Cancel",
          variant: "destructive",
        });
        if (!confirmed) return;
      }

      try {
        await apiClient.put(`/api/brands/${brand._id}`, { approvalStatus });
        toast.success(
          approvalStatus === "approved" ? "Brand approved" : "Brand rejected",
        );
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update brand",
        );
      }
    },
    [confirm, list],
  );

  const handleRestore = useCallback(
    async (brand: Brand) => {
      try {
        await apiClient.put(`/api/brands/${brand._id}`, { restore: true });
        toast.success("Brand restored");
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to restore brand",
        );
      }
    },
    [list],
  );

  const handleBulkArchive = useCallback(
    async (items: Brand[]) => {
      const confirmed = await confirm({
        title: "Archive brands",
        description: `Archive ${items.length} brands? They will be hidden from the storefront but can be restored later.`,
        confirmText: "Archive",
        cancelText: "Cancel",
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await Promise.all(
          items.map((brand) => apiClient.delete(`/api/brands/${brand._id}`)),
        );
        toast.success(`${items.length} brands archived`);
        setSelectedBrands([]);
        list.refetch();
      } catch {
        toast.error("Failed to archive brands");
      }
    },
    [confirm, list],
  );

  const handleBulkPermanentDelete = useCallback(
    async (items: Brand[]) => {
      const confirmed = await confirm({
        title: "Permanently delete brands",
        description: `Permanently delete ${items.length} brands? This cannot be undone. Products using these brands will keep the product, but the brand field will be cleared.`,
        confirmText: "Delete permanently",
        cancelText: "Cancel",
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        const results = await Promise.allSettled(
          items.map((brand) =>
            apiClient.delete(`/api/brands/${brand._id}?permanent=true`),
          ),
        );
        const successCount = results.filter(
          (result) => result.status === "fulfilled",
        ).length;
        const failCount = items.length - successCount;

        setSelectedBrands([]);
        list.refetch();

        if (successCount > 0) {
          toast.success(`${successCount} brands permanently deleted`);
        }
        if (failCount > 0) {
          toast.error(`${failCount} brands could not be deleted`);
        }
      } catch {
        toast.error("Failed to delete brands");
      }
    },
    [confirm, list],
  );

  const handleBulkStatusUpdate = useCallback(
    async (items: Brand[], isActive: boolean) => {
      const results = await Promise.allSettled(
        items.map((brand) =>
          apiClient.put(`/api/brands/${brand._id}`, { isActive }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = items.length - successCount;

      setSelectedBrands([]);
      list.refetch();

      if (successCount > 0) {
        toast.success(`${successCount} brands updated`);
      }
      if (failCount > 0) {
        toast.error(`${failCount} brands could not be updated`);
      }
    },
    [list],
  );

  const handleFeaturedUpdate = useCallback(
    async (brand: Brand, featured: boolean) => {
      try {
        await apiClient.put(`/api/brands/${brand._id}`, { featured });
        toast.success(
          featured ? "Brand marked as featured" : "Brand removed from featured",
        );
        list.refetch();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update brand",
        );
      }
    },
    [list],
  );

  const handleBulkFeaturedUpdate = useCallback(
    async (items: Brand[], featured: boolean) => {
      const results = await Promise.allSettled(
        items.map((brand) =>
          apiClient.put(`/api/brands/${brand._id}`, { featured }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = items.length - successCount;

      setSelectedBrands([]);
      list.refetch();

      if (successCount > 0) {
        toast.success(
          featured
            ? `${successCount} brands marked as featured`
            : `${successCount} brands removed from featured`,
        );
      }
      if (failCount > 0) {
        toast.error(`${failCount} brands could not be updated`);
      }
    },
    [list],
  );

  const columns = useMemo<DataTableColumn<Brand>[]>(
    () => [
      {
        id: "brand",
        header: "Brand",
        cell: (row) => (
          <ProductCell
            image={row.logo}
            title={row.name}
            subtitle={`/${row.slug}`}
            href={`/${locale}/admin/brands/${row._id}/edit`}
          />
        ),
        className: "w-[420px]",
      },
      {
        id: "products",
        header: "Products",
        cell: (row) => <NumberCell value={row.productCount ?? 0} />,
        className: "w-[90px]",
      },
      {
        id: "owner",
        header: "Source",
        cell: (row) =>
          row.ownerVendorId ? (
            <Badge variant="outline">Vendor</Badge>
          ) : (
            <span className="text-sm text-muted-foreground">Official</span>
          ),
        className: "w-[110px]",
      },
      {
        id: "approval",
        header: "Approval",
        cell: (row) => {
          if (row.deletedAt) {
            return <Badge variant="outline">Archived</Badge>;
          }
          if (row.approvalStatus === "pending") {
            return <Badge variant="secondary">Pending</Badge>;
          }
          if (row.approvalStatus === "rejected") {
            return <Badge variant="destructive">Rejected</Badge>;
          }
          return (
            <Badge variant="default" className="gap-1">
              <Check className="h-3 w-3" />
              Approved
            </Badge>
          );
        },
        className: "w-[130px]",
      },
      {
        id: "status",
        header: "Status",
        cell: (row) => (
          <StatusCell status={row.isActive ? "active" : "inactive"} />
        ),
        className: "w-[110px]",
      },
    ],
    [locale],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: "All" },
      { id: "pending", label: "Pending" },
      { id: "active", label: "Active" },
      { id: "featured", label: "Featured" },
      { id: "inactive", label: "Inactive" },
      { id: "rejected", label: "Rejected" },
      { id: "archived", label: "Archived" },
    ],
    [],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: "Brands",
        addAction: {
          id: "add",
          label: "Add brand",
          href: `/${locale}/admin/brands/new`,
          icon: <Plus className="h-4 w-4" />,
          variant: "default",
        },
      }),
    [locale],
  );

  const bulkActions = useMemo<DataTableBulkAction<Brand>[]>(
    () => [
      {
        id: "activate",
        label: "Set active",
        icon: <CheckCircle2 className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatusUpdate(items, true),
      },
      {
        id: "deactivate",
        label: "Set inactive",
        icon: <CircleOff className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatusUpdate(items, false),
      },
      {
        id: "mark-featured",
        label: "Mark featured",
        icon: <Star className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkFeaturedUpdate(items, true),
      },
      {
        id: "remove-featured",
        label: "Remove featured",
        icon: <CircleOff className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkFeaturedUpdate(items, false),
      },
      {
        id: "archive",
        label: "Archive",
        icon: <Archive className="h-4 w-4" />,
        variant: "destructive",
        onClick: handleBulkArchive,
      },
      {
        id: "delete",
        label: "Delete permanently",
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: handleBulkPermanentDelete,
      },
    ],
    [
      handleBulkArchive,
      handleBulkFeaturedUpdate,
      handleBulkPermanentDelete,
      handleBulkStatusUpdate,
    ],
  );

  const rowActions = useCallback(
    (row: Brand): DataTableAction[] => {
      // Archived brands only offer restore.
      if (row.deletedAt) {
        return [
          {
            id: "restore",
            label: "Restore",
            icon: <RotateCcw className="h-4 w-4" />,
            onClick: () => handleRestore(row),
          },
          {
            id: "delete",
            label: "Delete permanently",
            icon: <Trash2 className="h-4 w-4" />,
            variant: "destructive",
            onClick: () => handlePermanentDelete(row),
          },
        ];
      }

      const actions: DataTableAction[] = [];

      // Moderation shortcuts for vendor-submitted brands awaiting review.
      if (row.approvalStatus === "pending" || row.approvalStatus === "rejected") {
        actions.push({
          id: "approve",
          label: "Approve",
          icon: <Check className="h-4 w-4" />,
          onClick: () => handleModeration(row, "approved"),
        });
      }
      if (row.approvalStatus === "pending") {
        actions.push({
          id: "reject",
          label: "Reject",
          icon: <X className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => handleModeration(row, "rejected"),
        });
      }

      actions.push(
        {
          id: "edit",
          label: "Edit",
          icon: <Pencil className="h-4 w-4" />,
          href: `/${locale}/admin/brands/${row._id}/edit`,
        },
        {
          id: row.featured ? "remove-featured" : "mark-featured",
          label: row.featured ? "Remove featured" : "Mark featured",
          icon: (
            <Star
              className={
                row.featured ? "h-4 w-4 fill-current text-amber-500" : "h-4 w-4"
              }
            />
          ),
          onClick: () => handleFeaturedUpdate(row, !row.featured),
        },
        {
          id: "archive",
          label: "Archive",
          icon: <Archive className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => handleArchive(row),
        },
        {
          id: "delete",
          label: "Delete permanently",
          icon: <Trash2 className="h-4 w-4" />,
          variant: "destructive",
          onClick: () => handlePermanentDelete(row),
        },
      );

      return actions;
    },
    [
      locale,
      handleArchive,
      handleFeaturedUpdate,
      handleModeration,
      handlePermanentDelete,
      handleRestore,
    ],
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
      selectable
      selectedItems={selectedBrands}
      onSelectionChange={setSelectedBrands}
      bulkActions={bulkActions}
      searchable
      searchPlaceholder="Search brands..."
      searchValue={list.search}
      onSearchChange={list.handleSearchChange}
      toolbarActions={tableHeader.toolbarActions}
      toolbarLayout={tableHeader.toolbarLayout}
      tabsVariant={tableHeader.tabsVariant}
      filtersVariant={tableHeader.filtersVariant}
      appearance={tableHeader.appearance}
      stackedTopControls={tableHeader.stackedTopControls}
      showToolbarSortButton={tableHeader.showToolbarSortButton}
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
        router.push(`/${locale}/admin/brands/${row._id}/edit`)
      }
      emptyMessage="No brands found. Create your first brand to get started."
      emptyIcon={<Tag className="h-8 w-8" />}
    />
  );
}
