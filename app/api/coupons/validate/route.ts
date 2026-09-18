import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import {
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import { ValidateCouponSchema } from "@/lib/validations";
import { validateAndCalculateCoupon } from "@/lib/catalog/coupons";
import { withApi } from "@/lib/api/handler";

/**
 * POST /api/coupons/validate
 * Validate and calculate discount for a coupon code
 */
export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "coupons:validate",
        "moderate",
        session.user.role
      );
    } else if (cartSessionId) {
      await rateLimitBySession(request, cartSessionId, "coupons:validate", "moderate");
    } else {
      await rateLimitByIP(request, "moderate");
    }

    await connectDB();

    const { code, cartItems, subtotal, shippingCost, shippingByVendor } =
      await validateBody(request, ValidateCouponSchema);
    const result = await validateAndCalculateCoupon({
      code,
      subtotal,
      shippingCost,
      shippingByVendor,
      cartItems,
      userId: session?.user?.id,
    });

    return successResponse({
      valid: true,
      code: result.code,
      type: result.type,
      value: result.value,
      discount: result.discount,
      discountTarget: result.discountTarget,
      maxDiscount: result.maxDiscount,
      description: result.description,
      // So the page can price it the way checkout will: a seller's own
      // free-shipping coupon covers their delivery, and a scoped coupon's
      // discount falls on that seller's lines.
      vendorShares: result.vendorShares,
      shippingVendorId: result.shippingVendorId,
    });
  },
);
