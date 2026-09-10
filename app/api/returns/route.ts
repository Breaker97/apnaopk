import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { ValidationError } from "@/lib/api/errors";
import { createdResponse, paginatedResponse } from "@/lib/api/response";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { CreateReturnRequestSchema } from "@/lib/validations";
import { Order, ReturnRequest } from "@/models";
import { RETURN_REFUND_STATUS, RETURN_STATUS } from "@/lib/returns/returns";
import { getNextReturnNumber } from "@/lib/returns/return-number";
import {
  assertReturnEligible,
  loadReturnableOrder,
  planReturnRequest,
} from "@/lib/returns/return-plan";
import { validateRefundDestination } from "@/lib/returns/refund-settlement";
import { getSettings } from "@/models/settings.model";
import { notifyReturnRequestSubmitted } from "@/lib/notifications/notifications";
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

    return paginatedResponse(returns, page, limit, total);
  },
);

export const POST = withApi(
  { auth: "user" },
  async ({ request, session }) => {
    const body = await validateBody(request, CreateReturnRequestSchema);

    await connectDB();

    const order = await loadReturnableOrder({
      orderId: body.orderId,
      customerId: session.user.id,
    });

    assertReturnEligible(order);

    // Serialize return creation per order: the returnable-quantity check the
    // planner makes is read-then-create, so two concurrent submissions could
    // both pass it and together exceed the ordered quantity. The claim
    // self-expires after 15s in case a request crashes before releasing it.
    //
    // Taken here rather than inside the planner because the preview runs the
    // same planner and must not queue behind — or hold up — a real submission.
    const lockStaleBefore = new Date(Date.now() - 15_000);
    const returnLock = await Order.findOneAndUpdate(
      {
        _id: order._id,
        $or: [
          { returnRequestLockAt: null },
          { returnRequestLockAt: { $exists: false } },
          { returnRequestLockAt: { $lt: lockStaleBefore } },
        ],
      },
      { $set: { returnRequestLockAt: new Date() } },
    )
      .select("_id")
      .lean();
    if (!returnLock) {
      throw new ValidationError(
        "Another return for this order is being submitted. Please try again in a moment.",
      );
    }
    const releaseReturnLock = () =>
      Order.updateOne(
        { _id: order._id },
        { $unset: { returnRequestLockAt: "" } },
      ).catch((err) => console.error("Failed to release return lock:", err));

    try {
      const settings = await getSettings();
      const plan = await planReturnRequest({
        order,
        items: body.items,
        reason: body.reason,
        settings,
      });

      // A cash-on-delivery refund has no payment instrument to reverse, so
      // unless the shopper says where the money should go, "refunded" would
      // mean a note to a human and nothing else. Asked for at submission
      // rather than chased after approval, which is an email thread.
      if (plan.settlesOutOfBand) {
        const problems = validateRefundDestination(body.refundDestination);
        if (problems.length > 0) {
          throw new ValidationError(problems.join(". "));
        }
      }
      const refundDestination = plan.settlesOutOfBand
        ? { ...body.refundDestination, providedAt: new Date() }
        : undefined;

      const createdRequests = [];
      const notificationJobs: Promise<unknown>[] = [];
      for (const group of plan.groups) {
        const returnRequest = await ReturnRequest.create({
          returnNumber: await getNextReturnNumber(),
          orderId: order._id,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          ownerType: group.ownerType,
          ownerVendorId: group.ownerVendorId
            ? new Types.ObjectId(group.ownerVendorId)
            : undefined,
          vendorIds: group.vendorIds.map((id) => new Types.ObjectId(id)),
          status: RETURN_STATUS.REQUESTED,
          refundStatus: RETURN_REFUND_STATUS.PENDING,
          reason: body.reason,
          customerNote: body.customerNote,
          requestedAt: new Date(),
          createdBy: session.user.id,
          items: group.items,
          estimatedRefund: group.estimatedRefund,
          refundDestination,
        });
        createdRequests.push(returnRequest);
        notificationJobs.push(
          notifyReturnRequestSubmitted(returnRequest.toObject(), settings),
        );
      }

      await Promise.allSettled(notificationJobs);

      return createdResponse(
        createdRequests.length === 1 ? createdRequests[0] : createdRequests,
        "Return request submitted",
      );
    } finally {
      await releaseReturnLock();
    }
  },
);
