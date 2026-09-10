import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import {
  handleApiError,
  AuthenticationError,
} from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { getSettings } from "@/models";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { resolveAnalyticsConfig } from "@/lib/settings/credentials";

/**
 * GET /api/admin/analytics/plausible
 * Proxy Plausible Analytics API requests
 * Query params:
 *   - metric: aggregate | timeseries | pages | sources | realtime
 *   - period: day | 7d | 30d | month | 6mo | 12mo (default: 30d)
 *   - from/to: YYYY-MM-DD custom range override
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new AuthenticationError();
    await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.VIEW_ANALYTICS],
    );

    await connectDB();

    const settings = await getSettings();
    const analyticsSettings = settings.analytics;

    // Strip protocol and trailing slash — Plausible site_id must be bare hostname
    const domain = analyticsSettings?.plausibleDomain
      ? analyticsSettings.plausibleDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : undefined;
    // DB value wins; PLAUSIBLE_API_KEY env is the fallback.
    const apiKey = resolveAnalyticsConfig(analyticsSettings).plausibleApiKey;

    if (!domain || !apiKey) {
      return successResponse({
        configured: false,
        message: "Plausible Analytics is not configured",
      });
    }

    const baseUrl = analyticsSettings?.plausibleSelfHosted && analyticsSettings?.plausibleBaseUrl
      ? analyticsSettings.plausibleBaseUrl.replace(/\/$/, "")
      : "https://plausible.io";

    const searchParams = request.nextUrl.searchParams;
    const metric = searchParams.get("metric") || "aggregate";
    const period = searchParams.get("period") || "30d";
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const customRange =
      isDateParam(from) && isDateParam(to) && from <= to ? { from, to } : null;

    // Pass today's date explicitly so CE instances don't default to UTC date
    // which can cause rolling periods (7d, 30d) to miss same-day data
    const todayDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    const plausibleHeaders = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    // Build period query — rolling windows (day/7d/30d) need explicit date to anchor to today
    function periodParam(p: string) {
      const params = new URLSearchParams();

      if (customRange) {
        params.set("period", "custom");
        params.set("date", `${customRange.from},${customRange.to}`);
        return params.toString();
      }

      params.set("period", p);
      if (p === "day" || p === "7d" || p === "30d") {
        params.set("date", todayDate);
      }
      return params.toString();
    }

    if (metric === "realtime") {
      const res = await fetch(
        `${baseUrl}/api/v1/stats/realtime/visitors?site_id=${encodeURIComponent(domain)}`,
        { headers: plausibleHeaders, cache: "no-store" }
      );
      if (!res.ok) {
        const errText = await res.text();
        return successResponse({ configured: true, error: errText, data: null });
      }
      const visitors = await res.json();
      return successResponse({ configured: true, data: { visitors } });
    }

    const sid = `site_id=${encodeURIComponent(domain)}`;
    const pp = periodParam(period);

    if (metric === "aggregate") {
      const res = await fetch(
        `${baseUrl}/api/v1/stats/aggregate?${sid}&${pp}&metrics=visitors,pageviews,bounce_rate,visit_duration,visits`,
        { headers: plausibleHeaders, cache: "no-store" }
      );
      if (!res.ok) {
        const errText = await res.text();
        return successResponse({ configured: true, error: errText, data: null });
      }
      const data = await res.json();
      return successResponse({ configured: true, data });
    }

    if (metric === "timeseries") {
      const res = await fetch(
        `${baseUrl}/api/v1/stats/timeseries?${sid}&${pp}&metrics=visitors,pageviews`,
        { headers: plausibleHeaders, cache: "no-store" }
      );
      if (!res.ok) {
        const errText = await res.text();
        return successResponse({ configured: true, error: errText, data: null });
      }
      const data = await res.json();
      return successResponse({ configured: true, data });
    }

    if (metric === "pages") {
      const res = await fetch(
        `${baseUrl}/api/v1/stats/breakdown?${sid}&${pp}&property=event:page&metrics=visitors,pageviews&limit=10`,
        { headers: plausibleHeaders, cache: "no-store" }
      );
      if (!res.ok) {
        const errText = await res.text();
        return successResponse({ configured: true, error: errText, data: null });
      }
      const data = await res.json();
      return successResponse({ configured: true, data });
    }

    if (metric === "sources") {
      const res = await fetch(
        `${baseUrl}/api/v1/stats/breakdown?${sid}&${pp}&property=visit:source&metrics=visitors&limit=10`,
        { headers: plausibleHeaders, cache: "no-store" }
      );
      if (!res.ok) {
        const errText = await res.text();
        return successResponse({ configured: true, error: errText, data: null });
      }
      const data = await res.json();
      return successResponse({ configured: true, data });
    }

    if (metric === "countries") {
      const res = await fetch(
        `${baseUrl}/api/v1/stats/breakdown?${sid}&${pp}&property=visit:country&metrics=visitors&limit=10`,
        { headers: plausibleHeaders, cache: "no-store" }
      );
      if (!res.ok) {
        const errText = await res.text();
        return successResponse({ configured: true, error: errText, data: null });
      }
      const data = await res.json();
      return successResponse({ configured: true, data });
    }

    if (metric === "browsers") {
      const res = await fetch(
        `${baseUrl}/api/v1/stats/breakdown?${sid}&${pp}&property=visit:browser&metrics=visitors&limit=10`,
        { headers: plausibleHeaders, cache: "no-store" }
      );
      if (!res.ok) {
        const errText = await res.text();
        return successResponse({ configured: true, error: errText, data: null });
      }
      const data = await res.json();
      return successResponse({ configured: true, data });
    }

    if (metric === "os") {
      const res = await fetch(
        `${baseUrl}/api/v1/stats/breakdown?${sid}&${pp}&property=visit:os&metrics=visitors&limit=10`,
        { headers: plausibleHeaders, cache: "no-store" }
      );
      if (!res.ok) {
        const errText = await res.text();
        return successResponse({ configured: true, error: errText, data: null });
      }
      const data = await res.json();
      return successResponse({ configured: true, data });
    }

    if (metric === "devices") {
      const res = await fetch(
        `${baseUrl}/api/v1/stats/breakdown?${sid}&${pp}&property=visit:device&metrics=visitors&limit=10`,
        { headers: plausibleHeaders, cache: "no-store" }
      );
      if (!res.ok) {
        const errText = await res.text();
        return successResponse({ configured: true, error: errText, data: null });
      }
      const data = await res.json();
      return successResponse({ configured: true, data });
    }

    return successResponse({ configured: true, error: "Unknown metric", data: null });
  } catch (error) {
    return handleApiError(error);
  }
}

function isDateParam(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime());
}
