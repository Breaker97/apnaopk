import "server-only";

import { connectDB } from "@/lib/db";
import { Cart, Product } from "@/models";
import { PRODUCT_STATUS } from "@/config/app.config";
import {
  isStorefrontMultiVendorEnabled,
  isStorefrontProductSourceAllowed,
} from "@/lib/catalog/product-visibility";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import {
  calculatePreorderDeposit,
  getPreorderSettings,
  PURCHASE_TYPE,
  resolvePurchaseType,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import {
  loadShopperOffers,
  matchOffersToLines,
  quoteOfferLineKey,
  resolveOfferForLine,
  type LiveQuoteOffer,
} from "@/lib/quotes/quote-offer";
import {
  setCartItemQuantity,
  storeCurrency,
  type AdmitCartLine,
} from "@/lib/cart/cart-item-quantity";
import { CartRefusal, insufficientStock } from "@/lib/cart/cart-refusal";
import {
  anySellerOffersPickup,
  cartLineKey,
  cartProductFacts,
  countCartSellers,
  readCartProducts,
  type CartProductFacts,
} from "@/lib/cart/cart-products";

/**
 * The cart: whose cart a request opens, what is in it right now, and the ways
 * a line is added, set, removed and merged.
 *
 * The web's cart routes (app/api/cart) and the mobile API
 * (lib/api-core/shop/cart) both come through here, so a rule lives in one
 * place: quote offers price and fix their lots, pre-orders and regular items
 * never share a cart, a line whose product left the store is pruned, the
 * seller count agrees with checkout's pickup rule.
 *
 * Transport stays with the callers. A route reads the `cart_session` cookie
 * (the app sends the same id as `X-Cart-Token`) and the session, rate-limits,
 * and writes cookies; it hands this module the identity it resolved.
 */

/**
 * Whose cart: a signed-in shopper's, or a guest's by its session id. A
 * shopper's cart is found by the account alone, whatever guest id the request
 * also carries.
 */
export type CartIdentity =
  | { userId: string; sessionId?: undefined }
  | { sessionId: string; userId?: undefined };

export function resolveCartIdentity(input: {
  userId?: string | null;
  sessionId?: string | null;
}): CartIdentity | null {
  if (input.userId) return { userId: input.userId };
  if (input.sessionId) return { sessionId: input.sessionId };
  return null;
}

function cartQuery(identity: CartIdentity) {
  return identity.userId
    ? { userId: identity.userId }
    : { sessionId: identity.sessionId };
}

/** One line to add or set. */
type CartLineInput = {
  productId: string;
  variantId?: string;
  quantity: number;
};

/** A stored cart line, as the read and the merge see it. */
type StoredCartItem = Record<string, unknown> & {
  productId: { toString: () => string };
  variantId?: { toString: () => string };
  quantity: number;
  price: number;
  purchaseType?: string;
};

/** The stored cart, as `findOne().lean()` or a saved document's `toObject()` reads it. */
type StoredCart = {
  _id: unknown;
  items: StoredCartItem[];
  updatedAt?: Date;
};

type MutableCartItem = StoredCartItem & {
  name?: string;
  variantName?: string;
  image?: string;
  quoteId?: unknown;
  preorderReleaseDate?: Date;
  preorderMessage?: string;
  preorderPaymentMode?: string;
  preorderDepositAmount?: number;
  preorderOutstandingAmount?: number;
  preorderSupplierEta?: Date;
  preorderBatchName?: string;
};

/** A cart document, loaded to be changed and saved. */
type CartDocument = {
  _id: unknown;
  items: MutableCartItem[];
  save: () => Promise<unknown>;
  toObject: () => StoredCart;
};

/** What a write did. The "not found" answers are the caller's to word. */
type CartWriteResult =
  | { status: "saved"; cart: CartDocument }
  | { status: "no-cart" }
  | { status: "no-line"; cart: CartDocument }
  | { status: "product-not-found" }
  | { status: "variant-not-found" };

type LeanVariant = {
  _id: { toString: () => string };
  name: string;
  price: number;
  stock: number;
  image?: string;
  mediaId?: string;
  requiresShipping?: boolean;
  preorder?: PreorderSettingsShape;
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
  preorder?: PreorderSettingsShape;
  /** Whether `stock` is a limit — see lib/products/stock-policy.ts. */
  shipping?: { isPhysicalProduct?: boolean };
  inventory?: { tracked?: boolean; continueSellingWhenOutOfStock?: boolean };
};

/** The most distinct lines one cart holds. */
const CART_LINE_CAP = 100;

function isSameLine(
  item: { productId: { toString: () => string }; variantId?: { toString: () => string } },
  line: { productId: string; variantId?: string },
): boolean {
  return (
    item.productId.toString() === line.productId &&
    (line.variantId ? item.variantId?.toString() === line.variantId : !item.variantId)
  );
}

/**
 * Add a line, or more of one already in the cart: `POST /api/cart/items`.
 *
 * Adding again normally means "one more". On a quoted line it means "the lot
 * I was quoted", because the offer is only good for that exact quantity.
 */
export async function addCartLine(
  identity: CartIdentity,
  line: CartLineInput,
): Promise<CartWriteResult> {
  await connectDB();
  return putLine(identity, undefined, line, {});
}

/**
 * Set how many of a line the cart holds. 0 removes it.
 *
 * By default the line must already be in the cart (`no-line` otherwise), and
 * the quantity changes through `setCartItemQuantity`, the one way it is done:
 * stock, the quoted lot, a pre-order's terms worked out again.
 *
 * With `upsert` (the app's `PUT /cart/lines`) the request states the line's
 * whole state, so sending it twice leaves the cart as sending it once would:
 * a line already at that quantity is left alone, and a line not in the cart
 * is added under the same rules as `addCartLine`.
 *
 * `admit` is the caller's own rule for the line (see `setCartItemQuantity`).
 */
export async function setCartLine(
  identity: CartIdentity,
  line: CartLineInput,
  options: { upsert?: boolean; admit?: AdmitCartLine } = {},
): Promise<CartWriteResult> {
  await connectDB();
  const cart = (await Cart.findOne(cartQuery(identity))) as CartDocument | null;
  const existing = cart?.items.find((item) => isSameLine(item, line));

  if (!existing) {
    if (!options.upsert) {
      return cart ? { status: "no-line", cart } : { status: "no-cart" };
    }
    return putLine(identity, cart, line, { admit: options.admit });
  }
  if (options.upsert && existing.quantity === line.quantity) {
    return { status: "saved", cart: cart! };
  }

  await setCartItemQuantity(
    cart as unknown as Parameters<typeof setCartItemQuantity>[0],
    line,
    { admit: options.admit },
  );
  await cart!.save();
  return { status: "saved", cart: cart! };
}

/**
 * The add path's rules, for a line that may or may not be in the cart.
 * `cart` is the shopper's cart when the caller has read it already (`null`
 * for none yet), or `undefined` to read it here.
 */
async function putLine(
  identity: CartIdentity,
  loaded: CartDocument | null | undefined,
  line: CartLineInput,
  options: { admit?: AdmitCartLine },
): Promise<CartWriteResult> {
  const { productId, variantId, quantity } = line;
  const userId = identity.userId;
  const isMultiVendorEnabled = await isStorefrontMultiVendorEnabled();

  const product = await Product.findById(productId).lean<LeanProduct>();
  if (!product) return { status: "product-not-found" };
  if (
    product.status !== PRODUCT_STATUS.ACTIVE ||
    !isStorefrontProductSourceAllowed(product.productSource, isMultiVendorEnabled)
  ) {
    throw new CartRefusal("Product is not available", "not_available");
  }

  const selectedVariant = variantId
    ? product.variants?.find((v) => v._id.toString() === variantId)
    : undefined;
  if (variantId && !selectedVariant) return { status: "variant-not-found" };

  // A product with variants must be added WITH a specific variant. Otherwise
  // the line would be priced at product.price (the cheapest variant's mirror)
  // and carry no variant to fulfil — creating underpriced, unfulfillable
  // orders when a client bypasses the UI.
  if (!variantId && (product.variants?.length ?? 0) > 0) {
    throw new CartRefusal("Please select a variant for this product", "variant_required");
  }

  // "Price on request": the product carries price 0, so there is no number
  // to put on a line — unless the merchant answered this shopper's request
  // with one. The offer decides the price and fixes the quantity; without
  // one the buy box shows a quote button and this refuses the line, which is
  // what catches a tab left open from before the switch was flipped, a
  // cached card, or a hand-rolled POST.
  let quoteOffer: LiveQuoteOffer | null = null;
  if (isQuoteOnlyProduct(product)) {
    quoteOffer = await resolveOfferForLine({ userId, productId, variantId, quantity });
    if (!quoteOffer) {
      throw new CartRefusal(
        "This product is available by quote — request a price instead",
        "price_on_request",
      );
    }
  }

  const purchase = resolvePurchaseType({
    product,
    variantId,
    requestedQuantity: quantity,
    quoted: Boolean(quoteOffer),
  });
  if (!purchase) throw insufficientStock(product, variantId);
  options.admit?.({ product, variantId, purchaseType: purchase.purchaseType });

  const price = quoteOffer
    ? quoteOffer.unitPrice
    : selectedVariant
      ? selectedVariant.price
      : product.price;
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

  let cart =
    loaded === undefined
      ? ((await Cart.findOne(cartQuery(identity))) as CartDocument | null)
      : loaded;
  if (!cart) {
    cart = new Cart({
      userId: identity.userId || undefined,
      sessionId: identity.userId ? undefined : identity.sessionId,
      items: [],
    }) as CartDocument;
  }

  const existingItemIndex = cart.items.findIndex((item) => isSameLine(item, line));

  // Cap distinct lines: an unbounded cart lets a guest script thousands of
  // products into one oversized document (heavy $in validation on every GET).
  if (cart.items.length >= CART_LINE_CAP && existingItemIndex === -1) {
    throw new CartRefusal("Cart is full. Remove some items first.", "cart_full");
  }

  const requestedPurchaseType = purchase.purchaseType;
  const mixedItem = cart.items.find(
    (item) => (item.purchaseType || PURCHASE_TYPE.STANDARD) !== requestedPurchaseType,
  );
  if (mixedItem) {
    throw new CartRefusal(
      requestedPurchaseType === PURCHASE_TYPE.PREORDER
        ? "Pre-order items must be checked out separately from regular items"
        : "Regular items must be checked out separately from pre-order items",
      "mixed_purchase_types",
    );
  }

  if (existingItemIndex > -1) {
    // Adding again normally means "one more"; on a quoted line it means
    // "the lot I was quoted", because the offer is only good for that exact
    // quantity. Incrementing would push the line past it and the offer would
    // stop resolving at checkout — the shopper would watch their price
    // vanish for having clicked twice.
    const existing = cart.items[existingItemIndex];
    const newQuantity = quoteOffer ? quantity : existing.quantity + quantity;
    const nextPurchase = resolvePurchaseType({
      product,
      variantId,
      requestedQuantity: newQuantity,
      quoted: Boolean(quoteOffer),
    });
    if (!nextPurchase || nextPurchase.purchaseType !== requestedPurchaseType) {
      throw insufficientStock(product, variantId);
    }
    const preorderTerms =
      nextPurchase.purchaseType === PURCHASE_TYPE.PREORDER
        ? calculatePreorderDeposit({
            unitPrice: price,
            quantity: newQuantity,
            settings: getPreorderSettings(product, variantId),
            currency: await storeCurrency(),
          })
        : undefined;
    existing.quantity = newQuantity;
    existing.price = price;
    existing.quoteId = quoteOffer?.quoteId;
    existing.name = name;
    existing.variantName = variantName;
    existing.image = image;
    existing.purchaseType = requestedPurchaseType;
    existing.preorderReleaseDate =
      "preorderReleaseDate" in nextPurchase ? nextPurchase.preorderReleaseDate : undefined;
    existing.preorderMessage =
      "preorderMessage" in nextPurchase ? nextPurchase.preorderMessage : undefined;
    existing.preorderPaymentMode = preorderTerms?.paymentMode;
    existing.preorderDepositAmount = preorderTerms?.depositAmount;
    existing.preorderOutstandingAmount = preorderTerms?.outstandingAmount;
    existing.preorderSupplierEta =
      "preorderSupplierEta" in nextPurchase ? nextPurchase.preorderSupplierEta : undefined;
    existing.preorderBatchName =
      "preorderBatchName" in nextPurchase ? nextPurchase.preorderBatchName : undefined;
  } else {
    const preorderTerms =
      purchase.purchaseType === PURCHASE_TYPE.PREORDER
        ? calculatePreorderDeposit({
            unitPrice: price,
            quantity,
            settings: getPreorderSettings(product, variantId),
            currency: await storeCurrency(),
          })
        : undefined;
    cart.items.push({
      productId,
      variantId: variantId || undefined,
      quantity,
      price,
      quoteId: quoteOffer?.quoteId,
      name,
      variantName,
      image,
      purchaseType: requestedPurchaseType,
      preorderReleaseDate:
        "preorderReleaseDate" in purchase ? purchase.preorderReleaseDate : undefined,
      preorderMessage: "preorderMessage" in purchase ? purchase.preorderMessage : undefined,
      preorderPaymentMode: preorderTerms?.paymentMode,
      preorderDepositAmount: preorderTerms?.depositAmount,
      preorderOutstandingAmount: preorderTerms?.outstandingAmount,
      preorderSupplierEta:
        "preorderSupplierEta" in purchase ? purchase.preorderSupplierEta : undefined,
      preorderBatchName:
        "preorderBatchName" in purchase ? purchase.preorderBatchName : undefined,
    } as unknown as MutableCartItem);
  }

  await cart.save();
  return { status: "saved", cart };
}

/**
 * Take a line out of the cart.
 *
 * The line is the product's line without a variant, or the named variant's;
 * with `anyVariant` and no variant named, every line of the product goes
 * (`DELETE /api/cart?productId=`). Nothing is written when nothing matched.
 */
export async function removeCartLine(
  identity: CartIdentity,
  line: { productId: string; variantId?: string },
  options: { anyVariant?: boolean } = {},
): Promise<CartWriteResult> {
  await connectDB();
  const cart = (await Cart.findOne(cartQuery(identity))) as CartDocument | null;
  if (!cart) return { status: "no-cart" };

  const remaining = cart.items.filter((item) =>
    options.anyVariant && !line.variantId
      ? item.productId.toString() !== line.productId
      : !isSameLine(item, line),
  );
  if (remaining.length === cart.items.length) return { status: "no-line", cart };

  cart.items = remaining;
  await cart.save();
  return { status: "saved", cart };
}

/** Empty the cart by deleting it. */
export async function clearCart(identity: CartIdentity): Promise<void> {
  await connectDB();
  await Cart.deleteOne(cartQuery(identity));
}

/**
 * Move a guest's cart (by its session id) into a signed-in shopper's cart.
 * Without this, items added before sign-in silently disappear from view —
 * and on a shared browser the stale cookie can surface a previous guest's
 * cart to the next visitor. Item identity is (productId, variantId):
 * quantities are combined for matching lines; guest lines whose product
 * already exists with a different purchaseType are dropped (standard vs
 * preorder for one product is mutually exclusive). The guest cart is gone
 * afterwards; a guest id that opens no cart changes nothing.
 */
export async function mergeGuestCart(userId: string, sessionId: string): Promise<void> {
  await connectDB();
  // Delete-first claim: right after login the header and the page often BOTH
  // fetch the cart, so two requests can reach here concurrently. Only the one
  // that wins the delete performs the merge — otherwise each would add the
  // guest quantities on top of the other's merge (doubled lines).
  const guestCart = await Cart.findOneAndDelete({
    sessionId,
    userId: { $exists: false },
  }).lean<StoredCart>();
  if (!guestCart) return;

  const guestItems = (guestCart.items || []) as StoredCartItem[];
  if (guestItems.length === 0) return;

  const userCart = (await Cart.findOne({ userId })) as CartDocument | null;
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
    merged.map((item) => [item.productId?.toString(), item.purchaseType || "standard"]),
  );

  for (const guestItem of guestItems) {
    const existing = byKey.get(keyOf(guestItem));
    if (existing) {
      const combined = Number(existing.quantity || 0) + Number(guestItem.quantity || 0);
      if ((existing.purchaseType || PURCHASE_TYPE.STANDARD) === PURCHASE_TYPE.PREORDER) {
        // A pre-order line's deposit and balance are worked out for its
        // quantity. Adding the guest's units without working them out again
        // left the terms of the smaller line on the larger one — a pay-later
        // line of one merged to two owed its whole second unit today. Through
        // the one path that recomputes them; a merge the quota or the window
        // no longer allows keeps the account's line as it was.
        await setCartItemQuantity(
          { items: merged as unknown as Parameters<typeof setCartItemQuantity>[0]["items"] },
          {
            productId: String(existing.productId),
            variantId: existing.variantId ? String(existing.variantId) : undefined,
            quantity: combined,
          },
        ).catch(() => false);
        continue;
      }
      existing.quantity = combined;
      continue;
    }
    const productKey = guestItem.productId?.toString();
    const existingType = productPurchaseTypes.get(productKey);
    const guestType = guestItem.purchaseType || "standard";
    if (existingType && existingType !== guestType) continue;
    merged.push(guestItem);
    byKey.set(keyOf(guestItem), guestItem);
    productPurchaseTypes.set(productKey, guestType);
  }

  // save() (not updateOne) so the sliding-TTL pre-save hook also pushes
  // expiresAt out — a near-expiry cart that just received merged items must
  // not get TTL-deleted moments later.
  userCart.items = merged as MutableCartItem[];
  await userCart.save();
}

