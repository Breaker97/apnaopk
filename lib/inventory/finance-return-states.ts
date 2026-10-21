import { heldReturnUnits, type HeldReturnSource } from "@/lib/returns/held-units";
import { UNSELLABLE_RETURN_CONDITIONS } from "@/lib/returns/returns";
export type PhysicalReturn = Omit<HeldReturnSource, "items"> & { inventoryRestored?: boolean; items?: Array<NonNullable<NonNullable<HeldReturnSource["items"]>[number]> & { quantityRestocked?: number; orderItemIndex?: number }> | null };
/** Accepted goods awaiting restock also remain physically held, with no asset reversal. */
export function physicalReturnRows(request: PhysicalReturn | null) {
  if (!request?.itemsCountedAt || ["rejected", "cancelled"].includes(request.status ?? "")) return [];
  const unsellable = new Map(heldReturnUnits(request).map((line) => [line.itemIndex, line.held]));
  return (request.items ?? []).flatMap((item, index) => {
    if (!item?.productId) return [];
    const quantity = UNSELLABLE_RETURN_CONDITIONS.includes(item.condition ?? "") ? unsellable.get(index) ?? 0 : request.inventoryRestored ? 0 : Math.max(0, Number(item.quantityReceived ?? 0) - Number(item.quantityRestocked ?? 0));
    return [{ index, orderItemIndex: item.orderItemIndex, productId: String(item.productId), variantId: item.variantId ? String(item.variantId) : null, quantity }];
  });
}
