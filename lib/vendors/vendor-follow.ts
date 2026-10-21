import { connectDB, mongoose } from "@/lib/db";
import { VendorFollow } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import { isCustomerAccount } from "@/lib/access/customer-account";

const NON_CUSTOMER_ROLES = Object.values(USER_ROLES).filter(
  (role) => role !== USER_ROLES.CUSTOMER,
);

/**
 * Whether this account may follow stores: shoppers only.
 *
 * An admin, a team member or a seller following a store inflated the public
 * follower count with follows that were not a customer's — and an admin's
 * looked like the platform favouring one store over the rest. A seller is
 * kept out of every store, not just their own, by the product owner's call.
 */
export function canFollowStores(
  user: { role?: string | null; roles?: string[] | null } | null | undefined,
): boolean {
  return isCustomerAccount(user);
}

/**
 * How many shoppers follow this store.
 *
 * Counts only follows whose account is still a shopper's, by the same rule as
 * `canFollowStores`: follows an admin, staff member or seller made before the
 * rule existed stay in the collection but never reach the number, and neither
 * does one whose account has since taken another role.
 */
export async function countVendorFollowers(vendorId: unknown): Promise<number> {
  const id = String(vendorId);
  if (!mongoose.isValidObjectId(id)) return 0;

  await connectDB();

  const [result] = await VendorFollow.aggregate<{ count: number }>([
    { $match: { vendorId: new mongoose.Types.ObjectId(id) } },
    {
      $lookup: {
        from: "user",
        let: { userId: "$userId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$userId"] } } },
          { $project: { role: 1, roles: 1 } },
        ],
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $match: {
        "user.role": { $nin: NON_CUSTOMER_ROLES },
        "user.roles": { $nin: NON_CUSTOMER_ROLES },
      },
    },
    { $count: "count" },
  ]);

  return result?.count ?? 0;
}

/**
 * Whether this viewer follows this store.
 *
 * Deliberately NOT part of the cached vendor payload: the answer is per-viewer
 * and `unstable_cache` is shared across every visitor, so caching it would show
 * one shopper another shopper's follow state.
 *
 * Served by the unique `{ userId, vendorId }` index.
 */
export async function isFollowingVendor({
  vendorId,
  userId,
}: {
  vendorId: string;
  userId?: string | null;
}): Promise<boolean> {
  if (!userId) return false;
  if (!mongoose.isValidObjectId(vendorId)) return false;
  if (!mongoose.isValidObjectId(userId)) return false;

  await connectDB();

  return Boolean(await VendorFollow.exists({ userId, vendorId }));
}