/**
 * What the product side says about each line: seller, captions, shipping,
 * final sale, visibility — and which lines a live quote offer covers. The
 * shopper's offers and the products are read at once; a signed-out shopper
 * has no offers, and that lookup costs nothing.
 */
export async function readLineFacts(
  items: Array<{ productId?: unknown; variantId?: unknown; quantity?: unknown }>,
  userId: string | undefined,
  options: { forApp?: boolean } = {},
): Promise<{
  facts: Map<string, CartProductFacts>;
  quoteOffers: Map<string, LiveQuoteOffer>;
}> {
  const lines = items.map((item) => ({
    productId: item.productId as { toString: () => string } | undefined,
    variantId: item.variantId as { toString: () => string } | undefined,
    quantity: Number(item.quantity ?? 0),
  }));
  const [shopperOffers, productRows] = await Promise.all([
    loadShopperOffers(userId, {
      productIds: lines
        .map((line) => line.productId?.toString())
        .filter((id): id is string => Boolean(id)),
    }),
    readCartProducts(lines, options),
  ]);
  const quoteOffers = matchOffersToLines(lines, shopperOffers);
  const facts = cartProductFacts(lines, productRows, {
    quotedLineKeys: new Set(quoteOffers.keys()),
  });
  return { facts, quoteOffers };
}

