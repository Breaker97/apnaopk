import type { MessageProvider } from "@/models/channel-connection.model";
import type { ConversationChannel } from "@/models/conversation.model";

/**
 * One description of what each channel can do, replacing the comparisons that
 * used to be spelled out at ~39 call sites as
 * `channel === "whatsapp" || channel === "messenger"`.
 *
 * That shape did not just read badly — it failed unsafely. A channel added
 * without updating every site inherits live-chat behaviour by default: no
 * outbox row, no reply-window guard, no delivery status. The message is stored
 * and shown to the agent as sent while the customer never receives it, and
 * nothing raises an error. Describing the capability once makes the default for
 * an unknown channel explicit instead of accidental.
 *
 * Imports here are TYPE-ONLY on purpose: this module is used by client
 * components, and a value import from `models/` would pull Mongoose into the
 * browser bundle.
 */

const MB = 1024 * 1024;

/** Ceiling applied to every chat attachment regardless of channel. */
export const MAX_CHAT_ATTACHMENT_BYTES = 16 * MB;

interface ChannelCapability {
  /** Human-readable name used in UI badges and error messages. */
  label: string;
  /**
   * Delivered through a provider and the durable outbox rather than being
   * stored and rendered directly. This is the single most load-bearing flag:
   * it decides whether a message is queued for external delivery at all.
   */
  external: boolean;
  /** Supports pre-approved message templates (WhatsApp only). */
  templates: boolean;
  /**
   * Hours after the last inbound customer message during which the provider
   * accepts free-form replies. Undefined for internal channels.
   */
  replyWindowHours?: number;
  /**
   * Days of Meta's extended manual-support window (HUMAN_AGENT). Undefined
   * where the provider has no such concept.
   */
  humanAgentWindowDays?: number;
  /**
   * The provider exposes its customer profile through Meta's Messenger
   * Platform Graph node, so a display-name lookup is possible at all.
   *
   * This is load-bearing for a security reason, not a cosmetic one. The lookup
   * used to be guarded by `provider !== "whatsapp"`, which is true for Telegram
   * — so every new Telegram contact sent the BotFather token to
   * graph.facebook.com as a Bearer credential. Describing the capability makes
   * a non-Meta channel opt OUT by default instead of opting in by accident.
   */
  messengerPlatformProfile?: boolean;
  /** Whether a media message may carry body text as a caption. */
  captionsWithMedia: boolean;
  /** Attachments accepted in a single message. */
  maxAttachments: number;
  /**
   * Accepted upload types and their per-type size cap. A type the provider
   * rejects is refused at upload time rather than after the message row has
   * already been persisted and shown to the agent.
   */
  media: Record<string, number>;
}

const LIVE_CHAT_MEDIA: Record<string, number> = {
  "image/jpeg": MAX_CHAT_ATTACHMENT_BYTES,
  "image/png": MAX_CHAT_ATTACHMENT_BYTES,
  "image/gif": MAX_CHAT_ATTACHMENT_BYTES,
  "image/webp": MAX_CHAT_ATTACHMENT_BYTES,
  "video/mp4": MAX_CHAT_ATTACHMENT_BYTES,
  "video/webm": MAX_CHAT_ATTACHMENT_BYTES,
  "application/pdf": MAX_CHAT_ATTACHMENT_BYTES,
};

