"use client";

import {
  CheckCircle2,
  Trash2,
  MessageCircle,
  XCircle,
  ShieldOff,
  ExternalLink,
} from "lucide-react";
import {
  DataTable,
  type DataTableColumn,
  type DataTableTab,
  type DataTableAction,
  type DataTableBulkAction,
  type DataTablePaginationType,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast-notification";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { apiClient } from "@/lib/api/client";

interface Comment {
  _id: string;
  postId: { _id: string; title?: string; slug?: string } | string;
  authorName: string;
  authorEmail: string;
  content: string;
  status: "pending" | "approved" | "spam" | "trash";
  createdAt: string;
}

export function BlogCommentsDataTable({ locale }: { locale: string }) {
  const { confirm } = useConfirmation();
  const [isLoading, setIsLoading] = useState(true);
  const [items, setItems] = useState<Comment[]>([]);
  const [selected, setSelected] = useState<Comment[]>([]);
  const [activeTab, setActiveTab] = useState("pending");
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
      if (activeTab && activeTab !== "all") params.set("status", activeTab);
      const data = await apiClient.get<{
        data: Comment[];
        pagination: { total: number; totalPages: number };
      }>(`/api/blog-comments?${params.toString()}`);
      setItems(data.data);
      setPagination((p) => ({
        ...p,
        total: data.pagination.total,
        totalPages: data.pagination.totalPages,
      }));
    } catch {
      toast.error("Failed to load comments");
    } finally {
      setIsLoading(false);
    }
  }, [pagination.page, pagination.pageSize, activeTab]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchItems();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchItems]);

  const updateStatus = useCallback(
    async (c: Comment, status: string) => {
      try {
        await apiClient.put(`/api/blog-comments/${c._id}`, { status });
        toast.success("Updated");
        fetchItems();
      } catch {
        toast.error("Failed");
      }
    },
    [fetchItems],
  );

  const handleDelete = useCallback(
    async (c: Comment) => {
      const ok = await confirm({
        title: "Delete comment?",
        description: "This cannot be undone.",
        confirmText: "Delete",
        cancelText: "Cancel",
        variant: "destructive",
      });
      if (!ok) return;
      try {
        await apiClient.delete(`/api/blog-comments/${c._id}`);
        toast.success("Deleted");
        fetchItems();
      } catch {
        toast.error("Failed");
      }
    },
    [confirm, fetchItems],
  );

  const bulkUpdate = useCallback(
    async (comments: Comment[], status: string) => {
      await Promise.all(
        comments.map((c) =>
          apiClient.put(`/api/blog-comments/${c._id}`, { status }),
        ),
      );
      setSelected([]);
      toast.success(`${comments.length} comment(s) updated`);
      fetchItems();
    },
    [fetchItems],
  );

  const bulkDelete = useCallback(
    async (comments: Comment[]) => {
      const ok = await confirm({
        title: "Delete selected?",
        description: `${comments.length} comment(s) will be removed.`,
        confirmText: "Delete",
        cancelText: "Cancel",
        variant: "destructive",
      });
      if (!ok) return;
      await Promise.all(
        comments.map((c) => apiClient.delete(`/api/blog-comments/${c._id}`)),
      );
      setSelected([]);
      toast.success("Deleted");
      fetchItems();
    },
    [confirm, fetchItems],
  );

  const columns = useMemo<DataTableColumn<Comment>[]>(
    () => [
      {
        id: "author",
        header: "Author",
        cell: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.authorName}</p>
            <p className="truncate text-xs text-muted-foreground">{row.authorEmail}</p>
          </div>
        ),
        className: "w-[200px]",
      },
      {
        id: "content",
        header: "Comment",
        cell: (row) => (
          <p className="line-clamp-2 text-sm text-foreground/90">{row.content}</p>
        ),
        className: "min-w-[280px]",
      },
      {
        id: "post",
        header: "On post",
        cell: (row) => {
          const p = row.postId;
          if (typeof p === "string") return <span>—</span>;
          return (
            <a
              href={`/${locale}/blog/${p.slug || ""}`}
              className="inline-flex items-center gap-1 text-sm text-primary"
              target="_blank"
              rel="noreferrer"
            >
              {p.title || "View"}
              <ExternalLink className="h-3 w-3" />
            </a>
          );
        },
        className: "w-[200px]",
      },
      {
        id: "status",
        header: "Status",
        cell: (row) => (
          <Badge
            variant={
              row.status === "approved"
                ? "default"
                : row.status === "pending"
                  ? "secondary"
                  : "outline"
            }
            className="capitalize"
          >
            {row.status}
          </Badge>
        ),
        className: "w-[120px]",
      },
      {
        id: "date",
        header: "Date",
        cell: (row) => (
          <span className="text-xs text-muted-foreground">
            {new Date(row.createdAt).toLocaleDateString()}
          </span>
        ),
        className: "w-[120px]",
      },
    ],
    [locale],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: "All" },
      { id: "pending", label: "Pending" },
      { id: "approved", label: "Approved" },
      { id: "spam", label: "Spam" },
      { id: "trash", label: "Trash" },
    ],
    [],
  );

  const tableHeader = useMemo(
    () => buildAdminCommerceTableHeader({ title: "Comments" }),
    [],
  );

  const bulkActions = useMemo<DataTableBulkAction<Comment>[]>(
    () => [
      {
        id: "approve",
        label: "Approve",
        icon: <CheckCircle2 className="h-4 w-4" />,
        variant: "outline",
        onClick: (c) => bulkUpdate(c, "approved"),
      },
      {
        id: "spam",
        label: "Mark as spam",
        icon: <ShieldOff className="h-4 w-4" />,
        variant: "outline",
        onClick: (c) => bulkUpdate(c, "spam"),
      },
      {
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: bulkDelete,
      },
    ],
    [bulkUpdate, bulkDelete],
  );

  const rowActions = useCallback(
    (row: Comment): DataTableAction[] => {
      const actions: DataTableAction[] = [];
      if (row.status !== "approved") {
        actions.push({
          id: "approve",
          label: "Approve",
          icon: <CheckCircle2 className="h-4 w-4" />,
          onClick: () => updateStatus(row, "approved"),
        });
      }
      if (row.status !== "pending") {
        actions.push({
          id: "pending",
          label: "Mark pending",
          icon: <XCircle className="h-4 w-4" />,
          onClick: () => updateStatus(row, "pending"),
        });
      }
      if (row.status !== "spam") {
        actions.push({
          id: "spam",
          label: "Mark as spam",
          icon: <ShieldOff className="h-4 w-4" />,
          onClick: () => updateStatus(row, "spam"),
        });
      }
      actions.push({
        id: "delete",
        label: "Delete",
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: () => handleDelete(row),
      });
      return actions;
    },
    [updateStatus, handleDelete],
  );

  return (
    <DataTable
      data={items}
      columns={columns}
      keyField="_id"
      isLoading={isLoading}
      loadingMode="rows"
      title={tableHeader.title}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(t) => {
        setActiveTab(t);
        setPagination((p) => ({ ...p, page: 1 }));
      }}
      actions={tableHeader.actions}
      selectable
      selectedItems={selected}
      onSelectionChange={setSelected}
      bulkActions={bulkActions}
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
      emptyMessage="No comments to review."
      emptyIcon={<MessageCircle className="h-8 w-8" />}
    />
  );
}
