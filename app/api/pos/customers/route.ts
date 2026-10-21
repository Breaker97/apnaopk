import { connectDB } from "@/lib/db";
import { getSettingsLean } from "@/models";
import { successResponse, createdResponse } from "@/lib/api/response";
import { AuthorizationError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";
import { validateBody } from "@/lib/api/validate";
import { notifyAdminsNewCustomer } from "@/lib/notifications/notifications";
import { withApi } from "@/lib/api/handler";
import { createPOSCustomer, searchPOSCustomers } from "@/lib/pos/pos-customers";
import * as z from "zod";

const PosCustomerSchema = z.object({
  name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(50).optional(),
});

/**
 * GET /api/pos/customers?search=
 *
 * Accounts and guest customers for the till to ring a sale up for — see
 * lib/pos/pos-customers.ts for the two kinds.
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "pos:customers:search", preset: "lenient" } },
  async ({ request, session }) => {
    if (!(await canAccessPOS(session.user))) throw new AuthorizationError();
    await connectDB();

    const { searchParams } = new URL(request.url);
    const settings = await getSettingsLean();
    return successResponse(
      await searchPOSCustomers(searchParams.get("search") || "", settings),
    );
  },
);

/**
 * POST /api/pos/customers
 *
 * A name and an email OR a phone number. A phone-only customer is kept as a
 * guest record keyed by the number, so a walk-in known only by their number
 * can be recorded at last.
 */
export const POST = withApi(
  { auth: "user", rateLimit: { action: "pos:customers:create", preset: "lenient" } },
  async ({ request, session }) => {
    if (!(await canAccessPOS(session.user))) throw new AuthorizationError();
    await connectDB();

    const body = await validateBody(request, PosCustomerSchema);
    const settings = await getSettingsLean();
    const { customer, created } = await createPOSCustomer({ ...body, settings });

    if (created) {
      await notifyAdminsNewCustomer({
        customerId: customer._id,
        name: customer.name,
        email: customer.email ?? customer.phone ?? "",
        createdBy: session.user.id,
      }).catch((error) =>
        console.error("Failed to notify admins of a POS customer:", error),
      );
      return createdResponse(customer);
    }
    return successResponse(customer);
  },
);
