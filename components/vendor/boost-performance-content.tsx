"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  CalendarClock,
  Eye,
  MousePointerClick,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DashboardStatsGrid,
  type DashboardStatCardItem,
} from "@/components/admin/dashboard-stat-card";
import {
  BoostStatusBadge,
  formatBoostWindow,
} from "@/components/vendor/boosts-content";
import { BoostOccupancyStrip } from "@/components/admin/boost-occupancy-strip";
import type { BoostCampaignListRow } from "@/lib/boosts/boost-campaign-list";
import type { BoostCampaignStats } from "@/lib/boosts/boost-metrics";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

/**
 * Per-campaign performance view: totals, where the booking is in its runtime,
 * the daily impressions/clicks chart (mirrors the vendor dashboard's salesByDay
 * chart shape), and the booked-days strip that says what actually rendered.
 */
export function BoostPerformanceContent(props: {
  locale: string;
  campaign: BoostCampaignListRow;
  stats: BoostCampaignStats;
  /** This booking's own BoostSlotDay rows, ascending. */
  bookedDays: string[];
  /** Days the storefront could not render the product, with the failed share. */
  unservedDays: Array<{ day: string; share: number }>;
}) {
  const t = useTranslations();
  const label = useFallbackTranslator(t);
  // Interpolating messages must go through `t()` itself — the ICU formatter
  // throws on a placeholder with no value, and the fallback never reaches it.
  const labelWith = (
    key: string,
    fallback: string,
    values: Record<string, string | number>,
  ) =>
    t.has(key)
      ? t(key, values)
      : Object.entries(values).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          fallback,
        );
  const { campaign, stats } = props;

  // Captured once per mount — the runtime figures must not drift between
  // re-renders (react-hooks/purity).
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  const dayDiff = (from: string, to: string) =>
    Math.round(
      (Date.parse(`${to}T00:00:00.000Z`) -
        Date.parse(`${from}T00:00:00.000Z`)) /
        86_400_000,
    );

  // One card, three meanings. A fourth card would leave two of them empty at
  // any given moment, and "Days remaining: —" on a booking that starts next
  // month is the exact confusion the scheduled status exists to remove.
  const runtime = (() => {
    if (campaign.status === "scheduled" && campaign.startDay) {
      const days = Math.max(0, dayDiff(today, campaign.startDay));
      return {
        label: label("boosts.performance.startsIn", "Starts in"),
        value: labelWith("boosts.performance.inDays", "{days} days", { days }),
      };
    }
    if (
      (campaign.status === "active" || campaign.status === "paused") &&
      campaign.endDay
    ) {
      return {
        label: label("boosts.performance.daysRemaining", "Days remaining"),
        value: String(Math.max(0, dayDiff(today, campaign.endDay) + 1)),
      };
    }
    return {
      label: label("boosts.performance.daysRan", "Days run"),
      value: String(props.bookedDays.filter((day) => day <= today).length),
    };
  })();

  const statItems: DashboardStatCardItem[] = [
    {
      id: "impressions",
      label: label("boosts.stats.impressions", "Impressions"),
      value: stats.totals.impressions.toLocaleString(),
      icon: <Eye className="h-5 w-5" />,
    },
    {
      id: "clicks",
      label: label("boosts.stats.clicks", "Clicks"),
      value: stats.totals.clicks.toLocaleString(),
      icon: <MousePointerClick className="h-5 w-5" />,
    },
    {
      id: "ctr",
      label: label("boosts.stats.ctr", "CTR"),
      value: stats.totals.impressions
        ? `${(stats.totals.ctr * 100).toFixed(1)}%`
        : "—",
      icon: <TrendingUp className="h-5 w-5" />,
    },
    {
      id: "runtime",
      label: runtime.label,
      value: runtime.value,
      icon: <CalendarClock className="h-5 w-5" />,
    },
  ];

  // A day is "credited" only when the whole day failed; anything in between is
  // partial, because a booking that rendered for eight hours is not the same
  // claim as one that never rendered at all.
  const unservedByDay = new Map(
    props.unservedDays.map((row) => [row.day, row.share]),
  );
  const occupancyDays = props.bookedDays.map((day) => {
    const share = unservedByDay.get(day) ?? 0;
    return {
      day,
      state:
        share >= 1
          ? ("credited" as const)
          : share > 0
            ? ("partial" as const)
            : ("served" as const),
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/${props.locale}/vendor/boosts`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {label("boosts.performance.back", "All boosts")}
        </Link>
      </div>

      <div className="flex items-center gap-4">
        {campaign.product?.image ? (
          <Image
            src={campaign.product.image}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 rounded-lg object-cover"
          />
        ) : (
          <div className="h-14 w-14 rounded-lg bg-muted" />
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">
            {campaign.product?.name || "—"}
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            #{campaign.positionSnapshot.position} ·{" "}
            {campaign.positionSnapshot.label}
            <span>·</span>
            {formatBoostWindow(campaign, props.locale)}
            <BoostStatusBadge status={campaign.status} />
          </p>
        </div>
      </div>

      <DashboardStatsGrid stats={statItems} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {label("boosts.performance.chartTitle", "Daily performance")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.byDay.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {label(
                "boosts.performance.noData",
                "No activity recorded yet. Data appears as shoppers see your sponsored product.",
              )}
            </p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.byDay}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="impressions"
                    name={label("boosts.stats.impressions", "Impressions")}
                    fill="hsl(var(--primary))"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="clicks"
                    name={label("boosts.stats.clicks", "Clicks")}
                    fill="hsl(var(--muted-foreground))"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {occupancyDays.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {label("boosts.performance.bookedDays", "Booked days")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <BoostOccupancyStrip
              dayList={props.bookedDays}
              bookedDays={occupancyDays}
              labels={{
                summary: (booked, total) =>
                  labelWith(
                    "boosts.performance.daysBooked",
                    "{booked} of {total} days held",
                    { booked, total },
                  ),
                nextFree: () => "",
                fullyBooked: "",
              }}
            />
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-2 rounded-[2px] bg-primary" />
                {label("boosts.performance.legendServed", "Served")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-2 rounded-[2px] bg-amber-500" />
                {label("boosts.performance.legendPartial", "Partly credited")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-2 rounded-[2px] bg-destructive" />
                {label("boosts.performance.legendCredited", "Credited")}
              </span>
            </div>
            {campaign.refundableAmount > 0 ? (
              <p className="text-xs text-muted-foreground">
                {label(
                  "boosts.performance.creditNote",
                  "Credited days are refunded through your payment provider.",
                )}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {stats.byPlacement.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {label("boosts.performance.placements", "By placement")}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            {stats.byPlacement.map((row) => (
              <div key={row.placement} className="rounded-lg border p-3">
                <p className="text-sm font-medium">
                  {row.placement === "home"
                    ? label("boosts.performance.placementHome", "Home page")
                    : row.placement === "pdp"
                      ? label(
                          "boosts.performance.placementPdp",
                          "Product pages",
                        )
                      : label(
                          "boosts.performance.placementListing",
                          "Listings",
                        )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.impressions.toLocaleString()}{" "}
                  {label(
                    "boosts.stats.impressions",
                    "Impressions",
                  ).toLowerCase()}{" "}
                  · {row.clicks.toLocaleString()}{" "}
                  {label("boosts.stats.clicks", "Clicks").toLowerCase()}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