/** One line of the cart as the shopper sees it, priced as it is today. */
export type CartViewLine = {
  item: StoredCartItem;
  facts?: CartProductFacts;
  /** Priced by a live quote offer, for exactly the lot it holds. */
  quoted: boolean;
};

/** The cart as the shopper sees it right now. */
export type CartView = {
  /** Absent when this shopper has no cart. */
  cartId?: string;
  lines: CartViewLine[];
  totalItems: number;
  subtotal: number;
  /** What the rate engine prices: digital lines carry no weight. */
  shippableSubtotal: number;
  /** In the unit every shipping call site aggregates in. */
  totalWeight: number;
  hasShippableItems: boolean;
  hasDigitalItems: boolean;
  sellerCount: number;
  anySellerOffersPickup: boolean;
};

const NO_CART: CartView = {
  lines: [],
  totalItems: 0,
  subtotal: 0,
  shippableSubtotal: 0,
  totalWeight: 0,
  hasShippableItems: true,
  hasDigitalItems: false,
  sellerCount: 0,
  anySellerOffersPickup: false,
};

/**
 * The cart as the shopper sees it: `GET /api/cart`.
 *
 * Lines whose product left the store (deactivated, deleted, switched to
 * "price on request" without an offer for this shopper) are dropped, and the
 * stored cart is saved without them. Quoted lines are priced from the offer
 * as it stands today, not as it stood when the shopper accepted it.
 *
 * `alongside` is waited for together with the cart read (the web route's
 * rate-limit check: every page load asks for the cart, so the two are
 * overlapped). `cart` hands in a cart the caller already holds — one it just
 * saved — instead of reading it again. `forApp` reads what the app's cart
 * line shows beyond the web's (`CartLineAppFacts`).
 */
