import { Types, type ClientSession } from "mongoose";
import { Product, ReturnRequest } from "@/models";
import { heldReturnUnits, heldUnitRefusal } from "@/lib/returns/held-units";
import { productScopeFilter } from "@/lib/api-core/biz/scope";
import { applyBizStockEffect } from "@/lib/api-core/biz/stock-effect";
import type { BizOperationExecution } from "@/lib/api-core/biz/durable-operation";
import { authorizedReturnLocations, refuse, type ReturnContext, type ReturnRecord } from "./context";

/** A held unit can be repaired into stock or written off once. */
interface ReturnDispositionSelection { index: number; quantity: number; action: "restocked" | "written_off" }
export async function disposeBizReturn(input: { returned: ReturnRecord; selections: ReturnDispositionSelection[]; context: ReturnContext; operation: BizOperationExecution; session: ClientSession; actorId: string; locationId?: string }) {
  if (!input.selections.length || new Set(input.selections.map((line) => line.index)).size !== input.selections.length) refuse("RETURN_ITEM_LISTED_TWICE", "Choose each held return line once.");
  const held = heldReturnUnits(input.returned); const locations = await authorizedReturnLocations(input.returned, input.context);
  if (input.locationId && !locations.some((location) => location._id === input.locationId)) refuse("RETURN_LOCATION_NOT_ALLOWED", "Choose an authorized return location.");
  const dispositions: Record<string, unknown>[] = [];
  for (const selection of input.selections) {
    const position = input.returned.items.findIndex((item) => item.orderItemIndex === selection.index);
    const line = held.find((item) => item.itemIndex === position);
    if (heldUnitRefusal(line, selection.quantity) || !line) refuse("RETURN_QUANTITY_CHANGED", "Only the remaining held units can be disposed of.");
    if (!["restocked", "written_off"].includes(selection.action)) refuse("RETURN_ACTION_NOT_ALLOWED", "Choose restock or write off.");
    const product = await Product.findOne({ _id: line.productId, ...productScopeFilter(input.context.scope) }, undefined, { session: input.session }).select("locationInventory variants inventory shipping").lean<{ shipping?: { isPhysicalProduct?: boolean }; inventory?: { tracked?: boolean }; locationInventory?: Array<{ locationId: string }>; variants?: Array<{ _id: unknown; locationInventory?: Array<{ locationId: string }> }> } | null>();
    if (!product) refuse("RETURN_ACTION_NOT_ALLOWED", "The returned product is no longer accessible.");
    let selectedLocation: string | undefined;
    if (selection.action === "restocked") {
      const counters = (line.variantId ? product.variants?.find((variant) => String(variant._id) === line.variantId)?.locationInventory : product.locationInventory) || [];
      const locationId = input.locationId || (counters.length ? locations.find((location) => counters.some((counter) => String(counter.locationId) === location._id))?._id : undefined);
      if (counters.length && !locationId) refuse("RETURN_LOCATION_NOT_ALLOWED", "Choose an authorized location for these repaired goods.");
      selectedLocation = locationId;
      if (product.shipping?.isPhysicalProduct !== false && product.inventory?.tracked !== false) { const moved = await applyBizStockEffect({ effectKey: input.operation.effectKey, leg: `disposition-${input.returned._id}-line-${selection.index}`, productId: line.productId, variantId: line.variantId, locationId, quantity: selection.quantity, scopeFilter: productScopeFilter(input.context.scope), session: input.session }); if (!moved.success) refuse("RETURN_STATE_CHANGED", moved.error || "Stock changed concurrently."); }
    }
    dispositions.push({ itemIndex: position, productId: new Types.ObjectId(line.productId), ...(line.variantId ? { variantId: new Types.ObjectId(line.variantId) } : {}), quantity: selection.quantity, action: selection.action, at: new Date(), locationId: selectedLocation, ...(Types.ObjectId.isValid(input.actorId) ? { by: new Types.ObjectId(input.actorId) } : {}), bizOperationId: input.operation.id });
  }
  await ReturnRequest.updateOne({ _id: input.returned._id }, { $push: { unsellableDispositions: { $each: dispositions } } }, { session: input.session });
}
