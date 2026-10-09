import type { NextRequest } from "next/server";
import {
  audit,
  createAuditContext,
  createSystemAuditContext,
  type AuditContext,
} from "@/lib/audit";
import {
  providerLabel,
  supportsHumanAgentWindow,
} from "@/lib/conversations/channels";
import type { ConversationViewer } from "@/lib/conversations/types";
import {
  CHANNEL_CONNECTION_STATUSES,
  type IChannelConnection,
} from "@/models/channel-connection.model";

/**
 * Activity Log rows for chat channels: connected, reconnected, settings
 * changed, disconnected.
 *
 * A channel holds a live credential (a Meta page token or a Telegram bot token)
 * and an admin or a vendor can connect one, so who did what to which channel has
 * to be on record. The credential must never be. `audit()` redacts the keys it
 * recognises, but a connection document also carries a hash that authenticates
 * Telegram's webhook, and a key it does not recognise goes through untouched.
 * So no row here is built from the document: `snapshot` copies the short list of
 * fields below by name, and a field added to the model later stays out of the
 * log until someone adds it here.
 */

/** The only connection fields an audit row may read. */
export const CHANNEL_AUDIT_FIELDS = [
  "ownerType",
  "ownerVendorId",
  "provider",
  "status",
  "displayName",
  "externalAccountId",
  "publicPhoneNumberE164",
  "publicPageUsername",
  "publicInstagramUsername",
  "publicTelegramUsername",
  "messengerHumanAgentEnabled",
] as const;

export type ChannelAuditSource = Pick<
  IChannelConnection,
  (typeof CHANNEL_AUDIT_FIELDS)[number]
> & { _id: unknown };

interface ChannelAuditCaller {
  viewer: ConversationViewer;
  /** From the route. Left out, the row is still written, named from `viewer`. */
  auditContext?: AuditContext;
}

/**
 * The audit context for a channel change made through a route: the actor and
 * request from the session, and the vendor when the viewer already carries it,
 * so `audit()` need not look it up.
 */
export function channelAuditContext(
  request: NextRequest,
  session: Parameters<typeof createAuditContext>[1],
  viewer: ConversationViewer,
): AuditContext {
  return createAuditContext(
    request,
    session,
    viewer.kind === "vendor" ? { vendorId: viewer.vendorId } : undefined,
  );
}

/**
 * Who made a change for a caller that passed no request context: still named,
 * though without an IP or a device. Only an admin or a vendor can reach a
 * channel change at all (`owner()` refuses every other viewer first).
 */
function viewerAuditContext(viewer: ConversationViewer): AuditContext {
  if (viewer.kind === "admin" || viewer.kind === "vendor") {
    return {
      userId: viewer.userId,
      userEmail: viewer.email,
      userRole: viewer.kind,
      ...(viewer.kind === "vendor" ? { vendorId: viewer.vendorId } : {}),
    };
  }
  return createSystemAuditContext();
}

function snapshot(channel: ChannelAuditSource): Record<string, unknown> {
  const present = (fields: Record<string, string | undefined>) =>
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value));
  return {
    provider: channel.provider,
    status: channel.status,
    displayName: channel.displayName,
    ...present({
      externalAccountId: channel.externalAccountId,
      publicPhoneNumberE164: channel.publicPhoneNumberE164,
      publicPageUsername: channel.publicPageUsername,
      publicInstagramUsername: channel.publicInstagramUsername,
      publicTelegramUsername: channel.publicTelegramUsername,
    }),
    ...(supportsHumanAgentWindow(channel.provider)
      ? {
          messengerHumanAgentEnabled: Boolean(
            channel.messengerHumanAgentEnabled,
          ),
        }
      : {}),
  };
}

function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (field) => before[field] !== after[field],
  );
}

/** What a person would call the channel: the number or @handle customers use. */
function publicHandle(channel: ChannelAuditSource) {
  if (channel.publicPhoneNumberE164) return channel.publicPhoneNumberE164;
  const username =
    channel.publicPageUsername ||
    channel.publicInstagramUsername ||
    channel.publicTelegramUsername;
  return username ? `@${username}` : undefined;
}

/** `"Acme Page" (@acmepage)` */
function quoted(channel: ChannelAuditSource) {
  const handle = publicHandle(channel);
  return `"${channel.displayName}"${
    handle && handle !== channel.displayName ? ` (${handle})` : ""
  }`;
}

function channelName(channel: ChannelAuditSource) {
  return `${providerLabel(channel.provider)} channel ${quoted(channel)}`;
}

