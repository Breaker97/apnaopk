import { USER_ROLES, VENDOR_STATUS } from "@/config/app.config";
import {
  STAFF_PERMISSIONS,
  VENDOR_PERMISSIONS,
  type StaffPermission,
  type VendorPermission,
} from "@/config/permissions.config";
import { AuthorizationError } from "@/lib/api/errors";
import { isAdmin } from "@/lib/access/rbac";
import {
  VENDOR_ACCESS_FIELDS,
  loadVendorAccess,
  type VendorAccessSubject,
} from "@/lib/vendors/vendor-permissions";
import { StaffProfile, Vendor } from "@/models";
import type {
  ConversationSession,
  ConversationViewer,
} from "@/lib/conversations/types";

function hasInboxPermission(
  permissions: string[],
  action: "view" | "reply" | "manage",
) {
  const grants = new Set(permissions);
  if (action === "view") {
    return (
      grants.has(VENDOR_PERMISSIONS.VIEW_INBOX) ||
      grants.has(VENDOR_PERMISSIONS.REPLY_INBOX) ||
      grants.has(VENDOR_PERMISSIONS.MANAGE_INBOX) ||
      grants.has(STAFF_PERMISSIONS.VIEW_INBOX) ||
      grants.has(STAFF_PERMISSIONS.REPLY_INBOX) ||
      grants.has(STAFF_PERMISSIONS.MANAGE_INBOX)
    );
  }
  if (action === "reply") {
    return (
      grants.has(VENDOR_PERMISSIONS.REPLY_INBOX) ||
      grants.has(VENDOR_PERMISSIONS.MANAGE_INBOX) ||
      grants.has(STAFF_PERMISSIONS.REPLY_INBOX) ||
      grants.has(STAFF_PERMISSIONS.MANAGE_INBOX)
    );
  }
  return (
    grants.has(VENDOR_PERMISSIONS.MANAGE_INBOX) ||
    grants.has(STAFF_PERMISSIONS.MANAGE_INBOX)
  );
}

export async function resolveConversationViewer(params: {
  session: ConversationSession;
  guestKeyHash?: string;
}): Promise<ConversationViewer | null> {
  const { session } = params;
  if (session && isAdmin(session.user)) {
    return {
      kind: "admin",
      userId: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image || undefined,
    };
  }

  if (session?.user.role === USER_ROLES.VENDOR) {
    const vendor = await Vendor.findOne({
      userId: session.user.id,
      status: VENDOR_STATUS.APPROVED,
      storeActive: { $ne: false },
    })
      .select(VENDOR_ACCESS_FIELDS)
      .lean<VendorAccessSubject | null>();
    if (!vendor) throw new AuthorizationError("Active vendor profile not found");

    // EFFECTIVE access, not the legacy `Vendor.permissions` array. That field
    // still defaults to all 48 strings, so reading it directly handed the inbox
    // to every vendor regardless of what their plan sold or an admin revoked.
    const access = await loadVendorAccess(vendor);
    const permissions = access
      ? (Array.from(access.effective) as VendorPermission[])
      : [];
    if (!hasInboxPermission(permissions, "view")) {
      throw new AuthorizationError("Vendor inbox permission is required");
    }

    return {
      kind: "vendor",
      userId: session.user.id,
      vendorId: String(vendor._id),
      name: session.user.name,
      email: session.user.email,
      image: session.user.image || undefined,
      permissions,
    };
  }

  if (
    session?.user.role === USER_ROLES.STAFF ||
    session?.user.role === USER_ROLES.SELLER
  ) {
    const profile = await StaffProfile.findOne({
      userId: session.user.id,
      isActive: true,
    })
      .select("vendorIds permissions")
      .lean<{
        vendorIds?: unknown[];
        permissions?: StaffPermission[];
      } | null>();
    if (!profile) throw new AuthorizationError("Active staff profile not found");

    const permissions = Array.isArray(profile.permissions)
      ? profile.permissions
      : [];
    // An empty `vendorIds` is how the rest of the app represents an UNSCOPED
    // platform staff member (see lib/staff-scope.ts: no scope → no filter), not
    // a misconfigured one. Treating it as fatal locked platform staff out of
    // the inbox their default permissions had just granted them.
    const vendorIds = (profile.vendorIds || []).map(String).filter(Boolean);
    if (!hasInboxPermission(permissions, "view")) {
      throw new AuthorizationError("Staff inbox permission is required");
    }

    return {
      kind: "staff",
      userId: session.user.id,
      vendorIds,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image || undefined,
      permissions,
    };
  }

  if (session) {
    return {
      kind: "customer",
      userId: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image || undefined,
    };
  }

  if (params.guestKeyHash) {
    return { kind: "guest", guestKeyHash: params.guestKeyHash };
  }

  return null;
}

/**
 * Render-path variant: a viewer that is merely *not entitled* resolves to null
 * instead of throwing. Server components must not turn "this user has no inbox"
 * into a 500 error boundary — API routes keep using the throwing version so an
 * unauthorized request still answers 403.
 */
export async function tryResolveConversationViewer(
  params: Parameters<typeof resolveConversationViewer>[0],
): Promise<ConversationViewer | null> {
  try {
    return await resolveConversationViewer(params);
  } catch (error) {
    if (error instanceof AuthorizationError) return null;
    throw error;
  }
}

export function assertStoreConversationPermission(
  viewer: ConversationViewer,
  action: "view" | "reply" | "manage",
) {
  if (!canStoreConversationPermission(viewer, action)) {
    throw new AuthorizationError(`Inbox ${action} permission is required`);
  }
}

export function canStoreConversationPermission(
  viewer: ConversationViewer,
  action: "view" | "reply" | "manage",
) {
  if (viewer.kind === "admin") return true;
  if (viewer.kind !== "vendor" && viewer.kind !== "staff") return false;
  return hasInboxPermission(viewer.permissions, action);
}

export function assertVendorChannelPermission(viewer: ConversationViewer) {
  if (viewer.kind !== "vendor") return;
  if (!viewer.permissions.includes(VENDOR_PERMISSIONS.MANAGE_CHANNELS)) {
    throw new AuthorizationError(
      "Vendor messaging-channel permission is required",
    );
  }
}

export function isStoreViewer(viewer: ConversationViewer) {
  return (
    viewer.kind === "admin" ||
    viewer.kind === "vendor" ||
    viewer.kind === "staff"
  );
}
