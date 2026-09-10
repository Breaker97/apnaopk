import mongoose from "mongoose";
import { Cart, Order, Product, User } from "@/models";
import { PRODUCT_STATUS } from "@/config/app.config";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { ValidationError } from "@/lib/api/errors";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import {
  buildProductAgentSearch,
  scoreProductRelevance,
  tokenizeProductSearch,
} from "@/lib/products/search";
import type {
  AISalesChatAction,
  AISalesOrderStatusCard,
  AISalesProductCard,
  AISalesToolContext,
  AISalesToolResult,
} from "./types";

type ProductVariantDoc = {
  _id?: unknown;
  name?: string;
  price?: number;
  comparePrice?: number;
  stock?: number;
  image?: string;
  mediaId?: string;
  optionValues?: unknown;
};

type ProductMediaDoc = {
  _id?: unknown;
  url?: string;
};

type ProductDoc = {
  _id?: unknown;
  name?: string;
  slug?: string;
  handle?: string;
  description?: string;
  shortDescription?: string;
  price?: number;
  comparePrice?: number;
  priceOnRequest?: boolean;
  stock?: number;
  images?: string[];
  media?: ProductMediaDoc[];
  category?: { name?: string; slug?: string };
  tags?: string[];
  variants?: ProductVariantDoc[];
};

type CartItemDoc = {
  productId?: unknown;
  variantId?: unknown;
  quantity?: number;
  price?: number;
  name?: string;
  image?: string;
};

type CartDoc = {
  items?: CartItemDoc[];
};

type OrderItemDoc = {
  name?: string;
  quantity?: number;
  image?: string;
};

type OrderDoc = {
  _id?: unknown;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  total?: number;
  createdAt?: Date | string;
  items?: OrderItemDoc[];
  customerId?: unknown;
  shippingAddress?: { phone?: string };
};

