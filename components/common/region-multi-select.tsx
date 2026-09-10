"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { regionsForCountry } from "@/components/common/region-select";
import { cn } from "@/lib/utils";

const normalize = (value: string) => value.trim().toLowerCase();

/** Below this many options the search box is noise; above it the list scrolls. */
const SEARCH_VISIBILITY_THRESHOLD = 7;

type RegionMultiSelectProps = {
  id?: string;
  /** Countries the owning zone covers, as ISO-2 codes or country names. */
  countries: string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  freeTextPlaceholder?: string;
  disabled?: boolean;
};

const parseCsv = (value: string) =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Region picker for a shipping zone, drawn from the same subdivision catalog the
 * checkout address form uses.
 *
 * The zone's regions are matched against the shopper's saved region by
 * lowercased label (`lib/shipping.ts`), and `RegionSelect` stores that label.
 * Typing them by hand therefore made a rate silently unreachable on any spelling
 * the catalog disagrees with — "Dhaka" against a stored "Dhaka Division" quotes
 * the country-wide zone or the fallback with no error anywhere. Picking from the
 * same list is what makes the two sides match by construction, so this stores
 * labels too, never codes.
 *
 * Values already configured that aren't in the catalog are kept and shown as
 * removable chips rather than dropped: they may be matching real addresses
 * today, and clearing them on first render would change live shipping prices.
 */
export function RegionMultiSelect({
  id,
  countries,
  value,
  onChange,
  placeholder = "All regions",
  searchPlaceholder = "Search regions...",
  emptyText = "No regions found.",
  freeTextPlaceholder = "Dhaka, Chittagong",
  disabled = false,
}: RegionMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => (Array.isArray(value) ? value.filter(Boolean) : []),
    [value],
  );
  const selectedSet = useMemo(
    () => new Set(selected.map(normalize)),
    [selected],
  );

  // Union across the zone's countries, deduped by label — matching only ever
  // looks at the label, so two countries sharing a region name share one entry.
  const options = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const country of Array.isArray(countries) ? countries : []) {
      for (const region of regionsForCountry(country)) {
        const key = normalize(region.label);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        labels.push(region.label);
      }
    }
    return labels;
  }, [countries]);

  const showSearch = options.length > SEARCH_VISIBILITY_THRESHOLD;

  const filtered = useMemo(() => {
    const q = showSearch ? normalize(query) : "";
    if (!q) return options;
    return options.filter((label) => normalize(label).includes(q));
  }, [options, query, showSearch]);

  const toggle = (label: string) => {
    const target = normalize(label);
    if (selectedSet.has(target)) {
      onChange(selected.filter((entry) => normalize(entry) !== target));
      return;
    }
    onChange([...selected, label]);
  };

  const remove = (label: string) => {
    const target = normalize(label);
    onChange(selected.filter((entry) => normalize(entry) !== target));
  };

  // No catalog for any of the zone's countries (or no countries picked yet):
  // a disabled picker would be a dead end, so the field stays free text.
  if (options.length === 0) {
    return (
      <Textarea
        id={id}
        value={selected.join(", ")}
        disabled={disabled}
        onChange={(event) => onChange(parseCsv(event.target.value))}
        placeholder={freeTextPlaceholder}
        rows={2}
      />
    );
  }

  return (
    <div className="space-y-2">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setQuery("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            disabled={disabled}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              selected.length === 0 && "text-muted-foreground",
            )}
          >
            <span className="min-w-0 truncate text-left">
              {selected.length === 0
                ? placeholder
                : selected.length === 1
                  ? selected[0]
                  : `${selected.length} regions selected`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          {showSearch ? (
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : null}
          <ScrollArea className="max-h-72" viewportClassName="max-h-72">
            <div className="p-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {emptyText}
                </div>
              ) : (
                filtered.map((label) => {
                  const isSelected = selectedSet.has(normalize(label));
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => toggle(label)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent",
                        isSelected && "bg-accent",
                      )}
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((label) => (
            <Badge
              key={label}
              variant="secondary"
              className="max-w-full gap-1 pr-1"
            >
              <span className="truncate">{label}</span>
              <button
                type="button"
                onClick={() => remove(label)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                aria-label={`Remove ${label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
