"use client";

import { Plus, Pencil, Trash2, Tags } from "lucide-react";
import {
  DataTable,
  StatusCell,
  type DataTableColumn,
  type DataTableAction,
  type DataTablePaginationType,
} from "@/components/ui/data-table";
import { toast } from "@/components/ui/toast-notification";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";

interface BlogCategory {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  postCount?: number;
}

export function BlogCategoriesDataTable({ locale }: { locale: string }) {
  const router = useRouter();
  const { confirm } = useConfirmation();

  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<BlogCategory[]>([]);
  const [pagination, setPagination] = useState<DataTablePaginationType>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.pageSize),
      });
      const res = await fetch(`/api/blog-categories?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.data.data);
        setPagination((p) => ({
          ...p,
          total: data.data.pagination.total,
          totalPages: data.data.pagination.totalPages,
        }));
      }
    } catch {
      toast.error("Failed to load categories");
    } finally {
      setIsLoading(false);
    }
  }, [pagination.page, pagination.pageSize]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchItems();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchItems]);

  const handleDelete = useCallback(
    async (cat: BlogCategory) => {
      const ok = await confirm({
        title: "Delete category?",
        description: `"${cat.name}" will be removed.`,
        confirmText: "Delete",
        cancelText: "Cancel",
        variant: "destructive",
      });
      if (!ok) return;
      const res = await fetch(`/api/blog-categories/${cat._id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Category deleted");
        fetchItems();
      } else {
        // Prefer the server's reason — a refusal can be "in use by 3 posts" or
        // the demo-mode notice, and "Failed to delete" explains neither.
        const json = await res.json().catch(() => null);
        toast.error(json?.message || "Failed to delete");
      }
    },
    [confirm, fetchItems],
  );

  const columns = useMemo<DataTableColumn<BlogCategory>[]>(
    () => [
      {
        id: "name",
        header: "Name",
        cell: (row) => (
          <div>
            <p className="font-medium">{row.name}</p>
            <p className="text-xs text-muted-foreground">/{row.slug}</p>
          </div>
        ),
        className: "w-[280px]",
      },
      {
        id: "posts",
        header: "Posts",
        cell: (row) => <span className="text-sm">{row.postCount ?? 0}</span>,
        className: "w-[80px]",
      },
      {
        id: "status",
        header: "Status",
        cell: (row) => <StatusCell status={row.isActive ? "active" : "inactive"} />,
        className: "w-[120px]",
      },
    ],
    [],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: "Blog categories",
        addAction: {
          id: "add",
          label: "Add category",
          href: `/${locale}/admin/content/blog-categories/new`,
          icon: <Plus className="h-4 w-4" />,
          variant: "default",
        },
      }),
    [locale],
  );

  const rowActions = useCallback(
    (row: BlogCategory): DataTableAction[] => [
      {
        id: "edit",
        label: "Edit",
        icon: <Pencil className="h-4 w-4" />,
        href: `/${locale}/admin/content/blog-categories/${row._id}/edit`,
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: () => handleDelete(row),
      },
    ],
    [locale, handleDelete],
  );

  return (
    <DataTable
      data={items}
      columns={columns}
      keyField="_id"
      isLoading={isLoading}
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
      pagination={pagination}
      onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      onPageSizeChange={(pageSize) =>
        setPagination((p) => ({ ...p, page: 1, pageSize }))
      }
      rowActions={rowActions}
      rowActionsHeader="Actions"
      rowActionsVariant="inline"
      onRowClick={(row) =>
        router.push(`/${locale}/admin/content/blog-categories/${row._id}/edit`)
      }
      emptyMessage="No categories yet."
      emptyIcon={<Tags className="h-8 w-8" />}
    />
  );
}
