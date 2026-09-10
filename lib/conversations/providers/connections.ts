import { Types } from "mongoose";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import {
  CHANNEL_CONNECTION_STATUSES,
  ChannelConnection,
  type IChannelConnection,
  type MessageProvider,
} from "@/models/channel-connection.model";
import {
  createTelegramWebhookSecret,
  decryptMessagingSecret,
  encryptMessagingSecret,
} from "@/lib/conversations/secret-box";
import type { ConversationViewer } from "@/lib/conversations/types";
import { assertVendorChannelPermission } from "@/lib/conversations/viewer";
import {
  verifyMetaConnection,
  verifyStoredMetaConnection,
} from "@/lib/conversations/providers/meta-client";
import {
  normalizeInstagramUsername,
  normalizeMessengerUsername,
  normalizeTelegramUsername,
  normalizeWhatsAppNumber,
} from "@/lib/notifications/vendor-messaging";
import {
  deleteTelegramWebhook,
  getTelegramBot,
  setTelegramWebhook,
} from "@/lib/conversations/providers/telegram-client";
import {
  providerLabel,
  supportsHumanAgentWindow,
} from "@/lib/conversations/channels";
import { notifyChannelConnectionFailure } from "@/lib/conversations/providers/connection-health";

function owner(viewer: ConversationViewer) {
  if (viewer.kind === "admin") {
    return {
      ownerType: "platform" as const,
      ownerKey: "platform",
      actorUserId: viewer.userId,
    };
  }
  if (viewer.kind === "vendor") {
    assertVendorChannelPermission(viewer);
    return {
      ownerType: "vendor" as const,
      ownerKey: `vendor:${viewer.vendorId}`,
      ownerVendorId: new Types.ObjectId(viewer.vendorId),
      actorUserId: viewer.userId,
    };
  }
  throw new AuthorizationError("Only store users can manage message channels");
}

