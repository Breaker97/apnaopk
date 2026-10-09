"use client";

import { useTranslations } from "next-intl";
import { createTSafe } from "@/components/admin/online-store/t-safe";
import { ApiClientError, apiClient } from "@/lib/api/client";
import { useStoreBuilderScope } from "./builder-scope";
import { RemoteSelect } from "./remote-select";

interface BrandRow {
  _id: string;
  name: string;
  isActive?: boolean;
  approvalStatus?: string;
  deletedAt?: string | null;
}

/** How many brands a page of the picker lists before a search. */
const PAGE_SIZE = 50;

/**
 * Single-brand picker over the brands the storefront shows (approved,
 * active, not archived), searched on the server. Stores the brand id. A
 * stored brand that dropped off the storefront keeps its name, with why.
 */
export function BrandSelect({
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
  // A vendor's builder offers the brands its products carry — one list,
  // searched here.
  const scope = useStoreBuilderScope();
  const vendorRows = async (): Promise<BrandRow[]> => {
    const rows = await apiClient.get<BrandRow[] | { data?: BrandRow[] }>(
      scope.brandsEndpoint,
    );
    return Array.isArray(rows) ? rows : (rows?.data ?? []);
  };

  const issueOf = (brand: BrandRow): string | undefined => {
    if (brand.deletedAt) {
      return tSafe(
        "admin.catalogPicker.brand.archived",
        "This brand is archived, so the storefront does not show it.",
      );
    }
    if (brand.approvalStatus === "pending" || brand.approvalStatus === "rejected") {
      return tSafe(
        "admin.catalogPicker.brand.unapproved",
        "This brand is not approved, so the storefront does not show it.",
      );
    }
    if (brand.isActive === false) {
      return tSafe(
        "admin.catalogPicker.brand.inactive",
        "This brand is switched off, so the storefront does not show it.",
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
          return (await vendorRows())
            .filter((brand) => !term || brand.name.toLowerCase().includes(term))
            .map((brand) => ({ value: String(brand._id), label: brand.name }));
        }
        // `assignable` is the storefront's set; page + limit answer
        // `{ data, pagination }` rather than a bare array.
        const result = await apiClient.get<{ data?: BrandRow[] } | BrandRow[]>(
          "/api/brands",
          {
            query: {
              assignable: "true",
              page: 1,
              limit: PAGE_SIZE,
              search: query || undefined,
            },
          },
        );
        const rows = Array.isArray(result) ? result : (result?.data ?? []);
        return rows.map((brand) => ({ value: String(brand._id), label: brand.name }));
      }}
      resolve={async (id) => {
        if (scope.kind === "vendor") {
          const brand = (await vendorRows()).find((row) => String(row._id) === id);
          return brand
            ? { label: brand.name }
            : {
                label: tSafe("admin.catalogPicker.brand.notYours", "Brand"),
                issue: tSafe(
                  "admin.catalogPicker.brand.notYoursIssue",
                  "None of your products carry this brand, so it shows nothing on your page.",
                ),
              };
        }
        try {
          const brand = await apiClient.get<BrandRow>(`/api/brands/${encodeURIComponent(id)}`);
          return brand?._id ? { label: brand.name, issue: issueOf(brand) } : null;
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 404) return null;
          throw error;
        }
      }}
      placeholder={tSafe("admin.catalogPicker.brand.placeholder", "Select a brand…")}
      searchPlaceholder={tSafe("admin.catalogPicker.brand.search", "Search brands…")}
      emptyText={tSafe("admin.catalogPicker.brand.empty", "No brands found")}
      searchingText={tSafe("admin.catalogPicker.searching", "Searching…")}
      missingLabel={tSafe("admin.catalogPicker.brand.missing", "Deleted brand")}
      missingIssue={tSafe(
        "admin.catalogPicker.brand.missingIssue",
        "This brand no longer exists. Pick another one.",
      )}
    />
  );
}
