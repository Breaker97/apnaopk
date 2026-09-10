import { StaffProfile } from "@/models";
import type { Types } from "mongoose";

/**
 * Staff ownership — who manages a staff member, the platform admin or a vendor.
 *
 * Ownership used to be inferred from `vendorIds`, but that array is also the
 * data-access scope an admin may grant platform staff ("only see Vendor A's
 * orders"). Overloading it meant scoping a platform staff member to a vendor
 * silently handed them over: they vanished from the admin list and detail
 * routes (which 404 on vendor-owned staff), while the vendor's dashboard could
 * now edit their permissions, suspend the account, or delete them. The admin
 * had no way to undo it, because the routes that would clear the scope were the
 * ones returning 404.
 *
 * `managedBy` records ownership explicitly; `vendorIds` is scope alone. Rows
 * written before the field exist without it, so every filter here falls back to
 * the old inference — vendorIds non-empty meant vendor-owned — which is exactly
 * what those rows meant when written (only vendor creation set vendorIds
 * without the admin bug above). Both dashboards stamp the field on their next
 * profile write, and `db:migrate staff-ownership` stamps the rest in one pass.
 */

export const STAFF_MANAGED_BY = {
  PLATFORM: "platform",
  VENDOR: "vendor",
} as const;

/** Profile filter matching staff a vendor owns (explicit or legacy-derived). */
export const VENDOR_OWNED_STAFF_FILTER: Record<string, unknown> = {
  $or: [
    { managedBy: STAFF_MANAGED_BY.VENDOR },
    { managedBy: { $exists: false }, "vendorIds.0": { $exists: true } },
  ],
};

/** Profile filter matching staff the platform owns (explicit or legacy-derived). */
export const PLATFORM_OWNED_STAFF_FILTER: Record<string, unknown> = {
  $or: [
    { managedBy: STAFF_MANAGED_BY.PLATFORM },
    { managedBy: { $exists: false }, "vendorIds.0": { $exists: false } },
  ],
};

/** User IDs of staff whose profile belongs to a vendor. */
export async function getVendorOwnedStaffUserIds(): Promise<Types.ObjectId[]> {
  const profiles = await StaffProfile.find(VENDOR_OWNED_STAFF_FILTER)
    .select("userId")
    .lean();
  return profiles.map((profile) => profile.userId);
}

/** Whether a staff user belongs to a vendor (and is thus off-limits to admin). */
export async function isVendorOwnedStaff(
  userId: string | Types.ObjectId,
): Promise<boolean> {
  const profile = await StaffProfile.findOne({
    userId,
    ...VENDOR_OWNED_STAFF_FILTER,
  })
    .select("_id")
    .lean();
  return profile !== null;
}
