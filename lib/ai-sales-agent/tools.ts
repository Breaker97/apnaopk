import mongoose from "mongoose";
import { Cart, Order, Product, User } from "@/models";
import { PRODUCT_STATUS } from "@/config/app.config";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { ValidationError } from "@/lib/api/errors";
import { getStorefrontProductConstraint } from "@/lib/catalog/product-visibility";
import { matchSearchEntities, parseProductSearch } from "@/lib/products/search";
import { getProductSearchEntityIndex } from "@/lib/products/search-entities";
import { getStorefrontProducts } from "@/lib/products/storefront-products";
import { recordZeroResultSearch } from "@/lib/products/zero-result-searches";
import {
  getPurchasableQuantity,
  isProductAvailable,
} from "@/lib/products/stock-policy";
import {
  cartPillFor,
  classifyQueryTokens,
  describeProductOptions,
  gradeProductMatch,
  mergeByCoverage,
  mergeRoundRobin,
  planSearchLadder,
  plainText,
  resolveVariantSelection,
  summarizeProductForModel,
  type AgentProduct,
  type AgentVariant,
  type LadderQuery,
  type MatchGrade,
} from "./catalogue";
import {
  getAgentCategoryDirectory,
  getAgentKnowledgeChunks,
  getAgentStoreContext,
} from "./store-context";
import {
  agentFaqChunks,
  categoryLineage,
  rankKnowledge,
  resolveCategoryRequest,
} from "./store-knowledge";
import type {
  AISalesChatAction,
  AISalesOrderStatusCard,
  AISalesProductCard,
  AISalesToolContext,
  AISalesToolResult,
} from "./types";

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

