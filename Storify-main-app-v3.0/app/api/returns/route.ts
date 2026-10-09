import { connectDB } from "@/lib/db";
import { ValidationError } from "@/lib/api/errors";
import { createdResponse, paginatedResponse } from "@/lib/api/response";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { CreateReturnRequestSchema } from "@/lib/validations";
import { ReturnRequest } from "@/models";
import {
  assertReturnSelfServe,
  loadReturnableOrder,
} from "@/lib/returns/return-plan";
import { createReturnRequests } from "@/lib/returns/create-return";
import { toCustomerReturn } from "@/lib/returns/return-customer-view";
import { getSettings } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";

export const GET = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
    const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 10)));
    const orderId = request.nextUrl.searchParams.get("orderId");
    const query: Record<string, unknown> = { customerId: session.user.id };

    if (orderId) {
      if (!isValidObjectId(orderId)) {
        throw new ValidationError("Invalid order ID");
      }
      query.orderId = orderId;
    }

    const skip = (page - 1) * limit;
    const [returns, total] = await Promise.all([
      ReturnRequest.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      ReturnRequest.countDocuments(query),
    ]);

    // The shopper's view of each: no staff notes, no payment references.
    return paginatedResponse(returns.map(toCustomerReturn), page, limit, total);
  },
);

export const POST = withApi(
  {
    auth: "user",
    // Only the cancel route was limited: creating one takes a per-order lock,
    // runs the planner and emails the store.
    rateLimit: { action: "returns:create", preset: "moderate" },
  },
  async ({ request, session }) => {
    const body = await validateBody(request, CreateReturnRequestSchema);

    await connectDB();
    const settings = await getSettings();
    // A store that takes returns only through its team (R6): the shopper
    // still sees and can cancel the ones they have.
    assertReturnSelfServe(settings);

    const order = await loadReturnableOrder({
      orderId: body.orderId,
      customerId: session.user.id,
    });

    // The same path the store and sellers open returns through — see
    // lib/returns/create-return.ts — so a shopper's return and the store's
    // are priced and checked alike.
    const created = await createReturnRequests({
      order,
      items: body.items,
      reason: body.reason,
      customerNote: body.customerNote,
      refundDestination: body.refundDestination,
      settings,
      userId: session.user.id,
      openedBy: "customer",
    });

    const views = created.map((doc) => toCustomerReturn(doc));
    return createdResponse(
      views.length === 1 ? views[0] : views,
      "Return request submitted",
    );
  },
);
