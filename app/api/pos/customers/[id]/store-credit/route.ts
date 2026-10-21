import { Types } from "mongoose";
import { User, getSettingsLean } from "@/models";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { canAccessPOS } from "@/lib/access/rbac";
import { isCustomerAccount } from "@/lib/access/customer-account";
import { storeCreditSummary } from "@/lib/store-credit/store-credit";

/**
 * GET /api/pos/customers/[id]/store-credit — what an account customer can
 * spend at the till, in the store's currency.
 *
 * Only a customer account: credit hangs off a `User`, and a register must not
 * be able to read any other account's balance by id.
 */
export const GET = withApi<{ id: string }>(
  { auth: "user", rateLimit: { action: "pos:customers:search", preset: "lenient" } },
  async ({ params, session }) => {
    if (!(await canAccessPOS(session.user))) throw new AuthorizationError();
    if (!Types.ObjectId.isValid(params.id)) throw new NotFoundError("Customer");
    const customer = await User.findById(params.id)
      .select("role roles")
      .lean<{ role?: string; roles?: string[] } | null>();
    if (!isCustomerAccount(customer)) throw new NotFoundError("Customer");

    const settings = await getSettingsLean();
    const currency = String(settings.general?.defaultCurrency || "USD").toUpperCase();
    const summary = await storeCreditSummary(params.id);
    const row = summary.find((entry) => entry.currency === currency);
    return successResponse({ currency, available: row?.balance ?? 0 });
  },
);
