"use client";

import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "@/hooks/use-locale-navigation";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * Which ledger book a finance screen reads, held in the URL's `book`.
 *
 * Split from the period picker so a screen can take the dashboard's period
 * control and still offer this one: they answer different questions and share
 * nothing but the query string.
 */
export function FinanceBookFilter({ book }: { book: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const label = useFallbackTranslator(t);

  const setBook = (value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value) params.delete("book");
    else params.set("book", value);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <Select
      // Normalized, not passed straight through: callers say "all" or
      // nothing at all for the unfiltered case, and a value matching no
      // item renders the trigger EMPTY rather than falling back — which is
      // what it did until someone looked at the screen.
      value={book === "own" || book === "marketplace" ? book : "all-books"}
      onValueChange={(value) => setBook(value === "all-books" ? null : value)}
    >
      <SelectTrigger className="w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all-books">
          {label("finance.book.all", "Both books")}
        </SelectItem>
        <SelectItem value="own">
          {label("finance.book.own", "Own store")}
        </SelectItem>
        <SelectItem value="marketplace">
          {label("finance.book.marketplace", "Marketplace")}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
