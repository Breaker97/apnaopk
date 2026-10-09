import { createHash } from "node:crypto";
import { applyStockChangeAtomic, type StockChangeRequest, type StockChangeResult } from "@/lib/inventory/inventory";

interface BizStockEffect {
  /** BizOperationExecution.effectKey, plus an immutable domain leg. */
  effectKey: string;
  leg: string;
  productId: string;
  variantId?: string;
  locationId?: string;
  /** Signed units, never a stock baseline supplied by the app. */
  quantity: number;
  scopeFilter: Record<string, unknown>;
  /** Only a server-resolved standing policy may authorize overselling. */
  allowOversell?: boolean;
  session?: StockChangeRequest["session"];
}

/** One atomic, replayable counter movement. Callers transact multi-line effects. */
export async function applyBizStockEffect(input: BizStockEffect): Promise<StockChangeResult> {
  if (!input.effectKey.startsWith("biz:") || !input.leg || input.leg.length > 160 || !Number.isSafeInteger(input.quantity) || input.quantity === 0) {
    return { success: false, error: "Invalid business stock effect" };
  }
  const payload = [input.productId, input.variantId ?? null, input.locationId ?? null, input.quantity, input.allowOversell === true];
  return applyStockChangeAtomic({
    productId: input.productId, variantId: input.variantId, locationId: input.locationId,
    quantity: input.quantity, adjustment: true, scopeFilter: input.scopeFilter,
    rejectNegative: input.quantity < 0 && !input.allowOversell,
    allowNegative: input.quantity > 0 || input.allowOversell === true, requireLocationWhenTracked: true,
    receipt: { key: `${input.effectKey}:stock:${input.leg}`, hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), durable: true },
    session: input.session,
  });
}
