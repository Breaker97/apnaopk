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
import { rateLimitByIP, rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import { CartAddItemSchema, CartUpdateItemSchema } from "@/lib/validations";
import { PRODUCT_STATUS } from "@/config/app.config";
import {
  isStorefrontMultiVendorEnabled,
  isStorefrontProductSourceAllowed,
} from "@/lib/catalog/product-visibility";
import { getPurchasableQuantity } from "@/lib/products/stock-policy";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import {
  anySellerOffersPickup,
  cartLineKey,
  cartVendorIds,
  countCartSellers,
  resolveCartProducts,
} from "@/lib/cart/cart-products";

// Cart item type for type annotations
interface CartItem {
  productId: { toString: () => string };
  variantId?: { toString: () => string };
  quantity: number;
  price: number;
  name: string;
  image: string;
}

type StoredCartItem = CartItem & Record<string, unknown>;

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
 * Merge a lingering guest cart (keyed by the cart_session cookie) into the
 * logged-in user's cart. Without this, items added before login silently
 * disappear from view — and on a shared browser the stale cookie can surface
 * a previous guest's cart to the next visitor. Item identity is
 * (productId, variantId): quantities are combined for matching lines; guest
 * lines whose product already exists with a different purchaseType are
 * dropped (standard vs preorder for one product is mutually exclusive).
 */
async function mergeGuestCartIntoUserCart(
  userId: string,
  sessionId: string,
): Promise<void> {
  // Delete-first claim: right after login the header and the page often BOTH
  // fetch the cart, so two requests can reach here concurrently. Only the one
  // that wins the delete performs the merge — otherwise each would add the
  // guest quantities on top of the other's merge (doubled lines).
  const guestCart = await Cart.findOneAndDelete({
    sessionId,
    userId: { $exists: false },
  }).lean();
  if (!guestCart) return;

  const guestItems = (guestCart.items || []) as StoredCartItem[];
  if (guestItems.length === 0) return;

  const userCart = await Cart.findOne({ userId });
  if (!userCart) {
    // No user cart yet — recreate the claimed guest cart as the user's cart
    // (create() runs the sliding-TTL pre-save hook).
    const {
      _id: _guestId,
      sessionId: _guestSessionId,
      __v: _v,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...guestFields
    } = guestCart as Record<string, unknown>;
    await Cart.create({ ...guestFields, userId });
    return;
  }

  const keyOf = (item: StoredCartItem) =>
    `${item.productId?.toString()}::${item.variantId?.toString() || ""}`;
  const merged = [...(userCart.items as StoredCartItem[])];
  const byKey = new Map(merged.map((item) => [keyOf(item), item]));
  const productPurchaseTypes = new Map(
    merged.map((item) => [
      item.productId?.toString(),
      (item as { purchaseType?: string }).purchaseType || "standard",
    ]),
  );

  for (const guestItem of guestItems) {
    const existing = byKey.get(keyOf(guestItem));
    if (existing) {
      existing.quantity =
        Number(existing.quantity || 0) + Number(guestItem.quantity || 0);
      continue;
    }
    const productKey = guestItem.productId?.toString();
    const existingType = productPurchaseTypes.get(productKey);
    const guestType =
      (guestItem as { purchaseType?: string }).purchaseType || "standard";
    if (existingType && existingType !== guestType) continue;
    merged.push(guestItem);
    byKey.set(keyOf(guestItem), guestItem);
    productPurchaseTypes.set(productKey, guestType);
  }

  // save() (not updateOne) so the sliding-TTL pre-save hook also pushes
  // expiresAt out — a near-expiry cart that just received merged items must
  // not get TTL-deleted moments later.
  userCart.items = merged as typeof userCart.items;
  await userCart.save();
}

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

    if (userId) {
      await rateLimitByUser(
        request,
        userId,
        "cart:get",
        "lenient",
        session?.user?.role
      );
    } else {
      await rateLimitByIP(request, "lenient");
    }

    if (!userId && !sessionId) {
      return successResponse({ items: [], totalItems: 0, subtotal: 0 });
    }

    let clearGuestCookie = false;
    if (userId && sessionId) {
      await mergeGuestCartIntoUserCart(userId, sessionId).catch((err) =>
        console.error("Failed to merge guest cart on login:", err),
      );
      clearGuestCookie = true;
    }

    const query = userId ? { userId } : { sessionId };
    const cart = await Cart.findOne(query).lean();

    // The guest cart (if any) has been merged into the user cart above, so
    // the stale cookie must not resurface it — especially on a shared browser
    // where it may belong to a previous visitor.
    const withCookieCleanup = (response: ReturnType<typeof successResponse>) => {
      if (clearGuestCookie) response.cookies.delete("cart_session");
      return response;
    };

    if (!cart) {
      return withCookieCleanup(
        successResponse({
          items: [],
          totalItems: 0,
          subtotal: 0,
          sellerCount: 0,
          anySellerOffersPickup: false,
        }),
      );
    }

    const storedItems = cart.items as StoredCartItem[];
    const productFacts = await resolveCartProducts(storedItems);
    const visibleItems = storedItems.filter(
      (item) => productFacts.get(cartLineKey(item))?.visible,
    );
    if (visibleItems.length !== cart.items.length) {
      // Optimistic guard: this read-endpoint write must not clobber an item a
      // concurrent add just pushed — only apply if the cart is unchanged since
      // we read it. On interference the next GET re-filters anyway.
      await Cart.updateOne(
        { ...query, updatedAt: (cart as { updatedAt?: Date }).updatedAt },
        { $set: { items: visibleItems } },
      );
    }

    // Calculate totals
    const totalItems = visibleItems.reduce(
      (sum: number, item: { quantity: number }) => sum + item.quantity,
      0
    );
    const subtotal = visibleItems.reduce(
      (sum: number, item: { price: number; quantity: number }) =>
        sum + item.price * item.quantity,
      0
    );

    // What the rate engine actually prices: digital lines carry no weight and
    // are excluded from shipping thresholds server-side, so the cart reports
    // both figures rather than letting checkout re-derive them from a subtotal
    // it cannot tell apart.
    let shippableSubtotal = 0;
    let totalWeight = 0;
    for (const item of visibleItems) {
      const fact = productFacts.get(cartLineKey(item));
      if (!(fact?.requiresShipping ?? true)) continue;
      shippableSubtotal += item.price * item.quantity;
      totalWeight += (fact?.unitWeight ?? 0) * item.quantity;
    }

    return withCookieCleanup(
      successResponse({
        ...cart,
        // Seller identity is attached per line rather than stored on it: a cart
        // can outlive a vendor rename by weeks, and the name a shopper sees
        // should be the one on the store today.
        items: visibleItems.map((item) => {
          const fact = productFacts.get(cartLineKey(item));
          return {
            ...item,
            vendorId: fact?.vendorId,
            vendorName: fact?.vendorName,
          };
        }),
        totalItems,
        subtotal,
        shippableSubtotal,
        // In the unit every shipping call site aggregates in; the rate engine
        // converts from it into whatever unit the store's rates are written in.
        totalWeight,
        // Digital-only carts (ebooks, downloads) skip the shipping address
        // and shipping method steps at checkout — same rule the order/payment
        // routes apply server-side via resolveItemShipping.
        // An empty cart counts as shippable so checkout never flashes its
        // digital-only mode while the cart is still loading.
        hasShippableItems:
          visibleItems.length === 0 ||
          visibleItems.some(
            (item) => productFacts.get(cartLineKey(item))?.requiresShipping ?? true,
          ),
        // Any digital line — not just a digital-only cart — takes COD off the
        // table at checkout: the files release off the order before any cash
        // could be collected. Same rule the order/payment routes enforce.
        hasDigitalItems: visibleItems.some(
          (item) =>
            !(productFacts.get(cartLineKey(item))?.requiresShipping ?? true),
        ),
        // What decides whether collection is on the table at all. Derived from
        // the same visible, physical lines the shopper is looking at, so the
        // cart can never claim a different number of sellers than it displays.
        sellerCount: countCartSellers(visibleItems, productFacts),
        // Whether the seller mix is genuinely what costs this bag its
        // collection option, rather than the store simply never offering one.
        anySellerOffersPickup: await anySellerOffersPickup(
          cartVendorIds(visibleItems, productFacts),
        ),
      }),
    );
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
    const response = createdResponse(cart);

    if (!userId && sessionId) {
      response.headers.set(
        "Set-Cookie",
        `cart_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
          60 * 60 * 24 * 30
        }`
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

    // Find item
    const itemIndex = cart.items.findIndex(
      (item: CartItem) =>
        item.productId.toString() === productId &&
        (!variantId || item.variantId?.toString() === variantId)
    );

    if (itemIndex === -1) {
      return notFoundResponse("Item not found in cart");
    }

    if (quantity <= 0) {
      // Remove item
      cart.items.splice(itemIndex, 1);
    } else {
      // Update quantity
      cart.items[itemIndex].quantity = quantity;
    }

    cart.lastActionAt = new Date();
    cart.status = "active";
    await cart.save();

    return successResponse(cart);
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
    } else {
      await rateLimitByIP(request, "moderate");
    }

    if (!userId && !sessionId) {
      return notFoundResponse("Cart");
    }

    const query = userId ? { userId } : { sessionId };

    if (shouldClearAll) {
      await Cart.deleteOne(query);
      return successResponse({ message: "Cart cleared" });
    }

    const cart = await Cart.findOne(query);

    if (!cart) {
      return notFoundResponse("Cart");
    }

    // Remove specific item
    cart.items = cart.items.filter(
      (item: CartItem) =>
        !(
          item.productId.toString() === productId &&
          (!variantId || item.variantId?.toString() === variantId)
        )
    );

    await cart.save();

    return successResponse(cart);
  } catch (error) {
    return handleApiError(error);
  }
}
