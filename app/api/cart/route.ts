import { cartResponse, cartViewResponse } from "@/lib/cart/cart-response";
import { cartSessionCookie } from "@/lib/cart/cart-session-cookie";
import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Cart, Product } from "@/models";
import {
  successResponse,
  createdResponse,
  notFoundResponse,
} from "@/lib/api/response";
import { ValidationError, handleApiError } from "@/lib/api/errors";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import {
  SHOPPING_ADDRESS_ALLOWANCE,
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import { setCartItemQuantity } from "@/lib/cart/cart-item-quantity";
import {
  clearCart,
  getCartView,
  mergeGuestCart,
  removeCartLine,
  resolveCartIdentity,
} from "@/lib/cart/cart-service";
import { PURCHASE_TYPE, resolvePurchaseType } from "@/lib/orders/preorders";
import { CartAddItemSchema, CartUpdateItemSchema } from "@/lib/validations";
import { PRODUCT_STATUS } from "@/config/app.config";
import {
  isStorefrontMultiVendorEnabled,
  isStorefrontProductSourceAllowed,
} from "@/lib/catalog/product-visibility";
import { getPurchasableQuantity } from "@/lib/products/stock-policy";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";

// Cart item type for type annotations
interface CartItem {
  productId: { toString: () => string };
  variantId?: { toString: () => string };
  quantity: number;
  price: number;
  name: string;
  image: string;
}

type LeanVariant = {
  _id: { toString: () => string };
  name: string;
  price: number;
  stock: number;
  image?: string;
  mediaId?: string;
};

type LeanProduct = {
  name: string;
  price: number;
  stock: number;
  status?: string;
  priceOnRequest?: boolean;
  productSource?: unknown;
  images?: string[];
  media?: { _id: string; url: string }[];
  variants?: LeanVariant[];
  shipping?: { isPhysicalProduct?: boolean };
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
};

/**
 * GET /api/cart
 * Get current user's cart
 */
export async function GET(request: NextRequest) {
  try {
    await connectDB();

    // Get session
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    const userId = session?.user?.id;
    const sessionId = request.cookies.get("cart_session")?.value;
    const identity = resolveCartIdentity({ userId, sessionId });

    // Every page load asks for the cart, so the limit check is overlapped
    // with the cart read. A request over its limit still gets its 429 — the
    // read it started alongside is only a wasted lookup by an indexed key,
    // and nothing heavier starts before the check.
    const rateLimited = userId
      ? rateLimitByUser(
          request,
          userId,
          "cart:get",
          "lenient",
          session?.user?.role
        )
      : rateLimitByIP(request, "browse");

    if (!identity) {
      await rateLimited;
      return successResponse({ items: [], totalItems: 0, subtotal: 0 });
    }

    // Right after login only: a write, so it waits for the limit check.
    const clearGuestCookie = Boolean(userId && sessionId);
    if (userId && sessionId) {
      await rateLimited;
      await mergeGuestCart(userId, sessionId).catch((err) =>
        console.error("Failed to merge guest cart on login:", err),
      );
    }

    const view = await getCartView(identity, { alongside: rateLimited });
    const response = successResponse(cartViewResponse(view));
    // The guest cart (if any) has been merged into the user cart above, so
    // the stale cookie must not resurface it — especially on a shared browser
    // where it may belong to a previous visitor.
    if (clearGuestCookie) response.cookies.delete("cart_session");
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cart
 * Add item to cart
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    // Get session
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    const userId = session?.user?.id;
    let sessionId = request.cookies.get("cart_session")?.value;

    if (userId) {
      await rateLimitByUser(
        request,
        userId,
        "cart:add",
        "moderate",
        session?.user?.role
      );
    } else if (sessionId) {
      await rateLimitBySession(
        request,
        sessionId,
        "cart:add",
        "moderate",
        SHOPPING_ADDRESS_ALLOWANCE,
      );
    } else {
      await rateLimitByIP(request, "moderate");
    }

    const { productId, quantity, variantId } =
      await validateBody(request, CartAddItemSchema);

    // Generate session ID for guest users
    if (!userId && !sessionId) {
      sessionId = crypto.randomUUID();
    }

    const isMultiVendorEnabled = await isStorefrontMultiVendorEnabled();
    const product = await Product.findById(productId).lean<LeanProduct>();
    if (!product) {
      return notFoundResponse("Product");
    }
    if (
      product.status !== PRODUCT_STATUS.ACTIVE ||
      !isStorefrontProductSourceAllowed(
        product.productSource,
        isMultiVendorEnabled,
      )
    ) {
      throw new ValidationError("Product is not available");
    }

    // "Price on request" products have no price a shopper agreed to, so there
    // is nothing to put on a cart line. The buy box already offers a quote
    // button instead of Add to cart; this catches the paths that don't go
    // through it — a tab left open from before the merchant flipped the
    // switch, a cached card, a hand-rolled POST.
    //
    // A shopper the merchant HAS quoted is the one exception, and it is not
    // handled here: this endpoint is the legacy add path (the storefront adds
    // through POST /api/cart/items, which resolves the offer and prices the
    // line from it). Refusing outright is the safe half of the rule — it can
    // never underprice — so this stays a plain refusal rather than a second
    // copy of the offer logic that could drift from the real one.
    if (isQuoteOnlyProduct(product)) {
      throw new ValidationError(
        "This product is available by quote — request a price instead",
      );
    }

    const selectedVariant = variantId
      ? product.variants?.find((v) => v._id.toString() === variantId)
      : undefined;

    if (variantId && !selectedVariant) {
      return notFoundResponse("Variant");
    }

    // A product with variants must be added WITH a specific variant, otherwise
    // it is priced at the cheapest-variant mirror and can't be fulfilled.
    if (!variantId && (product.variants?.length ?? 0) > 0) {
      throw new ValidationError("Please select a variant for this product");
    }

    // Digital products and products with stock tracking off have no stock to
    // run out of; "continue selling when out of stock" opts a tracked product
    // out of the limit too. getPurchasableQuantity() owns that rule so the buy
    // box on the product page and this guard can't disagree.
    const availableStock = getPurchasableQuantity(
      product,
      selectedVariant ? selectedVariant.stock : product.stock,
    );
    if (availableStock <= 0 || quantity > availableStock) {
      throw new ValidationError("Insufficient stock");
    }
    // This path writes plain lines and knows nothing of pre-order terms. A
    // "pre-order only" product with stock is still a pre-order, and adding it
    // here made a standard line the direct order route then sold outside the
    // pre-order's quota, deposit and date.
    const purchase = resolvePurchaseType({
      product: product as unknown as Parameters<typeof resolvePurchaseType>[0]["product"],
      variantId: variantId || undefined,
      requestedQuantity: quantity,
    });
    if (purchase?.purchaseType !== PURCHASE_TYPE.STANDARD) {
      throw new ValidationError("Add pre-order items from the product page");
    }

    const price = selectedVariant ? selectedVariant.price : product.price;
    const name = product.name;
    const variantName = selectedVariant?.name;
    const image =
      selectedVariant?.image ||
      (selectedVariant?.mediaId
        ? product.media?.find((m) => m._id === selectedVariant.mediaId)?.url
        : undefined) ||
      product.images?.[0] ||
      product.media?.[0]?.url ||
      "";

    const query = userId ? { userId } : { sessionId };

    // Find or create cart
    let cart = await Cart.findOne(query);

    if (!cart) {
      cart = new Cart({
        userId: userId || undefined,
        sessionId: userId ? undefined : sessionId,
        items: [],
      });
    }

    // Check if product already in cart
    const existingItemIndex = cart.items.findIndex(
      (item: CartItem) =>
        item.productId.toString() === productId &&
        (variantId ? item.variantId?.toString() === variantId : !item.variantId)
    );

    // Cap distinct lines (oversized-document / abuse guard).
    if (existingItemIndex === -1 && cart.items.length >= 100) {
      throw new ValidationError("Cart is full. Remove some items first.");
    }

    // Pre-order lines carry terms this path cannot work out, and a cart holds
    // pre-orders or regular items, never both.
    if (
      cart.items.some(
        (item: CartItem & { purchaseType?: string }) =>
          (item.purchaseType || PURCHASE_TYPE.STANDARD) === PURCHASE_TYPE.PREORDER,
      )
    ) {
      throw new ValidationError(
        "Regular items must be checked out separately from pre-order items",
      );
    }

    if (existingItemIndex > -1) {
      // Update quantity
      const nextQuantity = cart.items[existingItemIndex].quantity + quantity;
      if (nextQuantity > availableStock) {
        throw new ValidationError("Insufficient stock");
      }
      cart.items[existingItemIndex].quantity = nextQuantity;
      cart.items[existingItemIndex].price = price;
      cart.items[existingItemIndex].name = name;
      cart.items[existingItemIndex].variantName = variantName;
      cart.items[existingItemIndex].image = image;
    } else {
      // Add new item
      cart.items.push({
        productId,
        variantId,
        quantity,
        price,
        name,
        variantName,
        image,
      });
    }

    cart.lastActionAt = new Date();
    cart.status = "active";
    await cart.save();

    // Return response with cookie for guest users
    const response = createdResponse(cartResponse(cart));

    if (!userId && sessionId) {
      response.headers.set(
        "Set-Cookie",
        cartSessionCookie(request, sessionId),
      );
    }

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/cart
 * Update cart item quantity
 */
export async function PUT(request: NextRequest) {
  try {
    await connectDB();

    // Get session
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    const userId = session?.user?.id;
    const sessionId = request.cookies.get("cart_session")?.value;

    if (userId) {
      await rateLimitByUser(
        request,
        userId,
        "cart:update",
        "moderate",
        session?.user?.role
      );
    } else if (sessionId) {
      await rateLimitBySession(
        request,
        sessionId,
        "cart:update",
        "moderate",
        SHOPPING_ADDRESS_ALLOWANCE,
      );
    } else {
      await rateLimitByIP(request, "moderate");
    }

    const { productId, quantity, variantId } = await validateBody(
      request,
      CartUpdateItemSchema,
    );

    if (!userId && !sessionId) {
      return notFoundResponse("Cart");
    }

    const query = userId ? { userId } : { sessionId };
    const cart = await Cart.findOne(query);

    if (!cart) {
      return notFoundResponse("Cart");
    }

    // Through the same rules as the cart line route: stock, the quoted-lot
    // lock, and a pre-order's deposit and balance worked out again for the new
    // quantity. This route used to write the number alone.
    const updated = await setCartItemQuantity(cart, {
      productId,
      variantId,
      quantity,
    });
    if (!updated) {
      return notFoundResponse("Item not found in cart");
    }

    cart.lastActionAt = new Date();
    cart.status = "active";
    await cart.save();

    return successResponse(cartResponse(cart));
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/cart
 * Clear cart or remove specific item
 */
export async function DELETE(request: NextRequest) {
  try {
    await connectDB();

    const searchParams = request.nextUrl.searchParams;
    const productId = searchParams.get("productId");
    const variantId = searchParams.get("variantId");
    const clearAll = searchParams.get("clearAll") === "true";
    const shouldClearAll = clearAll || !productId;

    // Get session
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    const userId = session?.user?.id;
    const sessionId = request.cookies.get("cart_session")?.value;

    if (userId) {
      await rateLimitByUser(
        request,
        userId,
        "cart:delete",
        "moderate",
        session?.user?.role
      );
    } else if (sessionId) {
      await rateLimitBySession(
        request,
        sessionId,
        "cart:delete",
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

    if (shouldClearAll) {
      await clearCart(identity);
      return successResponse({ message: "Cart cleared" });
    }

    // Without a variant named, every line of the product goes.
    const removed = await removeCartLine(
      identity,
      { productId: productId!, variantId: variantId || undefined },
      { anyVariant: true },
    );
    if (removed.status !== "saved" && removed.status !== "no-line") {
      return notFoundResponse("Cart");
    }

    return successResponse(cartResponse(removed.cart));
  } catch (error) {
    return handleApiError(error);
  }
}
