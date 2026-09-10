/**
 * Access requests — the second of the three doors to extra access
 * (docs/VENDOR_PERMISSIONS_GUIDELINE.md §2.4).
 *
 * Everything that WRITES an override lives here, so there is exactly one place
 * that knows the invariants: an override always carries an author and a reason,
 * approving never edits the plan, and granting a pack the marketplace policy
 * has switched off is refused rather than written and silently ignored.
 */

import { connectDB } from "@/lib/db";
import { User, Vendor, VendorPlan } from "@/models";
import { getSettings } from "@/models/settings.model";
import { NotificationType } from "@/models/notification.model";
import {
  VENDOR_ACCESS_REQUEST_STATUS,
  VendorAccessRequest,
  expiryForDuration,
  type IVendorAccessRequest,
  type VendorAccessRequestDuration,
} from "@/models/vendorAccessRequest.model";
import { createNotification } from "@/lib/notifications/notifications";
import { USER_ROLES } from "@/config/app.config";
import {
  VENDOR_PACK_LABELS,
  VENDOR_PERMISSION_PACKS,
  type VendorPermission,
  type VendorPermissionPack,
} from "@/config/permissions.config";
import {
  VENDOR_ACCESS_FIELDS,
  activeOverrides,
  overridesFromLegacyGrants,
  resolveVendorAccess,
  type VendorAccessOverride,
  type VendorAccessPlan,
  type VendorAccessSubject,
} from "@/lib/vendors/vendor-permissions";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/api/errors";
import { auditUpdate, type AuditContext } from "@/lib/audit";

/** Let every admin know a request is waiting. Best-effort: never blocks the write. */
export async function notifyAdminsOfAccessRequest(params: {
  storeName: string;
  pack: VendorPermissionPack;
  requestId: string;
}): Promise<void> {
  try {
    await connectDB();
    const admins = await User.find({ role: USER_ROLES.ADMIN })
      .select("_id")
      .lean<{ _id: unknown }[]>();

    await Promise.all(
      admins.map((admin) =>
        createNotification({
          userId: String(admin._id),
          type: NotificationType.VENDOR_ACCESS_REQUEST,
          title: "Vendor access request",
          message: `${params.storeName} is asking for ${VENDOR_PACK_LABELS[params.pack]}.`,
          link: `/admin/access-requests`,
          data: {
            requestId: params.requestId,
            pack: params.pack,
            recipientRole: USER_ROLES.ADMIN,
          },
          dedupe: {
            type: NotificationType.VENDOR_ACCESS_REQUEST,
            "data.requestId": params.requestId,
          },
        }),
      ),
    );
  } catch {
    // A notification failure must not lose the request the vendor just made.
  }
}

/** Tell the vendor what an admin decided. Best-effort, same reasoning. */
async function notifyVendorOfDecision(params: {
  vendorUserId: string;
  pack: VendorPermissionPack;
  approved: boolean;
  note?: string | null;
}): Promise<void> {
  try {
    await createNotification({
      userId: params.vendorUserId,
      type: NotificationType.VENDOR_ACCESS_REQUEST,
      title: params.approved
        ? `${VENDOR_PACK_LABELS[params.pack]} unlocked`
        : `Access request declined`,
      message: params.approved
        ? `An admin approved your request for ${VENDOR_PACK_LABELS[params.pack]}.`
        : params.note?.trim()
          ? `Your request for ${VENDOR_PACK_LABELS[params.pack]} was declined: ${params.note.trim()}`
          : `Your request for ${VENDOR_PACK_LABELS[params.pack]} was declined.`,
      link: "/vendor/dashboard",
    });
  } catch {
    // Same reasoning as above.
  }
}

interface OverrideWrite {
  permission: VendorPermission;
  mode: "grant" | "revoke";
  reason?: string;
  expiresAt?: Date | null;
}

/**
 * Merge override writes into a vendor's stored list and save.
 *
 * Reads the CURRENT overrides first — including the legacy-grant fallback — so
 * a vendor that has not been migrated yet is converted on its first write
 * instead of losing whatever the old list encoded.
 *
 * Returns the before/after vendor objects so the caller can write one audit
 * entry; this function deliberately does not audit, because "who changed this"
 * differs between an admin edit and an approved request.
 */
