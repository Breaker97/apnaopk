import { Cart, Product } from "@/models";
import {
  cartLineKey,
  resolveCartProducts,
} from "@/lib/cart/cart-products";
import { createdResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import {
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import { CartAddByIdSchema } from "@/lib/validations";
import {
  isStorefrontMultiVendorEnabled,
  isStorefrontProductSourceAllowed,
} from "@/lib/catalog/product-visibility";
import {
  calculatePreorderDeposit,
  getPreorderSettings,
  PURCHASE_TYPE,
  resolvePurchaseType,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import { withApi } from "@/lib/api/handler";

type LeanVariant = {
  _id: { toString: () => string };
  name: string;
  price: number;
  stock: number;
  image?: string;
  mediaId?: string;
  preorder?: PreorderSettingsShape;
};

type LeanProduct = {
  name: string;
  price: number;
  stock: number;
  status?: string;
  productSource?: unknown;
  images?: string[];
  media?: { _id: string; url: string }[];
  variants?: LeanVariant[];
  preorder?: PreorderSettingsShape;
  /** Whether `stock` is a limit — see lib/products/stock-policy.ts. */
  shipping?: { isPhysicalProduct?: boolean };
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
};

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const userId = session?.user?.id;
    let sessionId = request.cookies.get("cart_session")?.value;

    if (userId) {
      await rateLimitByUser(
        request,
        userId,
        "cart:addItem",
        "moderate",
        session?.user?.role
      );
    } else if (sessionId) {
      await rateLimitBySession(request, sessionId, "cart:addItem", "moderate");
    } else {
      // Create a guest session id before rate limiting to avoid shared
      // "ip:unknown" buckets in local/proxied environments.
      sessionId = crypto.randomUUID();
      await rateLimitBySession(request, sessionId, "cart:addItem", "moderate");
    }

    const { productId, variantId, quantity } = await validateBody(
      request,
      CartAddByIdSchema,
    );
    const isMultiVendorEnabled = await isStorefrontMultiVendorEnabled();

    const product = await Product.findById(productId).lean<LeanProduct>();
    if (!product) {
      return notFoundResponse("Product");
    }
    if (
      product.status !== "active" ||
      !isStorefrontProductSourceAllowed(
        product.productSource,
        isMultiVendorEnabled,
      )
    ) {
      throw new ValidationError("Product is not available");
    }

    const selectedVariant = variantId
      ? product.variants?.find((v: LeanVariant) => v._id.toString() === variantId)
      : undefined;

    if (variantId && !selectedVariant) {
      return notFoundResponse("Variant");
    }

    // A product with variants must be added WITH a specific variant. Otherwise
    // the line would be priced at product.price (the cheapest variant's mirror)
    // and carry no variant to fulfil — creating underpriced, unfulfillable
    // orders when a client bypasses the UI.
    if (!variantId && (product.variants?.length ?? 0) > 0) {
      throw new ValidationError("Please select a variant for this product");
    }

    const purchase = resolvePurchaseType({
      product,
      variantId,
      requestedQuantity: quantity,
    });
    if (!purchase) {
      throw new ValidationError("Insufficient stock");
    }

    const price = selectedVariant ? selectedVariant.price : product.price;
    const name = product.name;
    const variantName = selectedVariant?.name;
    const image =
      (selectedVariant && selectedVariant.image) ||
      (selectedVariant?.mediaId
        ? product.media?.find((m) => m._id === selectedVariant.mediaId)?.url
        : undefined) ||
      product.images?.[0] ||
      product.media?.[0]?.url ||
      "";

    const query = userId ? { userId } : { sessionId };

    let cart = await Cart.findOne(query);
    if (!cart) {
      cart = new Cart({
        userId: userId || undefined,
        sessionId: userId ? undefined : sessionId,
        items: [],
      });
    }

    // Cap distinct lines: an unbounded cart lets a guest script thousands of
    // products into one oversized document (heavy $in validation on every GET).
    if (
      cart.items.length >= 100 &&
      !cart.items.some(
        (item: { productId: { toString(): string }; variantId?: { toString(): string } }) =>
          item.productId.toString() === productId &&
          (variantId
            ? item.variantId?.toString() === variantId
            : !item.variantId),
      )
    ) {
      throw new ValidationError("Cart is full. Remove some items first.");
    }

    const requestedPurchaseType = purchase.purchaseType;
    const mixedItem = cart.items.find(
      (item: { purchaseType?: string }) =>
        (item.purchaseType || PURCHASE_TYPE.STANDARD) !== requestedPurchaseType,
    );
    if (mixedItem) {
      throw new ValidationError(
        requestedPurchaseType === PURCHASE_TYPE.PREORDER
          ? "Pre-order items must be checked out separately from regular items"
          : "Regular items must be checked out separately from pre-order items",
      );
    }

    const existingItemIndex = cart.items.findIndex(
      (item: { productId: { toString: () => string }; variantId?: { toString: () => string } }) =>
        item.productId.toString() === productId &&
        (variantId ? item.variantId?.toString() === variantId : !item.variantId)
    );

    if (existingItemIndex > -1) {
      const newQuantity = cart.items[existingItemIndex].quantity + quantity;
      const nextPurchase = resolvePurchaseType({
        product,
        variantId,
        requestedQuantity: newQuantity,
      });
      if (!nextPurchase || nextPurchase.purchaseType !== requestedPurchaseType) {
        throw new ValidationError("Insufficient stock");
      }
      const preorderTerms =
        nextPurchase.purchaseType === PURCHASE_TYPE.PREORDER
          ? calculatePreorderDeposit({
              unitPrice: price,
              quantity: newQuantity,
              settings: getPreorderSettings(product, variantId),
            })
          : undefined;
      cart.items[existingItemIndex].quantity = newQuantity;
      cart.items[existingItemIndex].price = price;
      cart.items[existingItemIndex].name = name;
      cart.items[existingItemIndex].variantName = variantName;
      cart.items[existingItemIndex].image = image;
      cart.items[existingItemIndex].purchaseType = requestedPurchaseType;
      cart.items[existingItemIndex].preorderReleaseDate =
        "preorderReleaseDate" in nextPurchase
          ? nextPurchase.preorderReleaseDate
          : undefined;
      cart.items[existingItemIndex].preorderMessage =
        "preorderMessage" in nextPurchase
          ? nextPurchase.preorderMessage
          : undefined;
      cart.items[existingItemIndex].preorderPaymentMode =
        preorderTerms?.paymentMode;
      cart.items[existingItemIndex].preorderDepositAmount =
        preorderTerms?.depositAmount;
      cart.items[existingItemIndex].preorderOutstandingAmount =
        preorderTerms?.outstandingAmount;
      cart.items[existingItemIndex].preorderSupplierEta =
        "preorderSupplierEta" in nextPurchase
          ? nextPurchase.preorderSupplierEta
          : undefined;
      cart.items[existingItemIndex].preorderBatchName =
        "preorderBatchName" in nextPurchase
          ? nextPurchase.preorderBatchName
          : undefined;
    } else {
      const preorderTerms =
        purchase.purchaseType === PURCHASE_TYPE.PREORDER
          ? calculatePreorderDeposit({
              unitPrice: price,
              quantity,
              settings: getPreorderSettings(product, variantId),
            })
          : undefined;
      cart.items.push({
        productId,
        variantId: variantId || undefined,
        quantity,
        price,
        name,
        variantName,
        image,
        purchaseType: requestedPurchaseType,
        preorderReleaseDate:
          "preorderReleaseDate" in purchase
            ? purchase.preorderReleaseDate
            : undefined,
        preorderMessage:
          "preorderMessage" in purchase ? purchase.preorderMessage : undefined,
        preorderPaymentMode: preorderTerms?.paymentMode,
        preorderDepositAmount: preorderTerms?.depositAmount,
        preorderOutstandingAmount: preorderTerms?.outstandingAmount,
        preorderSupplierEta:
          "preorderSupplierEta" in purchase ? purchase.preorderSupplierEta : undefined,
        preorderBatchName:
          "preorderBatchName" in purchase ? purchase.preorderBatchName : undefined,
      });
    }

    await cart.save();

    // Seller identity on every line, not just the one just added.
    //
    // Without it the client had to carry vendors over from the lines already on
    // screen — which by construction cannot know the product being added, so a
    // second item from the SAME store arrived vendorless, landed in the
    // "unknown seller" bucket, and flipped the cart and drawer into grouped
    // mode under a bogus "Sold by Another seller" header until the background
    // refresh landed. One indexed lookup here removes that whole class of
    // flicker and makes this response shape-compatible with `GET /api/cart`.
    const savedItems = cart.toObject().items as Array<Record<string, unknown>>;
    const productFacts = await resolveCartProducts(savedItems);

    const response = createdResponse({
      ...cart.toObject(),
      items: savedItems.map((item) => {
        const fact = productFacts.get(cartLineKey(item));
        return {
          ...item,
          vendorId: fact?.vendorId,
          vendorName: fact?.vendorName,
        };
      }),
    });
    if (!userId && sessionId) {
      response.headers.set(
        "Set-Cookie",
        `cart_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
          60 * 60 * 24 * 30
        }`
      );
    }

    return response;
  },
);
