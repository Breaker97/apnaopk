import { User } from "@/models";
import { isValidObjectId } from "@/lib/api/validate";

/**
 * Who rang up a POS sale, by name — the "Sold by" line of the order screens.
 *
 * `staffId` is a bare string with no `ref`, so it cannot be populated, the
 * same way `posLocationId` is looked up beside it. Nothing for an online
 * order, and nothing when that user no longer exists: the line is left out
 * rather than showing an id.
 */
export async function resolvePosSoldByName(order: {
  channel?: string | null;
  staffId?: unknown;
}): Promise<string | undefined> {
  if (order.channel !== "pos" || !order.staffId) return undefined;
  const staffId = String(order.staffId);
  if (!isValidObjectId(staffId)) return undefined;
  const user = await User.findById(staffId)
    .select("name")
    .lean<{ name?: string } | null>();
  return user?.name?.trim() || undefined;
}
