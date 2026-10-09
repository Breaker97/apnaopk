"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";

import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import { DataTablePagination } from "@/components/ui/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { META_CATALOG_ENDPOINT, metaRequest, type MetaRejectedProduct } from "./api";

const PAGE_SIZE = 10;

type Page = {
  rows: MetaRejectedProduct[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

/**
 * The products Meta refused items of — and only those: the product, the
 * variant when it is one, Meta's reason, and the way to the editor that
 * fixes it. A product Meta took is never listed.
 */
export function LiveRejectedList({ rejected, refreshKey }: { rejected: number; refreshKey: string }) {
  const t = useTranslations("admin.settings.metaCatalog.live.rejected");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [data, setData] = useState<Page | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(
        await metaRequest<Page>(
          `${META_CATALOG_ENDPOINT}/live/rejected?page=${page}&pageSize=${pageSize}`,
        ),
      );
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [page, pageSize]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey, rejected]);

  if (failed && !data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm">
        <span className="text-muted-foreground">{t("loadFailed")}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          {t("retry")}
        </Button>
      </div>
    );
  }
  if (!data) return <Skeleton className="h-24 w-full rounded-md" />;
  if (data.rows.length === 0) return null;

  return (
    <section className="space-y-2" aria-labelledby="meta-rejected-title">
      <h3
        id="meta-rejected-title"
        className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400"
      >
        <TriangleAlert className="size-4 shrink-0" />
        {rejected > 0 ? t("title", { count: rejected }) : t("titleFailing")}
      </h3>
      <ul className="divide-y rounded-md border">
        {data.rows.map((row) => (
          <li key={row.productId} className="space-y-1 px-4 py-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium" dir="auto" title={row.name}>
                {row.name}
              </span>
              <Link
                href={row.editPath}
                className="text-primary shrink-0 text-xs font-medium hover:underline"
              >
                {t("edit")}
              </Link>
            </div>
            {row.problems.map((problem) => (
              <p key={problem.itemId} className="text-muted-foreground break-words">
                {problem.variant ? (
                  <span className="text-foreground" dir="auto">
                    {problem.variant}:{" "}
                  </span>
                ) : null}
                <span dir="auto">{problem.message || t("noReason")}</span>
              </p>
            ))}
            {row.failing ? (
              <p className="text-muted-foreground break-words" dir="auto">
                {t("failing", { message: row.failing })}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {data.pagination.total > PAGE_SIZE ? (
        <DataTablePagination
          pagination={data.pagination}
          pageSizeOptions={[10, 25, 50]}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      ) : null}
    </section>
  );
}
