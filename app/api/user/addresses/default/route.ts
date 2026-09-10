import { mongoose } from "@/lib/db";
import { ObjectId } from "mongodb";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import {
  resolveAddressIndex,
  serializeAddresses,
} from "@/lib/customers/saved-addresses";

// Accepts an id, falling back to a position for addresses saved before the
// sub-schema carried one. Setting a default by index was the most dangerous of
// the index-based operations: it silently promotes whichever address moved into
// that slot, and checkout then auto-fills it.
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
    const db = mongoose.connection.db;
    if (!db) throw new Error("Database not connected");

    const { id, index: rawIndex } = await validateBody(
      request,
      SetDefaultAddressBodySchema,
    );

    // Get current addresses
    const user = await db
      .collection("user")
      .findOne({ _id: new ObjectId(session.user.id) });

    if (!user?.addresses) {
      return successResponse({ addresses: [] }, "No addresses found");
    }

    const index = resolveAddressIndex(user.addresses, { id, index: rawIndex });
    if (index === null) {
      throw new ValidationError({ index: ["Invalid address index"] });
    }

    // Update all addresses, setting only the selected one as default
    const updatedAddresses = user.addresses.map(
      (addr: { isDefault?: boolean }, i: number) => ({
        ...addr,
        isDefault: i === index,
      }),
    );

    await db
      .collection("user")
      .updateOne(
        { _id: new ObjectId(session.user.id) },
        { $set: { addresses: updatedAddresses } },
      );

    return successResponse(
      { addresses: serializeAddresses(updatedAddresses) },
      "Default address updated",
    );
  },
);
