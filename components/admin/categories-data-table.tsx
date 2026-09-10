"use client";

import {
  Plus,
  ChevronsUpDown,
  Download,
  Upload,
  Pencil,
  Trash2,
  FolderTree,
  CheckCircle2,
  CircleOff,
  Star,
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
  type DataTablePaginationType,
} from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { Badge } from "@/components/ui/badge";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useTranslations } from "next-intl";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { apiClient } from "@/lib/api/client";

interface Category {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parentId?: string;
  isActive: boolean;
  featured?: boolean;
  productCount?: number;
}

interface TreeCategory extends Category {
  depth: number;
  hasChildren: boolean;
  isLastChild: boolean;
  ancestorNames: string[];
}

interface CategoriesDataTableProps {
  locale: string;
  initialPage?: number;
  initialSearch?: string;
  initialStatus?: string;
}

export function CategoriesDataTable({
  locale,
  initialPage = 1,
  initialSearch = "",
  initialStatus = "all",
}: CategoriesDataTableProps) {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm } = useConfirmation();

  const [isLoading, setIsLoading] = useState(true);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<TreeCategory[]>([]);
  const [pagination, setPagination] = useState<DataTablePaginationType>({
    page: initialPage,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  });
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [activeTab, setActiveTab] = useState(initialStatus);
  const [sortColumn, setSortColumn] = useState("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const importInputId = "admin-categories-import-csv";

  const fetchCategories = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.get<Category[] | { data?: Category[] }>(
        "/api/categories?flat=true",
      );
      const cats = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data
          : [];
      setAllCategories(cats);
    } catch (error) {
      console.error("Failed to fetch categories:", error);
      toast.error(t("admin.categoriesDataTable.toasts.fetchError"));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCategories();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [fetchCategories]);

  // Build tree-ordered list (DFS): parents come first, then their children,
  // recursively. Each node carries its depth so the row can render with
  // Shopify-style indentation. Also tracks `isLastChild` per sibling group
  // so we can draw subtle tree connectors when desired.
  const treeOrderedCategories = useMemo<TreeCategory[]>(() => {
    if (allCategories.length === 0) return [];

    const childrenByParent = new Map<string, Category[]>();
    const ROOT_KEY = "__root__";
    for (const cat of allCategories) {
      const key = cat.parentId ? String(cat.parentId) : ROOT_KEY;
      const arr = childrenByParent.get(key);
      if (arr) arr.push(cat);
      else childrenByParent.set(key, [cat]);
    }

    const sortDir = sortDirection === "asc" ? 1 : -1;
    const compare = (a: Category, b: Category) => {
      if (sortColumn === "products") {
        return ((a.productCount ?? 0) - (b.productCount ?? 0)) * sortDir;
      }
      return a.name.localeCompare(b.name) * sortDir;
    };
    childrenByParent.forEach((arr) => arr.sort(compare));

    const result: TreeCategory[] = [];
    const visit = (parentKey: string, depth: number, ancestors: string[]) => {
      const children = childrenByParent.get(parentKey);
      if (!children) return;
      children.forEach((child, idx) => {
        const id = String(child._id);
        result.push({
          ...child,
          depth,
          hasChildren: childrenByParent.has(id),
          isLastChild: idx === children.length - 1,
          ancestorNames: ancestors,
        });
        visit(id, depth + 1, [...ancestors, child.name]);
      });
    };
    visit(ROOT_KEY, 0, []);
    return result;
  }, [allCategories, sortColumn, sortDirection]);

  // Apply search + status filter while preserving hierarchy: when a category
  // matches, all of its ancestors are kept too so the chain is visible.
  const filteredCategories = useMemo<TreeCategory[]>(() => {
    if (treeOrderedCategories.length === 0) return [];

    const searchLower = searchValue.trim().toLowerCase();
    const hasSearch = searchLower.length > 0;
    const hasStatus =
      activeTab === "active" ||
      activeTab === "inactive" ||
      activeTab === "featured";
    if (!hasSearch && !hasStatus) return treeOrderedCategories;

    const matches = (c: TreeCategory) => {
      if (
        hasStatus &&
        ((activeTab === "active" && !c.isActive) ||
          (activeTab === "inactive" && c.isActive) ||
          (activeTab === "featured" && !c.featured))
      ) {
        return false;
      }
      if (
        hasSearch &&
        !c.name.toLowerCase().includes(searchLower) &&
        !c.slug.toLowerCase().includes(searchLower)
      ) {
        return false;
      }
      return true;
    };

    const byId = new Map(allCategories.map((c) => [String(c._id), c]));
    const keep = new Set<string>();
    for (const cat of treeOrderedCategories) {
      if (matches(cat)) {
        let cursor: Category | undefined = cat;
        while (cursor) {
          const id = String(cursor._id);
          if (keep.has(id)) break;
          keep.add(id);
          cursor = cursor.parentId ? byId.get(String(cursor.parentId)) : undefined;
        }
      }
    }
    return treeOrderedCategories.filter((c) => keep.has(String(c._id)));
  }, [treeOrderedCategories, allCategories, searchValue, activeTab]);

  const tablePagination = useMemo<DataTablePaginationType>(() => {
    const total = filteredCategories.length;
    const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
    return {
      ...pagination,
      page: Math.min(pagination.page, totalPages),
      total,
      totalPages,
    };
  }, [filteredCategories.length, pagination]);

  const paginatedCategories = useMemo<TreeCategory[]>(() => {
    const start = (tablePagination.page - 1) * tablePagination.pageSize;
    return filteredCategories.slice(start, start + tablePagination.pageSize);
  }, [filteredCategories, tablePagination.page, tablePagination.pageSize]);

  // Update URL params without triggering Next.js navigation
  const updateUrlParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value && value !== "all" && value !== "") {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      });
      const search = params.toString();
      window.history.replaceState(
        null,
        "",
        search ? `?${search}` : window.location.pathname,
      );
    },
    [searchParams],
  );

  const handleSearch = useCallback(
    (value: string) => {
      setSearchValue(value);
      setPagination((prev) => ({ ...prev, page: 1 }));
      updateUrlParams({ search: value, page: undefined });
    },
    [updateUrlParams],
  );

  const handleTabChange = useCallback(
    (tabId: string) => {
      setActiveTab(tabId);
      updateUrlParams({ status: tabId, page: undefined });
    },
    [updateUrlParams],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      setPagination((prev) => ({ ...prev, page }));
      updateUrlParams({ page: page.toString() });
    },
    [updateUrlParams],
  );

  const handlePageSizeChange = useCallback(
    (pageSize: number) => {
      setPagination((prev) => ({ ...prev, page: 1, pageSize }));
      updateUrlParams({ page: undefined });
    },
    [updateUrlParams],
  );

  const handleSortChange = useCallback(
    (column: string, direction: "asc" | "desc") => {
      setSortColumn(column);
      setSortDirection(direction);
      updateUrlParams({
        sortBy: column,
        sortOrder: direction,
        page: undefined,
      });
    },
    [updateUrlParams],
  );

  const buildImportExportParams = useCallback(() => {
    const params = new URLSearchParams();
    if (searchValue) params.set("search", searchValue);
    if (activeTab && activeTab !== "all") params.set("status", activeTab);
    if (sortColumn) params.set("sortBy", sortColumn);
    if (sortDirection) params.set("sortOrder", sortDirection);
    return params;
  }, [activeTab, searchValue, sortColumn, sortDirection]);

  const handleExportCategories = useCallback(async () => {
    try {
      const params = buildImportExportParams();
      const res = await fetch(
        `/api/admin/categories/import-export?${params.toString()}`,
      );
      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `categories-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("Categories exported successfully");
    } catch {
      toast.error("Categories could not be exported");
    }
  }, [buildImportExportParams]);

  const handleImportCategories = useCallback(() => {
    document.getElementById(importInputId)?.click();
  }, []);

  const handleImportFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/admin/categories/import-export", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Import failed");
        }

        const result = data.data as {
          created: number;
          updated: number;
          failed: number;
          errors?: { row: number; message: string }[];
        };
        const summary = `Imported ${result.created} created, ${result.updated} updated`;
        if (result.failed > 0) {
          toast.error(
            `${summary}. ${result.failed} failed${
              result.errors?.[0]
                ? `: row ${result.errors[0].row} ${result.errors[0].message}`
                : "."
            }`,
          );
        } else {
          toast.success(summary);
        }
        setPagination((prev) => ({ ...prev, page: 1 }));
        void fetchCategories();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Categories could not be imported",
        );
      }
    },
    [fetchCategories],
  );

  const handleDelete = useCallback(
    async (category: Category) => {
      const confirmed = await confirm({
        title: t("admin.categoriesDataTable.dialogs.deleteSingle.title"),
        description: t("admin.categoriesDataTable.dialogs.deleteSingle.description", {
          name: category.name,
        }),
        confirmText: t("admin.categoriesDataTable.dialogs.deleteSingle.confirm"),
        cancelText: t("admin.categoriesDataTable.dialogs.deleteSingle.cancel"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await apiClient.delete(`/api/categories/${category._id}`);
        toast.success(t("admin.categoriesDataTable.toasts.deleteSingleSuccess"));
        fetchCategories();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("admin.categoriesDataTable.toasts.deleteSingleError"),
        );
      }
    },
    [confirm, fetchCategories, t],
  );

  const handleBulkDelete = useCallback(
    async (items: Category[]) => {
      const confirmed = await confirm({
        title: t("admin.categoriesDataTable.dialogs.deleteBulk.title"),
        description: t("admin.categoriesDataTable.dialogs.deleteBulk.description", {
          count: items.length,
        }),
        confirmText: t("admin.categoriesDataTable.dialogs.deleteBulk.confirm"),
        cancelText: t("admin.categoriesDataTable.dialogs.deleteBulk.cancel"),
        variant: "destructive",
      });

      if (!confirmed) return;

      try {
        await Promise.all(
          items.map((category) =>
            apiClient.delete(`/api/categories/${category._id}`),
          ),
        );
        toast.success(
          t("admin.categoriesDataTable.toasts.deleteBulkSuccess", {
            count: items.length,
          }),
        );
        setSelectedCategories([]);
        fetchCategories();
      } catch {
        toast.error(t("admin.categoriesDataTable.toasts.deleteBulkError"));
      }
    },
    [confirm, fetchCategories, t],
  );

  const handleBulkStatusUpdate = useCallback(
    async (items: Category[], isActive: boolean) => {
      const statusLabel = isActive
        ? t("admin.categoriesDataTable.status.active")
        : t("admin.categoriesDataTable.status.inactive");
      const confirmed = await confirm({
        title: isActive
          ? t("admin.categoriesDataTable.dialogs.activate.title")
          : t("admin.categoriesDataTable.dialogs.deactivate.title"),
        description: t("admin.categoriesDataTable.dialogs.updateStatus.description", {
          count: items.length,
          status: statusLabel,
        }),
        confirmText: isActive
          ? t("admin.categoriesDataTable.dialogs.activate.confirm")
          : t("admin.categoriesDataTable.dialogs.deactivate.confirm"),
        cancelText: t("admin.categoriesDataTable.dialogs.updateStatus.cancel"),
      });

      if (!confirmed) return;

      const results = await Promise.allSettled(
        items.map((category) =>
          apiClient.put(`/api/categories/${category._id}`, { isActive }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = items.length - successCount;

      setSelectedCategories([]);
      fetchCategories();

      if (successCount > 0) {
        toast.success(
          t("admin.categoriesDataTable.toasts.updateSuccess", {
            count: successCount,
          }),
        );
      }
      if (failCount > 0) {
        toast.error(
          t("admin.categoriesDataTable.toasts.updateError", {
            count: failCount,
          }),
        );
      }
    },
    [confirm, fetchCategories, t],
  );

  const handleFeaturedUpdate = useCallback(
    async (category: Category, featured: boolean) => {
      try {
        await apiClient.put(`/api/categories/${category._id}`, { featured });
        toast.success(
          featured
            ? "Category marked as featured"
            : "Category removed from featured",
        );
        void fetchCategories();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to update category",
        );
      }
    },
    [fetchCategories],
  );

  const handleBulkFeaturedUpdate = useCallback(
    async (items: Category[], featured: boolean) => {
      const results = await Promise.allSettled(
        items.map((category) =>
          apiClient.put(`/api/categories/${category._id}`, { featured }),
        ),
      );

      const successCount = results.filter(
        (result) => result.status === "fulfilled",
      ).length;
      const failCount = items.length - successCount;

      setSelectedCategories([]);
      void fetchCategories();

      if (successCount > 0) {
        toast.success(
          featured
            ? `${successCount} categories marked as featured`
            : `${successCount} categories removed from featured`,
        );
      }
      if (failCount > 0) {
        toast.error(`${failCount} categories could not be updated`);
      }
    },
    [fetchCategories],
  );

  const columns = useMemo<DataTableColumn<TreeCategory>[]>(
    () => [
      {
        id: "category",
        header: t("admin.categoriesDataTable.columns.category"),
        cell: (row) => {
          const subtitle =
            row.ancestorNames.length > 0
              ? row.ancestorNames.join(" > ")
              : `/${row.slug}`;
          return (
            <ProductCell
              image={row.image}
              title={row.name}
              subtitle={subtitle}
              href={`/${locale}/admin/categories/${row._id}/edit`}
            />
          );
        },
        className: "w-[420px]",
      },
      {
        id: "products",
        header: t("admin.categoriesDataTable.columns.products"),
        cell: (row) => <NumberCell value={row.productCount ?? 0} />,
        className: "w-[100px]",
      },
      {
        id: "featured",
        header: "Featured",
        cell: (row) =>
          row.featured ? (
            <Badge variant="secondary" className="gap-1">
              <Star className="h-3 w-3 fill-current" />
              Featured
            </Badge>
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          ),
        className: "w-[130px]",
      },
      {
        id: "status",
        header: t("admin.categoriesDataTable.columns.status"),
        cell: (row) => (
          <StatusCell status={row.isActive ? "active" : "inactive"} />
        ),
        className: "w-[120px]",
      },
    ],
    [locale, t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: t("admin.categoriesDataTable.tabs.all") },
      { id: "active", label: t("admin.categoriesDataTable.tabs.active") },
      { id: "featured", label: "Featured" },
      { id: "inactive", label: t("admin.categoriesDataTable.tabs.inactive") },
    ],
    [t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("admin.categoriesDataTable.title"),
        addAction: {
          id: "add",
          label: t("admin.categoriesDataTable.actions.addCategory"),
          href: `/${locale}/admin/categories/new`,
          icon: <Plus className="h-4 w-4" />,
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
              label: t("admin.categoriesDataTable.actions.export"),
              icon: <Download className="h-4 w-4" />,
              onClick: handleExportCategories,
            },
            {
              id: "toolbar-import",
              label: t("admin.categoriesDataTable.actions.import"),
              icon: <Upload className="h-4 w-4" />,
              onClick: handleImportCategories,
            },
          ],
        },
      }),
    [handleExportCategories, handleImportCategories, locale, t],
  );

  const bulkActions = useMemo<DataTableBulkAction<TreeCategory>[]>(
    () => [
      {
        id: "activate",
        label: t("admin.categoriesDataTable.bulkActions.setActive"),
        icon: <CheckCircle2 className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatusUpdate(items, true),
      },
      {
        id: "deactivate",
        label: t("admin.categoriesDataTable.bulkActions.setInactive"),
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
        id: "delete",
        label: t("admin.categoriesDataTable.bulkActions.delete"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: handleBulkDelete,
      },
    ],
    [handleBulkDelete, handleBulkFeaturedUpdate, handleBulkStatusUpdate, t],
  );

  const rowActions = useCallback(
    (row: TreeCategory): DataTableAction[] => [
      {
        id: "edit",
        label: t("admin.categoriesDataTable.rowActions.edit"),
        icon: <Pencil className="h-4 w-4" />,
        href: `/${locale}/admin/categories/${row._id}/edit`,
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
        id: "delete",
        label: t("admin.categoriesDataTable.rowActions.delete"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: () => handleDelete(row),
      },
    ],
    [locale, handleDelete, handleFeaturedUpdate, t],
  );

  return (
    <>
      <input
        id={importInputId}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleImportFileChange}
      />
      <DataTable
        data={paginatedCategories}
        columns={columns}
        keyField="_id"
        isLoading={isLoading}
        loadingMode="rows"
        title={tableHeader.title}
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        actions={tableHeader.actions}
        selectable
        selectedItems={selectedCategories}
        onSelectionChange={setSelectedCategories}
        bulkActions={bulkActions}
        searchable
        searchPlaceholder={t("admin.categoriesDataTable.searchPlaceholder")}
        searchValue={searchValue}
        onSearchChange={handleSearch}
        toolbarActions={tableHeader.toolbarActions}
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        pagination={tablePagination}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        rowActions={rowActions}
        rowActionsHeader={t("admin.categoriesDataTable.rowActionsHeader")}
        rowActionsVariant="inline"
        onRowClick={(row) =>
          router.push(`/${locale}/admin/categories/${row._id}/edit`)
        }
        emptyMessage={t("admin.categoriesDataTable.empty")}
        emptyIcon={<FolderTree className="h-8 w-8" />}
      />
    </>
  );
}
