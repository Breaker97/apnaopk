import type { IAISalesAgentSettings } from "@/models/settings.model";
import type { AISalesFallbackReason } from "./fallback";

type AISalesChatRole = "user" | "assistant";

export type AISalesProductCard = {
  id: string;
  variantId?: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  price: number;
  comparePrice?: number;
  /**
   * Sold by quote: the card prints "Price on request" instead of `price`, and
   * carries no Add-to-cart action. See lib/products/quote-pricing.ts.
   */
  priceOnRequest?: boolean;
  stock: number;
  url: string;
};

export type AISalesOrderStatusCard = {
  orderId: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  items: Array<{ name: string; quantity: number; image?: string }>;
  placedAt?: string;
  url?: string;
};

export type AISalesChatAction =
  | {
      type: "add_to_cart";
      label: string;
      productId: string;
      variantId?: string;
    }
  | {
      type: "checkout";
      label: string;
      href: string;
    };

export type AISalesChatMessage = {
  id: string;
  role: AISalesChatRole;
  content: string;
  productCards?: AISalesProductCard[];
  orderCards?: AISalesOrderStatusCard[];
  actions?: AISalesChatAction[];
  /** Set when the reply was made from the catalogue without the model. */
  fallback?: AISalesFallbackReason;
};

export type AISalesChatResponse = {
  conversationId: string;
  message: AISalesChatMessage;
  cartUpdated?: boolean;
  checkoutUrl?: string;
  settings?: PublicAISalesAgentConfig;
};

export type PublicAISalesAgentConfig = {
  enabled: boolean;
  configured: boolean;
  agentName: string;
  greeting: string;
  widget: IAISalesAgentSettings["widget"];
  capabilities: IAISalesAgentSettings["capabilities"];
  faviconUrl?: string;
};

/**
 * One line of the streamed chat reply, newline-delimited JSON. `tools` lands
 * as soon as a hop's tools finish, so the cards render while the model is
 * still composing; `delta` carries the text as it is written; `done` is the
 * persisted message, authoritative over everything streamed before it.
 */
export type AISalesStreamEvent =
  | { type: "meta"; conversationId: string }
  | {
      type: "tools";
      productCards?: AISalesProductCard[];
      orderCards?: AISalesOrderStatusCard[];
      actions?: AISalesChatAction[];
    }
  | { type: "delta"; text: string }
  | {
      type: "done";
      conversationId: string;
      message: AISalesChatMessage;
      cartUpdated?: boolean;
      checkoutUrl?: string;
      settings?: PublicAISalesAgentConfig;
    }
  | { type: "error"; message: string };

export type AISalesToolContext = {
  locale: string;
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  origin: string;
  settings: IAISalesAgentSettings;
  /**
   * A past turn re-run for diagnosis (scripts/ai-sales-agent-replay.ts):
   * the tools read, and never count a miss in Search insights.
   */
  replay?: boolean;
};

/**
 * The search tool's verdict on a turn, kept on the assistant message and
 * handed back as `SESSION_STATE.lastSearch` — so the model's memory of what
 * it found is the tool's verdict, not its own earlier sentence about it.
 */
export type AISalesSearchVerdict = {
  query: string;
  match: string;
  category?: string;
};

export type AISalesToolResult = {
  content: string;
  productCards?: AISalesProductCard[];
  orderCards?: AISalesOrderStatusCard[];
  actions?: AISalesChatAction[];
  cartUpdated?: boolean;
  checkoutUrl?: string;
  cartSessionId?: string;
  recommendedProductIds?: string[];
  search?: AISalesSearchVerdict;
};
