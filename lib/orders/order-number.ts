import { Order, getNextSequence } from "@/models";
import { normalizeOrderPrefix } from "@/lib/orders/order-settings";

const ONLINE_COUNTER_KEY_PREFIX = "online_order:";
const POS_COUNTER_KEY_PREFIX = "pos_order:";

/**
 * Read the highest existing order number for a prefix, comparing the numeric
 * suffix NUMERICALLY. A lexicographic sort would rank ORD999999 above
 * ORD1000000, so a counter re-seeded past a million orders would restart at
 * the wrong value and grind through duplicate-key retries. Runs only when a
 * counter document is first created for a prefix.
 */
async function readMaxOrderSequence(prefix: string): Promise<number> {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = (await Order.aggregate([
    { $match: { orderNumber: { $regex: `^${escaped}\\d+$` } } },
    {
      $project: {
        seq: {
          $toLong: {
            $substrCP: [
              "$orderNumber",
              prefix.length,
              {
                $subtract: [{ $strLenCP: "$orderNumber" }, prefix.length],
              },
            ],
          },
        },
      },
    },
    { $group: { _id: null, max: { $max: "$seq" } } },
  ])) as Array<{ max?: number }>;
  return Number(rows[0]?.max || 0);
}

/**
 * Generate the next online order number atomically. Format: <PREFIX>000001.
 * On first call for a prefix, seed from the highest matching existing order.
 */
export async function getNextOnlineOrderNumber(prefix = "ORD"): Promise<string> {
  const normalized = normalizeOrderPrefix(prefix);
  const seq = await getNextSequence(
    `${ONLINE_COUNTER_KEY_PREFIX}${normalized}`,
    () => readMaxOrderSequence(normalized),
  );
  return `${normalized}${String(seq).padStart(6, "0")}`;
}

/**
 * Generate the next POS order number atomically for the given prefix.
 * Format: <PREFIX>000001. On first call (no counter document yet), seeds
 * from max(existing prefix#).
 */
export async function getNextPosOrderNumber(prefix: string): Promise<string> {
  const normalized = prefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") || "POS";
  const seq = await getNextSequence(
    `${POS_COUNTER_KEY_PREFIX}${normalized}`,
    () => readMaxOrderSequence(normalized),
  );
  return `${normalized}${String(seq).padStart(6, "0")}`;
}
