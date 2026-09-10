import { Types } from "mongoose";
import {
  STAFF_PERMISSIONS,
} from "@/config/permissions.config";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import {
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import {
  StaffProfile,
  User,
  Vendor,
} from "@/models";
import type { ConversationViewer } from "@/lib/conversations/types";
import {
  applyConversationHeader,
  assertConversationAccess,
  serializeConversation,
} from "@/lib/conversations/service";
import {
  canStoreConversationPermission,
  isStoreViewer,
} from "@/lib/conversations/viewer";

interface AssigneeDTO {
  userId: string;
  name: string;
  email?: string;
  image?: string;
  role: "admin" | "vendor" | "staff";
}

type StoreConversationViewer = Extract<
  ConversationViewer,
  { kind: "admin" | "vendor" | "staff" }
>;

function objectId(value: string, label: string) {
  if (!Types.ObjectId.isValid(value)) {
    throw new ValidationError(`${label} is invalid`);
  }
  return new Types.ObjectId(value);
}

function objectIdValue(value: unknown, label: string) {
  const candidate =
    value && typeof value === "object" && "_id" in value
      ? (value as { _id?: unknown })._id
      : value;
  return objectId(String(candidate || ""), label);
}

function uniqueObjectIds(values: unknown[]) {
  const ids = new Map<string, Types.ObjectId>();
  for (const value of values) {
    const text = String(value || "");
    if (Types.ObjectId.isValid(text)) ids.set(text, new Types.ObjectId(text));
  }
  return [...ids.values()];
}

async function listEligibleAssignees(params: {
  viewer: ConversationViewer;
  ownerVendorId?: Types.ObjectId;
}) {
  const candidateRoles = new Map<string, AssigneeDTO["role"]>();
  const candidateIds: unknown[] = [];

  const INBOX_PERMISSIONS = [
    STAFF_PERMISSIONS.VIEW_INBOX,
    STAFF_PERMISSIONS.REPLY_INBOX,
    STAFF_PERMISSIONS.MANAGE_INBOX,
  ];
  // Who may see the platform's own roster. An empty `vendorIds` is how the rest
  // of the app marks UNSCOPED platform staff (see lib/staff-scope.ts), who
  // already read every conversation — so listing platform agents to them
  // discloses nothing they cannot already reach. A vendor-scoped viewer never
  // gets it.
  const platformViewer =
    params.viewer.kind === "admin" ||
    (params.viewer.kind === "staff" && !params.viewer.vendorIds.length);

  if (platformViewer) {
    const admins = await User.find({
      $or: [{ role: USER_ROLES.ADMIN }, { roles: USER_ROLES.ADMIN }],
      status: USER_ACCOUNT_STATUS.ACTIVE,
    })
      .select("_id")
      .lean<Array<{ _id: Types.ObjectId }>>();
    for (const admin of admins) {
      candidateIds.push(admin._id);
      candidateRoles.set(String(admin._id), "admin");
    }
  }

  if (!params.ownerVendorId && platformViewer) {
    // A platform-owned thread has no vendor team, so the only agents left are
    // the platform's own. Without this a platform staff member could read every
    // platform conversation but never claim one: the eligible list came back
    // empty, so even a self-claim failed with "Eligible assignee not found".
    const platformStaff = await StaffProfile.find({
      isActive: true,
      $or: [{ vendorIds: { $size: 0 } }, { vendorIds: { $exists: false } }],
      permissions: { $in: INBOX_PERMISSIONS },
    })
      .select("userId")
      .lean<Array<{ userId: Types.ObjectId }>>();
    for (const profile of platformStaff) {
      candidateIds.push(profile.userId);
      candidateRoles.set(String(profile.userId), "staff");
    }
  }

  if (params.ownerVendorId) {
    const [vendor, staffProfiles] = await Promise.all([
      Vendor.findById(params.ownerVendorId)
        .select("userId")
        .lean<{ userId?: Types.ObjectId } | null>(),
      StaffProfile.find({
        vendorIds: params.ownerVendorId,
        isActive: true,
        permissions: { $in: INBOX_PERMISSIONS },
      })
        .select("userId")
        .lean<Array<{ userId: Types.ObjectId }>>(),
    ]);
    if (vendor?.userId) {
      candidateIds.push(vendor.userId);
      candidateRoles.set(String(vendor.userId), "vendor");
    }
    for (const profile of staffProfiles) {
      candidateIds.push(profile.userId);
      candidateRoles.set(String(profile.userId), "staff");
    }
  }

  const ids = uniqueObjectIds(candidateIds);
  if (!ids.length) return [];
  const users = await User.find({
    _id: { $in: ids },
    status: USER_ACCOUNT_STATUS.ACTIVE,
  })
    .select("_id name email image")
    .sort({ name: 1 })
    .lean<
      Array<{
        _id: Types.ObjectId;
        name: string;
        email?: string;
        image?: string;
      }>
    >();

  return users.map<AssigneeDTO>((user) => ({
    userId: String(user._id),
    name: user.name,
    email: user.email,
    image: user.image,
    role: candidateRoles.get(String(user._id)) || "staff",
  }));
}

function requireStoreViewer(
  viewer: ConversationViewer,
): asserts viewer is StoreConversationViewer {
  if (!isStoreViewer(viewer)) {
    throw new AuthorizationError(
      "Only store users can manage conversation assignments",
    );
  }
}

export async function getConversationAssignmentOptions(params: {
  conversationId: string;
  viewer: ConversationViewer;
}) {
  requireStoreViewer(params.viewer);
  const conversation = await assertConversationAccess(
    params.conversationId,
    params.viewer,
  );
  const ownerVendorId = conversation.ownerVendorId
    ? objectIdValue(conversation.ownerVendorId, "Vendor")
    : undefined;
  const assignees = await listEligibleAssignees({
    viewer: params.viewer,
    ownerVendorId,
  });
  return {
    assignees,
    viewerUserId: params.viewer.userId,
    canClaim: canStoreConversationPermission(params.viewer, "reply"),
    canManage: canStoreConversationPermission(params.viewer, "manage"),
  };
}

export async function updateConversationAssignment(params: {
  conversationId: string;
  viewer: ConversationViewer;
  userId?: string | null;
}) {
  requireStoreViewer(params.viewer);
  const conversation = await assertConversationAccess(
    params.conversationId,
    params.viewer,
  );
  const targetUserId = params.userId?.trim() || undefined;
  const selfAssignment = targetUserId === params.viewer.userId;
  if (
    selfAssignment
      ? !canStoreConversationPermission(params.viewer, "reply")
      : !canStoreConversationPermission(params.viewer, "manage")
  ) {
    throw new AuthorizationError(
      selfAssignment
        ? "Inbox reply permission is required to claim a conversation"
        : "Inbox manage permission is required to change assignments",
    );
  }

  if (targetUserId) {
    const ownerVendorId = conversation.ownerVendorId
      ? objectIdValue(conversation.ownerVendorId, "Vendor")
      : undefined;
    const assignees = await listEligibleAssignees({
      viewer: params.viewer,
      ownerVendorId,
    });
    if (!assignees.some((candidate) => candidate.userId === targetUserId)) {
      throw new NotFoundError("Eligible assignee");
    }
  }

  // Routed through the same atomic header update every other transition uses,
  // rather than mutating this hydrated (and populated) document and calling
  // `save()`. It also returns the populated result directly, replacing the
  // re-read that followed the save.
  const updated = await applyConversationHeader(
    conversation._id as Types.ObjectId,
    targetUserId
      ? { $set: { assignedToUserId: objectId(targetUserId, "Assignee") } }
      : { $unset: { assignedToUserId: "" } },
  );
  if (!updated) throw new NotFoundError("Conversation");
  return serializeConversation(updated, params.viewer);
}
