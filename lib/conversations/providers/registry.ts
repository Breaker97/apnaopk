import type { IChannelConnection, MessageProvider } from "@/models/channel-connection.model";
import type { IConversation } from "@/models/conversation.model";
import type { IConversationMessage } from "@/models/conversation-message.model";
import {
  fetchWhatsAppMedia,
  MetaGraphError,
  sendMetaAttachmentMessage,
  sendMetaTemplateMessage,
  sendMetaTextMessage,
  type MetaTemplateSendComponent,
} from "@/lib/conversations/providers/meta-client";
import {
  fetchTelegramMedia,
  sendTelegramMedia,
  sendTelegramText,
  TelegramApiError,
} from "@/lib/conversations/providers/telegram-client";

/**
 * What every channel provider must supply.
 *
 * Before this existed the outbox called Meta's send functions directly and
 * interpreted Meta's error codes inline, so the queue physically could not
 * express another provider's retry semantics. Adding Telegram — the first
 * channel that shares no transport with Meta — is what forced the seam.
 */
interface ProviderFailure {
  /** Retrying this exact request will never succeed. */
  permanent: boolean;
  /** The stored credential is dead; the connection should be demoted. */
  authFailure: boolean;
  /** Provider-requested minimum delay before the next attempt. */
  retryAfterSeconds?: number;
  /** Provider error code, persisted on the message for operators. */
  errorCode?: string;
}

/**
 * A send that failed before the provider was ever contacted.
 *
 * The outbox treats an unrecognised error as retryable, which is the right
 * default for a transport fault but the wrong one for a fault we raised
 * ourselves: a deleted conversation, a revoked connection or a thread with no
 * recipient will not become valid by waiting, yet each used to burn all eight
 * attempts and only then dead-letter. Carrying the verdict on the error is what
 * lets the queue tell those apart from the ones that genuinely might recover —
 * a reply window, for instance, reopens the moment the customer writes again,
 * so it stays retryable on purpose.
 *
 * `code` is persisted on the message so the failures panel shows why, rather
 * than only the sentence.
 */
export class MessagingDeliveryError extends Error {
  readonly permanent: boolean;
  readonly code: string;

  constructor(params: { message: string; code: string; permanent: boolean }) {
    super(params.message);
    this.name = "MessagingDeliveryError";
    this.permanent = params.permanent;
    this.code = params.code;
  }
}

interface ProviderSendContext {
  connection: IChannelConnection;
  conversation: IConversation;
  message: IConversationMessage;
  /** Already validated as present by the caller. */
  recipientId: string;
}

interface MessagingProviderAdapter {
  /** Sends the message and returns the provider's own message id. */
  send(context: ProviderSendContext): Promise<string>;
  /**
   * Interprets a thrown error. Returning undefined means "not a recognised
   * provider error", which the caller treats as retryable — an unknown failure
   * must never be mistaken for a permanent one.
   */
  classify(error: unknown): ProviderFailure | undefined;
  /**
   * The connection field a webhook's account identifier matches. Telegram is
   * absent on purpose: its updates do not name the receiving bot, so the bot is
   * identified by the webhook secret instead (see the Telegram webhook route).
   */
  connectionFilter?(lookupId: string): Record<string, unknown>;
  /**
   * Streams an inbound attachment the provider stores behind an opaque id.
   *
   * Present only where inbound media arrives as an id rather than a URL, which
   * is why the Messenger Platform channels have none — they deliver a CDN link
   * the browser can load directly. Living on the adapter keeps the attachment
   * proxy from re-deriving this with an `=== "telegram" ? … : whatsapp` ternary,
   * whose else-branch would quietly claim a future provider's media as
   * WhatsApp's.
   */
  fetchMedia?(params: {
    connection: IChannelConnection;
    providerMediaId: string;
  }): Promise<{
    body: ReadableStream<Uint8Array>;
    contentType: string;
    contentLength?: number;
  }>;
}

function whatsappTemplatePayload(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const candidate = (metadata as { whatsappTemplate?: unknown })
    .whatsappTemplate;
  if (!candidate || typeof candidate !== "object") return undefined;
  const template = candidate as {
    name?: unknown;
    language?: unknown;
    components?: unknown;
  };
  if (typeof template.name !== "string" || typeof template.language !== "string") {
    return undefined;
  }
  return {
    name: template.name,
    language: template.language,
    components: (template.components || []) as MetaTemplateSendComponent[],
  };
}

function usesMessengerHumanAgent(metadata: unknown) {
  return (
    Boolean(metadata) &&
    typeof metadata === "object" &&
    (metadata as { messengerMessageTag?: unknown }).messengerMessageTag ===
      "HUMAN_AGENT"
  );
}

