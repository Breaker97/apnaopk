import type { Types } from "mongoose";
import { User, StaffProfile } from "@/models";
import { connectDB } from "@/lib/db";
import { STAFF_USER_ROLES, TEAM_USER_ROLES } from "@/lib/access/staff-role";
import { getOwnerAdminUserIds } from "@/lib/access/team-roles";
import {
  VENDOR_OWNED_STAFF_FILTER,
  getVendorOwnedStaffUserIds,
} from "@/lib/access/staff-ownership";
import {
  countForQuery,
  listResult,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Team / staff list query.
 *
 * Shared by `GET /api/admin/staff`, `GET /api/vendor/staff` and the team
 * pages' server components so every caller reads a query string the same way.
 *
 * The two dashboards see disjoint sets: a vendor sees the staff it owns, the
 * admin sees the platform team — administrators plus platform staff,
 * explicitly *excluding* vendor-owned staff, so a merchant's employees never
 * surface in the platform list. Pass `vendorId` to get the vendor view.
 */

interface StaffListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
}

interface StaffListContext {
  /** Present for the vendor dashboard; absent lists platform staff. */
  vendorId?: Types.ObjectId | string;
}

function applyStatusFilter(
  query: Record<string, unknown>,
  status: string | undefined,
) {
  if (status === "active") {
    // Accounts predating the status field behave as active.
    query.status = { $in: ["active", null] };
  } else if (status === "inactive") {
    query.status = "inactive";
  } else if (status === "banned") {
    query.status = "banned";
  }
}

export async function fetchStaffList(
  params: StaffListParams,
  { vendorId }: StaffListContext = {},
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, search, status } = params;
  // A vendor manages staff only; the admin Team page also lists administrators.
  const query: Record<string, unknown> = {
    role: { $in: vendorId ? STAFF_USER_ROLES : TEAM_USER_ROLES },
  };

  // Ownership is recorded on the profile, so that lookup has to happen before
  // the user query in both directions. The vendor path matches ownership, not
  // just membership in `vendorIds` — platform staff scoped to a vendor's data
  // must never surface in that vendor's staff list.
  let scopedProfiles: Awaited<ReturnType<typeof StaffProfile.find>> | null = null;
  if (vendorId) {
    scopedProfiles = await StaffProfile.find({
      vendorIds: vendorId,
      ...VENDOR_OWNED_STAFF_FILTER,
    }).lean();
    query._id = { $in: scopedProfiles.map((profile) => profile.userId) };
  } else {
    query._id = { $nin: await getVendorOwnedStaffUserIds() };
  }

  // `search` arrives regex-escaped from SafeSearchSchema.
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }
  applyStatusFilter(query, status);

  const [users, total, ownerIds] = await Promise.all([
    User.find(query)
      .select("name email image phone status role createdAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    countForQuery(User, query),
    vendorId ? Promise.resolve([]) : getOwnerAdminUserIds(),
  ]);

  // Profiles carry the permissions/scope shown per row. The vendor path
  // already loaded them; the admin path resolves only the page being returned.
  const profiles =
    scopedProfiles ??
    (await StaffProfile.find({
      userId: { $in: users.map((user) => user._id) },
    }).lean());

  const profileByUserId = new Map(
    profiles.map((profile) => [String(profile.userId), profile]),
  );

  const ownerIdSet = new Set(ownerIds);
  const items = users.map((user) => ({
    ...user,
    isOwner: ownerIdSet.has(String(user._id)),
    staffProfile: profileByUserId.get(String(user._id)) || null,
  }));

  return listResult(items as unknown[], page, limit, total);
}
