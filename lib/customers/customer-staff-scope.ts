import { Types } from "mongoose";
import { Order } from "@/models";
import {
  buildStaffOrderScopeFilter,
  hasStaffScope,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";

/**
 * Whether a customer is inside a scoped staff member's reach: they ordered
 * from one of the vendors, locations or regions the staff member is limited
 * to. Unscoped staff (and admins) reach every customer.
 */
async function isCustomerInStaffScope(
  userId: string,
  staffScope?: StaffAccessScope,
) {
  if (!hasStaffScope(staffScope)) return true;
  // Guest profiles reach here with no userId at all; the string then isn't a
  // castable ObjectId, and matching on it would throw rather than filter.
  if (!Types.ObjectId.isValid(userId)) return false;
  const count = await Order.countDocuments({
    customerId: userId,
    ...buildStaffOrderScopeFilter(staffScope),
  });
  return count > 0;
}

/**
 * The profile-shaped variant: registered rows are scoped by their orders'
 * customerId, guest rows by the checkout email their orders carry.
 */
export async function isProfileInStaffScope(
  profile: { _id?: unknown; userId?: unknown; email?: string; isGuest?: boolean },
  staffScope?: StaffAccessScope,
) {
  if (!hasStaffScope(staffScope)) return true;
  const userId = getCustomerProfileUserId(profile);
  if (Types.ObjectId.isValid(userId)) {
    return isCustomerInStaffScope(userId, staffScope);
  }
  // A guest the till knew only by phone owns their counter sales by the row
  // itself; an email guest by the checkout email.
  const owner = profile.email
    ? { guestEmail: profile.email }
    : profile.isGuest && profile._id && Types.ObjectId.isValid(String(profile._id))
      ? { posCustomerProfileId: new Types.ObjectId(String(profile._id)) }
      : null;
  if (!owner) return false;
  const count = await Order.countDocuments({
    ...owner,
    ...buildStaffOrderScopeFilter(staffScope),
  });
  return count > 0;
}

function getCustomerProfileUserId(profile: { userId?: unknown }) {
  const user = profile.userId;
  if (user && typeof user === "object" && "_id" in user) {
    return String((user as { _id?: unknown })._id || "");
  }
  return String(user || "");
}
