"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Package, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppImage } from "@/components/ui/app-image";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface ProductOption {
  _id: string;
  name: string;
  price?: number;
  images?: { url?: string }[];
}

interface ProductListResponse {
  data: ProductOption[];
}

/**
 * Single-product binding picker: debounced name search over the admin
 * products list, one selection at a time. Used by the slider studio's
 * "Product" element — the bound product is what the Price element renders
 * from, so this is deliberately a reference picker, never a price input.
 */
export function ProductSelect({
  value,
  onChange,
  searchPlaceholder,
  clearLabel,
}: {
  value: string;
  onChange: (productId: string) => void;
  searchPlaceholder: string;
  clearLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ProductOption | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve the stored id to a display card once (and when it changes
  // externally, e.g. discard restoring the draft).
  useApplyOnChange([value], () => {
    if (!value) setSelected(null);
  });
  useEffect(() => {
    if (!value) return;
    if (selected?._id === value) return;
    let cancelled = false;
    apiClient
      .get<ProductOption>(`/api/admin/products/${value}`)
      .then((product) => {
        if (!cancelled && product?._id) setSelected(product);
      })
      .catch(() => {
        if (!cancelled) setSelected(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

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
    if (query.trim().length < 2) return;
    debounce.current = setTimeout(() => {
      apiClient
        .get<ProductListResponse>(
          `/api/admin/products?page=1&limit=8&search=${encodeURIComponent(query.trim())}`,
        )
        .then((response) => setResults(response?.data ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query]);

  return (
    <div className="space-y-2">
      {selected ? (
        <div className="flex items-center gap-3 rounded-md border border-border bg-card p-2.5">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
            {selected.images?.[0]?.url ? (
              <AppImage
                src={selected.images[0].url}
                alt={selected.name}
                fill
                className="object-cover"
                sizes="40px"
              />
            ) : (
              <Package className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <p className="min-w-0 flex-1 truncate text-sm font-medium">
            {selected.name}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            aria-label={clearLabel}
            onClick={() => {
              setSelected(null);
              onChange("");
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          className="pl-8"
        />
        {searching ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {results !== null ? (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-card">
          {results.length === 0 && !searching ? (
            <p className="p-3 text-xs text-muted-foreground">—</p>
          ) : (
            results.map((product) => (
              <button
                key={product._id}
                type="button"
                onClick={() => {
                  setSelected(product);
                  onChange(product._id);
                  setQuery("");
                  setResults(null);
                }}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/50",
                  product._id === value && "bg-accent/40",
                )}
              >
                <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded bg-muted">
                  {product.images?.[0]?.url ? (
                    <AppImage
                      src={product.images[0].url}
                      alt={product.name}
                      fill
                      className="object-cover"
                      sizes="32px"
                    />
                  ) : (
                    <Package className="absolute inset-0 m-auto h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {product.name}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
