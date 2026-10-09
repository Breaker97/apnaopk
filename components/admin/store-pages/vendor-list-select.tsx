"use client";

import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Plus, Search, Store, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppImage } from "@/components/ui/app-image";
import { apiClient } from "@/lib/api/client";
import { appConfig } from "@/config/app.config";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface VendorOption {
  _id: string;
  storeName: string;
  slug?: string;
  logo?: string;
  isDefault?: boolean;
}

interface VendorListResponse {
  data: VendorOption[];
}

/** One page of approved stores covers almost every marketplace outright. */
const PAGE_SIZE = 100;

/** The store's own catalogue is not a marketplace vendor — never offer it. */
function isMarketplaceVendor(vendor: VendorOption): boolean {
  return !vendor.isDefault && vendor.slug !== appConfig.defaultVendorSlug;
}

async function fetchApprovedVendors(search = ""): Promise<VendorOption[]> {
  const params = new URLSearchParams({
    page: "1",
    limit: String(PAGE_SIZE),
    status: "approved",
    sortOrder: "asc",
  });
  if (search) params.set("search", search);
  const response = await apiClient.get<VendorListResponse>(
    `/api/admin/vendors?${params.toString()}`,
  );
  return (response?.data ?? []).filter(isMarketplaceVendor);
}

/**
 * Hand-picked stores for the Top Vendors section: the picks in display
 * order (drag to reorder), and a search over approved stores to add more.
 *
 * Only approved stores are offered because only approved stores render; a
 * pick whose store has since been suspended stays in the list, marked, so
 * the merchant sees why the storefront shows one card fewer.
 */
export function VendorListSelect({
  value,
  onChange,
  title,
  max,
  labels,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  title: string;
  max?: number;
  labels: {
    search: string;
    empty: string;
    noResults: string;
    unavailable: string;
    remove: string;
    reorder: string;
    limitReached: string;
  };
}) {
  const [catalog, setCatalog] = useState<Map<string, VendorOption>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VendorOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const remember = (vendors: VendorOption[]) =>
    setCatalog((current) => {
      const next = new Map(current);
      for (const vendor of vendors) next.set(vendor._id, vendor);
      return next;
    });

  // The first page doubles as the default suggestions and as the lookup
  // that turns the stored ids back into names and logos.
  useEffect(() => {
    let cancelled = false;
    fetchApprovedVendors()
      .then((vendors) => {
        if (!cancelled) remember(vendors);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useApplyOnChange([query], () => {
    if (query.trim().length < 2) {
      setResults(null);
      setSearching(false);
    } else {
      setSearching(true);
    }
  });
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const term = query.trim();
    if (term.length < 2) return;
    debounce.current = setTimeout(() => {
      fetchApprovedVendors(term)
        .then((vendors) => {
          remember(vendors);
          setResults(vendors);
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  const picked = new Set(value);
  const atMax = max !== undefined && value.length >= max;
  const suggestions = (results ?? [...catalog.values()]).filter(
    (vendor) => !picked.has(vendor._id),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = value.indexOf(String(active.id));
    const to = value.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(value, from, to));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold text-foreground">{title}</p>
        <span className="text-[11px] text-muted-foreground">
          {max !== undefined ? `${value.length} / ${max}` : value.length}
        </span>
      </div>

      {value.length > 0 ? (
        <DndContext
          id="vendor-list-select"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={value} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1.5">
              {value.map((id, index) => (
                <PickedRow
                  key={id}
                  id={id}
                  index={index}
                  vendor={catalog.get(id)}
                  // Until the first page answers, a missing name is "loading",
                  // not "unavailable".
                  unavailable={loaded && !catalog.has(id)}
                  labels={labels}
                  onRemove={() => onChange(value.filter((pick) => pick !== id))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {labels.empty}
        </p>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          className="pl-8"
          disabled={atMax}
        />
        {searching ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {atMax ? (
        <p className="text-xs text-muted-foreground">{labels.limitReached}</p>
      ) : (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-card">
          {!loaded && results === null ? (
            <div className="flex justify-center p-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : suggestions.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {labels.noResults}
            </p>
          ) : (
            suggestions.map((vendor) => (
              <button
                key={vendor._id}
                type="button"
                onClick={() => {
                  onChange([...value, vendor._id]);
                  setQuery("");
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/50"
              >
                <VendorLogo vendor={vendor} />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {vendor.storeName}
                </span>
                <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function PickedRow({
  id,
  index,
  vendor,
  unavailable,
  labels,
  onRemove,
}: {
  id: string;
  index: number;
  vendor: VendorOption | undefined;
  unavailable: boolean;
  labels: { unavailable: string; remove: string; reorder: string };
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5",
        isDragging && "z-10 shadow-md",
        unavailable && "opacity-60",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none p-1 text-muted-foreground"
        aria-label={labels.reorder}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
        {index + 1}
      </span>
      {vendor ? <VendorLogo vendor={vendor} /> : null}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {vendor?.storeName ?? (unavailable ? labels.unavailable : "…")}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
        aria-label={labels.remove}
        onClick={onRemove}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

function VendorLogo({ vendor }: { vendor: VendorOption }) {
  return (
    <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-muted">
      {vendor.logo ? (
        <AppImage
          src={vendor.logo}
          alt=""
          fill
          className="object-cover"
          sizes="28px"
        />
      ) : (
        <Store className="absolute inset-0 m-auto h-3.5 w-3.5 text-muted-foreground" />
      )}
    </div>
  );
}