function serializeChannelConnection(connection: IChannelConnection) {
  return {
    _id: String(connection._id),
    ownerType: connection.ownerType,
    ownerVendorId: connection.ownerVendorId
      ? String(connection.ownerVendorId)
      : undefined,
    provider: connection.provider,
    status: connection.status,
    displayName: connection.displayName,
    externalAccountId: connection.externalAccountId,
    businessAccountId: connection.businessAccountId,
    phoneNumberId: connection.phoneNumberId,
    pageId: connection.pageId,
    instagramUserId: connection.instagramUserId,
    telegramBotId: connection.telegramBotId,
    publicPhoneNumberE164: connection.publicPhoneNumberE164,
    publicPageUsername: connection.publicPageUsername,
    publicInstagramUsername: connection.publicInstagramUsername,
    publicTelegramUsername: connection.publicTelegramUsername,
    // Gated on the capability, not on `provider === "messenger"`: Meta grants
    // the extended manual-support window on Instagram too, and `connectMetaChannel`
    // already persists it there. Naming one provider made the Instagram value
    // write-only — saved, never reported, and silently cleared on the next save.
    messengerHumanAgentEnabled: supportsHumanAgentWindow(connection.provider)
      ? Boolean(connection.messengerHumanAgentEnabled)
      : undefined,
    tokenExpiresAt: connection.tokenExpiresAt?.toISOString(),
    scopes: connection.scopes,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString(),
    lastError: connection.lastError,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

export async function listChannelConnections(viewer: ConversationViewer) {
  const target = owner(viewer);
  const connections = await ChannelConnection.find({
    ownerKey: target.ownerKey,
    // A revoked row is a tombstone kept only so its `_id` — and therefore the
    // conversation history hanging off it — survives a disconnect. To the
    // operator the channel is gone, and the panel must offer the connect form
    // rather than a card for something they already removed.
    status: { $ne: CHANNEL_CONNECTION_STATUSES.REVOKED },
  })
    .sort({ provider: 1 })
    .lean<IChannelConnection[]>();
  return connections.map(serializeChannelConnection);
}

export async function connectMetaChannel(params: {
  viewer: ConversationViewer;
  provider: MessageProvider;
  accessToken: string;
  displayName?: string;
  externalAccountId?: string;
  businessAccountId?: string;
  phoneNumberId?: string;
  pageId?: string;
  instagramUserId?: string;
  publicPhoneNumberE164?: string;
  publicPageUsername?: string;
  publicInstagramUsername?: string;
  messengerHumanAgentEnabled?: boolean;
  tokenExpiresAt?: string;
  scopes?: string[];
}) {
  const accessToken = params.accessToken.trim();
  if (accessToken.length < 20) {
    throw new ValidationError("A valid Meta access token is required");
  }
  if (params.provider === "whatsapp" && !params.phoneNumberId?.trim()) {
    throw new ValidationError("WhatsApp phone number ID is required");
  }
  if (params.provider === "messenger" && !params.pageId?.trim()) {
    throw new ValidationError("Messenger page ID is required");
  }
  if (params.provider === "instagram" && !params.instagramUserId?.trim()) {
    throw new ValidationError("Instagram professional account ID is required");
  }

  const verified = await verifyMetaConnection({
    provider: params.provider,
    accessToken,
    businessAccountId: params.businessAccountId?.trim(),
    phoneNumberId: params.phoneNumberId?.trim(),
    pageId: params.pageId?.trim(),
    instagramUserId: params.instagramUserId?.trim(),
  });
  const target = owner(params.viewer);
  const expires = params.tokenExpiresAt
    ? new Date(params.tokenExpiresAt)
    : undefined;
  if (expires && Number.isNaN(expires.getTime())) {
    throw new ValidationError("Token expiry is invalid");
  }

  const connection = await ChannelConnection.findOneAndUpdate(
    { ownerKey: target.ownerKey, provider: params.provider },
    {
      $set: {
        ownerType: target.ownerType,
        ownerKey: target.ownerKey,
        ownerVendorId:
          "ownerVendorId" in target ? target.ownerVendorId : undefined,
        provider: params.provider,
        status: CHANNEL_CONNECTION_STATUSES.ACTIVE,
        displayName:
          params.displayName?.trim().slice(0, 160) || verified.displayName,
        externalAccountId:
          params.externalAccountId?.trim() || verified.externalAccountId,
        businessAccountId:
          params.provider === "whatsapp"
            ? params.businessAccountId?.trim()
            : undefined,
        phoneNumberId:
          params.provider === "whatsapp"
            ? params.phoneNumberId?.trim()
            : undefined,
        pageId:
          params.provider === "messenger" ? params.pageId?.trim() : undefined,
        instagramUserId:
          params.provider === "instagram"
            ? params.instagramUserId?.trim()
            : undefined,
        publicPhoneNumberE164:
          params.provider === "whatsapp"
            ? normalizeWhatsAppNumber(
                params.publicPhoneNumberE164 || verified.publicPhoneNumber,
              )
            : undefined,
        publicPageUsername:
          params.provider === "messenger"
            ? normalizeMessengerUsername(
                params.publicPageUsername || verified.publicPageUsername,
              )
            : undefined,
        publicInstagramUsername:
          params.provider === "instagram"
            ? normalizeInstagramUsername(
                params.publicInstagramUsername || verified.publicInstagramUsername,
              )
            : undefined,
        // Meta gates the extended manual-support window on both Messenger
        // Platform channels, so Instagram carries the same opt-in.
        messengerHumanAgentEnabled: supportsHumanAgentWindow(params.provider)
          ? Boolean(params.messengerHumanAgentEnabled)
          : false,
        accessTokenEncrypted: encryptMessagingSecret(accessToken),
        ...(expires ? { tokenExpiresAt: expires } : {}),
        scopes: (params.scopes || []).map((scope) => scope.trim()).filter(Boolean),
        lastVerifiedAt: new Date(),
      },
      // Mongoose drops `$set: { field: undefined }` silently, so writing
      // `lastError: undefined` left the failure from the previous credential
      // sitting on a connection that had just verified successfully — and a
      // token with no expiry inherited the old one's.
      $unset: {
        lastError: "",
        ...(expires ? {} : { tokenExpiresAt: "" }),
      },
      // Reconnecting revives the SAME row — that is what keeps every existing
      // conversation's `channelConnectionId` valid — so the audit trail must
      // record who first connected the channel, not whoever last refreshed the
      // token. `$set` here quietly rewrote that on every save.
      $setOnInsert: { createdByUserId: new Types.ObjectId(target.actorUserId) },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return serializeChannelConnection(connection);
}

/**
 * Connects a Telegram bot.
 *
 * The bot token IS the credential — there is no OAuth, no app review and no
 * account picker — so onboarding is: validate the token, then point the bot at
 * our webhook with a freshly minted secret. Only the secret's hash is stored;
 * the plaintext exists just long enough to reach setWebhook.
 */
export async function connectTelegramChannel(params: {
  viewer: ConversationViewer;
  botToken: string;
  webhookUrl: string;
  publicTelegramUsername?: string;
  displayName?: string;
}) {
  const botToken = params.botToken.trim();
  // BotFather tokens look like <bot id>:<35-char secret>.
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    throw new ValidationError(
      "Enter the bot token exactly as BotFather issued it",
    );
  }
  if (!/^https:\/\//i.test(params.webhookUrl)) {
    throw new ValidationError(
      "Telegram only delivers webhooks to a public HTTPS URL",
    );
  }
  const bot = await getTelegramBot(botToken);
  const target = owner(params.viewer);
  const { secret, hash } = createTelegramWebhookSecret();

  // Claim the bot BEFORE touching Telegram. `setWebhook` rotates the secret on
  // whoever owns this bot today, and `drop_pending_updates` discards their
  // queue — so registering first and only then colliding on the
  // {provider, telegramBotId} unique index left the rightful owner receiving
  // updates signed with a secret stored nowhere: a permanent, silent 401 with
  // nothing in their UI to explain it.
  const claimedElsewhere = await ChannelConnection.findOne({
    provider: "telegram",
    telegramBotId: String(bot.id),
    ownerKey: { $ne: target.ownerKey },
    status: { $ne: CHANNEL_CONNECTION_STATUSES.REVOKED },
  })
    .select("_id")
    .lean();
  if (claimedElsewhere) {
    throw new ValidationError(
      "This Telegram bot is already connected to another store. Create a separate bot with BotFather.",
    );
  }

  const connection = await ChannelConnection.findOneAndUpdate(
    { ownerKey: target.ownerKey, provider: "telegram" },
    {
      $set: {
        ownerType: target.ownerType,
        ownerKey: target.ownerKey,
        ownerVendorId:
          "ownerVendorId" in target ? target.ownerVendorId : undefined,
        provider: "telegram",
        status: CHANNEL_CONNECTION_STATUSES.ACTIVE,
        displayName:
          params.displayName?.trim().slice(0, 160) ||
          bot.firstName ||
          bot.username ||
          "Telegram bot",
        externalAccountId: String(bot.id),
        telegramBotId: String(bot.id),
        telegramWebhookSecretHash: hash,
        publicTelegramUsername:
          normalizeTelegramUsername(
            params.publicTelegramUsername || bot.username,
          ) || undefined,
        accessTokenEncrypted: encryptMessagingSecret(botToken),
        scopes: [],
        lastVerifiedAt: new Date(),
      },
      $unset: { lastError: "", tokenExpiresAt: "" },
      $setOnInsert: { createdByUserId: new Types.ObjectId(target.actorUserId) },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  // The bot is ours now, so pointing it at our webhook can only affect us.
  try {
    await setTelegramWebhook({
      token: botToken,
      url: params.webhookUrl,
      secretToken: secret,
    });
  } catch (error) {
    // The row is claimed but nothing will ever arrive on it. Park it in `error`
    // so the panel shows why and "Verify" can retry, instead of presenting a
    // connection that looks healthy and is deaf.
    await ChannelConnection.updateOne(
      { _id: connection!._id },
      {
        $set: {
          status: CHANNEL_CONNECTION_STATUSES.ERROR,
          lastError:
            error instanceof Error
              ? `Telegram rejected the webhook registration: ${error.message.slice(0, 900)}`
              : "Telegram rejected the webhook registration",
        },
      },
    );
    throw error;
  }
  return serializeChannelConnection(connection!);
}

/**
 * Disconnects a channel WITHOUT destroying the row.
 *
 * Every conversation on the channel references this document's `_id`, and
 * inbound threads are deduplicated by `{channelConnectionId, externalThreadId}`.
 * Deleting it therefore did far more than disconnect: existing threads could
 * never be replied to again (the outbox found no dependency and dead-lettered
 * every message), and reconnecting minted a NEW `_id`, so the same customer's
 * next message opened a second conversation beside the old one and the history
 * split in two.
 *
 * Keeping the row and marking it `revoked` — the status the enum has always
 * declared and nothing ever set — makes reconnecting revive the same identity,
 * so the whole thread history stays continuous. What the row must NOT keep is
 * the credential and the routing keys: the operator asked us to stop, so the
 * token is dropped and the account identifiers are released for reuse.
 */
export async function disconnectChannel(params: {
  viewer: ConversationViewer;
  connectionId: string;
}) {
  if (!Types.ObjectId.isValid(params.connectionId)) {
    throw new ValidationError("Channel connection is invalid");
  }
  const target = owner(params.viewer);
  const connection = await ChannelConnection.findOne({
    _id: new Types.ObjectId(params.connectionId),
    ownerKey: target.ownerKey,
  });
  if (!connection) throw new AuthorizationError("Channel connection not found");

  if (connection.provider === "telegram" && connection.accessTokenEncrypted) {
    // Best effort, and BEFORE the token is dropped: without this the bot keeps
    // posting updates we will now refuse, and Telegram keeps retrying them.
    try {
      await deleteTelegramWebhook(
        decryptMessagingSecret(connection.accessTokenEncrypted),
      );
    } catch (error) {
      console.error("Failed to detach the Telegram webhook:", error);
    }
  }

  await ChannelConnection.updateOne(
    { _id: connection._id },
    {
      $set: {
        status: CHANNEL_CONNECTION_STATUSES.REVOKED,
        lastError: "Disconnected by a store user",
      },
      $unset: {
        accessTokenEncrypted: "",
        tokenExpiresAt: "",
        // Released so the account can be connected somewhere else, and so no
        // webhook can route to a channel that is meant to be off.
        phoneNumberId: "",
        pageId: "",
        instagramUserId: "",
        telegramBotId: "",
        telegramWebhookSecretHash: "",
      },
    },
  );
}

/**
 * Changes the operational settings of an already-connected channel.
 *
 * Human Agent used to be accepted only inside the connect payload, so turning
 * it on or off after the fact meant disconnecting and pasting the access token
 * again. Instagram was worse: the value was persisted but never serialized
 * back, so the panel re-sent `false` on every subsequent save.
 */
export async function updateChannelSettings(params: {
  viewer: ConversationViewer;
  connectionId: string;
  messengerHumanAgentEnabled: boolean;
}) {
  if (!Types.ObjectId.isValid(params.connectionId)) {
    throw new ValidationError("Channel connection is invalid");
  }
  const target = owner(params.viewer);
  const connection = await ChannelConnection.findOne({
    _id: new Types.ObjectId(params.connectionId),
    ownerKey: target.ownerKey,
    status: { $ne: CHANNEL_CONNECTION_STATUSES.REVOKED },
  });
  if (!connection) throw new AuthorizationError("Channel connection not found");
  if (!supportsHumanAgentWindow(connection.provider)) {
    throw new ValidationError(
      `${providerLabel(connection.provider)} has no Human Agent window`,
    );
  }
  connection.messengerHumanAgentEnabled = params.messengerHumanAgentEnabled;
  await connection.save();
  return serializeChannelConnection(connection);
}

export async function verifyConnectedChannel(params: {
  viewer: ConversationViewer;
  connectionId: string;
}) {
  if (!Types.ObjectId.isValid(params.connectionId)) {
    throw new ValidationError("Channel connection is invalid");
  }
  const target = owner(params.viewer);
  const connection = await ChannelConnection.findOne({
    _id: new Types.ObjectId(params.connectionId),
    ownerKey: target.ownerKey,
    status: { $ne: CHANNEL_CONNECTION_STATUSES.REVOKED },
  });
  if (!connection) throw new AuthorizationError("Channel connection not found");
  // A revoked row keeps no credential, so there is nothing to re-verify.
  if (!connection.accessTokenEncrypted) {
    throw new ValidationError(
      "This channel has no stored credential. Connect it again.",
    );
  }
  const wasActive = connection.status === CHANNEL_CONNECTION_STATUSES.ACTIVE;
  try {
    if (connection.provider === "telegram") {
      await getTelegramBot(decryptMessagingSecret(connection.accessTokenEncrypted));
    } else {
      await verifyStoredMetaConnection(connection);
    }
    connection.status = CHANNEL_CONNECTION_STATUSES.ACTIVE;
    connection.lastVerifiedAt = new Date();
    connection.lastError = undefined;
    await connection.save();
    return serializeChannelConnection(connection);
  } catch (error) {
    connection.status = CHANNEL_CONNECTION_STATUSES.ERROR;
    connection.lastError =
      error instanceof Error ? error.message.slice(0, 1000) : "Verification failed";
    await connection.save();
    // Only on the transition out of `active`. The operator who clicked Verify
    // already sees this error; the alert exists for everyone else on the team
    // who is about to find the channel dead, and re-verifying an already-broken
    // connection must not notify them again.
    if (wasActive) {
      await notifyChannelConnectionFailure(connection, connection.lastError);
    }
    throw error;
  }
}