/** Whose inbox it feeds. A vendor is not named: the row's actor says which. */
function inboxOf(channel: ChannelAuditSource) {
  return channel.ownerType === "vendor"
    ? "the vendor's inbox"
    : "the platform inbox";
}

function credentialLabel(channel: ChannelAuditSource) {
  return channel.provider === "telegram" ? "bot token" : "access token";
}

function reference(channel: ChannelAuditSource) {
  return {
    resource: "messagingChannel" as const,
    resourceId: String(channel._id),
    resourceName: `${providerLabel(channel.provider)}: ${channel.displayName}`,
    metadata: {
      provider: channel.provider,
      ownerType: channel.ownerType,
      ...(channel.ownerVendorId
        ? { ownerVendorId: String(channel.ownerVendorId) }
        : {}),
    },
  };
}

function connectedSummary(
  current: ChannelAuditSource,
  previous: ChannelAuditSource | null,
  failure?: string,
) {
  const name = channelName(current);
  const inbox = inboxOf(current);
  if (failure) {
    return `Could not finish ${previous ? "reconnecting" : "connecting"} the ${name} to ${inbox}: ${failure}`;
  }
  if (!previous) return `Connected the ${name} to ${inbox}`;

  // Reconnecting revives the same row, so it reads as "after a disconnect" when
  // the channel was off, and as a credential swap when it was still connected.
  const how =
    previous.status === CHANNEL_CONNECTION_STATUSES.REVOKED
      ? "after it was disconnected"
      : `with a new ${credentialLabel(current)}`;
  // The same row can be pointed at another page or number; that is worth saying.
  const switched =
    previous.externalAccountId &&
    previous.externalAccountId !== current.externalAccountId
      ? `, switching it from ${quoted(previous)}`
      : "";
  return `Reconnected the ${name} to ${inbox} ${how}${switched}`;
}

/**
 * A channel connected, or reconnected over its own row (`previous`): the same
 * row is revived so every conversation on it stays valid, which makes a
 * reconnect an `UPDATE` rather than a new channel.
 *
 * `failure` is for a connect that wrote the row and then did not finish. The
 * credential was stored and whatever was connected here lost its webhook secret,
 * so the attempt is a change even though it ended in an error.
 */
export function auditChannelConnected(
  caller: ChannelAuditCaller & {
    current: ChannelAuditSource;
    /** The row this connect revived, or null when it made a new one. */
    previous: ChannelAuditSource | null;
    failure?: string;
  },
) {
  const { current, previous, failure } = caller;
  const before = previous ? snapshot(previous) : undefined;
  const after = {
    ...snapshot(current),
    // A connect that fails after claiming the row leaves it parked in `error`.
    ...(failure ? { status: CHANNEL_CONNECTION_STATUSES.ERROR } : {}),
  };
  return audit(caller.auditContext ?? viewerAuditContext(caller.viewer), {
    action: previous ? "UPDATE" : "CREATE",
    ...reference(current),
    changes: {
      ...(before ? { before, fields: changedFields(before, after) } : {}),
      after,
      summary: connectedSummary(current, previous, failure),
    },
    ...(failure ? { success: false, errorMessage: failure } : {}),
  });
}

/** Human Agent replies turned on or off. The only setting a channel has. */
export function auditChannelSettings(
  caller: ChannelAuditCaller & {
    channel: ChannelAuditSource;
    humanAgent: { from: boolean; to: boolean };
  },
) {
  const { channel, humanAgent } = caller;
  return audit(caller.auditContext ?? viewerAuditContext(caller.viewer), {
    action: "SETTINGS_CHANGE",
    ...reference(channel),
    changes: {
      before: { messengerHumanAgentEnabled: humanAgent.from },
      after: { messengerHumanAgentEnabled: humanAgent.to },
      fields: ["messengerHumanAgentEnabled"],
      summary: `Turned Human Agent replies ${
        humanAgent.to ? "on" : "off"
      } for the ${channelName(channel)} in ${inboxOf(channel)}`,
    },
  });
}

/** A channel disconnected. `channel` is the connection as it stood before. */
export function auditChannelDisconnected(
  caller: ChannelAuditCaller & { channel: ChannelAuditSource },
) {
  const { channel } = caller;
  return audit(caller.auditContext ?? viewerAuditContext(caller.viewer), {
    action: "DELETE",
    ...reference(channel),
    changes: {
      before: snapshot(channel),
      summary: `Disconnected the ${channelName(channel)} from ${inboxOf(channel)}`,
    },
  });
}
