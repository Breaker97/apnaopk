import { connectDB, mongoose } from "@/lib/db";
import { VendorFollow } from "@/models";

/**
 * Whether this viewer follows this store.
 *
 * Deliberately NOT part of the cached vendor payload: the answer is per-viewer
 * and `unstable_cache` is shared across every visitor, so caching it would show
 * one shopper another shopper's follow state.
 *
 * Served by the unique `{ userId, vendorId }` index. A follower *count* is one
 * `countDocuments({ vendorId })` away — covered by the `{ vendorId, createdAt }`
 * index — but nothing displays one yet, so no query is spent on it.
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