function safeText(value: unknown, max = 240) {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function productImage(product: ProductDoc, variant?: ProductVariantDoc) {
  return (
    variant?.image ||
    (variant?.mediaId
      ? product.media?.find((m) => m._id === variant.mediaId)?.url
      : undefined) ||
    product.images?.[0] ||
    product.media?.[0]?.url ||
    ""
  );
}

function productStock(product: ProductDoc, variant?: ProductVariantDoc) {
  return Number(variant ? variant.stock : product.stock) || 0;
}

function productPrice(product: ProductDoc, variant?: ProductVariantDoc) {
  return Number(variant ? variant.price : product.price) || 0;
}

function toProductCard(
  product: ProductDoc,
  locale: string,
  variant?: ProductVariantDoc,
): AISalesProductCard {
  const id = String(product._id);
  const variantId = variant?._id ? String(variant._id) : undefined;
  const productName = product.name || "Product";
  const name = variant?.name ? `${productName} - ${variant.name}` : productName;
  const slug = product.slug || product.handle || id;
  return {
    id,
    variantId,
    name,
    slug: String(slug),
    description: safeText(product.shortDescription || product.description, 170),
    image: productImage(product, variant),
    price: productPrice(product, variant),
    comparePrice:
      typeof variant?.comparePrice === "number"
        ? variant.comparePrice
        : typeof product.comparePrice === "number"
          ? product.comparePrice
          : undefined,
    priceOnRequest: isQuoteOnlyProduct(product) || undefined,
    stock: productStock(product, variant),
    url: `/${locale}/products/${slug}`,
  };
}

function productPublicSelect() {
  return [
    "name",
    "title",
    "slug",
    "handle",
    "description",
    "shortDescription",
    "price",
    "comparePrice",
    "priceOnRequest",
    "stock",
    "sku",
    "images",
    "media",
    "category",
    "productType",
    "tags",
    "variants",
    "options",
    "status",
    "productSource",
    "rating",
    "reviewCount",
    "featured",
  ].join(" ");
}

async function findVisibleProducts(query: Record<string, unknown>, limit: number) {
  return Product.find({
    status: PRODUCT_STATUS.ACTIVE,
    ...(await getStorefrontProductConstraint()),
    ...query,
  })
    .select(productPublicSelect())
    .populate("category", "name slug")
    .sort({ featured: -1, reviewCount: -1, rating: -1, createdAt: -1 })
    .limit(limit)
    .lean<ProductDoc[]>();
}

async function searchProductsTool(
  args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  const queryText = typeof args.query === "string" ? args.query : "";
  const limit = Math.min(
    Math.max(Number(args.limit) || ctx.settings.maxRecommendations || 4, 1),
    8,
  );

  const extraQuery: Record<string, unknown> = {};
  if (typeof args.maxPrice === "number") extraQuery.price = { $lte: args.maxPrice };
  if (typeof args.minPrice === "number") {
    extraQuery.price = {
      ...(extraQuery.price as Record<string, number>),
      $gte: args.minPrice,
    };
  }
  if (typeof args.tag === "string" && args.tag.trim()) {
    extraQuery.tags = args.tag.trim();
  }

  const searchQuery = buildProductAgentSearch(queryText);
  // Fetch up to limit*3 candidates so the in-app re-rank has room to surface
  // the strongest matches (name+tag matches over description-only matches).
  const candidateLimit = Math.min(limit * 3, 24);
  let products: ProductDoc[] = [];

  if (searchQuery) {
    products = await findVisibleProducts(
      { ...extraQuery, $and: [searchQuery] },
      candidateLimit,
    );
    if (products.length === 0) {
      // Fallback: token-only tag match for the rare case where regex misses
      // (e.g. abbreviations or non-ASCII variants we haven't synonymed).
      const tokens = tokenizeProductSearch(queryText);
      if (tokens.length > 0) {
        products = await findVisibleProducts(
          { ...extraQuery, tags: { $in: tokens } },
          candidateLimit,
        );
      }
    }
  } else {
    products = await findVisibleProducts(extraQuery, limit);
  }

  // App-side relevance re-rank so name/tag matches beat description-only matches.
  if (queryText && products.length > 1) {
    const scored = products.map((product) => ({
      product,
      score: scoreProductRelevance(product, queryText),
    }));
    scored.sort((a, b) => b.score - a.score);
    products = scored.slice(0, limit).map((entry) => entry.product);
  } else {
    products = products.slice(0, limit);
  }

  const cards = products.map((product) => toProductCard(product, ctx.locale));
  const actions: AISalesChatAction[] = cards
    // No Add-to-cart pill for a quoted product: the cart API refuses the line,
    // so the pill could only ever end in an error the shopper did nothing to
    // deserve. The card still appears — the agent may recommend it, the
    // shopper follows the link and requests a price there.
    .filter(
      (card) =>
        ctx.settings.capabilities.cartActions &&
        card.stock > 0 &&
        !card.priceOnRequest,
    )
    .slice(0, 3)
    .map((card) => ({
      type: "add_to_cart",
      label: "Add to cart",
      productId: card.id,
      variantId: card.variantId,
    }));

  return {
    content:
      cards.length > 0
        ? `RESULTS: ${cards.length} product${cards.length === 1 ? "" : "s"} returned and rendered as cards in the UI, ordered by relevance to the query. Do not list them in text.`
        : `NO_RESULTS: the store does not currently sell any product matching "${queryText || "this request"}". Tell the customer in one short sentence the store does not carry this. Do not ask narrowing questions. You may offer to search a related category.`,
    productCards: cards,
    actions,
    recommendedProductIds: cards.map((card) => card.id),
  };
}

async function getProductDetailsTool(
  args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  const productId = typeof args.productId === "string" ? args.productId : "";
  const slug = typeof args.slug === "string" ? args.slug : "";
  let query: Record<string, unknown> | null = null;
  if (productId && mongoose.isValidObjectId(productId)) {
    query = { _id: productId };
  } else if (slug) {
    query = { slug };
  }
  if (!query) {
    return {
      content:
        "NOT_FOUND: no product matched. Use the data from the product cards already returned to the user instead of asking the customer for retries.",
    };
  }
  const products = await findVisibleProducts(query, 1);
  const product = products[0];
  if (!product) {
    return {
      content:
        "NOT_FOUND: no product matched. Use the data from the product cards already returned to the user instead of asking the customer for retries.",
    };
  }
  const cards = [toProductCard(product, ctx.locale)];
  const variants = Array.isArray(product.variants)
    ? product.variants.slice(0, 8).map((variant) => ({
        id: String(variant._id),
        name: variant.name,
        price: variant.price,
        stock: variant.stock,
        options: variant.optionValues,
      }))
    : [];
  return {
    content: JSON.stringify({
      product: cards[0],
      description: safeText(product.description, 900),
      category: product.category?.name,
      tags: product.tags || [],
      variants,
    }),
    productCards: cards,
    recommendedProductIds: cards.map((card) => card.id),
  };
}

async function getStoreContextTool(
  _args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  return {
    content: JSON.stringify({
      locale: ctx.locale,
      checkout: "Secure checkout is available through the store checkout page.",
      paymentMethods: "Payment options are shown during checkout.",
      escalationMessage: ctx.settings.escalationMessage,
    }),
  };
}

async function getStoreFaqTool(
  args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  const faq = Array.isArray(ctx.settings.faq) ? ctx.settings.faq : [];
  if (faq.length === 0) {
    return {
      content:
        "NO_FAQ: no FAQ has been configured. Answer briefly using general ecommerce norms only when safe (e.g. checkout is online); otherwise offer to connect the customer with the store team.",
    };
  }

  const tokens = tokenizeProductSearch(typeof args.query === "string" ? args.query : "");
  const scored = faq
    .map((entry) => {
      const haystack = [
        entry.question || "",
        entry.answer || "",
        ...(Array.isArray(entry.tags) ? entry.tags : []),
      ]
        .join(" ")
        .toLowerCase();
      const hits = tokens.reduce(
        (sum, token) => (haystack.includes(token.toLowerCase()) ? sum + 1 : sum),
        0,
      );
      return { entry, hits };
    })
    .sort((a, b) => b.hits - a.hits);

  // Return top 3 by token hits; if zero hits across all, return first 3 as
  // fallback so the model still has something to ground a generic reply.
  const top = scored.slice(0, 3).map(({ entry }) => ({
    question: safeText(entry.question, 200),
    answer: safeText(entry.answer, 600),
  }));

  return {
    content: JSON.stringify({ faq: top }),
  };
}

async function getCartSummaryTool(
  _args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  const query = ctx.userId
    ? { userId: ctx.userId }
    : ctx.sessionId
      ? { sessionId: ctx.sessionId }
      : null;
  if (!query) return { content: "The cart is empty." };
  const cart = await Cart.findOne(query).lean<CartDoc | null>();
  const items = cart?.items || [];
  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
  return {
    content: JSON.stringify({
      totalItems: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      subtotal,
      items: items.map((item) => ({
        productId: String(item.productId),
        variantId: item.variantId ? String(item.variantId) : undefined,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
      })),
    }),
  };
}

async function addToCartTool(
  args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  if (!ctx.settings.capabilities.cartActions) {
    return { content: "Cart actions are disabled." };
  }
  const productId = typeof args.productId === "string" ? args.productId : "";
  const variantId = typeof args.variantId === "string" ? args.variantId : undefined;
  const quantity = Math.min(Math.max(Number(args.quantity) || 1, 1), 100);
  const products = await findVisibleProducts({ _id: productId }, 1);
  const product = products[0];
  if (!product) throw new ValidationError("Product is not available");
  if (isQuoteOnlyProduct(product)) {
    throw new ValidationError(
      "This product is sold by quote — the customer needs to request a price on the product page",
    );
  }

  const selectedVariant = variantId
    ? product.variants?.find((variant) => String(variant._id) === variantId)
    : undefined;
  if (variantId && !selectedVariant) throw new ValidationError("Variant not found");

  const stock = productStock(product, selectedVariant);
  if (stock <= 0 || quantity > stock) throw new ValidationError("Insufficient stock");

  let sessionId = ctx.sessionId;
  if (!ctx.userId && !sessionId) sessionId = crypto.randomUUID();
  const query = ctx.userId ? { userId: ctx.userId } : { sessionId };
  let cart = await Cart.findOne(query);
  if (!cart) {
    cart = new Cart({
      userId: ctx.userId || undefined,
      sessionId: ctx.userId ? undefined : sessionId,
      items: [],
    });
  }

  const price = productPrice(product, selectedVariant);
  const baseName = product.name || "Product";
  const name = selectedVariant?.name
    ? `${baseName} - ${selectedVariant.name}`
    : baseName;
  const image = productImage(product, selectedVariant);
  const existingIndex = cart.items.findIndex(
    (item: CartItemDoc) =>
      String(item.productId) === productId &&
      (variantId ? String(item.variantId) === variantId : !item.variantId),
  );

  if (existingIndex >= 0) {
    const nextQuantity = cart.items[existingIndex].quantity + quantity;
    if (nextQuantity > stock) throw new ValidationError("Insufficient stock");
    cart.items[existingIndex].quantity = nextQuantity;
    cart.items[existingIndex].price = price;
    cart.items[existingIndex].name = name;
    cart.items[existingIndex].image = image;
  } else {
    cart.items.push({ productId, variantId, quantity, price, name, image });
  }
  cart.lastActionAt = new Date();
  cart.status = "active";
  await cart.save();

  return {
    content: `Added ${quantity} x ${name} to the cart.`,
    cartUpdated: true,
    cartSessionId: sessionId,
    productCards: [toProductCard(product, ctx.locale, selectedVariant)],
  };
}

async function startCheckoutTool(
  _args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  if (!ctx.settings.capabilities.checkoutHandoff) {
    return { content: "Checkout handoff is disabled." };
  }

  // Gate on a non-empty cart so the agent never hands off a button that leads
  // to a blank checkout. Match the same lookup as addToCartTool.
  const query = ctx.userId
    ? { userId: ctx.userId }
    : ctx.sessionId
      ? { sessionId: ctx.sessionId }
      : null;
  const cart = query ? await Cart.findOne(query).lean<CartDoc | null>() : null;
  const itemCount =
    cart?.items?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0;
  if (itemCount === 0) {
    return {
      content:
        "EMPTY_CART: the cart is empty. Tell the customer they need to add at least one item before checking out. Do not show a checkout button.",
    };
  }

  const checkoutUrl = `/${ctx.locale}/checkout`;
  return {
    content: `Checkout is ready at ${checkoutUrl}.`,
    checkoutUrl,
    actions: [{ type: "checkout", label: "Check out here!", href: checkoutUrl }],
  };
}

async function getOrderStatusTool(
  args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  if (!ctx.settings.capabilities.orderStatus) {
    return { content: "Order status lookup is disabled." };
  }

  const orderNumber =
    typeof args.orderNumber === "string" ? args.orderNumber.trim() : "";
  const email =
    typeof args.email === "string" ? args.email.trim().toLowerCase() : "";
  const phone = typeof args.phone === "string" ? args.phone.trim() : "";

  let orders: OrderDoc[] = [];
  if (ctx.userId) {
    const query: Record<string, unknown> = { customerId: ctx.userId };
    if (orderNumber) query.orderNumber = orderNumber;
    orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(orderNumber ? 1 : 5)
      .lean<OrderDoc[]>();
  } else {
    if (!orderNumber || (!email && !phone)) {
      return {
        content:
          "For privacy, please provide your order number and the email or phone used at checkout.",
      };
    }
    const candidate = await Order.findOne({ orderNumber }).lean<OrderDoc | null>();
    if (candidate) {
      // Normalize phone to digits-only for comparison so different formats
      // ("+1 555 ..." vs "5555550100") still match.
      const digitsOnly = (value: string) => value.replace(/\D+/g, "");
      const phoneMatch =
        Boolean(phone) &&
        digitsOnly(candidate.shippingAddress?.phone || "") === digitsOnly(phone);
      let emailMatch = false;
      if (email && candidate.customerId) {
        const user = (await User.findById(candidate.customerId)
          .select("email")
          .lean()) as { email?: string } | null;
        emailMatch =
          Boolean(user?.email) &&
          user!.email!.toLowerCase() === email;
      }
      if (phoneMatch || emailMatch) {
        orders = [candidate];
      }
    }
  }

  if (!orders.length) return { content: "I could not find a matching order." };

  const cards: AISalesOrderStatusCard[] = orders.map((order) => ({
    orderId: String(order._id),
    orderNumber: order.orderNumber || "",
    status: order.status || "pending",
    paymentStatus: order.paymentStatus || "pending",
    total: Number(order.total || 0),
    placedAt: order.createdAt ? new Date(order.createdAt).toISOString() : undefined,
    url: ctx.userId && order.orderNumber ? `/${ctx.locale}/account/orders/${order.orderNumber}` : undefined,
    items: (order.items || []).slice(0, 5).map((item) => ({
      name: item.name || "Item",
      quantity: item.quantity || 0,
      image: item.image,
    })),
  }));
  return {
    content: `Found ${cards.length} order${cards.length === 1 ? "" : "s"}.`,
    orderCards: cards,
  };
}

export const aiSalesToolHandlers = {
  search_products: searchProductsTool,
  get_product_details: getProductDetailsTool,
  get_store_context: getStoreContextTool,
  get_store_faq: getStoreFaqTool,
  get_cart_summary: getCartSummaryTool,
  add_to_cart: addToCartTool,
  start_checkout: startCheckoutTool,
  get_order_status: getOrderStatusTool,
};