export async function getCartView(
  identity: CartIdentity,
  options: { alongside?: Promise<unknown>; cart?: StoredCart | null; forApp?: boolean } = {},
): Promise<CartView> {
  await connectDB();
  const query = cartQuery(identity);
  const [, cart] = await Promise.all([
    options.alongside,
    options.cart !== undefined
      ? options.cart
      : Cart.findOne(query).lean<StoredCart>(),
  ]);
  if (!cart) return { ...NO_CART, lines: [] };

  const storedItems = cart.items;
  // A quote-priced line is only in this cart because the shopper holds a
  // live offer for it, so the offers are resolved before anything else:
  // they decide both whether the line survives the visibility filter below
  // and what it is worth right now.
  const { facts: productFacts, quoteOffers } = await readLineFacts(
    storedItems,
    identity.userId,
    { forApp: options.forApp },
  );
  const visibleItems = storedItems.filter(
    (item) => productFacts.get(cartLineKey(item))?.visible,
  );
  if (visibleItems.length !== storedItems.length) {
    // Optimistic guard: this read-endpoint write must not clobber an item a
    // concurrent add just pushed — only apply if the cart is unchanged since
    // we read it. On interference the next GET re-filters anyway.
    await Cart.updateOne(
      { ...query, updatedAt: cart.updatedAt },
      { $set: { items: visibleItems } },
    );
  }

  // The merchant can re-quote while the line sits in the cart, so what the
  // shopper is shown comes from the offer rather than from the price stored
  // when they accepted it. Not persisted: checkout re-reads the offer too,
  // and a cart document is not the record of what was agreed.
  for (const item of visibleItems) {
    const offer = quoteOffers.get(quoteOfferLineKey(item.productId, item.variantId));
    if (offer) item.price = offer.unitPrice;
  }

  const totalItems = visibleItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = visibleItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

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

  return {
    cartId: String(cart._id),
    lines: visibleItems.map((item) => ({
      item,
      facts: productFacts.get(cartLineKey(item)),
      quoted: quoteOffers.has(quoteOfferLineKey(item.productId, item.variantId)),
    })),
    totalItems,
    subtotal,
    shippableSubtotal,
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
      (item) => !(productFacts.get(cartLineKey(item))?.requiresShipping ?? true),
    ),
    // What decides whether collection is on the table at all. Derived from
    // the same visible, physical lines the shopper is looking at, so the
    // cart can never claim a different number of sellers than it displays.
    sellerCount: countCartSellers(visibleItems, productFacts),
    // Whether the seller mix is genuinely what costs this bag its
    // collection option, rather than the store simply never offering one.
    anySellerOffersPickup: anySellerOffersPickup(visibleItems, productFacts),
  };
}