function productImage(product: AgentProduct, variant?: AgentVariant) {
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

function productStock(product: AgentProduct, variant?: AgentVariant) {
  return Number(variant ? variant.stock : product.stock) || 0;
}

function productPrice(product: AgentProduct, variant?: AgentVariant) {
  return Number(variant ? variant.price : product.price) || 0;
}

function toProductCard(
  product: AgentProduct,
  locale: string,
  variant?: AgentVariant,
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
    description: plainText(product.shortDescription || product.description, 170),
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
    "priceRange",
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
    "shipping",
    "inventory",
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
    .lean<AgentProduct[]>();
}

type CatalogueMatch = "browse" | "exact" | "partial" | "outside_budget" | "none";

/**
 * What the model is told about a search's outcome. State, never a script:
 * the prompt decides the wording, and the customer never sees these.
 */
const SEARCH_NOTES: Record<CatalogueMatch, string> = {
  browse:
    "No search words were given; these are the store's popular products within the given limits.",
  exact:
    "At least one of these products carries every search word in its name, category, brand, tags or options. The cards are rendered in the UI; do not restate the list. Use the product data to answer questions.",
  partial:
    "No product carries every search word in its name, category, brand, tags or options. These are the closest: matchedTerms on each product lists the words it matched, including words found only in its text or codes; unmatchedTerms lists the words no product matched.",
  outside_budget:
    "Products carrying every search word exist, but none inside the price limits given. These are the nearest ones by price.",
  none:
    "Verified: with the price and category filters removed, no product in the catalogue matched any of these words.",
};

const CATEGORY_UNKNOWN_NOTE =
  "The category was not one the store has, so the whole catalogue was searched.";
const CATEGORY_NAME_SEARCHED_NOTE =
  "The category was not one the store has; its name was searched as words across the whole catalogue instead.";
const CATEGORY_DROPPED_NOTE =
  "Nothing in that category matched; these are matches from the whole catalogue.";

/** How many "Add to cart" pills a search answer carries. */
const MAX_SEARCH_PILLS = 3;

type GradedResults = {
  products: AgentProduct[];
  grades: Map<string, MatchGrade>;
  /** Some product here is the thing asked for. */
  strong: boolean;
};

async function searchProductsTool(
  args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  const queryText = typeof args.query === "string" ? args.query.trim() : "";
  const limit = Math.min(
    Math.max(Number(args.limit) || ctx.settings.maxRecommendations || 4, 1),
    8,
  );
  // A category from the session state narrows the search, or is browsed on
  // its own. A name the store does not have is ignored, with a note, rather
  // than turned into an empty answer — and on its own it is searched as
  // words, never widened into a browse of the whole store.
  const requestedCategory =
    typeof args.category === "string" ? args.category.trim() : "";
  const directory = await getAgentCategoryDirectory();
  const category = requestedCategory
    ? resolveCategoryRequest(directory, requestedCategory)
    : null;
  const categoryNameSearched = Boolean(requestedCategory && !category && !queryText);
  const searchText = categoryNameSearched ? requestedCategory : queryText;
  const minPrice = typeof args.minPrice === "number" ? args.minPrice : undefined;
  const maxPrice = typeof args.maxPrice === "number" ? args.maxPrice : undefined;
  const hasBudget = minPrice !== undefined || maxPrice !== undefined;
  const facets = { limit, minPrice, maxPrice, category: category?.slug };

  // The storefront's own search — the same index, ranking and description
  // fallback the header search bar uses — so the agent recommends exactly
  // what a shopper would find. Every rung of the ladder is one cached call.
  const runFull = (
    search: string | undefined,
    sortBy?: string,
    overrides: Partial<typeof facets> = {},
  ) =>
    getStorefrontProducts<AgentProduct>({
      ...facets,
      ...overrides,
      search,
      sortBy,
    });
  const run = async (
    search: string | undefined,
    sortBy?: string,
    overrides: Partial<typeof facets> = {},
  ) => (await runFull(search, sortBy, overrides)).data;

  const parsed = searchText ? parseProductSearch(searchText) : null;
  let match: CatalogueMatch = "browse";
  let products: AgentProduct[] = [];
  let grades = new Map<string, MatchGrade>();
  let queryTerms: string[] = [];
  let categoryDropped = false;
  // Set when the storefront answered the full query with corrected words —
  // "ipone" searched as "iphone".
  let corrected: { from: string; to: string } | undefined;

  if (!parsed) {
    products = await run(undefined, "popular");
  } else {
    const first = planSearchLadder(parsed);
    const [entityIndex, full] = await Promise.all([
      getProductSearchEntityIndex(),
      runFull(first.full.query),
    ]);
    corrected = full.searchCorrection;
    // A misspelt query the engine corrected is graded, and widened, with the
    // words it was really answered with: "ipone" appears on no product row.
    const effective = (corrected && parseProductSearch(corrected.to)) || parsed;
    const ladder = effective === parsed ? first : planSearchLadder(effective);
    const query = classifyQueryTokens(
      effective,
      matchSearchEntities(effective, entityIndex),
    );
    queryTerms = query.tokens;
    const lineage = categoryLineage(directory);

    // A hit is graded against the product row itself, never trusted from
    // the engine: the engine matched "apple iphone" to a watch whose spec
    // sheet mentions iPhones. `matched` is what each rung is known to have
    // matched, which the grade keeps for the model.
    const grade = (
      rows: AgentProduct[],
      matched: Map<string, string[]>,
    ): GradedResults => {
      const graded = new Map<string, MatchGrade>();
      let strong = false;
      for (const product of rows) {
        const id = String(product._id);
        const result = gradeProductMatch(
          product,
          query,
          matched.get(id) ?? [],
          lineage.get(product.category?.slug ?? "") ?? [],
        );
        graded.set(id, result);
        strong ||= result.strong;
      }
      return { products: rows, grades: graded, strong };
    };
    const gradeRung = (tokens: string[], rows: AgentProduct[]) =>
      grade(rows, new Map(rows.map((product) => [String(product._id), tokens])));
    const runRungs = (rungs: LadderQuery[]) =>
      Promise.all(
        rungs.map(async (rung) => ({
          tokens: rung.tokens,
          products: await run(rung.query),
        })),
      );

    let found = gradeRung(ladder.full.tokens, full.data);

    // Nothing, or nothing that is the thing asked for: widen. One word
    // dropped at a time, all rungs at once — each is a cached, index-bounded
    // storefront query, and the customer is waiting. The full rung's own
    // hits stay in the merge: they did match every word, if only weakly.
    if (!found.strong && ladder.leaveOneOut.length > 0) {
      const merged = mergeRoundRobin(
        [
          { tokens: ladder.full.tokens, products: full.data },
          ...(await runRungs(ladder.leaveOneOut)),
        ],
        limit,
      );
      found = grade(merged.products, merged.matched);
    }
    if (found.products.length === 0 && ladder.singles.length > 0) {
      const merged = mergeByCoverage(await runRungs(ladder.singles), limit);
      found = grade(merged.products, merged.matched);
    }

    // Still not the thing asked for. Before the answer is "no", the filters
    // come off: the words may be right and the budget or the category wrong,
    // and each is a different answer for the customer. The strong matches
    // outside the budget are shown nearest price first — cheapest when a
    // ceiling excluded them, dearest when a floor did.
    const nearestPrice = maxPrice !== undefined ? "price-asc" : "price-desc";
    const strongWithout = async (
      overrides: Partial<typeof facets>,
    ): Promise<GradedResults | null> => {
      const rows = await run(ladder.full.query, nearestPrice, overrides);
      const graded = gradeRung(ladder.full.tokens, rows);
      if (!graded.strong) return null;
      return {
        ...graded,
        products: rows.filter((product) => graded.grades.get(String(product._id))?.strong),
      };
    };
    const noBudget = { minPrice: undefined, maxPrice: undefined };
    let outsideBudget: GradedResults | null = null;
    if (!found.strong) {
      if (hasBudget) outsideBudget = await strongWithout(noBudget);
      if (!outsideBudget && category) {
        // The words may be right and the category wrong — a phone case
        // filed under Accessories while the model guessed Phones.
        if (found.products.length === 0) {
          const rows = await run(ladder.full.query, undefined, { category: undefined });
          if (rows.length > 0) {
            categoryDropped = true;
            found = gradeRung(ladder.full.tokens, rows);
          }
        }
        if (!found.strong && hasBudget) {
          outsideBudget = await strongWithout({ ...noBudget, category: undefined });
          if (outsideBudget) categoryDropped = true;
        }
      }
    }

    if (outsideBudget) {
      match = "outside_budget";
      ({ products, grades } = outsideBudget);
    } else {
      grades = found.grades;
      // The thing asked for leads the cards; among the rest, the product
      // that answers more of the words comes first, and a stray hit last.
      const rank = (product: AgentProduct) => {
        const grade = grades.get(String(product._id));
        return grade ? (grade.strong ? 1000 : 0) + grade.satisfied : 0;
      };
      products = [...found.products].sort((a, b) => rank(b) - rank(a));
      match = products.length === 0 ? "none" : found.strong ? "exact" : "partial";
    }
  }

  const cards = products.map((product) => toProductCard(product, ctx.locale));
  const actions: AISalesChatAction[] = ctx.settings.capabilities.cartActions
    ? products
        .flatMap((product): AISalesChatAction[] => {
          const pill = cartPillFor(product);
          if (!pill) return [];
          return [
            {
              type: "add_to_cart",
              label: "Add to cart",
              productId: String(product._id),
              variantId: pill.variantId,
            },
          ];
        })
        .slice(0, MAX_SEARCH_PILLS)
    : [];

  const summaries = products.map((product) =>
    summarizeProductForModel(product, {
      matchedTerms: grades.get(String(product._id))?.matchedTerms,
    }),
  );
  const covered = new Set(summaries.flatMap((summary) => summary.matchedTerms ?? []));

  // Verified with every filter removed: a product the store does not sell.
  // The admin's Search insights report counts it. A replay of a past turn
  // only reads.
  if (match === "none" && !ctx.replay) {
    recordZeroResultSearch({
      query: searchText,
      source: "assistant",
      clientKey: ctx.userId || ctx.sessionId,
    });
  }

  return {
    content: JSON.stringify({
      match,
      query: searchText,
      queryTerms,
      ...(hasBudget ? { budget: { minPrice, maxPrice } } : {}),
      ...(match === "partial"
        ? { unmatchedTerms: queryTerms.filter((term) => !covered.has(term)) }
        : {}),
      ...(requestedCategory
        ? {
            category: {
              requested: requestedCategory,
              resolved: category
                ? { name: category.name, slug: category.slug }
                : null,
              ...(categoryDropped ? { dropped: true } : {}),
            },
          }
        : {}),
      ...(corrected ? { corrected } : {}),
      products: summaries,
      note: [
        SEARCH_NOTES[match],
        corrected && products.length > 0
          ? `The search words were misspelt; these results are for "${corrected.to}". If the customer's spelling differed, confirm it in passing.`
          : "",
        requestedCategory && !category
          ? categoryNameSearched
            ? CATEGORY_NAME_SEARCHED_NOTE
            : CATEGORY_UNKNOWN_NOTE
          : "",
        categoryDropped ? CATEGORY_DROPPED_NOTE : "",
      ]
        .filter(Boolean)
        .join(" "),
    }),
    productCards: cards,
    actions,
    recommendedProductIds: cards.map((card) => card.id),
    search: {
      query: searchText,
      match,
      ...(category ? { category: category.slug } : {}),
    },
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
  return {
    content: JSON.stringify({
      product: summarizeProductForModel(product, { variantLimit: 24 }),
      description: plainText(product.description, 900),
      tags: product.tags || [],
    }),
    productCards: cards,
    recommendedProductIds: cards.map((card) => card.id),
  };
}

/** A locale-less page path as the customer's own locale would reach it. */
function localizePath(locale: string, path: string | undefined) {
  return path ? `/${locale}${path}` : undefined;
}

async function getStoreContextTool(
  _args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  // The merchant's real configuration — checkout's payment methods, the
  // shipping rates and delivery times, the policy pages — not a placeholder
  // the model would have to talk around.
  const context = await getAgentStoreContext();
  return {
    content: JSON.stringify({
      ...context,
      policies: {
        ...context.policies,
        ...(context.policies.returns
          ? {
              returns: {
                ...context.policies.returns,
                path: localizePath(ctx.locale, context.policies.returns.path),
              },
            }
          : {}),
        pages: context.policies.pages.map((page) => ({
          ...page,
          path: localizePath(ctx.locale, page.path),
        })),
      },
      checkout: `Secure checkout is at /${ctx.locale}/checkout; it collects address and payment details.`,
      escalationMessage: ctx.settings.escalationMessage,
    }),
  };
}

async function getStoreFaqTool(
  args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  // The agent's own FAQ first, then whatever the merchant published — the
  // FAQ page, the returns policy, terms, custom pages — cut into paragraphs.
  const chunks = [
    ...agentFaqChunks(Array.isArray(ctx.settings.faq) ? ctx.settings.faq : []),
    ...(await getAgentKnowledgeChunks()),
  ];
  if (chunks.length === 0) {
    return {
      content:
        "NO_FAQ: the store has published no FAQ or policy pages. Answer briefly using general ecommerce norms only when safe (e.g. checkout is online); otherwise offer to connect the customer with the store team.",
    };
  }

  const query = typeof args.query === "string" ? args.query : "";
  const top = rankKnowledge(chunks, query, 3);
  if (top.length === 0) {
    return {
      content: JSON.stringify({
        status: "NO_MATCH",
        note: "Nothing in the FAQ or the policy pages mentions this. Do not invent a policy; offer to connect the customer with the store team.",
        sources: Array.from(new Set(chunks.map((chunk) => chunk.source))),
      }),
    };
  }

  return {
    content: JSON.stringify({
      entries: top.map((chunk) => ({
        source: chunk.source,
        title: chunk.title,
        text: chunk.text,
        ...(chunk.path ? { path: localizePath(ctx.locale, chunk.path) } : {}),
      })),
    }),
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

function optionsArgument(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function addToCartTool(
  args: Record<string, unknown>,
  ctx: AISalesToolContext,
): Promise<AISalesToolResult> {
  if (!ctx.settings.capabilities.cartActions) {
    return { content: "Cart actions are disabled." };
  }
  const productId = typeof args.productId === "string" ? args.productId : "";
  const quantity = Math.min(Math.max(Number(args.quantity) || 1, 1), 100);
  const products = await findVisibleProducts({ _id: productId }, 1);
  const product = products[0];
  if (!product) throw new ValidationError("Product is not available");
  if (isQuoteOnlyProduct(product)) {
    throw new ValidationError(
      "This product is sold by quote — the customer needs to request a price on the product page",
    );
  }

  // The customer's choice in whatever form the model has it: an id from the
  // search result, option values, or their own words. The cart refuses a
  // variant product without a variant, so an unresolved choice becomes the
  // question to ask rather than a silently wrong line.
  const resolution = resolveVariantSelection(product, {
    variantId: typeof args.variantId === "string" ? args.variantId : undefined,
    options: optionsArgument(args.options),
    variant: typeof args.variant === "string" ? args.variant : undefined,
  });
  if (resolution.kind === "not_found" || resolution.kind === "ambiguous") {
    const candidates =
      resolution.kind === "ambiguous" ? resolution.candidates : product.variants || [];
    return {
      content: JSON.stringify({
        status: "NEEDS_VARIANT",
        product: product.name,
        reason:
          resolution.kind === "ambiguous"
            ? "Several variants fit; ask the customer to choose one of the candidates."
            : "No variant matches that choice; ask the customer to pick from the options.",
        options: describeProductOptions(product),
        candidates: candidates.slice(0, 12).map((variant) => ({
          variantId: String(variant._id),
          name: variant.name,
          price: variant.price,
          inStock: isProductAvailable(product, variant.stock),
        })),
      }),
    };
  }
  const selectedVariant =
    resolution.kind === "selected" ? resolution.variant : undefined;
  const variantId = selectedVariant?._id ? String(selectedVariant._id) : undefined;

  // Not `stock > 0`: a digital or untracked product is always purchasable —
  // see lib/products/stock-policy.ts.
  const purchasable = getPurchasableQuantity(
    product,
    productStock(product, selectedVariant),
  );
  if (quantity > purchasable) throw new ValidationError("Insufficient stock");

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
    if (nextQuantity > purchasable) throw new ValidationError("Insufficient stock");
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
