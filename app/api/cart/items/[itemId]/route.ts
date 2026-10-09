import { cartResponse } from "@/lib/cart/cart-response";
import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { handleApiError } from "@/lib/api/errors";
import {
  SHOPPING_ADDRESS_ALLOWANCE,
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import * as z from "zod";
import {
  removeCartLine,
  resolveCartIdentity,
  setCartLine,
} from "@/lib/cart/cart-service";

function parseItemId(itemId: string): { productId: string; variantId?: string } {
  const [productId, variantId] = itemId.split("-");
  return { productId, variantId: variantId || undefined };
}

const CartItemQuantitySchema = z.object({
  // Whole units: a line of 1.5 was charged half a unit extra and took half a
  // unit off stock.
  quantity: z.coerce.number().int().min(0).max(100),
});

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  try {
    await connectDB();

    const { itemId } = await context.params;
    const { productId, variantId } = parseItemId(itemId);
    if (!isValidObjectId(productId)) return notFoundResponse("Item");
    if (variantId && !isValidObjectId(variantId)) return notFoundResponse("Item");

    const session = await auth.api.getSession({ headers: await headers() });
    const userId = session?.user?.id;
    const sessionId = request.cookies.get("cart_session")?.value;

    if (userId) {
      await rateLimitByUser(
        request,
        userId,
        "cart:updateItem",
        "moderate",
        session?.user?.role
      );
    } else if (sessionId) {
      await rateLimitBySession(
        request,
        sessionId,
        "cart:updateItem",
        "moderate",
        SHOPPING_ADDRESS_ALLOWANCE,
      );
    } else {
      await rateLimitByIP(request, "moderate");
    }

    const { quantity } = await validateBody(request, CartItemQuantitySchema);

    const identity = resolveCartIdentity({ userId, sessionId });
    if (!identity) {
      return notFoundResponse("Cart");
    }

    // Through the one way a quantity changes: stock, the quoted lot, and a
    // pre-order's terms worked out again.
    const updated = await setCartLine(identity, { productId, variantId, quantity });
    if (updated.status === "no-line") return notFoundResponse("Item");
    if (updated.status !== "saved") return notFoundResponse("Cart");
    return successResponse(cartResponse(updated.cart));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ itemId: string }> }
) {
  try {
    await connectDB();

    const { itemId } = await context.params;
    const { productId, variantId } = parseItemId(itemId);
    if (!isValidObjectId(productId)) return notFoundResponse("Item");
    if (variantId && !isValidObjectId(variantId)) return notFoundResponse("Item");

    const session = await auth.api.getSession({ headers: await headers() });
    const userId = session?.user?.id;
    const sessionId = request.cookies.get("cart_session")?.value;

    if (userId) {
      await rateLimitByUser(
        request,
        userId,
        "cart:removeItem",
        "moderate",
        session?.user?.role
      );
    } else if (sessionId) {
      await rateLimitBySession(
        request,
        sessionId,
        "cart:removeItem",
        "moderate",
        SHOPPING_ADDRESS_ALLOWANCE,
      );
    } else {
      await rateLimitByIP(request, "moderate");
    }

    const identity = resolveCartIdentity({ userId, sessionId });
    if (!identity) {
      return notFoundResponse("Cart");
    }

    const removed = await removeCartLine(identity, { productId, variantId });
    if (removed.status === "no-line") return notFoundResponse("Item");
    if (removed.status !== "saved") return notFoundResponse("Cart");
    return successResponse(cartResponse(removed.cart));
  } catch (error) {
    return handleApiError(error);
  }
}
