import { connectDB, mongoose } from "@/lib/db";
import { Order } from "@/models";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";

/**
 * GET /api/orders/review-eligibility?productId=<id>
 *
 * Returns the id of a delivered/completed order belonging to the current user
 * that contains the given product (or null). Used by the product page to decide
 * whether the "Write a review" form can be opened, and to prefill the orderId.
 *
 * This replaces a client-side scan that fetched the first 100 of the user's
 * orders and searched them in JS — which produced a false "not eligible" for
 * customers whose qualifying purchase was older than their 100 most recent
 * orders. This does the same match the review-create endpoint enforces, as a
 * single indexed query over just this customer's orders.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId || !mongoose.isValidObjectId(productId)) {
    throw new ValidationError({ productId: ["Valid product ID is required"] });
  }

  await connectDB();

  // Mirrors the eligibility rule in POST /api/reviews (delivered/completed order,
  // owned by this user, containing the product). Newest qualifying order wins.
  const order = await Order.findOne({
    customerId: session.user.id,
    "items.productId": productId,
    status: { $in: ["delivered", "completed"] },
  })
    .select("_id")
    .sort({ createdAt: -1 })
    .lean<{ _id: unknown } | null>();

  return successResponse({
    eligibleOrderId: order?._id ? String(order._id) : null,
  });
});
