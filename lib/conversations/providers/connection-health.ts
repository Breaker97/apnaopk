import type { Types } from "mongoose";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { createNotification } from "@/lib/notifications/notifications";
import {
  CHANNEL_CONNECTION_STATUSES,
  ChannelConnection,
  type IChannelConnection,
} from "@/models/channel-connection.model";
import { NotificationType } from "@/models/notification.model";
import { User, Vendor } from "@/models";
import { providerLabel } from "@/lib/conversations/channels";

/**
 * Marks a channel connection as broken, and tells its owner exactly once.
 *
 * Two separate problems live here.
 *
 * The first is *idempotence*: a dead token fails every queued message on the
 * connection, so the demotion used to be written once per failed send. Guarding
 * the update on `status: active` turns that into a single edge — the first send
 * that discovers the outage demotes and notifies; the rest see a connection
 * that is already `error` and stay quiet.
 *
 * The second is *silence*: before this, a dying credential was recorded only in
 * `lastError`, which is rendered nowhere except the channels panel. A vendor's
 * WhatsApp could be down for days while the storefront kept advertising it.
 * Failed deliveries get a panel and unanswered chats get an escalation email;
 * an entire channel going dark deserves at least as much.
 */
export async function demoteChannelConnection(params: {
  connectionId: Types.ObjectId;
  reason: string;
}) {
  const message = params.reason.slice(0, 1000);
  try {
    const demoted = await ChannelConnection.findOneAndUpdate(
      {
        _id: params.connectionId,
        status: CHANNEL_CONNECTION_STATUSES.ACTIVE,
      },
      {
        $set: {
          status: CHANNEL_CONNECTION_STATUSES.ERROR,
          lastError: message,
        },
      },
      { new: true },
    );
    // Already demoted (or already revoked): the owner has been told.
    if (!demoted) return false;
    await notifyChannelConnectionFailure(demoted, message);
    return true;
  } catch (error) {
    // Every caller is already on a failure path — the outbox runs this inside
    // the handler that records a failed send. Throwing from here would abort
    // that bookkeeping and, in the cron, the rest of the batch with it.
    console.error("Failed to demote a channel connection:", error);
    return false;
  }
}

/**
 * Notifies whoever can actually fix the connection.
 *
 * `dedupe` is keyed on the connection rather than the error text so a channel
 * that flaps between demotion and a failed re-verification cannot bury the
 * owner's bell under identical rows.
 */
export async function notifyChannelConnectionFailure(
  connection: IChannelConnection,
  reason: string,
) {
  const label = providerLabel(connection.provider);
  const connectionId = String(connection._id);
  const data = {
    channelConnectionId: connectionId,
    provider: connection.provider,
    ownerVendorId: connection.ownerVendorId
      ? String(connection.ownerVendorId)
      : undefined,
  };
  const notify = (userId: string, link: string) =>
    createNotification({
      userId,
      type: NotificationType.SYSTEM,
      title: `${label} is disconnected`,
      message: `${label} stopped accepting messages: ${reason.slice(0, 400)}. Reconnect it to resume replying.`,
      link,
      data,
      dedupe: {
        type: NotificationType.SYSTEM,
        "data.channelConnectionId": connectionId,
        isRead: false,
      },
    });

  try {
    if (connection.ownerVendorId) {
      const vendor = await Vendor.findById(connection.ownerVendorId)
        .select("userId")
        .lean<{ userId?: unknown } | null>();
      if (!vendor?.userId) return;
      // Deep-links straight to the panel that can reconnect it, not to a
      // settings index the owner then has to search.
      await notify(String(vendor.userId), "/vendor/settings?tab=channels");
      return;
    }

    const admins = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      status: { $ne: USER_ACCOUNT_STATUS.BANNED },
    })
      .select("_id")
      .lean<Array<{ _id: unknown }>>();
    await Promise.allSettled(
      admins.map((admin) =>
        notify(String(admin._id), "/admin/settings/messaging"),
      ),
    );
  } catch (error) {
    // Losing the alert must never cost the delivery attempt that raised it.
    console.error("Failed to report a channel connection outage:", error);
  }
}
