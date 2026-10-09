"use client";

import { useTranslations } from "next-intl";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { ApiClientError, apiClient } from "@/lib/api/client";
import { useStoreBuilderScope } from "./builder-scope";
import { RemoteSelect } from "./remote-select";

interface CollectionOption {
  _id: string;
  title: string;
  status?: string;
  publishing?: { onlineStore?: boolean };
}

/** How many collections a page of the picker lists before a search. */
const PAGE_SIZE = 50;

/**
 * Single-collection picker fed by the admin collections list — the active
 * ones, searched on the server — through the shared select-with-search.
 * Stores the collection id. A stored collection off the first page keeps its
 * own title; one the storefront no longer shows (a draft, unpublished,
 * deleted) says so under the control.
 */
export function CollectionSelect({
  value,
  onChange,
  placeholder,
  modal,
  ariaLabel,
}: {
  value: string;
  /** "" when the pick is cleared. */
  onChange: (id: string) => void;
  placeholder: string;
  modal?: boolean;
  ariaLabel?: string;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  // A vendor's builder offers the collections its products are in — one
  // list, searched here — instead of the marketplace's paged admin list.
  const scope = useStoreBuilderScope();
  const vendorList = async (): Promise<CollectionOption[]> => {
    const rows = await apiClient.get<CollectionOption[] | { data?: CollectionOption[] }>(
      scope.collectionsEndpoint,
    );
    return Array.isArray(rows) ? rows : (rows?.data ?? []);
  };

  const issueOf = (collection: CollectionOption): string | undefined => {
    if (collection.status && collection.status !== "active") {
      return tSafe(
        "admin.catalogPicker.collection.draft",
        "This collection is a draft, so the storefront does not show it.",
      );
    }
    if (collection.publishing && !collection.publishing.onlineStore) {
      return tSafe(
        "admin.catalogPicker.collection.unpublished",
        "This collection is not published to the online store, so the storefront does not show it.",
      );
    }
    return undefined;
  };

  return (
    <RemoteSelect
      value={value}
      onChange={onChange}
      modal={modal}
      ariaLabel={ariaLabel}
      load={async (query) => {
        if (scope.kind === "vendor") {
          const term = query.trim().toLowerCase();
          return (await vendorList())
            .filter((collection) => !term || collection.title.toLowerCase().includes(term))
            .map((collection) => ({ value: String(collection._id), label: collection.title }));
        }
        // paginatedResponse nests the rows: the unwrapped payload is
        // { data: CollectionOption[], pagination } — NOT a bare array.
        const payload = await apiClient.get<
          { data?: CollectionOption[] } | CollectionOption[]
        >("/api/admin/collections", {
          query: { page: 1, limit: PAGE_SIZE, status: "active", search: query || undefined },
        });
        const rows = Array.isArray(payload) ? payload : (payload?.data ?? []);
        return rows.map((collection) => ({
          value: String(collection._id),
          label: collection.title,
          issue: issueOf(collection),
        }));
      }}
      resolve={async (id) => {
        if (scope.kind === "vendor") {
          const collection = (await vendorList()).find(
            (option) => String(option._id) === id,
          );
          return collection
            ? { label: collection.title }
            : {
                label: tSafe("admin.catalogPicker.collection.notYours", "Collection"),
                issue: tSafe(
                  "admin.catalogPicker.collection.notYoursIssue",
                  "None of your products are in this collection, so it shows nothing on your page.",
                ),
              };
        }
        try {
          const collection = await apiClient.get<CollectionOption>(
            `/api/admin/collections/${encodeURIComponent(id)}`,
          );
          return collection?._id
            ? { label: collection.title, issue: issueOf(collection) }
            : null;
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 404) return null;
          throw error;
        }
      }}
      placeholder={placeholder}
      // A row or a shelf can be emptied again, as the native select allowed.
      clearLabel={tSafe("admin.catalogPicker.none", "None")}
      searchPlaceholder={tSafe("admin.catalogPicker.collection.search", "Search collections…")}
      emptyText={tSafe("admin.catalogPicker.collection.empty", "No collections found")}
      searchingText={tSafe("admin.catalogPicker.searching", "Searching…")}
      missingLabel={tSafe("admin.catalogPicker.collection.missing", "Deleted collection")}
      missingIssue={tSafe(
        "admin.catalogPicker.collection.missingIssue",
        "This collection no longer exists. Pick another one.",
      )}
    />
  );
}
