"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  MAX_RETURN_WINDOW_DAYS,
  MIN_RETURN_WINDOW_DAYS,
} from "@/lib/returns/return-policy";
import { MAX_RETURN_WINDOW_OVERRIDES } from "@/lib/returns/return-window";
import { SettingBlock } from "./setting-row";

type CollectionOption = { _id: string; title: string };
type Override = { collectionId: string; windowDays: number };

/**
 * Collections with a return window of their own (Settings → Orders →
 * Returns, R6). A product in one of them — or with its own window — is
 * returnable for that many days instead of the store's; where several apply,
 * the shortest does. Orders already placed keep the window they were sold
 * with (lib/returns/return-window.ts).
 */
export function ReturnWindowOverridesField({
  value,
  defaultDays,
  onChange,
}: {
  value: Override[];
  /** What a newly added collection starts on: the store's own window. */
  defaultDays: number;
  onChange: (next: Override[]) => void;
}) {
  const t = useTranslations();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CollectionOption[]>([]);
  // Titles of every collection seen, so a row keeps its name once the list
  // has moved on to another search.
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [listComplete, setListComplete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        // No `kind` filter: collections saved before kinds existed carry none.
        const params = new URLSearchParams({ limit: "100" });
        if (query.trim()) params.set("search", query.trim());
        const res = await fetch(`/api/admin/collections?${params.toString()}`);
        const data = await res.json().catch(() => null);
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
        // The rows still show what is saved; the list simply stays as it was.
      }
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const chosen = useMemo(() => new Set(value.map((entry) => entry.collectionId)), [value]);
  const choices = options.filter((option) => !chosen.has(option._id));
  const full = value.length >= MAX_RETURN_WINDOW_OVERRIDES;

  return (
    <SettingBlock
      inputId="returnWindowOverrides"
      label={t("admin.settings.orders.windowOverrides")}
      hint={t("admin.settings.orders.windowOverridesHint")}
    >
      {value.length > 0 ? (
        <div className="space-y-2">
          {value.map((entry) => {
            const title =
              titles[entry.collectionId] ||
              (listComplete
                ? t("admin.settings.orders.finalSaleCollectionMissing")
                : t("admin.settings.orders.finalSaleCollectionUnnamed"));
            return (
              <div
                key={entry.collectionId}
                className="bg-muted/30 flex items-center gap-2 rounded-lg border py-1.5 ps-3.5 pe-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {title}
                </span>
                <NumberInput
                  aria-label={`${title}: ${t("admin.settings.orders.windowOverrideDays")}`}
                  className="h-8 w-20"
                  min={MIN_RETURN_WINDOW_DAYS}
                  max={MAX_RETURN_WINDOW_DAYS}
                  step={1}
                  value={entry.windowDays}
                  whenEmpty={defaultDays}
                  onValueChange={(next) =>
                    onChange(
                      value.map((row) =>
                        row.collectionId === entry.collectionId
                          ? { ...row, windowDays: next ?? defaultDays }
                          : row,
                      ),
                    )
                  }
                />
                <span className="text-muted-foreground text-sm">
                  {t("admin.settings.orders.windowOverrideDaysUnit")}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={`${t("admin.settings.orders.windowOverrideRemove")}: ${title}`}
                  onClick={() =>
                    onChange(value.filter((row) => row.collectionId !== entry.collectionId))
                  }
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div
        className="relative w-full @md:w-72"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            window.setTimeout(() => setOpen(false), 150);
          }
        }}
      >
        <Plus
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
        />
        <Input
          id="returnWindowOverrides"
          className="ps-9"
          value={query}
          disabled={full}
          placeholder={t("admin.settings.orders.windowOverridesSearch")}
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
                    onChange([
                      ...value,
                      { collectionId: option._id, windowDays: defaultDays },
                    ]);
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
    </SettingBlock>
  );
}
