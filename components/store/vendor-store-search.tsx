"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { usePathname, useRouter } from "@/hooks/use-locale-navigation";
import { cn } from "@/lib/utils";

/**
 * Search within one vendor's store. The storefront page already reads
 * `?search=` into its product grid; this is the box that sets it. Every other
 * param (filters, sort, the tab) is kept, and the page resets to 1 the way
 * every other grid control does.
 */
export function VendorStoreSearch({
  initialQuery,
  labels,
  className,
}: {
  initialQuery: string;
  labels: { placeholder: string; clear: string };
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);

  const go = (query: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (query) params.set("search", query);
    else params.delete("search");
    params.delete("page");
    const next = params.toString();
    router.push(next ? `${pathname}?${next}` : pathname, { scroll: false });
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    go(value.trim());
  };

  return (
    <form
      role="search"
      onSubmit={onSubmit}
      className={cn("relative w-full sm:w-64", className)}
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={labels.placeholder}
        aria-label={labels.placeholder}
        maxLength={120}
        className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            setValue("");
            if (initialQuery) go("");
          }}
          aria-label={labels.clear}
          className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </form>
  );
}
