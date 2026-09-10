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
  deliveryStatus: "queued" | "sent" | "delivered" | "read" | "failed";
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
