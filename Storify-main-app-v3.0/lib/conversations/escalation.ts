import { Types } from "mongoose";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { sendEmail } from "@/lib/email/email";
import { getPlatformMessagingConfiguration } from "@/lib/notifications/platform-messaging";
import {
  Conversation,
  StaffProfile,
  User,
  Vendor,
  getSettings,
} from "@/models";
import { CONVERSATION_STATUSES } from "@/models/conversation.model";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function recipientForConversation(conversation: {
  assignedToUserId?: Types.ObjectId;
  ownerVendorId?: Types.ObjectId;
}) {
  if (conversation.assignedToUserId) {
    const assignee = await User.findOne({
      _id: conversation.assignedToUserId,
      status: USER_ACCOUNT_STATUS.ACTIVE,
    })
      .select("name email role")
      .lean<{ name?: string; email?: string; role?: string } | null>();
    if (assignee?.email) {
      return {
        name: assignee.name || "team",
        email: assignee.email,
        path:
          assignee.role === USER_ROLES.STAFF ||
          assignee.role === USER_ROLES.SELLER
            ? "/staff/inbox"
            : assignee.role === USER_ROLES.VENDOR
              ? "/vendor/inbox"
              : "/admin/inbox?view=chat",
      };
    }
  }

  if (conversation.ownerVendorId) {
    const vendor = await Vendor.findById(conversation.ownerVendorId)
      .select("userId")
      .lean<{ userId?: Types.ObjectId } | null>();
    const owner = vendor?.userId
      ? await User.findOne({
          _id: vendor.userId,
          status: USER_ACCOUNT_STATUS.ACTIVE,
        })
          .select("name email")
          .lean<{ name?: string; email?: string } | null>()
      : null;
    if (owner?.email) {
      return {
        name: owner.name || "vendor",
        email: owner.email,
        path: "/vendor/inbox",
      };
    }

    const fallbackStaff = await StaffProfile.findOne({
      vendorIds: conversation.ownerVendorId,
      isActive: true,
      permissions: { $in: ["reply_inbox", "manage_inbox"] },
    })
      .select("userId")
      .lean<{ userId?: Types.ObjectId } | null>();
    const staffUser = fallbackStaff?.userId
      ? await User.findOne({
          _id: fallbackStaff.userId,
          status: USER_ACCOUNT_STATUS.ACTIVE,
        })
          .select("name email")
          .lean<{ name?: string; email?: string } | null>()
      : null;
    if (staffUser?.email) {
      return {
        name: staffUser.name || "team",
        email: staffUser.email,
        path: "/staff/inbox",
      };
    }
  }

  return null;
}

export async function processConversationEscalations(limit = 50) {
  const [config, settings] = await Promise.all([
    getPlatformMessagingConfiguration(),
    getSettings(),
  ]);
  if (!config.escalationEnabled) {
    return { scanned: 0, notified: 0, skipped: true };
  }

  const cutoff = new Date(
    Date.now() - config.escalationAfterMinutes * 60 * 1000,
  );
  const conversations = await Conversation.find({
    status: { $in: [CONVERSATION_STATUSES.OPEN, CONVERSATION_STATUSES.PENDING] },
    lastInboundAt: { $lte: cutoff },
    escalationNotifiedAt: { $exists: false },
    $expr: {
      $gt: [
        "$lastInboundAt",
        { $ifNull: ["$lastOutboundAt", new Date(0)] },
      ],
    },
  })
    .sort({ lastInboundAt: 1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .lean();

  let notified = 0;
  for (const conversation of conversations) {
    const claimedAt = new Date();
    const claimed = await Conversation.updateOne(
      { _id: conversation._id, escalationNotifiedAt: { $exists: false } },
      { $set: { escalationNotifiedAt: claimedAt } },
    );
    if (!claimed.modifiedCount) continue;

    const recipient = await recipientForConversation(conversation);
    const fallbackEmail =
      conversation.ownerVendorId
        ? ""
        : config.escalationEmail || settings.general?.storeEmail || "";
    const email = recipient?.email || fallbackEmail;
    if (!email) {
      await Conversation.updateOne(
        { _id: conversation._id, escalationNotifiedAt: claimedAt },
        { $unset: { escalationNotifiedAt: 1 } },
      );
      continue;
    }
    const path =
      recipient?.path ||
      "/admin/inbox?view=chat";
    const separator = path.includes("?") ? "&" : "?";
    const inboxUrl = `${(
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    ).replace(/\/$/, "")}${path}${separator}conversation=${conversation._id}`;
    // One undeliverable address must not abort the batch. An uncaught throw
    // here left this conversation's `escalationNotifiedAt` claimed — so it
    // never escalated again — and skipped every remaining conversation too.
    try {
      await sendEmail({
        to: email,
        subject: `Unanswered chat from ${conversation.contact.name}`,
        category: "chat-escalation",
        settings,
        html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#18181b">
          <h1 style="font-size:22px;margin:0 0 16px">A customer is waiting for a reply</h1>
          <p>Hi ${escapeHtml(recipient?.name || "team")},</p>
          <p><strong>${escapeHtml(conversation.contact.name)}</strong> sent a message that has remained unanswered for at least ${config.escalationAfterMinutes} minutes.</p>
          <p style="padding:12px;background:#f4f4f5;border-radius:6px">${escapeHtml(conversation.lastMessagePreview)}</p>
          <p><a href="${escapeHtml(inboxUrl)}" style="display:inline-block;padding:11px 16px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px">Open conversation</a></p>
        </div>
      `,
      });
      notified += 1;
    } catch (error) {
      console.error(
        `Chat escalation email failed for conversation ${conversation._id}:`,
        error,
      );
      // Release the claim so the next run retries this one.
      await Conversation.updateOne(
        { _id: conversation._id, escalationNotifiedAt: claimedAt },
        { $unset: { escalationNotifiedAt: 1 } },
      );
    }
  }

  return { scanned: conversations.length, notified, skipped: false };
}
