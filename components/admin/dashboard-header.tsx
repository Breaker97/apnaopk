"use client";

import * as React from "react";
import Link from "@/components/language/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, BarChart3, ShoppingBag } from "lucide-react";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/** What the subtitle says the numbers below cover, per dashboard period. */
const SUBTITLE_FALLBACK: Record<string, string> = {
  today: "Here's what's happening with your store today.",
  yesterday: "Here's what happened with your store yesterday.",
  week: "Here's what's happening with your store over the last 7 days.",
  month: "Here's what's happening with your store this month.",
  all: "Here's how your store has done all time.",
  custom: "Here's what happened with your store from {from} to {to}.",
};

/** "2026-08-27" → "27 Aug 2026", read as the UTC day the dashboard resolved. */
function formatDay(day: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00.000Z`));
}

type GreetingKey = "goodMorning" | "goodAfternoon" | "goodEvening";

function resolveGreetingKey(): GreetingKey {
  const hour = new Date().getHours();
  if (hour < 12) return "goodMorning";
  if (hour < 18) return "goodAfternoon";
  return "goodEvening";
}

/**
 * Personalized greeting + quick links shown at the top of the admin dashboard.
 * Kept in its own module so the loading skeleton can reuse it without pulling
 * in the chart-heavy dashboard content bundle.
 */
export function DashboardHeader({
  userName,
  filter,
  period,
}: {
  userName?: string;
  /** The period picker, rendered before the quick links. */
  filter?: React.ReactNode;
  /**
   * The dashboard's selected period, so the subtitle names it instead of
   * always saying "today". `from`/`to` are "YYYY-MM-DD", used for "custom".
   */
  period?: { key: string; from: string; to: string };
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  const locale = useLocale();
  const periodKey = period?.key ?? "today";
  const subtitle =
    periodKey === "custom" && period?.from && period.to
      ? label("admin.dashboardPage.subtitleFor.custom", SUBTITLE_FALLBACK.custom, {
          from: formatDay(period.from, locale),
          to: formatDay(period.to, locale),
        })
      : periodKey === "today" || !SUBTITLE_FALLBACK[periodKey]
        ? t("admin.dashboardPage.subtitle")
        : label(
            `admin.dashboardPage.subtitleFor.${periodKey}`,
            SUBTITLE_FALLBACK[periodKey],
          );

  const [greetingKey, setGreetingKey] = React.useState<GreetingKey>(
    resolveGreetingKey,
  );

  React.useEffect(() => {
    const update = () => setGreetingKey(resolveGreetingKey());
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, []);

  const displayName =
    userName?.trim() || t("common.guest");

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-2xl">
          {t(`admin.dashboardPage.${greetingKey}`, {
            name: displayName,
            defaultMessage:
              greetingKey === "goodMorning"
                ? `Good morning, ${displayName}.`
                : greetingKey === "goodAfternoon"
                  ? `Good afternoon, ${displayName}.`
                  : `Good evening, ${displayName}.`,
          })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {subtitle}
        </p>
      </div>
      <div className="flex w-full flex-wrap items-stretch gap-2 sm:w-auto sm:flex-nowrap">
        {filter ? <div className="w-full sm:w-auto">{filter}</div> : null}
        <Link
          href="/admin/analytics"
          className="group inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-3.5 text-sm font-semibold text-foreground shadow-xs transition-all hover:border-foreground/20 hover:bg-muted/60 hover:shadow-sm sm:flex-none"
        >
          <BarChart3 className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
          {t("admin.sidebar.analytics")}
          <ArrowUpRight className="size-3.5 text-muted-foreground transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground rtl:-scale-x-100" />
        </Link>
        <Link
          href="/admin/orders"
          className="group inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-[10px] bg-primary px-3.5 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 hover:shadow-sm sm:flex-none"
        >
          <ShoppingBag className="size-4" />
          {t("admin.sidebar.orders")}
          <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 rtl:-scale-x-100" />
        </Link>
      </div>
    </div>
  );
}
