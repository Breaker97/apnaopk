import { successResponse } from "@/lib/api/response";
import { NextResponse } from "next/server";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import * as z from "zod";
import { validateBody } from "@/lib/api/validate";
import {
  addToWishlist,
  readWishlistProducts,
  removeFromWishlist,
} from "@/lib/customers/wishlist";

const WishlistItemSchema = z.object({
  productId: z
    .string({ error: "Product ID is required" })
    .min(1, "Product ID is required")
    .regex(/^[a-fA-F0-9]{24}$/, "Invalid product ID"),
});

/**
 * GET /api/wishlist
 * Get user's wishlist
 */
export const GET = withApi({ auth: "user" }, async ({ session }) => {
  return successResponse({ items: await readWishlistProducts(session.user.id) });
});

/**
 * POST /api/wishlist
 * Add item to wishlist
 */
export const POST = withApi({ auth: "user" }, async ({ request, session }) => {
  const { productId } = await validateBody(request, WishlistItemSchema);
  const { itemCount } = await addToWishlist(session.user.id, productId);

  return NextResponse.json({
    success: true,
    message: "Added to wishlist",
    data: { itemCount },
  });
});

/**
 * DELETE /api/wishlist
 * Remove item from wishlist
 */
// Shopper-owned data: removing a wishlist entry stays available on demo.
export const DELETE = withApi({ auth: "user", demo: "allow" }, async ({ request, session }) => {
  const productId = request.nextUrl.searchParams.get("productId");
  if (!productId) {
    throw new ValidationError({ productId: ["Product ID is required"] });
  }

  const { itemCount } = await removeFromWishlist(session.user.id, productId);

  return NextResponse.json({
    success: true,
    message: "Removed from wishlist",
    data: { itemCount },
  });
});
