"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { AppImage } from "@/components/ui/app-image";
import { type Locale } from "@/config/i18n.config";
import {
  MAX_COMPARE_PRODUCTS,
  buildCompareHref,
} from "@/lib/products/compare";
import { cn } from "@/lib/utils";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface Suggestion {
  _id: string;
  name: string;
  slug: string;
  images?: string[];
}

/**
 * How a shopper puts a product into the comparison.
 *
 * The selection lives in the URL, so picking a result is a navigation, not a
 * mutation: the comparison is shareable, survives a reload, and the back
 * button undoes it. That is also why this is the page's only stateful part —
 * everything else renders from the query string on the server.
 */
export function CompareSearch({
  locale,
  selection,
}: {
  locale: Locale;
  selection: string[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const tf = useFallbackTranslator(t);
  const isFull = selection.length >= MAX_COMPARE_PRODUCTS;

  // Debounced lookup. The abort controller matters more than the delay: a
  // slow early request landing after a fast late one would replace the
  // results with the wrong query's.
  useApplyOnChange([term, isFull], () => {
    if (term.trim().length < 2 || isFull) {
      setResults([]);
      setLoading(false);
    } else {
      setLoading(true);
    }
  });
  useEffect(() => {
    const query = term.trim();
    if (query.length < 2 || isFull) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(
        `/api/products?limit=6&search=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          const list = payload?.data?.data;
          setResults(Array.isArray(list) ? list.slice(0, 6) : []);
          setOpen(true);
        })
        .catch(() => {
          /* aborted or offline — leave the last results in place */
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, isFull]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const add = (slug: string) => {
    setTerm("");
    setResults([]);
    setOpen(false);
    router.push(buildCompareHref(locale, selection, { add: slug }));
  };

  return (
    <div ref={boxRef} className="relative mx-auto w-full max-w-[558px]">
      <div className="flex items-center gap-2 rounded-input border border-border bg-background p-1.5 ps-5">
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          disabled={isFull}
          placeholder={
            isFull
              ? tf("compare.full", "Remove a product to add another")
              : tf("compare.searchPlaceholder", "Search products...")
          }
          aria-label={tf("compare.searchLabel", "Search products to compare")}
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
        </span>
      </div>

      {open && results.length > 0 ? (
        <ul className="absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-border bg-background p-1.5 shadow-lg">
          {results.map((item) => {
            const already = selection.includes(item.slug);
            return (
              <li key={item._id}>
                <button
                  type="button"
                  onClick={() => !already && add(item.slug)}
                  disabled={already}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start transition-colors",
                    already
                      ? "cursor-not-allowed opacity-50"
                      : "hover:bg-muted",
                  )}
                >
                  <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted/50">
                    {item.images?.[0] ? (
                      <AppImage
                        src={item.images[0]}
                        alt=""
                        fill
                        sizes="40px"
                        className="object-contain p-1"
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {item.name}
                  </span>
                  {already ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {tf("compare.added", "Added")}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
