"use client";

import {
  Plus,
  Pencil,
  Trash2,
  Newspaper,
  Eye,
  Star,
  CheckCircle2,
  CircleOff,
  ExternalLink,
  Tags,
  MessageCircle,
} from "lucide-react";
import {
  DataTable,
  ProductCell,
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
import { useTranslations } from "next-intl";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { apiClient } from "@/lib/api/client";

interface BlogPost {
  _id: string;
  title: string;
  slug: string;
  status: "draft" | "scheduled" | "published" | "archived";
  visibility: "public" | "private" | "password";
  isFeatured: boolean;
  featuredImage?: { url?: string };
  authorName?: string;
  publishedAt?: string;
  scheduledFor?: string;
  viewCount: number;
  commentCount: number;
}

interface Props {
  locale: string;
  initialPage?: number;
  initialSearch?: string;
  initialStatus?: string;
}

export function BlogPostsDataTable({
  locale,
  initialPage = 1,
  initialSearch = "",
  initialStatus = "all",
}: Props) {
  const t = useTranslations("admin.blogPostsPage");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { confirm } = useConfirmation();

  const [isLoading, setIsLoading] = useState(true);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [selected, setSelected] = useState<BlogPost[]>([]);
  const [pagination, setPagination] = useState<DataTablePaginationType>({
    page: initialPage,
    pageSize: 10,
    total: 0,
    totalPages: 1,
  });
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [activeTab, setActiveTab] = useState(initialStatus);
  const [sortColumn, setSortColumn] = useState("publishedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const fetchPosts = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        limit: String(pagination.pageSize),
        sortBy: sortColumn,
        sortOrder: sortDirection,
      });
      if (searchValue) params.set("search", searchValue);
      if (activeTab && activeTab !== "all") params.set("status", activeTab);

      const data = await apiClient.get<{
        data: BlogPost[];
        pagination: { total: number; totalPages: number };
      }>(`/api/blog-posts?${params.toString()}`);
      setPosts(data.data);
      setPagination((prev) => ({
        ...prev,
        total: data.pagination.total,
        totalPages: data.pagination.totalPages,
      }));
    } catch {
      toast.error(t("toast.loadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [pagination.page, pagination.pageSize, searchValue, activeTab, sortColumn, sortDirection, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPosts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchPosts]);

  const updateUrl = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([key, value]) => {
        if (value && value !== "all" && value !== "") params.set(key, value);
        else params.delete(key);
      });
      const search = params.toString();
      window.history.replaceState(null, "", search ? `?${search}` : window.location.pathname);
    },
    [searchParams],
  );

  const handleSearch = useCallback(
    (value: string) => {
      setSearchValue(value);
      setPagination((p) => ({ ...p, page: 1 }));
      updateUrl({ search: value, page: undefined });
    },
    [updateUrl],
  );

  const handleTab = useCallback(
    (tabId: string) => {
      setActiveTab(tabId);
      setPagination((p) => ({ ...p, page: 1 }));
      updateUrl({ status: tabId, page: undefined });
    },
    [updateUrl],
  );

  const handleDelete = useCallback(
    async (post: BlogPost) => {
      const ok = await confirm({
        title: t("confirm.deleteTitle"),
        description: t("confirm.deleteDescription", { title: post.title }),
        confirmText: t("actions.delete"),
        cancelText: t("actions.cancel"),
        variant: "destructive",
      });
      if (!ok) return;
      try {
        await apiClient.delete(`/api/blog-posts/${post._id}`);
        toast.success(t("toast.deleted"));
        fetchPosts();
      } catch {
        toast.error(t("toast.deleteFailed"));
      }
    },
    [confirm, fetchPosts, t],
  );

  const handleBulkDelete = useCallback(
    async (items: BlogPost[]) => {
      const ok = await confirm({
        title: t("confirm.deleteSelectedTitle"),
        description: t("confirm.deleteSelectedDescription", {
          count: items.length,
        }),
        confirmText: t("actions.delete"),
        cancelText: t("actions.cancel"),
        variant: "destructive",
      });
      if (!ok) return;
      await Promise.all(
        items.map((p) => apiClient.delete(`/api/blog-posts/${p._id}`)),
      );
      toast.success(t("toast.bulkDeleted", { count: items.length }));
      setSelected([]);
      fetchPosts();
    },
    [confirm, fetchPosts, t],
  );

  const handleBulkStatus = useCallback(
    async (items: BlogPost[], status: string) => {
      const results = await Promise.allSettled(
        items.map((p) => apiClient.put(`/api/blog-posts/${p._id}`, { status })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      setSelected([]);
      fetchPosts();
      if (ok > 0) toast.success(t("toast.bulkUpdated", { count: ok }));
      if (ok < items.length) toast.error(t("toast.someUpdatesFailed"));
    },
    [fetchPosts, t],
  );

  const handleFeature = useCallback(
    async (post: BlogPost, isFeatured: boolean) => {
      try {
        await apiClient.put(`/api/blog-posts/${post._id}`, { isFeatured });
        toast.success(
          isFeatured ? t("toast.markedFeatured") : t("toast.removedFeatured"),
        );
        fetchPosts();
      } catch {
        toast.error(t("toast.updateFailed"));
      }
    },
    [fetchPosts, t],
  );

  const columns = useMemo<DataTableColumn<BlogPost>[]>(
    () => [
      {
        id: "title",
        header: t("table.title"),
        cell: (row) => (
          <ProductCell
            image={row.featuredImage?.url}
            title={row.title}
            titleWordLimit={8}
            subtitle={`/${row.slug}`}
            href={`/${locale}/admin/content/blog-posts/${row._id}/edit`}
          />
        ),
        className: "w-[400px]",
      },
      {
        id: "author",
        header: t("table.author"),
        cell: (row) => <span className="text-sm">{row.authorName || "—"}</span>,
        className: "w-[140px]",
      },
      {
        id: "status",
        header: t("table.status"),
        cell: (row) => (
          <div className="flex items-center gap-2">
            <Badge
              variant={
                row.status === "published"
                  ? "default"
                  : row.status === "scheduled"
                    ? "secondary"
                    : row.status === "archived"
                      ? "outline"
                      : "outline"
              }
              className="capitalize"
            >
              {t(`status.${row.status}`)}
            </Badge>
            {row.isFeatured ? (
              <Badge variant="secondary" className="gap-1">
                <Star className="h-3 w-3 fill-current" />
                {t("status.featured")}
              </Badge>
            ) : null}
          </div>
        ),
        className: "w-[200px]",
      },
      {
        id: "publishedAt",
        header: t("table.date"),
        cell: (row) => {
          const d = row.publishedAt || row.scheduledFor;
          return (
            <span className="text-sm text-muted-foreground">
              {d ? new Date(d).toLocaleDateString() : "—"}
            </span>
          );
        },
        className: "w-[120px]",
        sortable: true,
      },
      {
        id: "stats",
        header: t("table.stats"),
        cell: (row) => (
          <div className="flex gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {row.viewCount || 0}
            </span>
            <span>{t("comments", { count: row.commentCount || 0 })}</span>
          </div>
        ),
        className: "w-[180px]",
      },
    ],
    [locale, t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      { id: "all", label: t("tabs.all") },
      { id: "published", label: t("tabs.published") },
      { id: "draft", label: t("tabs.draft") },
      { id: "scheduled", label: t("tabs.scheduled") },
      { id: "archived", label: t("tabs.archived") },
    ],
    [t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("title"),
        secondaryActions: [
          {
            id: "manage-categories",
            label: t("actions.manageCategories"),
            href: `/${locale}/admin/content/blog-categories`,
            icon: <Tags className="h-4 w-4" />,
            variant: "outline",
          },
          {
            id: "manage-comments",
            label: t("actions.manageComments"),
            href: `/${locale}/admin/content/blog-comments`,
            icon: <MessageCircle className="h-4 w-4" />,
            variant: "outline",
          },
        ],
        addAction: {
          id: "add",
          label: t("actions.add"),
          href: `/${locale}/admin/content/blog-posts/new`,
          icon: <Plus className="h-4 w-4" />,
          variant: "default",
        },
      }),
    [locale, t],
  );

  const bulkActions = useMemo<DataTableBulkAction<BlogPost>[]>(
    () => [
      {
        id: "publish",
        label: t("actions.publish"),
        icon: <CheckCircle2 className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatus(items, "published"),
      },
      {
        id: "draft",
        label: t("actions.moveToDraft"),
        icon: <CircleOff className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatus(items, "draft"),
      },
      {
        id: "archive",
        label: t("actions.archive"),
        icon: <CircleOff className="h-4 w-4" />,
        variant: "outline",
        onClick: (items) => handleBulkStatus(items, "archived"),
      },
      {
        id: "delete",
        label: t("actions.delete"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: handleBulkDelete,
      },
    ],
    [handleBulkStatus, handleBulkDelete, t],
  );

  const rowActions = useCallback(
    (row: BlogPost): DataTableAction[] => [
      {
        id: "view",
        label: t("actions.viewOnSite"),
        icon: <ExternalLink className="h-4 w-4" />,
        href: `/${locale}/blog/${row.slug}`,
      },
      {
        id: "edit",
        label: t("actions.edit"),
        icon: <Pencil className="h-4 w-4" />,
        href: `/${locale}/admin/content/blog-posts/${row._id}/edit`,
      },
      {
        id: row.isFeatured ? "unfeature" : "feature",
        label: row.isFeatured ? t("actions.removeFeatured") : t("actions.markFeatured"),
        icon: <Star className={row.isFeatured ? "h-4 w-4 fill-current text-amber-500" : "h-4 w-4"} />,
        onClick: () => handleFeature(row, !row.isFeatured),
      },
      {
        id: "delete",
        label: t("actions.delete"),
        icon: <Trash2 className="h-4 w-4" />,
        variant: "destructive",
        onClick: () => handleDelete(row),
      },
    ],
    [locale, handleDelete, handleFeature, t],
  );

  return (
    <DataTable
      data={posts}
      columns={columns}
      keyField="_id"
      isLoading={isLoading}
      loadingMode="rows"
      title={tableHeader.title}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={handleTab}
      actions={tableHeader.actions}
      selectable
      selectedItems={selected}
      onSelectionChange={setSelected}
      bulkActions={bulkActions}
      searchable
      searchPlaceholder={t("searchPlaceholder")}
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
      onSortChange={(c, d) => {
        setSortColumn(c);
        setSortDirection(d);
      }}
      pagination={pagination}
      onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      onPageSizeChange={(pageSize) =>
        setPagination((p) => ({ ...p, page: 1, pageSize }))
      }
      rowActions={rowActions}
      rowActionsHeader={t("table.actions")}
      rowActionsVariant="inline"
      onRowClick={(row) =>
        router.push(`/${locale}/admin/content/blog-posts/${row._id}/edit`)
      }
      emptyMessage={t("empty")}
      emptyIcon={<Newspaper className="h-8 w-8" />}
    />
  );
}
