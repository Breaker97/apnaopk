import { AsyncLocalStorage } from "node:async_hooks";
import type { InventoryReason } from "./finance-rules";
import { processSingleton } from "@/lib/process-singleton";

export interface InventoryWriteContext {
  reason: InventoryReason;
  sourceKind: string;
  sourceId: string;
  actorId?: string;
  note?: string;
  channel?: "web" | "mobile" | "system";
  requestKey?: string;
  costChangeConfirmed?: boolean;
  costEstablishment?: "opening";
  valuationExpectedVersions?: Record<string, number>;
  valuationProductVersion?: string;
  skipCapture?: boolean;
  restock?: { orderId: string; subOrderId?: string; lineId?: string };
  transfer?: { id: string; phase: "ship" | "receive" | "cancel"; from: string; to: string };
}
// Shared by every bundled copy of this module, so the product hook sees the
// write a route declared whichever copy installed it.
const context = processSingleton("inventory:write-context", () => new AsyncLocalStorage<InventoryWriteContext>());
export const inventoryWriteContext = () => context.getStore();
export function withInventoryWrite<T>(input: InventoryWriteContext, work: () => Promise<T>): Promise<T> {
  return context.run({ ...context.getStore(), ...input }, work);
}
