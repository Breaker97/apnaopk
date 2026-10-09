import "server-only";
import { connectDB } from "@/lib/db";
import { getSettingsLean } from "@/models";
import type { IAnalyticsSettings } from "@/models/settings.model";
import { resolveAnalyticsConfig } from "@/lib/settings/credentials";
import type {
  TrafficAggregate,
  TrafficBreakdownRow,
  TrafficOverview,
  TrafficPoint,
  TrafficQuery,
} from "@/lib/analytics/traffic-overview";

/** Plausible is a third party on the critical path of a page; never wait forever. */
const PLAUSIBLE_TIMEOUT_MS = 6000;

const BREAKDOWN_LIMIT = 10;

/** Where the store's Plausible stats live. */
export interface PlausibleSite {
  baseUrl: string;
  domain: string;
  apiKey: string;
}

/** The store's Plausible site, or null until both a domain and an API key are set. */
export function resolvePlausibleSite(
  analytics?: Partial<IAnalyticsSettings> | null,
): PlausibleSite | null {
  // Plausible's site_id is the bare hostname: no protocol, no trailing slash.
  const domain = analytics?.plausibleDomain
    ?.replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  // DB value wins; PLAUSIBLE_API_KEY env is the fallback.
  const apiKey = resolveAnalyticsConfig(analytics).plausibleApiKey;
  if (!domain || !apiKey) return null;

  const baseUrl =
    analytics?.plausibleSelfHosted && analytics?.plausibleBaseUrl
      ? analytics.plausibleBaseUrl.replace(/\/$/, "")
      : "https://plausible.io";
  return { baseUrl, domain, apiKey };
}

/**
 * GET one Plausible v1 stats endpoint (`aggregate`, `timeseries`, `breakdown`,
 * `realtime/visitors`) for the site. The caller picks the caching.
 */
export function fetchPlausibleStats(
  site: PlausibleSite,
  endpoint: string,
  query: string,
  init: Pick<RequestInit, "cache" | "next">,
): Promise<Response> {
  const siteId = `site_id=${encodeURIComponent(site.domain)}`;
  return fetch(
    `${site.baseUrl}/api/v1/stats/${endpoint}?${siteId}${query ? `&${query}` : ""}`,
    {
      ...init,
      headers: { Authorization: `Bearer ${site.apiKey}` },
      signal: AbortSignal.timeout(PLAUSIBLE_TIMEOUT_MS),
    },
  );
}

async function loadStoreSite(): Promise<PlausibleSite | null> {
  await connectDB();
  const settings = await getSettingsLean();
  return resolvePlausibleSite(settings.analytics);
}

/** One live stats read; null when Plausible errors, times out or is unreachable. */
async function readLiveStats<T>(
  site: PlausibleSite,
  endpoint: string,
  query: string,
): Promise<T | null> {
  try {
    const response = await fetchPlausibleStats(site, endpoint, query, {
      cache: "no-store",
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Plausible's v1 API has no "all time" period. Its own launch year is the
 * floor of a custom range instead, so no day with traffic falls outside it.
 */
const ALL_TIME_START = "2019-01-01";

const isAllTime = (query: TrafficQuery) =>
  "period" in query && query.period === "all";

/**
 * Plausible's period parameters. Rolling windows (day/7d/30d) carry today's
 * date explicitly so a CE instance anchors them to today instead of its own
 * default and does not miss same-day data.
 */
function plausiblePeriod(query: TrafficQuery): string {
  const today = new Date().toISOString().slice(0, 10);
  if ("from" in query) {
    // Only the `day` period is read by the hour: a custom range of one day
    // comes back as a single bucket, a chart of one point.
    return query.from === query.to
      ? `period=day&date=${query.from}`
      : `period=custom&date=${query.from},${query.to}`;
  }
  const { period } = query;
  if (period === "all") {
    return `period=custom&date=${ALL_TIME_START},${today}`;
  }
  if (period === "day" || period === "7d" || period === "30d") {
    return `period=${period}&date=${today}`;
  }
  return `period=${period}`;
}

/** All time is drawn by the month, from the first month with traffic. */
function dropLeadingEmptyMonths(points: TrafficPoint[]): TrafficPoint[] {
  const first = points.findIndex(
    (point) => point.visitors > 0 || point.pageviews > 0,
  );
  return first === -1 ? [] : points.slice(first);
}

/**
 * Everything the traffic page shows for one period: one settings read, then
 * every Plausible request in parallel. A section Plausible fails to answer
 * comes back empty instead of failing the page; `unavailable` marks the case
 * where none answered.
 */
export async function loadTrafficOverview(
  query: TrafficQuery,
): Promise<TrafficOverview> {
  const site = await loadStoreSite();
  if (!site) return { configured: false };

  const period = plausiblePeriod(query);
  const allTime = isAllTime(query);
  const breakdown = (property: string, metrics = "visitors") =>
    readLiveStats<{ results?: TrafficBreakdownRow[] }>(
      site,
      "breakdown",
      `${period}&property=${property}&metrics=${metrics}&limit=${BREAKDOWN_LIMIT}`,
    );

  const answers = await Promise.all([
    readLiveStats<{ results?: TrafficAggregate }>(
      site,
      "aggregate",
      `${period}&metrics=visitors,pageviews,bounce_rate,visit_duration,visits`,
    ),
    readLiveStats<{ results?: TrafficPoint[] }>(
      site,
      "timeseries",
      `${period}&metrics=visitors,pageviews${allTime ? "&interval=month" : ""}`,
    ),
    breakdown("event:page", "visitors,pageviews"),
    breakdown("visit:source"),
    breakdown("visit:country"),
    breakdown("visit:browser"),
    breakdown("visit:os"),
    breakdown("visit:device"),
    readLiveStats<unknown>(site, "realtime/visitors", ""),
  ]);
  const [
    aggregate,
    timeseries,
    pages,
    sources,
    countries,
    browsers,
    os,
    devices,
    realtime,
  ] = answers;

  return {
    configured: true,
    unavailable: answers.every((answer) => answer === null),
    aggregate: aggregate?.results ?? null,
    timeseries: allTime
      ? dropLeadingEmptyMonths(timeseries?.results ?? [])
      : (timeseries?.results ?? []),
    pages: pages?.results ?? [],
    sources: sources?.results ?? [],
    countries: countries?.results ?? [],
    browsers: browsers?.results ?? [],
    os: os?.results ?? [],
    devices: devices?.results ?? [],
    realtimeVisitors: typeof realtime === "number" ? realtime : null,
  };
}

/** Visitors on the site right now; null when unconfigured or unreachable. */
export async function loadRealtimeVisitors(): Promise<number | null> {
  const site = await loadStoreSite();
  if (!site) return null;
  const visitors = await readLiveStats<unknown>(site, "realtime/visitors", "");
  return typeof visitors === "number" ? visitors : null;
}
