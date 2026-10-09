import {
  SponsoredEventsRequest,
  SponsoredEventsResult,
} from "@/contracts/mobile/shop/v1/home";
import { defineRoute } from "@/lib/api-core/registry";
import {
  recordSponsoredEvents,
  type SponsoredPlacement,
} from "@/lib/boosts/sponsored-metrics";
import { BOOST_PLACEMENT } from "@/config/app.config";

const PLACEMENTS: Record<SponsoredEventsRequest["events"][number]["placement"], SponsoredPlacement> = {
  HOME: BOOST_PLACEMENT.HOME,
  LISTING: BOOST_PLACEMENT.LISTING,
  PRODUCT_PAGE: BOOST_PLACEMENT.PRODUCT_PAGE,
};

/**
 * POST /events/sponsored: the app's impressions and clicks of paid cards,
 * counted by the same code as the web's beacon (lib/boosts/sponsored-metrics.ts).
 * Signed in or not; the counts are the vendors' reporting, never billed.
 */
export const sponsoredEventsRoute = defineRoute({
  id: "home.events.sponsored",
  method: "POST",
  path: "/events/sponsored",
  auth: "optional",
  cache: { kind: "private" },
  rateLimit: { bucket: "track:sponsored", preset: "lenient" },
  demo: "default",
  input: SponsoredEventsRequest,
  output: SponsoredEventsResult,
  handler: async ({ input }) => {
    const recorded = await recordSponsoredEvents(
      input.events.map((event) => ({
        campaignId: event.campaignId,
        placement: PLACEMENTS[event.placement],
        type: event.kind === "CLICK" ? "clk" : "imp",
      })),
    );
    return { recorded };
  },
});
