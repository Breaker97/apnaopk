import * as z from "zod";
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import {
  CAMPAIGN_ID,
  MAX_SPONSORED_EVENTS,
  recordSponsoredEvents,
  SPONSORED_PLACEMENT_VALUES,
} from "@/lib/boosts/sponsored-metrics";

const EventSchema = z.object({
  /** campaignId — hex-validated so ObjectId construction can never throw
   * (a 24-char non-hex string would break the always-204 contract). */
  c: z.string().regex(CAMPAIGN_ID),
  /** placement */
  p: z.enum(SPONSORED_PLACEMENT_VALUES),
  /** type */
  t: z.enum(["imp", "clk"]),
});

const PayloadSchema = z.object({
  events: z.array(EventSchema).min(1).max(MAX_SPONSORED_EVENTS),
});

// Obvious automation only. What is sold is a position for a range of days, so
// these counts are reporting-grade (vendor ROI) and nothing is billed on them —
// heavier fraud defenses belong to a CPC model.
const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|pingdom|curl|wget|python-requests/i;

/**
 * POST /api/track/sponsored
 * Impression/click beacon for sponsored placements. Fire-and-forget by
 * contract: always 204, never an error the client would surface. Counted by
 * lib/boosts/sponsored-metrics.ts, which the shopper app's events endpoint
 * shares. Server-side on purpose: ad blockers eat client analytics, and
 * vendors are shown these numbers as the return on money they paid.
 */
export const POST = withApi(
  {
    auth: "optional",
    rateLimit: { action: "track:sponsored", preset: "lenient" },
  },
  async ({ request }) => {
    const userAgent = request.headers.get("user-agent") || "";
    if (!userAgent || BOT_UA.test(userAgent)) {
      return new NextResponse(null, { status: 204 });
    }

    const body = await request.json().catch(() => null);
    const parsed = PayloadSchema.safeParse(body);
    if (!parsed.success) {
      return new NextResponse(null, { status: 204 });
    }

    await recordSponsoredEvents(
      parsed.data.events.map((event) => ({
        campaignId: event.c,
        placement: event.p,
        type: event.t,
      })),
    );
    return new NextResponse(null, { status: 204 });
  },
);
