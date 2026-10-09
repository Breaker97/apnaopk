"use client";

import { useTranslations } from "next-intl";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { ApiClientError, apiClient } from "@/lib/api/client";
import { useStoreBuilderScope } from "./builder-scope";
import { RemoteSelect, type RemoteOption } from "./remote-select";

interface CategoryRow {
  _id: string;
  name: string;
  slug?: string;
  /** Ancestor names ending in the category's own (GET /api/categories?flat=true). */
  path?: string[];
  isActive?: boolean;
}

/** "Electronics › Phones › Smartphones" — where the category sits. */
export function categoryPathLabel(category: Pick<CategoryRow, "name" | "path">): string {
  return category.path && category.path.length > 0
    ? category.path.join(" › ")
    : category.name;
}

/**
 * Single-category picker: parent categories and sub-categories alike, each
 * named by its full path, searched on the server. Stores the category id.
 * A switched-off category stays pickable, and says what that means.
 */
export function CategorySelect({
  value,
  onChange,
  modal,
  ariaLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  modal?: boolean;
  ariaLabel?: string;
}) {
  const t = useTranslations();
  const tSafe = createTSafe(t);
  const hiddenIssue = tSafe(
    "admin.catalogPicker.category.hidden",
    "This category is switched off, so the storefront does not show it.",
  );

  // A vendor's builder offers the categories its products are in (and the
  // top-level ones above them) — one list, searched here.
  const scope = useStoreBuilderScope();
  const vendorRows = async (): Promise<CategoryRow[]> => {
    const rows = await apiClient.get<CategoryRow[] | { data?: CategoryRow[] }>(
      scope.categoriesEndpoint,
    );
    return Array.isArray(rows) ? rows : (rows?.data ?? []);
  };

  const toOption = (category: CategoryRow): RemoteOption => ({
    value: String(category._id),
    label: categoryPathLabel(category),
    ...(category.isActive === false ? { issue: hiddenIssue } : {}),
  });

  return (
    <RemoteSelect
      value={value}
      onChange={onChange}
      modal={modal}
      ariaLabel={ariaLabel}
      load={async (query) => {
        if (scope.kind === "vendor") {
          const term = query.trim().toLowerCase();
          return (await vendorRows())
            .filter((category) => !term || category.name.toLowerCase().includes(term))
            .map(toOption)
            .sort((a, b) => a.label.localeCompare(b.label));
        }
        const rows = await apiClient.get<CategoryRow[]>("/api/categories", {
          query: { flat: "true", search: query || undefined },
        });
        return (Array.isArray(rows) ? rows : [])
          .map(toOption)
          // Parents read before their children.
          .sort((a, b) => a.label.localeCompare(b.label));
      }}
      resolve={async (id) => {
        if (scope.kind === "vendor") {
          const category = (await vendorRows()).find((row) => String(row._id) === id);
          return category
            ? { label: categoryPathLabel(category) }
            : {
                label: tSafe("admin.catalogPicker.category.notYours", "Category"),
                issue: tSafe(
                  "admin.catalogPicker.category.notYoursIssue",
                  "None of your products are in this category, so it shows nothing on your page.",
                ),
              };
        }
        try {
          const category = await apiClient.get<CategoryRow>(
            `/api/categories/${encodeURIComponent(id)}`,
          );
          return category?._id ? { label: category.name, issue: toOption(category).issue } : null;
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 404) return null;
          throw error;
        }
      }}
      placeholder={tSafe("admin.catalogPicker.category.placeholder", "Select a category…")}
      searchPlaceholder={tSafe("admin.catalogPicker.category.search", "Search categories…")}
      emptyText={tSafe("admin.catalogPicker.category.empty", "No categories found")}
      searchingText={tSafe("admin.catalogPicker.searching", "Searching…")}
      missingLabel={tSafe("admin.catalogPicker.category.missing", "Deleted category")}
      missingIssue={tSafe(
        "admin.catalogPicker.category.missingIssue",
        "This category no longer exists. Pick another one.",
      )}
    />
  );
}
