import { z } from "zod";
import { Types } from "mongoose";
import { Product } from "@/models";
import { PRODUCT_STATUS } from "@/config/app.config";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { joinPreorderWaitlist } from "@/lib/orders/preorder-waitlist";

const BodySchema = z.object({
  /** Required for a guest; ignored for a signed-in shopper. */
  email: z.string().email().max(254).optional(),
  variantId: z.string().max(40).optional(),
  locale: z.string().max(10).optional(),
});

/**
 * POST /api/products/[slug]/preorder-waitlist
 *
 * Join the list for a pre-order whose spots are all taken. The segment is the
 * product's slug, or its id — this sits beside `GET /api/products/[slug]`, and
 * Next.js allows only one name for a dynamic segment at a level.
 *
 * A signed-in shopper joins with their account's email, never one from the
 * body: an invitation is a message sent to an address, and the only address
 * this route should ever put on a list for someone signed in is their own. A
 * guest types theirs.
 *
 * Refused, with the reason, when the list cannot mean anything — not a
 * pre-order, closed, or with spots still open — so the page can tell the
 * shopper to just pre-order instead of queueing them for something in reach.
 */
export const POST = withApi<{ slug: string }>(
  {
    auth: "optional",
    // Strict: joining is a one-off, and an open email field is what a spammer
    // enumerating addresses would hammer.
    rateLimit: { action: "products:preorder-waitlist", preset: "strict" },
  },
  async ({ request, params, session }) => {
    const body = await validateBody(request, BodySchema);

    const email = session?.user?.email || body.email;
    if (!email) {
      throw new ValidationError({ email: ["Enter your email to join the list"] });
    }

    // The storefront's own visibility rules, so a draft product, or one whose
    // vendor was suspended, answers exactly as its page does: not found — and
    // does not tell a caller with its slug how its pre-order is selling.
    const product = await Product.findOne({
      ...(Types.ObjectId.isValid(params.slug)
        ? { $or: [{ _id: params.slug }, { slug: params.slug }] }
        : { slug: params.slug }),
      status: PRODUCT_STATUS.ACTIVE,
      ...(await getStorefrontProductConstraint()),
    })
      .select("_id")
      .lean<{ _id: unknown } | null>();
    if (!product) return notFoundResponse("Product");

    const result = await joinPreorderWaitlist({
      productId: String(product._id),
      variantId: body.variantId,
      email,
      userId: session?.user?.id,
      locale: body.locale,
    });
    if (!result) return notFoundResponse("Product");

    return successResponse(result);
  },
);
