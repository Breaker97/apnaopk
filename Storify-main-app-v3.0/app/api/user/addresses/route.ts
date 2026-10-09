import * as z from "zod";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { AddressSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";
import { serializeAddresses } from "@/lib/customers/saved-addresses";
import {
  addAddress,
  deleteAddress,
  readAddresses,
  updateAddress,
} from "@/lib/customers/address-book";

const AddAddressBodySchema = z.object({
  address: AddressSchema,
});

// `id` is preferred and `index` is the legacy fallback for addresses saved
// before the sub-schema carried one; see `lib/saved-addresses.ts`. Both are
// optional at the schema level so the resolver can decide, which keeps one
// "invalid address" error shape instead of two different validation failures.
const UpdateAddressBodySchema = z.object({
  id: z.string().trim().min(1).optional(),
  index: z.coerce.number().int().min(0).optional(),
  address: AddressSchema,
});

const DeleteAddressBodySchema = z.object({
  id: z.string().trim().min(1).optional(),
  index: z.coerce.number().int().min(0).optional(),
});

/**
 * GET /api/user/addresses
 * Get user's addresses
 */
export const GET = withApi(
  { auth: "user" },
  async ({ session }) => {
    const addresses = await readAddresses(session.user.id);
    return successResponse({ addresses: serializeAddresses(addresses) });
  },
);

/**
 * POST /api/user/addresses
 * Add new address
 */
export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const { address } = await validateBody(request, AddAddressBodySchema);
    const addresses = await addAddress(session.user.id, address);
    return successResponse(
      { addresses: serializeAddresses(addresses) },
      "Address added successfully",
    );
  },
);

/**
 * PUT /api/user/addresses
 * Update existing address
 */
export const PUT = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const { id, index, address } = await validateBody(
      request,
      UpdateAddressBodySchema,
    );
    const addresses = await updateAddress(session.user.id, { id, index }, address);
    return successResponse(
      { addresses: serializeAddresses(addresses) },
      "Address updated successfully",
    );
  },
);

/**
 * DELETE /api/user/addresses
 * Delete address by index
 */
export const DELETE = withApi(
  // Shopper-owned data: removing your own address stays available on demo.
  { auth: "user", demo: "allow" },
  async ({ request, session }) => {
    const { id, index } = await validateBody(request, DeleteAddressBodySchema);
    const addresses = await deleteAddress(session.user.id, { id, index });
    if (!addresses) {
      return successResponse({ addresses: [] }, "No addresses to delete");
    }
    return successResponse(
      { addresses: serializeAddresses(addresses) },
      "Address deleted successfully",
    );
  },
);
