"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/** One page across all currency sections; totals always cover the full period. */
export function VendorStatementPagination({
  page, pageSize, total, shown, href,
}: {
  page: number;
  pageSize: number;
  total: number;
  shown: number;
  href: string;
}) {
  const label = useFallbackTranslator(useTranslations());
  if (total <= pageSize && page === 1) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (value: number) => {
    const [path, query] = href.split("?");
    const params = new URLSearchParams(query);
    if (value > 1) params.set("page", String(value));
    else params.delete("page");
    return `${path}?${params}`;
  };
  return (
    <nav aria-label={label("finance.statement.pagination", "Statement pages")} className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-xs text-muted-foreground">
        {label("finance.statement.pageEntries", "Showing {from}–{to} of {total} entries. Balances cover the whole period.", {
          from: shown ? (page - 1) * pageSize + 1 : 0,
          to: shown ? (page - 1) * pageSize + shown : 0,
          total,
        })}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? <Button asChild size="sm" variant="outline"><Link href={pageHref(Math.min(page - 1, pages))}><ChevronLeft className="size-4" />{label("common.previous", "Previous")}</Link></Button> : <Button size="sm" variant="outline" disabled><ChevronLeft className="size-4" />{label("common.previous", "Previous")}</Button>}
        {page < pages ? <Button asChild size="sm" variant="outline"><Link href={pageHref(page + 1)}>{label("common.next", "Next")}<ChevronRight className="size-4" /></Link></Button> : <Button size="sm" variant="outline" disabled>{label("common.next", "Next")}<ChevronRight className="size-4" /></Button>}
      </div>
    </nav>
  );
}
