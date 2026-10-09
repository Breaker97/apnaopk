import { ValidationError } from "@/lib/api/errors";
import type { IChannelConnection } from "@/models/channel-connection.model";
import { decryptMessagingSecret } from "@/lib/conversations/secret-box";

const TELEGRAM_API = "https://api.telegram.org";

/** Telegram truncates past this; splitting silently would reorder replies. */
const TELEGRAM_TEXT_LIMIT = 4096;
/** Media captions are far shorter than message bodies. */
const TELEGRAM_CAPTION_LIMIT = 1024;

/**
 * A Bot API failure with Telegram's structured fields preserved, so the outbox
 * can tell a revoked token from a rate limit from a permanently undeliverable
 * chat — the same reason `MetaGraphError` exists on the Meta side.
 */
export class TelegramApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly retryAfterSeconds?: number;

  constructor(params: {
    message: string;
    status: number;
    code?: number;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = "TelegramApiError";
    this.status = params.status;
    this.code = params.code;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }

  /** The bot token is invalid, revoked, or the bot was deleted. */
  get isAuthFailure() {
    return this.code === 401 || this.status === 401;
  }

  get isThrottled() {
    return this.code === 429 || this.status === 429;
  }

  /**
   * 400 means Telegram rejected the payload or chat; 403 means the customer
   * blocked the bot. Neither improves by waiting. Everything else — including
   * 5xx and network faults — stays retryable.
   */
  get isPermanent() {
    if (this.isThrottled) return false;
    if (this.isAuthFailure) return true;
    return this.code === 400 || this.code === 403;
  }
}

/** The bot token is the whole credential; there is nothing else to decrypt. */
function telegramBotToken(connection: IChannelConnection) {
  return decryptMessagingSecret(connection.accessTokenEncrypted);
}

async function telegramRequest<T>(params: {
  token: string;
  method: string;
  body?: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(
    `${TELEGRAM_API}/bot${params.token}/${params.method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params.body || {}),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | {
        ok?: boolean;
        result?: T;
        description?: string;
        error_code?: number;
        parameters?: { retry_after?: number };
      }
    | null;
  if (!response.ok || !payload?.ok) {
    throw new TelegramApiError({
      message:
        payload?.description || `Telegram Bot API returned ${response.status}`,
      status: response.status,
      code: payload?.error_code,
      retryAfterSeconds: payload?.parameters?.retry_after,
    });
  }
  return payload.result as T;
}

interface TelegramBotIdentity {
  id: number;
  username?: string;
  firstName?: string;
}

/** Validates a bot token and returns the bot's identity. */
export async function getTelegramBot(token: string) {
  const result = await telegramRequest<{
    id: number;
    is_bot?: boolean;
    username?: string;
    first_name?: string;
  }>({ token, method: "getMe" });
  if (!result?.id) {
    throw new ValidationError("Telegram did not recognize this bot token");
  }
  return {
    id: result.id,
    username: result.username,
    firstName: result.first_name,
  } satisfies TelegramBotIdentity;
}

/**
 * Points the bot at our webhook.
 *
 * `secret_token` is what replaces Meta's HMAC: Telegram signs nothing, so it
 * echoes this value back in `X-Telegram-Bot-Api-Secret-Token` and that header
 * is the only proof an update really came from Telegram.
 */
export async function setTelegramWebhook(params: {
  token: string;
  url: string;
  secretToken: string;
}) {
  await telegramRequest<boolean>({
    token: params.token,
    method: "setWebhook",
    body: {
      url: params.url,
      secret_token: params.secretToken,
      allowed_updates: ["message", "edited_message"],
      // Anything queued before this connection existed belongs to whoever was
      // using the bot previously, not to this store.
      drop_pending_updates: true,
    },
  });
}

export async function deleteTelegramWebhook(token: string) {
  await telegramRequest<boolean>({ token, method: "deleteWebhook" });
}

/**
 * The value stored as `providerMessageId` for a Telegram message.
 *
 * Telegram's `message_id` is a per-CHAT counter that restarts at 1 for every
 * conversation, but `providerMessageId` is deduplicated — and uniquely indexed —
 * as `{channel, providerMessageId}`, i.e. globally per channel. Storing the bare
 * id therefore made customer B's first message a "duplicate" of customer A's
 * first message: it was silently discarded on ingest, and an outbound reply
 * collided with the unique index, was misclassified as a retryable failure, and
 * was re-sent up to eight times. Scoping by chat restores the uniqueness the
 * index assumes.
 */
export function telegramMessageKey(chatId: string, messageId: string | number) {
  return `${chatId}:${messageId}`;
}

export async function sendTelegramText(params: {
  connection: IChannelConnection;
  chatId: string;
  text: string;
}) {
  const result = await telegramRequest<{ message_id: number }>({
    token: telegramBotToken(params.connection),
    method: "sendMessage",
    body: {
      chat_id: params.chatId,
      text: params.text.slice(0, TELEGRAM_TEXT_LIMIT),
    },
  });
  return telegramMessageKey(params.chatId, result.message_id);
}

const TELEGRAM_MEDIA_METHOD: Record<
  "image" | "video" | "audio" | "document",
  { method: string; field: string }
> = {
  image: { method: "sendPhoto", field: "photo" },
  video: { method: "sendVideo", field: "video" },
  audio: { method: "sendAudio", field: "audio" },
  document: { method: "sendDocument", field: "document" },
};

export async function sendTelegramMedia(params: {
  connection: IChannelConnection;
  chatId: string;
  attachment: {
    type: "image" | "video" | "audio" | "document";
    url: string;
  };
  caption?: string;
}) {
  const target = TELEGRAM_MEDIA_METHOD[params.attachment.type];
  // Telegram fetches the media itself from this URL, which is why the caller
  // must have validated it as public HTTPS.
  const result = await telegramRequest<{ message_id: number }>({
    token: telegramBotToken(params.connection),
    method: target.method,
    body: {
      chat_id: params.chatId,
      [target.field]: params.attachment.url,
      ...(params.caption
        ? { caption: params.caption.slice(0, TELEGRAM_CAPTION_LIMIT) }
        : {}),
    },
  });
  return telegramMessageKey(params.chatId, result.message_id);
}

/**
 * Resolves an inbound `file_id` to a downloadable URL and streams it.
 *
 * The URL embeds the bot token, so it must never reach the browser — the
 * viewer-authorized attachment proxy is what serves this to an agent, exactly
 * as it does for WhatsApp media ids.
 */
export async function fetchTelegramMedia(params: {
  connection: IChannelConnection;
  fileId: string;
}) {
  const token = telegramBotToken(params.connection);
  const file = await telegramRequest<{
    file_path?: string;
    file_size?: number;
  }>({
    token,
    method: "getFile",
    body: { file_id: params.fileId },
  });
  if (!file.file_path) {
    throw new ValidationError("Telegram did not return a downloadable file");
  }
  const response = await fetch(
    `${TELEGRAM_API}/file/bot${token}/${file.file_path}`,
    { signal: AbortSignal.timeout(30_000), redirect: "error" },
  );
  if (!response.ok || !response.body) {
    throw new TelegramApiError({
      message: `Telegram media download returned ${response.status}`,
      status: response.status,
    });
  }
  const contentLength = Number(response.headers.get("content-length"));
  return {
    body: response.body,
    contentType:
      response.headers.get("content-type") || "application/octet-stream",
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
  };
}
