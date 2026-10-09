import type { Types } from "mongoose";
import type { ApiSession } from "@/lib/api/handler";
import type { ConversationChannel } from "@/models/conversation.model";

export type ConversationViewer =
  | {
      kind: "admin";
      userId: string;
      name: string;
      email?: string;
      image?: string;
    }
  | {
      kind: "vendor";
      userId: string;
      vendorId: string;
      name: string;
      email?: string;
      image?: string;
      permissions: string[];
    }
  | {
      kind: "staff";
      userId: string;
      vendorIds: string[];
      name: string;
      email?: string;
      image?: string;
      permissions: string[];
    }
  | {
      kind: "customer";
      userId: string;
      name: string;
      email?: string;
      image?: string;
    }
  | {
      kind: "guest";
      guestKeyHash: string;
      name?: string;
      email?: string;
    };

export interface ConversationDTO {
  _id: string;
  channel: ConversationChannel;
  ownerType: "platform" | "vendor";
  ownerVendorId?: string;
  ownerName?: string;
  contact: {
    name: string;
    email?: string;
    phone?: string;
    image?: string;
  };
  /** The shopper account that wrote it signed in; for the store's side only. */
  customerUserId?: string;
  subject: string;
  status: "open" | "pending" | "resolved" | "closed" | "spam";
  assignedTo?: {
    userId: string;
    name: string;
    image?: string;
  };
  productContext?: {
    productId: string;
    vendorId?: string;
    name: string;
    slug: string;
    image?: string;
    variantId?: string;
    variantName?: string;
  };
  lastMessageId?: string;
  lastMessagePreview: string;
  lastMessageAt: string;
  replyWindowExpiresAt?: string;
  humanAgentWindowExpiresAt?: string;
  unreadCount: number;
  unreadForCustomer: number;
  unreadForStore: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageDTO {
  _id: string;
  conversationId: string;
  channel: ConversationChannel;
  direction: "inbound" | "outbound" | "internal";
  senderType: "customer" | "guest" | "vendor" | "staff" | "admin" | "system";
  senderUserId?: string;
  senderName: string;
  body: string;
  attachments: Array<{
    type: "image" | "video" | "audio" | "document";
    url: string;
    name?: string;
    mimeType?: string;
    size?: number;
  }>;
  /**
   * A product shared in the message, as it was when sent. Prices are plain
   * amounts in `currency` (the store's currency code then); absent for a
   * price-on-request product.
   */
  product?: {
    productId: string;
    name: string;
    slug: string;
    imageUrl?: string;
    variantName?: string;
    price?: number;
    compareAtPrice?: number;
    currency?: string;
  };
  /**
   * The body is the product's name and link, written because nothing was
   * typed with the product: a client showing the product's card hides it.
   */
  bodyIsFallback: boolean;
  deliveryStatus: "queued" | "sent" | "delivered" | "read" | "failed";
  /** The sending client's own id for the message, which settles its retries. */
  clientMessageId?: string;
  messageKind?: "whatsapp_template";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppTemplateVariableDTO {
  key: string;
  label: string;
  component: "header" | "body" | "button";
  type: "text" | "image" | "video" | "document";
  buttonIndex?: number;
  parameterName?: string;
  example?: string;
}

export interface WhatsAppTemplateDTO {
  _id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  parameterFormat: "POSITIONAL" | "NAMED";
  body: string;
  variables: WhatsAppTemplateVariableDTO[];
  syncedAt: string;
}

export type ConversationSession = ApiSession | null;

export type ConversationQuery = Record<string, unknown>;

export interface ConversationTarget {
  ownerType: "platform" | "vendor";
  ownerVendorId?: Types.ObjectId;
  ownerName?: string;
  productContext?: {
    productId: Types.ObjectId;
    vendorId?: Types.ObjectId;
    name: string;
    slug: string;
    image?: string;
    variantId?: Types.ObjectId;
    variantName?: string;
  };
}

/**
 * A storefront chat button's context, resolved for the inbox's new-conversation
 * pane before any thread exists: who the first message will reach and the
 * product snapshot it will carry.
 */
export interface ConversationDraftPreview {
  ownerName?: string;
  productContext?: ConversationDTO["productContext"];
}
