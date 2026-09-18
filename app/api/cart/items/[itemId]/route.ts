import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { Cart } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { handleApiError } from "@/lib/api/errors";
import { rateLimitByIP, rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { z } from "zod";
import { setCartItemQuantity } from "@/lib/cart/cart-item-quantity";

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
    } else {
      await rateLimitByIP(request, "moderate");
    }

    const { quantity } = await validateBody(request, CartItemQuantitySchema);

    if (!userId && !sessionId) {
      return notFoundResponse("Cart");
    }

    const query = userId ? { userId } : { sessionId };
    const cart = await Cart.findOne(query);
    if (!cart) {
      return notFoundResponse("Cart");
    }

    const updated = await setCartItemQuantity(cart, {
      productId,
      variantId,
      quantity,
    });
    if (!updated) return notFoundResponse("Item");

    await cart.save();
    return successResponse(cart);
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
    } else {
      await rateLimitByIP(request, "moderate");
    }

    if (!userId && !sessionId) {
      return notFoundResponse("Cart");
    }

    const query = userId ? { userId } : { sessionId };
    const cart = await Cart.findOne(query);
    if (!cart) {
      return notFoundResponse("Cart");
    }

    const beforeCount = cart.items.length;
    cart.items = cart.items.filter(
      (item: { productId: { toString: () => string }; variantId?: { toString: () => string } }) =>
        !(
          item.productId.toString() === productId &&
          (variantId ? item.variantId?.toString() === variantId : !item.variantId)
        )
    );

    if (cart.items.length === beforeCount) {
      return notFoundResponse("Item");
    }

    await cart.save();
    return successResponse(cart);
  } catch (error) {
    return handleApiError(error);
  }
}
