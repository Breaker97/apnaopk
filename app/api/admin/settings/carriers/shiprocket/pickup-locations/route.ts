import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { resolveCarrierContext } from "@/lib/shipping/carriers/credentials";
import { CarrierError } from "@/lib/shipping/carriers/errors";
import {
  shiprocketAuthenticate,
  shiprocketPickupLocations,
} from "@/lib/shipping/carriers/shiprocket";

/**
 * GET /api/admin/settings/carriers/shiprocket/pickup-locations
 *
 * Shiprocket dispatches from a nickname registered in their own dashboard, not
 * from an address we send. This lists the nicknames on the account so the
 * settings form can offer a picker instead of a free-text field nobody can
 * guess correctly.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:settings:carrier-pickup", preset: "strict" },
  },
  async () => {
    const context = await resolveCarrierContext({
      provider: "shiprocket",
      ignoreEnabled: true,
    });

    try {
      const token = await shiprocketAuthenticate(context);
      const locations = await shiprocketPickupLocations({ token });
      return successResponse({ locations });
    } catch (error) {
      if (error instanceof CarrierError) {
        throw new ValidationError(error.message);
      }
      throw error;
    }
  },
);
