"use client";

import { useEffect, useRef, useState } from "react";
import {
  FolderTree,
  Layers,
  Link2,
  Loader2,
  Package,
  Search,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { apiClient } from "@/lib/api/client";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import type { TSafe } from "@/components/admin/online-store/t-safe";
import { cn } from "@/lib/utils";

/**
 * Where a link points, and the controls for saying so — shared by the Tags
 * modal and the Links modal, because "type a url, or pick a category, a
 * collection or a product" is the same job in both.
 *
 * Only the resolved url is ever stored. The source is read back off the
 * url's prefix, so a link picked here and one typed on Customize are the
 * same kind of thing, and nothing has to be migrated when a merchant
 * changes their mind about how they chose it.
 */

export const LINK_SOURCES = [
  "custom",
  "category",
  "collection",
  "product",
] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

/** Where each catalogue source's links point. */
const SOURCE_PATHS: Record<Exclude<LinkSource, "custom">, string> = {
  category: "/categories/",
  collection: "/collections/",
  product: "/products/",
};

export function sourceOf(url: string): LinkSource {
  for (const source of ["category", "collection", "product"] as const) {
    if (url.startsWith(SOURCE_PATHS[source])) return source;
  }
  return "custom";
}

function slugOf(
  url: string,
  source: Exclude<LinkSource, "custom">,
): string {
  return url.startsWith(SOURCE_PATHS[source])
    ? url.slice(SOURCE_PATHS[source].length).split(/[?#]/, 1)[0]
    : "";
}

const SOURCE_ICONS: Record<LinkSource, LucideIcon> = {
  custom: Link2,
  category: FolderTree,
  collection: Layers,
  product: Package,
};

function sourceLabels(tSafe: TSafe): Record<LinkSource, string> {
  return {
    custom: tSafe("admin.headerStudio.tags.source.custom", "Custom link"),
    category: tSafe("admin.headerStudio.tags.source.category", "Category"),
    collection: tSafe(
      "admin.headerStudio.tags.source.collection",
      "Collection",
    ),
    product: tSafe("admin.headerStudio.tags.source.product", "Product"),
  };
}

/**
 * The four-way source switch: a segmented control where there is room, the
 * same choice as a dropdown where there is not.
 */
export function SourcePicker({
  value,
  onChange,
  tSafe,
  compact,
}: {
  value: LinkSource;
  onChange: (source: LinkSource) => void;
  tSafe: TSafe;
  /** Icons only — for a nested row, which has a card's width to share. */
  compact?: boolean;
}) {
  const labels = sourceLabels(tSafe);
  const groupLabel = tSafe("admin.headerStudio.tags.sourceLabel", "Source");

  return (
    <>
      <div
        role="group"
        aria-label={groupLabel}
        className="hidden shrink-0 rounded-[4px] border bg-background p-0.5 shadow-xs sm:flex"
      >
        {LINK_SOURCES.map((option) => {
          const Icon = SOURCE_ICONS[option];
          const active = value === option;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              aria-label={labels[option]}
              title={compact ? labels[option] : undefined}
              onClick={() => onChange(option)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-[3px] text-xs font-medium transition-colors",
                compact ? "px-1.5" : "px-2.5",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {compact ? null : labels[option]}
            </button>
          );
        })}
      </div>
      <NativeSelect
        aria-label={groupLabel}
        size="sm"
        value={value}
        onChange={(event) => onChange(event.target.value as LinkSource)}
        className="w-32 shrink-0 sm:hidden"
      >
        {LINK_SOURCES.map((option) => (
          <option key={option} value={option}>
            {labels[option]}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}

/**
 * The "Links to" control for whichever source is active: a url box, a
 * catalogue dropdown, or the product search. A catalogue pick fills the url
 * and — unless the merchant already wrote one — the label with it.
 */
export function LinkTargetField({
  source,
  url,
  label,
  catalogue,
  tSafe,
  onChange,
}: {
  source: LinkSource;
  url: string;
  /** The row's current label, so a pick only names an unnamed row. */
  label: string;
  catalogue: Catalogue;
  tSafe: TSafe;
  onChange: (patch: { url: string; label?: string }) => void;
}) {
  const linkCaption = tSafe("admin.headerStudio.tags.linksTo", "Links to");

  const pick = (
    picked: CatalogueOption | null,
    from: Exclude<LinkSource, "custom">,
  ) => {
    if (!picked) {
      onChange({ url: "" });
      return;
    }
    onChange({
      url: `${SOURCE_PATHS[from]}${picked.slug}`,
      label: label.trim() ? label : picked.name,
    });
  };

  if (source === "custom") {
    return (
      <Input
        value={url}
        placeholder="/products or https://…"
        aria-label={linkCaption}
        onChange={(event) => onChange({ url: event.target.value })}
        className="h-9"
      />
    );
  }

  if (source === "product") {
    return (
      <ProductPicker
        slug={slugOf(url, "product")}
        tSafe={tSafe}
        onPick={(picked) => pick(picked, "product")}
      />
    );
  }

  return (
    <CatalogueSelect
      source={source}
      options={
        source === "category" ? catalogue.categories : catalogue.collections
      }
      slug={slugOf(url, source)}
      tSafe={tSafe}
      onPick={(picked) => pick(picked, source)}
    />
  );
}

export interface CatalogueOption {
  name: string;
  slug: string;
}

export interface Catalogue {
  /** null while loading. */
  categories: CatalogueOption[] | null;
  collections: CatalogueOption[] | null;
}

/**
 * Categories and collections are short lists, fetched ONCE when the modal
 * opens and shared by every row — a card per fetch would hit the API a
 * dozen times and leave later rows showing the placeholder while they wait.
 */
export function useCatalogue(open: boolean): Catalogue {
  const [catalogue, setCatalogue] = useState<Catalogue>({
    categories: null,
    collections: null,
  });
  const loaded = useRef(false);

  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    let cancelled = false;

    const clean = (rows: { name?: unknown; slug?: unknown }[]) =>
      rows.flatMap((row) =>
        typeof row.name === "string" && typeof row.slug === "string" && row.slug
          ? [{ name: row.name, slug: row.slug }]
          : [],
      );

    apiClient
      .get<{ name?: string; slug?: string }[]>("/api/categories?flat=true")
      .then((rows) => clean(Array.isArray(rows) ? rows : []))
      .catch(() => [] as CatalogueOption[])
      .then((categories) => {
        if (!cancelled) setCatalogue((prev) => ({ ...prev, categories }));
      });

    apiClient
      // paginatedResponse nests the rows under `data`.
      .get<
        | { data?: { title?: string; slug?: string }[] }
        | { title?: string; slug?: string }[]
      >("/api/admin/collections?page=1&limit=100&status=active")
      .then((payload) =>
        clean(
          (Array.isArray(payload) ? payload : (payload?.data ?? [])).map(
            (row) => ({ name: row.title, slug: row.slug }),
          ),
        ),
      )
      .catch(() => [] as CatalogueOption[])
      .then((collections) => {
        if (!cancelled) setCatalogue((prev) => ({ ...prev, collections }));
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  return catalogue;
}

function CatalogueSelect({
  source,
  options,
  slug,
  tSafe,
  onPick,
}: {
  source: "category" | "collection";
  options: CatalogueOption[] | null;
  slug: string;
  tSafe: TSafe;
  onPick: (picked: CatalogueOption | null) => void;
}) {
  const placeholder =
    source === "category"
      ? tSafe("admin.headerStudio.tags.pickCategory", "Choose a category…")
      : tSafe("admin.headerStudio.tags.pickCollection", "Choose a collection…");
  const listed = options?.some((option) => option.slug === slug) ?? false;

  return (
    <NativeSelect
      aria-label={placeholder}
      value={slug}
      disabled={options === null}
      onChange={(event) => {
        const picked = options?.find(
          (option) => option.slug === event.target.value,
        );
        onPick(picked ?? null);
      }}
      className="w-full"
    >
      <option value="">{placeholder}</option>
      {(options ?? []).map((option) => (
        <option key={option.slug} value={option.slug}>
          {option.name}
        </option>
      ))}
      {/* The stored pick stays visible while the list loads, and stays
          selectable if it fell outside the first page. */}
      {slug && !listed ? <option value={slug}>{slug}</option> : null}
    </NativeSelect>
  );
}

interface ProductHit {
  _id: string;
  name: string;
  slug: string;
}

/** Products are searched, not listed: a catalogue can hold thousands. */
function ProductPicker({
  slug,
  tSafe,
  onPick,
}: {
  slug: string;
  tSafe: TSafe;
  onPick: (picked: CatalogueOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useApplyOnChange([query], () => {
    if (query.trim().length < 2) {
      setHits(null);
      setSearching(false);
    } else {
      setSearching(true);
    }
  });
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 2) return;
    debounce.current = setTimeout(() => {
      apiClient
        .get<{ data?: ProductHit[] }>(
          `/api/admin/products?page=1&limit=8&search=${encodeURIComponent(query.trim())}`,
        )
        .then((response) => setHits(response?.data ?? []))
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  if (slug) {
    return (
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-[4px] border border-primary/30 bg-primary/5 pl-2.5 pr-1">
        <Package className="h-4 w-4 shrink-0 text-primary" />
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs"
          title={`${SOURCE_PATHS.product}${slug}`}
        >
          {SOURCE_PATHS.product}
          {slug}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => onPick(null)}
        >
          {tSafe("admin.headerStudio.tags.change", "Change")}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex h-9 items-center gap-2 rounded-[4px] border bg-background px-2">
        {searching ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={tSafe(
            "admin.headerStudio.tags.searchProducts",
            "Search products…",
          )}
          aria-label={tSafe(
            "admin.headerStudio.tags.searchProducts",
            "Search products…",
          )}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      {hits && hits.length > 0 ? (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-[4px] border bg-popover p-1 shadow-md">
          {hits.map((hit) => (
            <li key={hit._id}>
              <button
                type="button"
                className="w-full rounded-[4px] px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onPick({ name: hit.name, slug: hit.slug });
                  setQuery("");
                  setHits(null);
                }}
              >
                {hit.name}
              </button>
            </li>
          ))}
        </ul>
      ) : hits && query.trim().length >= 2 && !searching ? (
        <p className="absolute z-10 mt-1 w-full rounded-[4px] border bg-popover px-2 py-1.5 text-xs text-muted-foreground shadow-md">
          {tSafe("admin.headerStudio.tags.noProducts", "No products match")}
        </p>
      ) : null}
    </div>
  );
}

/** The caption above a card's field — "LABEL", "LINKS TO". */
export function FieldCaption({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/60">
      {children}
    </span>
  );
}
