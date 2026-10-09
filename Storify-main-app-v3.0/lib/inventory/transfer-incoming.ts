import { Transfer } from "@/models";
import { remainingTransferQuantity } from "@/lib/inventory/transfer-rules";

/**
 * Units on their way to a location: shipped on a transfer and not yet received
 * or rejected. They left the source's stock at ship time and are in nobody's
 * on-hand count until they arrive, so without this an inventory row simply
 * reads as having lost them.
 *
 * Counted per inventory row (a variant, or a product without variants), and
 * narrowed to transfers bound for `locationId` when the list is filtered to
 * one. Transfers shipped before stock moved at ship time are left out: their
 * units are still counted on hand at the source.
 */
export async function attachIncomingStock<
  T extends { productId: string; variantId: string | null },
>(items: T[], locationId?: string): Promise<Array<T & { incoming: number }>> {
  if (items.length === 0) return [];

  const transfers = await Transfer.find({
    status: "in_transit",
    shippedAt: { $exists: true },
    "items.productId": { $in: [...new Set(items.map((item) => item.productId))] },
    ...(locationId ? { toLocationId: locationId } : {}),
  })
    .select("items.productId items.variantId items.quantity items.receivedQuantity items.rejectedQuantity")
    .lean<
      Array<{
        items?: Array<{
          productId: unknown;
          variantId?: string;
          quantity: number;
          receivedQuantity?: number;
          rejectedQuantity?: number;
        }>;
      }>
    >()
    .catch((err) => {
      // A missing figure must not take the inventory list down with it.
      console.error("Failed to read incoming transfer stock:", err);
      return [];
    });

  const incoming = new Map<string, number>();
  for (const transfer of transfers) {
    for (const line of transfer.items || []) {
      const key = `${String(line.productId)}:${line.variantId || ""}`;
      incoming.set(key, (incoming.get(key) || 0) + remainingTransferQuantity(line));
    }
  }

  return items.map((item) => ({
    ...item,
    incoming: incoming.get(`${item.productId}:${item.variantId || ""}`) || 0,
  }));
}
