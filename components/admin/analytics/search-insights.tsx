import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowUpRight, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ZERO_RESULT_REPORT_PERIODS,
  getZeroResultSearchReport,
  type ZeroResultReportPeriod,
} from "@/lib/products/zero-result-searches";
import { cn } from "@/lib/utils";
import {
  ZERO_RESULT_SEARCH_RETENTION_DAYS,
  ZERO_RESULT_SEARCH_SOURCES,
  type ZeroResultSearchSource,
} from "@/models/zero-result-search.model";

type SearchParams = Record<string, string | string[] | undefined>;

function readPeriod(value: unknown): ZeroResultReportPeriod {
  const days = Number(value);
  return (ZERO_RESULT_REPORT_PERIODS as readonly number[]).includes(days)
    ? (days as ZeroResultReportPeriod)
    : 30;
}

function readSource(value: unknown): ZeroResultSearchSource | undefined {
  return (ZERO_RESULT_SEARCH_SOURCES as readonly string[]).includes(String(value))
    ? (value as ZeroResultSearchSource)
    : undefined;
}

/** A filter pill: a link, so the report is a plain server render. */
function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * Searches that found nothing — the admin's view of what shoppers asked for
 * that the store does not sell, or sells under words they did not use.
 *
 * Server-rendered from the counters in `zeroresultsearches`; the period and
 * source filters are links, so there is no client code to ship and a URL
 * can be shared with the whole team.
 */
export async function SearchInsights({
  locale,
  basePath,
  searchParams,
}: {
  locale: string;
  /** `/admin/analytics/search` or its staff mirror, without the locale. */
  basePath: string;
  searchParams: SearchParams;
}) {
  const t = await getTranslations({ locale, namespace: "admin.searchInsights" });
  const format = await getFormatter({ locale });
  const days = readPeriod(searchParams.days);
  const source = readSource(searchParams.source);
  const { rows, total } = await getZeroResultSearchReport({ days, source });

  const hrefFor = (next: { days?: number; source?: string | null }) => {
    const params = new URLSearchParams();
    const nextDays = next.days ?? days;
    const nextSource = next.source === undefined ? source : next.source;
    if (nextDays !== 30) params.set("days", String(nextDays));
    if (nextSource) params.set("source", nextSource);
    const query = params.toString();
    return `/${locale}${basePath}${query ? `?${query}` : ""}`;
  };

  const sourceLabel = (value: ZeroResultSearchSource) =>
    value === "assistant" ? t("sources.assistant") : t("sources.storefront");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5">
            <FilterLink href={hrefFor({ source: null })} active={!source}>
              {t("sources.all")}
            </FilterLink>
            {ZERO_RESULT_SEARCH_SOURCES.map((value) => (
              <FilterLink
                key={value}
                href={hrefFor({ source: value })}
                active={source === value}
              >
                {sourceLabel(value)}
              </FilterLink>
            ))}
          </div>
          <div className="flex items-center rounded-lg border bg-muted/30 p-0.5">
            {ZERO_RESULT_REPORT_PERIODS.map((value) => (
              <FilterLink
                key={value}
                href={hrefFor({ days: value })}
                active={days === value}
              >
                {t("periods.days", { count: value })}
              </FilterLink>
            ))}
          </div>
        </div>
      </div>

      {/* The table runs edge to edge: no card padding or gap, or a blank band
          opens above the summary line. */}
      <Card className="gap-0 overflow-hidden !rounded-sm py-0">
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
              <SearchX className="h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">{t("empty.title")}</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {t("empty.description", { count: days })}
              </p>
            </div>
          ) : (
            <>
              <p className="border-b px-4 py-3 text-sm text-muted-foreground">
                {t("summary", { searches: total, terms: rows.length, count: days })}
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.term")}</TableHead>
                      <TableHead className="text-right">{t("columns.searches")}</TableHead>
                      <TableHead>{t("columns.lastSearched")}</TableHead>
                      <TableHead>{t("columns.where")}</TableHead>
                      <TableHead className="w-0" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.query}>
                        <TableCell className="max-w-[320px] truncate font-medium">
                          {row.query}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {format.number(row.count)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {format.relativeTime(new Date(row.lastSearchedAt))}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {row.sources.map((value) => (
                              <Badge key={value} variant="secondary">
                                {sourceLabel(value)}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <a
                            href={`/${locale}/products?search=${encodeURIComponent(row.query)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground"
                          >
                            {t("tryIt")}
                            <ArrowUpRight className="h-3 w-3" aria-hidden />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        {t("footnote", { retention: ZERO_RESULT_SEARCH_RETENTION_DAYS })}
      </p>
    </div>
  );
}
