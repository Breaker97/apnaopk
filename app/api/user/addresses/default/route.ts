import { successResponse } from "@/lib/api/response";
import * as z from "zod";
import { validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { serializeAddresses } from "@/lib/customers/saved-addresses";
import { setDefaultAddress } from "@/lib/customers/address-book";

// Accepts an id, falling back to a position for addresses saved before the
// sub-schema carried one. See `setDefaultAddress` for why the id is preferred.
const SetDefaultAddressBodySchema = z.object({
  id: z.string().trim().min(1).optional(),
  index: z.coerce.number().int().min(0).optional(),
});

/**
 * PUT /api/user/addresses/default
 * Set default address
 */
export const PUT = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const { id, index } = await validateBody(request, SetDefaultAddressBodySchema);
    const addresses = await setDefaultAddress(session.user.id, { id, index });
    if (!addresses) {
      return successResponse({ addresses: [] }, "No addresses found");
    }
    return successResponse(
      { addresses: serializeAddresses(addresses) },
      "Default address updated",
    );
  },
);
