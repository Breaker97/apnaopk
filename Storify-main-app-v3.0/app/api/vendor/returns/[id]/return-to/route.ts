import { withApi } from "@/lib/api/handler";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { loadReturnForRoute } from "@/lib/returns/return-route-access";
import {
  defaultReturnLocation,
  fallbackReturnDestination,
  listReturnLocations,
} from "@/lib/returns/return-destination";
import { customReturnInstructions } from "@/lib/returns/return-shipping";

/**
 * Where this return's parcel may be sent, for the seller's approve dialog: the
 * owner's locations with the one it would go to by default, or — for an owner
 * with no location — the address its parcels ship from.
 */
export const GET = withApi<{ id: string }>(
  {
    auth: "user",
    rateLimit: { action: "vendor:returns:return-to", preset: "lenient" },
  },
  async ({ params, session }) => {
    await connectDB();
    const returnRequest = await loadReturnForRoute({
      scope: "vendor",
      user: session.user,
      id: params.id,
      mode: "read",
    });
    if (!returnRequest) return notFoundResponse("Return request");

    const settings = await getSettings();
    const locations = await listReturnLocations(returnRequest);
    const preferred = await defaultReturnLocation(returnRequest, locations);
    return successResponse({
      locations,
      defaultLocationId: preferred?._id ?? null,
      fallback:
        locations.length === 0
          ? await fallbackReturnDestination(returnRequest, settings)
          : null,
      instructions: customReturnInstructions(settings) ?? null,
    });
  },
);
