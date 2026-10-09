"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Category } from "@/components/admin/product-form/schema";

// Searchable category picker with breadcrumb path. Modeled on Shopify's
// product category combobox: type to filter, every level is selectable — a
// charger can sit on "Chargers" as well as on "Chargers › iPhone Chargers",
// and a parent's storefront page rolls up everything under it.
export function CategoryPicker({
  categories,
  value,
  onChange,
  labels,
}: {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  labels: {
    selectCategory: string;
    searchCategories: string;
    clear: string;
    noCategories: string;
    noMatches: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = categories.find((c) => c._id === value);
  const selectedPath = selected?.path ?? [];

  const ordered = useMemo(() => depthFirst(categories), [categories]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? ordered.filter((c) => {
        const haystack = (c.path?.join(" › ") ?? c.name).toLowerCase();
        return haystack.includes(q);
      })
    : ordered;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          className={cn(
            "w-full min-w-0 justify-between overflow-hidden font-normal",
            !value && "text-muted-foreground",
          )}
        >
          {selected ? (
            <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-left">
              {selectedPath.length > 1 ? (
                <span className="block min-w-0 truncate">
                  <span className="text-muted-foreground">
                    {selectedPath.slice(0, -1).join(" › ")} ›{" "}
                  </span>
                  <span className="text-foreground">
                    {selectedPath[selectedPath.length - 1]}
                  </span>
                </span>
              ) : (
                <span className="block min-w-0 truncate">{selected.name}</span>
              )}
            </span>
          ) : (
            <span className="min-w-0 truncate">{labels.selectCategory}</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchCategories}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setQuery("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {labels.clear}
            </button>
          )}
        </div>

        <div className="max-h-72 overflow-y-auto p-1">
          {ordered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {labels.noCategories}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {labels.noMatches.replace("{query}", query)}
            </div>
          ) : (
            filtered.map((cat) => {
              const path = cat.path ?? [cat.name];
              const isSelected = cat._id === value;
              const own = path[path.length - 1];
              const ancestors = path.slice(0, -1);
              return (
                <button
                  key={cat._id}
                  type="button"
                  onClick={() => {
                    onChange(cat._id);
                    setQuery("");
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                    isSelected && "bg-accent",
                  )}
                >
                  <Check
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{own}</div>
                    {ancestors.length > 0 && (
                      <div className="truncate text-xs text-muted-foreground">
                        {ancestors.join(" › ")}
                      </div>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Each parent followed by its own sub-categories, siblings in the order they
 * came (the store's category order). The flat list interleaves the levels, which
 * read fine while only the deepest ones were offered.
 */
function depthFirst(categories: Category[]): Category[] {
  const ids = new Set(categories.map((c) => c._id));
  const childrenOf = new Map<string, Category[]>();
  const roots: Category[] = [];
  for (const category of categories) {
    const parentId = category.parentId;
    if (parentId && ids.has(parentId)) {
      childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), category]);
    } else {
      roots.push(category);
    }
  }

  const ordered: Category[] = [];
  const seen = new Set<string>();
  const visit = (category: Category) => {
    if (seen.has(category._id)) return;
    seen.add(category._id);
    ordered.push(category);
    for (const child of childrenOf.get(category._id) ?? []) visit(child);
  };
  roots.forEach(visit);
  // A parentId loop has no root; list those rather than hide them.
  categories.forEach(visit);
  return ordered;
}
