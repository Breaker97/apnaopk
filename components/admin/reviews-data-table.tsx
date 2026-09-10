"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  CornerDownRight,
  PauseCircle,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import {
  DataTable,
  DateCell,
  type DataTableAction,
  type DataTableBulkAction,
  type DataTableColumn,
  type DataTableFilter,
  type DataTableTab,
} from "@/components/ui/data-table";
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/toast-notification";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useListNavigation } from "@/hooks/use-list-navigation";
import { apiClient } from "@/lib/api/client";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { buildAdminCommerceTableHeader } from "@/components/admin/admin-commerce-table-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AppImage } from "@/components/ui/app-image";
import { cn } from "@/lib/utils";
import { ReviewReplyDialog } from "@/components/admin/review-reply-dialog";
import type { AdminReview, ReviewProductRef, ReviewUserRef } from "@/lib/admin/reviews-types";


interface ReviewsDataTableProps {
  locale: string;
  area?: "admin" | "staff";
  readOnly?: boolean;
  /** Rows for the current query string, fetched by the page. */
  data: AdminReview[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const REVIEW_FILTER_IDS = ["status", "rating"];

function getProduct(row: AdminReview): ReviewProductRef | null {
  if (!row.productId) return null;
  if (typeof row.productId === "string") return { _id: row.productId };
  return row.productId;
}

function getUser(row: AdminReview): ReviewUserRef | null {
  if (!row.userId) return null;
  if (typeof row.userId === "string") return { _id: row.userId };
  return row.userId;
}

function truncateWords(value: string, maxWords: number) {
  const words = value.trim().split(/\s+/);
  if (words.length <= maxWords) return value;
  return `${words.slice(0, maxWords).join(" ")} ..`;
}

function StarRow({
  value,
  size = 14,
  ariaLabel,
}: {
  value: number;
  size?: number;
  ariaLabel: string;
}) {
  const filledStars = Math.max(0, Math.min(5, Math.round(value)));

  return (
    <div className="flex items-center gap-[1px] leading-none" aria-label={ariaLabel}>
      {Array.from({ length: 5 }).map((_, idx) => (
        <span
          key={idx}
          aria-hidden="true"
          style={{ fontSize: size }}
          className={cn(
            "font-black",
            idx < filledStars
              ? "text-slate-900 dark:text-slate-100"
              : "text-slate-300 dark:text-slate-700",
          )}
        >
          ★
        </span>
      ))}
    </div>
  );
}

export function ReviewsDataTable({
  locale,
  area = "admin",
  readOnly = false,
  data,
  pagination,
}: ReviewsDataTableProps) {
  const t = useTranslations();
  const router = useRouter();
  const { confirm } = useConfirmation();

  const [selected, setSelected] = useState<AdminReview[]>([]);
  const [replyTarget, setReplyTarget] = useState<AdminReview | null>(null);

  const basePath = `/${locale}/${area}`;

  const list = useListNavigation<AdminReview>({
    items: data,
    pagination,
    tabParam: "view",
    filterIds: REVIEW_FILTER_IDS,
  });

  const handleSetApproved = useCallback(
    async (reviewId: string, isApproved: boolean) => {
      try {
        await apiClient.patch(`/api/admin/reviews/${reviewId}`, { isApproved });
        toast.success(
          isApproved
            ? t("admin.reviewsPage.toast.published")
            : t("admin.reviewsPage.toast.onHold"),
        );
        list.refetch();
      } catch {
        toast.error(t("common.error"));
      }
    },
    [list, t],
  );

  const handleDelete = useCallback(
    async (reviewId: string) => {
      const ok = await confirm({
        title: t("admin.reviewsPage.delete.title"),
        description: t("admin.reviewsPage.delete.description"),
        confirmText: t("common.delete"),
        cancelText: t("common.cancel"),
        variant: "destructive",
      });
      if (!ok) return;

      try {
        await apiClient.delete(`/api/admin/reviews/${reviewId}`);
        toast.success(
          t("admin.reviewsPage.toast.deleted"),
        );
        list.refetch();
      } catch {
        toast.error(t("common.error"));
      }
    },
    [confirm, list, t],
  );

  const handleBulkSetApproved = useCallback(
    async (items: AdminReview[], isApproved: boolean) => {
      try {
        await Promise.all(
          items.map((r) =>
            apiClient.patch(`/api/admin/reviews/${r._id}`, { isApproved }),
          ),
        );
        setSelected([]);
        toast.success(
          t("admin.reviewsPage.bulk.updated", {
            count: items.length,
          }),
        );
        list.refetch();
      } catch {
        toast.error(t("common.error"));
      }
    },
    [list, t],
  );

  const handleBulkDelete = useCallback(
    async (items: AdminReview[]) => {
      const ok = await confirm({
        title: t("admin.reviewsPage.bulk.deleteTitle"),
        description: t("admin.reviewsPage.bulk.deleteDescription", {
          count: items.length,
        }),
        confirmText: t("common.delete"),
        cancelText: t("common.cancel"),
        variant: "destructive",
      });
      if (!ok) return;

      try {
        await Promise.all(
          items.map((r) => apiClient.delete(`/api/admin/reviews/${r._id}`)),
        );
        setSelected([]);
        toast.success(
          t("admin.reviewsPage.bulk.deleted", {
            count: items.length,
          }),
        );
        list.refetch();
      } catch {
        toast.error(t("common.error"));
      }
    },
    [confirm, list, t],
  );

  const columns = useMemo<DataTableColumn<AdminReview>[]>(
    () => [
      {
        id: "product",
        header: t("admin.reviewsPage.table.product"),
        cell: (row) => {
          const p = getProduct(row);
          const cover = p?.images?.[0];
          const productHref = p?._id
            ? `${basePath}/products/${p._id}/edit`
            : null;
          const productName =
            p?.name ||
            t("admin.reviewsPage.unknownProduct");
          const displayProductName = truncateWords(productName, 6);

          const inner = (
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                {cover ? (
                  <AppImage
                    src={cover}
                    alt={productName}
                    fill
                    className="object-cover"
                  />
                ) : null}
              </div>
              <span
                className="truncate text-sm font-medium text-foreground"
                title={productName}
              >
                {displayProductName}
              </span>
            </div>
          );

          return productHref ? (
            <Link
              href={productHref}
              className="block min-w-0 hover:[&_span]:text-blue-600 hover:[&_span]:underline dark:hover:[&_span]:text-blue-400"
              onClick={(e) => e.stopPropagation()}
            >
              {inner}
            </Link>
          ) : (
            inner
          );
        },
        className: "w-[260px] min-w-[220px]",
      },
      {
        id: "reviewer",
        header: t("admin.reviewsPage.table.reviewer"),
        cell: (row) => {
          const u = getUser(row);
          const name = u?.name || t("common.guest");
          const initial = (name?.charAt(0) || "U").toUpperCase();
          const customerHref = u?.customerProfileId
            ? `${basePath}/customers/${u.customerProfileId}`
            : null;

          const inner = (
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarImage src={u?.image} alt={name} />
                <AvatarFallback>{initial}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground transition-colors group-hover/reviewer:text-primary group-focus-visible/reviewer:text-primary">
                  {name}
                </p>
                {u?.email && (
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email}
                  </p>
                )}
                {row.isVerified && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <ShieldCheck className="h-3 w-3" />
                    {t("admin.reviewsPage.verified")}
                  </p>
                )}
              </div>
            </div>
          );

          return customerHref ? (
            <Link
              href={customerHref}
              className="group/reviewer block min-w-0"
              onClick={(e) => e.stopPropagation()}
            >
              {inner}
            </Link>
          ) : (
            inner
          );
        },
        className: "w-[240px] min-w-[200px]",
      },
      {
        id: "review",
        header: t("admin.reviewsPage.table.review"),
        cell: (row) => (
          <div className="min-w-0 max-w-[300px] space-y-1">
            {Array.isArray(row.images) && row.images.length > 0 && (
              <div className="mb-2 flex gap-1.5">
                {row.images.slice(0, 3).map((src, idx) => (
                  <div
                    key={`${row._id}-img-${idx}`}
                    className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[7px] bg-muted"
                  >
                    <AppImage
                      src={src}
                      alt={t("admin.reviewsPage.reviewImageAlt", {
                        index: idx + 1,
                      })}
                      fill
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
            <StarRow
              value={row.rating}
              ariaLabel={t("admin.reviewsPage.starsAriaLabel", {
                value: row.rating,
              })}
            />
            {row.title && (
              <p className="text-sm font-semibold leading-[18px] text-slate-900 dark:text-slate-100">
                {row.title}
              </p>
            )}
            <p className="line-clamp-2 text-sm leading-5 text-slate-600 dark:text-slate-400">
              {row.comment}
            </p>
            {row.reply?.comment && (
              <div className="mt-3">
                <div className="flex items-center gap-2 text-sm font-semibold leading-[18px] text-slate-900 dark:text-slate-100">
                  <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    {t("admin.reviewsPage.youReplied")}
                  </span>
                </div>
                <div className="ml-[22px] mt-1 border-l border-slate-300 pl-3 dark:border-slate-700">
                  <p className="line-clamp-3 text-sm leading-5 text-slate-600 dark:text-slate-400">
                    {row.reply.comment}
                  </p>
                </div>
              </div>
            )}
          </div>
        ),
        className: "min-w-[280px]",
      },
      {
        id: "createdAt",
        header: t("admin.reviewsPage.table.date"),
        cell: (row) => <DateCell date={row.createdAt} format="medium" />,
        className: "w-[140px] hidden lg:table-cell",
        headerClassName: "hidden lg:table-cell",
        sortable: true,
      },
      {
        id: "status",
        header: t("admin.reviewsPage.table.status"),
        cell: (row) =>
          row.isApproved ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[12px] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t("admin.reviewsPage.status.published")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[12px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              <Clock className="h-3.5 w-3.5" />
              {t("admin.reviewsPage.status.onHold")}
            </span>
          ),
        className: "w-[140px] hidden md:table-cell",
        headerClassName: "hidden md:table-cell",
      },
    ],
    [basePath, t],
  );

  const tabs = useMemo<DataTableTab[]>(
    () => [
      {
        id: "all",
        label: t("admin.reviewsPage.tabs.all"),
      },
      {
        id: "published",
        label: t("admin.reviewsPage.tabs.published"),
      },
      {
        id: "on_hold",
        label: t("admin.reviewsPage.tabs.onHold"),
      },
      {
        id: "with_reply",
        label: t("admin.reviewsPage.tabs.withReply"),
      },
      {
        id: "no_reply",
        label: t("admin.reviewsPage.tabs.noReply"),
      },
    ],
    [t],
  );

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        id: "status",
        label: t("admin.reviewsPage.filters.status"),
        type: "select",
        options: [
          {
            label: t("admin.reviewsPage.tabs.all"),
            value: "all",
          },
          {
            label: t("admin.reviewsPage.status.published"),
            value: "published",
          },
          {
            label: t("admin.reviewsPage.status.onHold"),
            value: "on_hold",
          },
        ],
      },
      {
        id: "rating",
        label: t("admin.reviewsPage.filters.rating"),
        type: "select",
        options: [
          {
            label: t("admin.reviewsPage.tabs.all"),
            value: "all",
          },
          { label: "5 ★", value: "5" },
          { label: "4 ★", value: "4" },
          { label: "3 ★", value: "3" },
          { label: "2 ★", value: "2" },
          { label: "1 ★", value: "1" },
        ],
      },
    ],
    [t],
  );

  const tableHeader = useMemo(
    () =>
      buildAdminCommerceTableHeader({
        title: t("admin.reviewsPage.title"),
      }),
    [t],
  );

  const bulkActions = useMemo<DataTableBulkAction<AdminReview>[]>(
    () =>
      readOnly
        ? []
        : [
            {
              id: "publish",
              label: t("admin.reviewsPage.bulk.publish"),
              icon: <CheckCircle2 className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkSetApproved(items, true),
            },
            {
              id: "on_hold",
              label: t("admin.reviewsPage.bulk.onHold"),
              icon: <PauseCircle className="h-4 w-4" />,
              variant: "outline",
              onClick: (items) => handleBulkSetApproved(items, false),
            },
            {
              id: "delete",
              label: t("common.delete"),
              icon: <Trash2 className="h-4 w-4" />,
              variant: "destructive",
              onClick: (items) => handleBulkDelete(items),
            },
          ],
    [handleBulkDelete, handleBulkSetApproved, readOnly, t],
  );

  const rowActions = useCallback(
    (row: AdminReview): DataTableAction[] => {
      if (readOnly) return [];

      return [
        {
          id: "reply",
          label: t("admin.reviewsPage.reply"),
          onClick: () => setReplyTarget(row),
        },
        row.isApproved
          ? {
              id: "unpublish",
              label: t("admin.reviewsPage.unpublish"),
              onClick: () => handleSetApproved(row._id, false),
            }
          : {
              id: "publish",
              label: t("admin.reviewsPage.publish"),
              onClick: () => handleSetApproved(row._id, true),
            },
        ...(row.isApproved
          ? [
              {
                id: "on_hold",
                label: t("admin.reviewsPage.status.onHold"),
                onClick: () => handleSetApproved(row._id, false),
              },
            ]
          : []),
        {
          id: "delete",
          label: t("common.delete"),
          variant: "destructive",
          onClick: () => handleDelete(row._id),
        },
      ];
    },
    [handleDelete, handleSetApproved, readOnly, t],
  );

  return (
    <>
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
        selectedItems={selected}
        onSelectionChange={setSelected}
        bulkActions={bulkActions}
        searchable
        searchPlaceholder={t("admin.reviewsPage.searchPlaceholder")}
        searchValue={list.search}
        onSearchChange={list.handleSearchChange}
        filters={filters}
        filterValues={list.filters}
        onFilterChange={list.handleFilterChange}
        toolbarActions={tableHeader.toolbarActions}
        pagination={list.pagination}
        onPageChange={list.handlePageChange}
        onPageSizeChange={list.handlePageSizeChange}
        sortColumn={list.sortBy}
        sortDirection={list.sortOrder}
        onSortChange={list.handleSortChange}
        rowActions={readOnly ? undefined : rowActions}
        rowActionsHeader={t("admin.reviewsPage.table.actions")}
        rowActionsVariant="split"
        toolbarLayout={tableHeader.toolbarLayout}
        tabsVariant={tableHeader.tabsVariant}
        filtersVariant={tableHeader.filtersVariant}
        appearance={tableHeader.appearance}
        stackedTopControls={tableHeader.stackedTopControls}
        showToolbarSortButton={tableHeader.showToolbarSortButton}
        className="overflow-hidden [&_thead_th]:text-xs [&_tbody_td]:align-top"
        onRowClick={(row) => {
          const product = getProduct(row);
          if (product?._id) {
            router.push(`${basePath}/products/${product._id}/edit`);
          }
        }}
        emptyMessage={t("admin.reviewsPage.empty")}
      />

      <ReviewReplyDialog
        open={!!replyTarget}
        review={replyTarget}
        onOpenChange={(open) => {
          if (!open) setReplyTarget(null);
        }}
        onSaved={() => {
          setReplyTarget(null);
          list.refetch();
        }}
      />
    </>
  );
}