/** WhatsApp, Messenger and Instagram all speak Graph; only the node differs. */
const metaAdapter: MessagingProviderAdapter = {
  async send({ connection, conversation, message, recipientId }) {
    const template = whatsappTemplatePayload(message.providerMetadata);
    const messengerHumanAgent = usesMessengerHumanAgent(
      message.providerMetadata,
    );
    // Both window checks stay RETRYABLE: an inbound message reopens the
    // provider window, and the retry ladder spans roughly eleven minutes, so a
    // customer who writes back in that time gets the agent's reply delivered
    // rather than dead-lettered.
    if (
      messengerHumanAgent &&
      (!connection.messengerHumanAgentEnabled ||
        !conversation.humanAgentWindowExpiresAt ||
        conversation.humanAgentWindowExpiresAt.getTime() <= Date.now())
    ) {
      throw new MessagingDeliveryError({
        message: "The Human Agent reply window has expired",
        code: "human_agent_window_expired",
        permanent: false,
      });
    }
    if (
      !template &&
      !messengerHumanAgent &&
      conversation.replyWindowExpiresAt &&
      conversation.replyWindowExpiresAt.getTime() < Date.now()
    ) {
      throw new MessagingDeliveryError({
        message:
          "The provider reply window has expired; an approved template is required",
        code: "reply_window_expired",
        permanent: false,
      });
    }
    const attachment = message.attachments?.[0];
    if (attachment?.url) {
      return sendMetaAttachmentMessage({
        connection,
        recipientId,
        attachment: {
          type: attachment.type,
          url: attachment.url,
          name: attachment.name,
        },
        caption: message.body,
        messengerHumanAgent,
      });
    }
    if (template) {
      return sendMetaTemplateMessage({ connection, recipientId, template });
    }
    return sendMetaTextMessage({
      connection,
      recipientId,
      text: message.body,
      messengerHumanAgent,
    });
  },
  classify(error) {
    if (!(error instanceof MetaGraphError)) return undefined;
    return {
      permanent: error.isPermanent,
      authFailure: error.isAuthFailure,
      retryAfterSeconds: error.isThrottled
        ? error.retryAfterSeconds || 60
        : undefined,
      errorCode: error.code !== undefined ? String(error.code) : undefined,
    };
  },
};

const telegramAdapter: MessagingProviderAdapter = {
  async send({ connection, message, recipientId }) {
    // Telegram has no reply window and no templates, so there is nothing to
    // gate on here — a bot may message any chat that has started it.
    const attachment = message.attachments?.[0];
    if (attachment?.url) {
      return sendTelegramMedia({
        connection,
        chatId: recipientId,
        attachment: { type: attachment.type, url: attachment.url },
        caption: message.body,
      });
    }
    return sendTelegramText({
      connection,
      chatId: recipientId,
      text: message.body,
    });
  },
  classify(error) {
    if (!(error instanceof TelegramApiError)) return undefined;
    return {
      permanent: error.isPermanent,
      authFailure: error.isAuthFailure,
      retryAfterSeconds: error.isThrottled
        ? error.retryAfterSeconds || 60
        : undefined,
      errorCode: error.code !== undefined ? String(error.code) : undefined,
    };
  },
};

const ADAPTERS: Record<MessageProvider, MessagingProviderAdapter> = {
  whatsapp: {
    ...metaAdapter,
    connectionFilter: (lookupId) => ({ phoneNumberId: lookupId }),
    fetchMedia: ({ connection, providerMediaId }) =>
      fetchWhatsAppMedia({ connection, mediaId: providerMediaId }),
  },
  messenger: {
    ...metaAdapter,
    connectionFilter: (lookupId) => ({ pageId: lookupId }),
  },
  instagram: {
    ...metaAdapter,
    connectionFilter: (lookupId) => ({ instagramUserId: lookupId }),
  },
  telegram: {
    ...telegramAdapter,
    fetchMedia: ({ connection, providerMediaId }) =>
      fetchTelegramMedia({ connection, fileId: providerMediaId }),
  },
};

export function providerAdapter(provider: MessageProvider) {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    // Exhaustive by construction, but a provider added to the enum without an
    // adapter must fail loudly rather than silently never deliver.
    throw new Error(`No messaging adapter is registered for ${provider}`);
  }
  return adapter;
}

/**
 * The connection field a webhook payload's account identifier must be matched
 * against. Returning undefined means this provider does not identify its
 * account inside the payload at all.
 *
 * There is deliberately no default branch: an unrecognised provider used to
 * fall through to `pageId`, which matches nothing and drops the webhook with no
 * error anywhere.
 */
export function connectionLookupFilter(
  provider: MessageProvider,
  connectionLookupId: string,
): Record<string, unknown> | undefined {
  return ADAPTERS[provider]?.connectionFilter?.(connectionLookupId);
}
