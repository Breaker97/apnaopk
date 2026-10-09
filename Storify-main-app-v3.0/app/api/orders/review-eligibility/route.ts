import { mongoose } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { resolveReviewEligibility } from "@/lib/catalog/review-eligibility";

/**
 * GET /api/orders/review-eligibility?productId=<id>
 *
 * Which of the current user's orders a new review of this product would
 * belong to (or null), and whether they have already reviewed it on every
 * order it was delivered in. Used by the product page to decide whether the
 * "Write a review" form can be opened, and to prefill the orderId.
 *
 * A targeted query over just this customer's orders — the product page used
 * to fetch their first 100 orders and search them in JS, which answered "not
 * eligible" to anyone whose purchase was older than that.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId || !mongoose.isValidObjectId(productId)) {
    throw new ValidationError({ productId: ["Valid product ID is required"] });
  }

  return successResponse(
    await resolveReviewEligibility(session.user.id, productId),
  );
});
