"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_FINAL_SALE_COLLECTIONS } from "@/lib/returns/final-sale";

type CollectionOption = { _id: string; title: string };

/**
 * The collections the store sells as final sale (Settings → Orders →
 * Returns). Picked the way a product's own collections are: search, pick,
 * remove from the chips. Every product in one of them is final sale on the
 * orders placed from then on — see lib/returns/final-sale.ts.
 */
export function FinalSaleCollectionsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CollectionOption[]>([]);
  // Titles of every collection seen, so a chip keeps its name once the list
  // has moved on to another search.
  const [titles, setTitles] = useState<Record<string, string>>({});
  // The unfiltered list came back whole, so a saved id missing from it is a
  // collection that no longer exists rather than one beyond the first page.
  const [listComplete, setListComplete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        // No `kind` filter: collections saved before kinds existed carry none,
        // and would never be offered.
        const params = new URLSearchParams({ limit: "100" });
        if (query.trim()) params.set("search", query.trim());
        const res = await fetch(`/api/admin/collections?${params.toString()}`);
        const data = await res.json().catch(() => null);
        // A paginated answer: `{ data: { data: rows, pagination } }`.
        const rows = data?.data?.data;
        if (cancelled || !res.ok || !Array.isArray(rows)) return;
        const next = (rows as Array<{ _id?: unknown; title?: unknown }>)
          .map((row) => ({ _id: String(row._id ?? ""), title: String(row.title ?? "") }))
          .filter((row) => row._id);
        setOptions(next);
        if (!query.trim()) setListComplete(next.length < 100);
        setTitles((current) => ({
          ...current,
          ...Object.fromEntries(next.map((row) => [row._id, row.title])),
        }));
      } catch {
        // The chips still show what is saved; the list simply stays as it was.
      }
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const selected = useMemo(() => new Set(value), [value]);
  const choices = options.filter((option) => !selected.has(option._id));
  const full = value.length >= MAX_FINAL_SALE_COLLECTIONS;

  return (
    <div className="space-y-2">
      <Label htmlFor="finalSaleCollections">
        {t("admin.settings.orders.finalSaleCollections")}
      </Label>
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            window.setTimeout(() => setOpen(false), 150);
          }
        }}
      >
        <Input
          id="finalSaleCollections"
          value={query}
          disabled={full}
          placeholder={t("admin.settings.orders.finalSaleCollectionsSearch")}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {open && !full ? (
          <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
            {choices.length > 0 ? (
              choices.map((option) => (
                <button
                  key={option._id}
                  type="button"
                  className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    onChange([...value, option._id]);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  {option.title}
                </button>
              ))
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">
                {t("admin.settings.orders.finalSaleCollectionsNone")}
              </p>
            )}
          </div>
        ) : null}
      </div>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.map((id) => (
            <Badge
              key={id}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => onChange(value.filter((entry) => entry !== id))}
            >
              {titles[id] ||
                (listComplete
                  ? t("admin.settings.orders.finalSaleCollectionMissing")
                  : t("admin.settings.orders.finalSaleCollectionUnnamed"))}
              <X className="ml-1 h-3 w-3" />
            </Badge>
          ))}
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {t("admin.settings.orders.finalSaleCollectionsHint")}
      </p>
    </div>
  );
}