async function applyOverrides(
  vendorId: string,
  writes: OverrideWrite[],
  actor: { userId: string },
): Promise<{ before: Record<string, unknown>; after: Record<string, unknown> }> {
  await connectDB();
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw new NotFoundError("Vendor");

  const settings = await getSettings();
  const plan = vendor.planId
    ? await VendorPlan.findById(vendor.planId)
        .select("capabilities")
        .lean<VendorAccessPlan | null>()
    : null;

  const before = vendor.toObject() as Record<string, unknown>;

  const subject = vendor.toObject() as VendorAccessSubject;
  const resolution = resolveVendorAccess({ vendor: subject, plan, settings });

  // Start from what is stored, or from the legacy list converted to overrides.
  const current: VendorAccessOverride[] = Array.isArray(
    subject.permissionOverrides,
  )
    ? activeOverrides(subject.permissionOverrides)
    : overridesFromLegacyGrants(
        subject.permissions,
        new Set(
          resolution.packs.flatMap((state) =>
            state.entitled ? VENDOR_PERMISSION_PACKS[state.pack] : [],
          ),
        ),
      );

  const byPermission = new Map<VendorPermission, VendorAccessOverride>(
    current.map((override) => [override.permission, override]),
  );

  const now = new Date();
  for (const write of writes) {
    byPermission.set(write.permission, {
      permission: write.permission,
      mode: write.mode,
      reason: write.reason,
      grantedBy: actor.userId,
      grantedAt: now,
      expiresAt: write.expiresAt ?? null,
    });
  }

  vendor.set("permissionOverrides", Array.from(byPermission.values()));
  await vendor.save();

  return { before, after: vendor.toObject() as Record<string, unknown> };
}

type AccessRequestDecision = "approved" | "declined";

/**
 * Approve or decline a request.
 *
 * Approving writes ONE grant override per permission in the pack, carrying the
 * vendor's own reason and the expiry they asked for. It never touches the plan:
 * a later upgrade or downgrade therefore leaves the decision intact, which is
 * the whole reason overrides are stored as deltas.
 */
export async function decideAccessRequest(params: {
  requestId: string;
  decision: AccessRequestDecision;
  note?: string;
  actor: { userId: string };
  auditContext: AuditContext;
}): Promise<IVendorAccessRequest> {
  await connectDB();

  const request = await VendorAccessRequest.findById(params.requestId);
  if (!request) throw new NotFoundError("Access request");
  if (request.status !== VENDOR_ACCESS_REQUEST_STATUS.PENDING) {
    throw new ConflictError("This request has already been decided");
  }

  const pack = request.pack as VendorPermissionPack;

  if (params.decision === "approved") {
    const vendor = await Vendor.findById(request.vendorId)
      .select(VENDOR_ACCESS_FIELDS)
      .lean<(VendorAccessSubject & { userId?: string }) | null>();
    if (!vendor) throw new NotFoundError("Vendor");

    const settings = await getSettings();
    const plan = vendor.planId
      ? await VendorPlan.findById(vendor.planId)
          .select("capabilities")
          .lean<VendorAccessPlan | null>()
      : null;
    const resolution = resolveVendorAccess({ vendor, plan, settings });
    const packState = resolution.packs.find((state) => state.pack === pack);

    // Refuse rather than write an override the policy layer will ignore. A
    // grant that silently does nothing is worse than a clear decline.
    if (packState?.policy === false) {
      throw new ValidationError(
        `${VENDOR_PACK_LABELS[pack]} is switched off marketplace-wide, so an override cannot grant it. Turn it on in Settings first.`,
      );
    }

    const expiresAt = expiryForDuration(
      request.duration as VendorAccessRequestDuration,
    );

    const { before, after } = await applyOverrides(
      String(request.vendorId),
      VENDOR_PERMISSION_PACKS[pack].map((permission) => ({
        permission,
        mode: "grant" as const,
        reason: request.reason,
        expiresAt,
      })),
      params.actor,
    );

    await auditUpdate(
      params.auditContext,
      "vendor",
      String(request.vendorId),
      before,
      after,
    );

    if (vendor.userId) {
      await notifyVendorOfDecision({
        vendorUserId: String(vendor.userId),
        pack,
        approved: true,
      });
    }
  } else {
    const vendor = await Vendor.findById(request.vendorId)
      .select("userId")
      .lean<{ userId?: string } | null>();
    if (vendor?.userId) {
      await notifyVendorOfDecision({
        vendorUserId: String(vendor.userId),
        pack,
        approved: false,
        note: params.note,
      });
    }
  }

  request.status =
    params.decision === "approved"
      ? VENDOR_ACCESS_REQUEST_STATUS.APPROVED
      : VENDOR_ACCESS_REQUEST_STATUS.DECLINED;
  request.decidedBy = params.actor.userId;
  request.decidedAt = new Date();
  request.decisionNote = params.note?.trim() || null;
  await request.save();

  return request;
}
