import type { IAISalesAgentSettings } from "@/models/settings.model";

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

export type AISalesToolContext = {
  locale: string;
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  origin: string;
  settings: IAISalesAgentSettings;
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
};
