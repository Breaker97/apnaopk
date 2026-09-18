/**
 * What a return would be worth, without creating one.
 *
 * The shopper picks the items and the reason, and the reason is what decides
 * whether the delivery comes back and whether the return leg is charged — so
 * quoting the figure only after submission told them the one thing they needed
 * before it. This answers the same question the submission does, from the same
 * planner, so the number shown is the number they get.
 *
 * A POST because the selection is a body, not because anything is written:
 * no lock is taken, no return number is drawn, nothing is persisted.
 */

import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { CreateReturnRequestSchema } from "@/lib/validations";
import {
  assertReturnEligible,
  loadReturnableOrder,
  planReturnRequest,
} from "@/lib/returns/return-plan";
import { getSettings } from "@/models/settings.model";
import { withApi } from "@/lib/api/handler";

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    // The same schema the submission validates against, so a selection that
    // previews cleanly cannot then be rejected on submit for its shape.
    const body = await validateBody(request, CreateReturnRequestSchema);

    await connectDB();

    const order = await loadReturnableOrder({
      orderId: body.orderId,
      customerId: session.user.id,
    });

    const settings = await getSettings();
    assertReturnEligible(order, settings);

    const plan = await planReturnRequest({
      order,
      items: body.items,
      reason: body.reason,
      settings,
    });

    return successResponse({
      currency: plan.currency,
      merchantAtFault: plan.merchantAtFault,
      refundsShipping: plan.refundsShipping,
      // Tells the form to ask where the money should go, before the shopper
      // commits to a return they would then be chased about.
      settlesOutOfBand: plan.settlesOutOfBand,
      total: plan.total,
      // One entry per parcel the shopper will send back. Usually one; a return
      // spanning two sellers is two, and each carries its own return-leg fee.
      groups: plan.groups.map((group) => ({
        ownerType: group.ownerType,
        items: group.items.map((item) => ({
          name: item.name,
          quantityRequested: item.quantityRequested,
        })),
        estimatedRefund: group.estimatedRefund,
      })),
    });
  },
);
