"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { DataTablePaginationType } from "@/components/ui/data-table";

/**
 * Everything a DataTable screen needs from its list state, independent of who
 * fetches the rows.
 *
 * Kept separate from the hook below so a table depends on the contract rather
 * than the implementation: every admin/vendor/staff list screen types its
 * `list` object as this, so an alternative source of rows can be dropped in
 * without touching a single table body.
 */
interface ListController<T> {
  items: T[];
  isLoading: boolean;
  pagination: DataTablePaginationType;
  search: string;
  activeTab: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  filters: Record<string, string>;
  refetch: () => void;
  handleSearchChange: (value: string) => void;
  handleTabChange: (tabId: string) => void;
  handlePageChange: (page: number) => void;
  handlePageSizeChange: (pageSize: number) => void;
  handleSortChange: (column: string, direction: "asc" | "desc") => void;
  handleFilterChange: (filterId: string, value: string) => void;
}

/**
 * URL-driven list state for DataTable screens.
 *
 * The URL is the only source of truth and every control is a navigation: the
 * page's server component reads the same query string, runs the query, and
 * streams the rows back. The table never opens an XHR of its own, and a
 * pasted or reloaded URL always reproduces exactly what was on screen.
 *
 * Navigations run inside `useTransition`, so `isLoading` is the transition's
 * pending flag and the table keeps drawing (with skeleton rows) instead of
 * blanking out. `router.replace` rather than `push` keeps filter changes out
 * of browser history — stepping back through every keystroke is not what a
 * Back button is for.
 */

export interface UseListNavigationOptions<T> {
  /** Rows for the current query, already fetched by the server component. */
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  /** Query param the active tab maps to. Defaults to "status". */
  tabParam?: string;
  /**
   * Filter ids to read out of the URL. Anything absent reads as "all", which
   * is the value DataTable's selects use for "no filter".
   */
  filterIds?: string[];
  defaultSortBy?: string;
  defaultSortOrder?: "asc" | "desc";
  /** Page size that is left out of the URL because it is the server default. */
  defaultPageSize?: number;
}

export function useListNavigation<T>({
  items,
  pagination,
  tabParam = "status",
  filterIds,
  defaultSortBy = "createdAt",
  defaultSortOrder = "desc",
  defaultPageSize = 10,
}: UseListNavigationOptions<T>): ListController<T> {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Free text is the one control kept in local state. Every other control
  // changes atomically on click, but the search box is typed into while a
  // navigation for an earlier keystroke is still in flight — reading it back
  // from the URL would snap the input to that older value mid-word.
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");

  const navigate = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === "all") params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      startTransition(() => {
        router.replace(query ? `${pathname}?${query}` : pathname, {
          scroll: false,
        });
      });
    },
    [pathname, router, searchParams],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearch(value);
      navigate({ search: value, page: undefined });
    },
    [navigate],
  );

  const handleTabChange = useCallback(
    (tabId: string) => navigate({ [tabParam]: tabId, page: undefined }),
    [navigate, tabParam],
  );

  const handlePageChange = useCallback(
    (page: number) => navigate({ page: page > 1 ? String(page) : undefined }),
    [navigate],
  );

  const handlePageSizeChange = useCallback(
    (pageSize: number) =>
      navigate({
        limit: pageSize === defaultPageSize ? undefined : String(pageSize),
        page: undefined,
      }),
    [defaultPageSize, navigate],
  );

  const handleSortChange = useCallback(
    (column: string, direction: "asc" | "desc") =>
      navigate({ sortBy: column, sortOrder: direction, page: undefined }),
    [navigate],
  );

  const handleFilterChange = useCallback(
    (filterId: string, value: string) =>
      navigate({ [filterId]: value, page: undefined }),
    [navigate],
  );

  const refetch = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  const filterKey = filterIds?.join(",") ?? "";
  const filters = useMemo(() => {
    const entries = filterKey ? filterKey.split(",") : [];
    return Object.fromEntries(
      entries.map((id) => [id, searchParams.get(id) ?? "all"]),
    );
  }, [filterKey, searchParams]);

  return {
    items,
    isLoading: isPending,
    pagination: {
      page: pagination.page,
      pageSize: pagination.limit,
      total: pagination.total,
      totalPages: pagination.totalPages,
    },
    search,
    activeTab: searchParams.get(tabParam) ?? "all",
    sortBy: searchParams.get("sortBy") ?? defaultSortBy,
    sortOrder:
      searchParams.get("sortOrder") === "asc"
        ? "asc"
        : searchParams.get("sortOrder") === "desc"
          ? "desc"
          : defaultSortOrder,
    filters,
    refetch,
    handleSearchChange,
    handleTabChange,
    handlePageChange,
    handlePageSizeChange,
    handleSortChange,
    handleFilterChange,
  };
}