export const CHANNEL_CAPABILITIES: Record<ConversationChannel, ChannelCapability> =
  {
    live_chat: {
      label: "Live chat",
      external: false,
      templates: false,
      captionsWithMedia: true,
      maxAttachments: 4,
      media: LIVE_CHAT_MEDIA,
    },
    whatsapp: {
      label: "WhatsApp",
      external: true,
      templates: true,
      replyWindowHours: 24,
      captionsWithMedia: true,
      maxAttachments: 1,
      // Cloud API: JPEG/PNG images up to 5MB; MP4 video and PDF documents up to
      // 16MB. GIF and WebP are not valid image messages.
      media: {
        "image/jpeg": 5 * MB,
        "image/png": 5 * MB,
        "video/mp4": MAX_CHAT_ATTACHMENT_BYTES,
        "application/pdf": MAX_CHAT_ATTACHMENT_BYTES,
      },
    },
    messenger: {
      label: "Messenger",
      external: true,
      templates: false,
      replyWindowHours: 24,
      humanAgentWindowDays: 7,
      messengerPlatformProfile: true,
      // The Messenger attachment API has no caption field; body text has to be
      // sent as its own message.
      captionsWithMedia: false,
      maxAttachments: 1,
      // Messenger caps attachments at 25MB, so the 16MB chat ceiling binds.
      media: {
        "image/jpeg": MAX_CHAT_ATTACHMENT_BYTES,
        "image/png": MAX_CHAT_ATTACHMENT_BYTES,
        "image/gif": MAX_CHAT_ATTACHMENT_BYTES,
        "video/mp4": MAX_CHAT_ATTACHMENT_BYTES,
        "application/pdf": MAX_CHAT_ATTACHMENT_BYTES,
      },
    },
    instagram: {
      label: "Instagram",
      external: true,
      // Instagram Direct has no template concept at all.
      templates: false,
      replyWindowHours: 24,
      humanAgentWindowDays: 7,
      messengerPlatformProfile: true,
      captionsWithMedia: false,
      maxAttachments: 1,
      // Instagram Messaging accepts images up to 8MB and video up to 25MB (the
      // 16MB chat ceiling binds), and does NOT accept documents.
      media: {
        "image/jpeg": 8 * MB,
        "image/png": 8 * MB,
        "image/gif": 8 * MB,
        "video/mp4": MAX_CHAT_ATTACHMENT_BYTES,
      },
    },
    telegram: {
      label: "Telegram",
      external: true,
      // Telegram has neither templates nor a reply window: a bot may message
      // any chat that has started it, at any time. `replyWindowHours` is left
      // undefined on purpose — treating "no window" as an expired window would
      // lock the composer permanently.
      templates: false,
      captionsWithMedia: true,
      maxAttachments: 1,
      // Sending by URL, Telegram fetches the file itself: photos are capped at
      // 5MB and other types at 20MB, so the 16MB chat ceiling binds there.
      media: {
        "image/jpeg": 5 * MB,
        "image/png": 5 * MB,
        "image/gif": 5 * MB,
        "video/mp4": MAX_CHAT_ATTACHMENT_BYTES,
        "audio/mpeg": MAX_CHAT_ATTACHMENT_BYTES,
        "application/pdf": MAX_CHAT_ATTACHMENT_BYTES,
      },
    },
  };

/** True when the provider enforces a window for free-form replies at all. */
export function hasReplyWindow(channel: string) {
  return channelCapability(channel).replyWindowHours !== undefined;
}

export function channelCapability(channel: string): ChannelCapability {
  return (
    CHANNEL_CAPABILITIES[channel as ConversationChannel] ??
    CHANNEL_CAPABILITIES.live_chat
  );
}

/**
 * External channels are named after the provider that carries them, so the
 * channel value doubles as the connection's provider. Keeping that invariant in
 * one function is what lets the outbox, the webhook and the connection lookup
 * agree without another lookup table.
 */
type ExternalConversationChannel = Extract<
  ConversationChannel,
  MessageProvider
>;

export function isExternalChannel(
  channel: string,
): channel is ExternalConversationChannel {
  return channelCapability(channel).external;
}

/** The provider that carries this channel, or undefined for internal ones. */
export function channelProvider(channel: string): MessageProvider | undefined {
  return isExternalChannel(channel) ? channel : undefined;
}

export function supportsTemplates(channel: string) {
  return channelCapability(channel).templates;
}

type ChatAttachmentKind = "image" | "video" | "audio" | "document";

/**
 * Buckets an accepted upload into the kind it is stored as, or undefined when
 * nothing here can hold it.
 *
 * This lives beside the capability table on purpose: the table decides what may
 * be UPLOADED, this decides what the accepted file is STORED as, and the two
 * disagreeing is silent. It had no `audio/` branch while the Telegram row
 * accepted `audio/mpeg`, so a voice note passed the upload check, was written
 * to storage, and only then failed — leaving Telegram's audio support
 * unreachable. `tests/conversations.test.ts` fails if they drift again.
 */
export function attachmentKindFor(
  mimeType: string,
): ChatAttachmentKind | undefined {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "document";
  return undefined;
}

/** True only where a Messenger Platform profile lookup is actually possible. */
export function supportsMessengerPlatformProfile(channel: string) {
  return channelCapability(channel).messengerPlatformProfile === true;
}

export function supportsHumanAgentWindow(channel: string) {
  return channelCapability(channel).humanAgentWindowDays !== undefined;
}

export function humanAgentWindowMs(channel: string) {
  const days = channelCapability(channel).humanAgentWindowDays;
  return days === undefined ? undefined : days * 24 * 60 * 60 * 1000;
}

export function replyWindowMs(channel: string) {
  const hours = channelCapability(channel).replyWindowHours;
  return hours === undefined ? undefined : hours * 60 * 60 * 1000;
}

export function channelLabel(channel: string) {
  return channelCapability(channel).label;
}

/** Providers are the external channels; derived so the two cannot drift. */
export const MESSAGE_PROVIDERS = (
  Object.keys(CHANNEL_CAPABILITIES) as ConversationChannel[]
).filter(isExternalChannel);

export function providerLabel(provider: string) {
  return channelLabel(provider);
}
