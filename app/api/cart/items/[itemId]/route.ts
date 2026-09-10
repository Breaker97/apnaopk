import { NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { Cart, Product } from "@/models";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { ValidationError, handleApiError } from "@/lib/api/errors";
import { rateLimitByIP, rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { isValidObjectId, validateBody } from "@/lib/api/validate";
import { z } from "zod";
import {
  calculatePreorderDeposit,
  getPreorderSettings,
  PURCHASE_TYPE,
  resolvePurchaseType,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";

function parseItemId(itemId: string): { productId: string; variantId?: string } {
  const [productId, variantId] = itemId.split("-");
  return { productId, variantId: variantId || undefined };
}

const CartItemQuantitySchema = z.object({
  quantity: z.coerce.number().min(0).max(100),
});

type CartUpdateProduct = {
  stock?: number;
  /** Whether `stock` is a limit — see lib/products/stock-policy.ts. */
  shipping?: { isPhysicalProduct?: boolean };
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
  preorder?: PreorderSettingsShape;
  variants?: Array<{
    _id?: unknown;
    stock?: number;
    preorder?: PreorderSettingsShape;
  }>;
};

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

    const itemIndex = cart.items.findIndex(
      (item: { productId: { toString: () => string }; variantId?: { toString: () => string } }) =>
        item.productId.toString() === productId &&
        (variantId ? item.variantId?.toString() === variantId : !item.variantId)
    );

    if (itemIndex === -1) {
      return notFoundResponse("Item");
    }

    if (quantity <= 0) {
      cart.items.splice(itemIndex, 1);
    } else {
      const currentType =
        cart.items[itemIndex].purchaseType || PURCHASE_TYPE.STANDARD;
      const product = await Product.findById(productId).lean<CartUpdateProduct>();
      if (!product) return notFoundResponse("Product");

      const purchase = resolvePurchaseType({
        product,
        variantId,
        requestedQuantity: quantity,
      });
      if (!purchase || purchase.purchaseType !== currentType) {
        throw new ValidationError("Insufficient stock");
      }
      const preorderTerms =
        purchase.purchaseType === PURCHASE_TYPE.PREORDER
          ? calculatePreorderDeposit({
              unitPrice: Number(cart.items[itemIndex].price || 0),
              quantity,
              settings: getPreorderSettings(product, variantId),
            })
          : undefined;

      cart.items[itemIndex].quantity = quantity;
      cart.items[itemIndex].preorderReleaseDate =
        "preorderReleaseDate" in purchase
          ? purchase.preorderReleaseDate
          : undefined;
      cart.items[itemIndex].preorderMessage =
        "preorderMessage" in purchase ? purchase.preorderMessage : undefined;
      cart.items[itemIndex].preorderPaymentMode = preorderTerms?.paymentMode;
      cart.items[itemIndex].preorderDepositAmount =
        preorderTerms?.depositAmount;
      cart.items[itemIndex].preorderOutstandingAmount =
        preorderTerms?.outstandingAmount;
      cart.items[itemIndex].preorderSupplierEta =
        "preorderSupplierEta" in purchase
          ? purchase.preorderSupplierEta
          : undefined;
      cart.items[itemIndex].preorderBatchName =
        "preorderBatchName" in purchase ? purchase.preorderBatchName : undefined;
    }

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
