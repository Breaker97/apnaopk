import "server-only";
import { ApiError, NotFoundError } from "@/lib/api/errors";
import { FinanceOperation } from "@/models/finance-operation.model";
import { finishFinanceOperation, mutationKey } from "@/lib/finance/operations";
export function inventoryRequestKey(request: Request) {
  if (!request.headers.get("idempotency-key")) throw new ApiError("Idempotency-Key is required for inventory changes.", 400, "REQUEST_KEY_REQUIRED");
  return mutationKey(request);
}
/** Recovery only verifies/replays existing plans; it never repairs historical balances. */
export async function retryInventoryPosting(input: { operationId: string; fingerprint: string }) {
  const operation = await FinanceOperation.findById(input.operationId).lean();
  if (!operation || !operation.action.startsWith("inventory:") && !(operation.postings as Array<{ book: string; debit: string; credit: string }>).some((row) => row.book === "own" && (row.debit === "inventory" || row.credit === "inventory"))) throw new NotFoundError("Inventory operation");
  if (operation.fingerprint !== input.fingerprint) throw new ApiError("The recovery plan changed; reload it.", 409, "RECOVERY_PLAN_CHANGED");
  if (operation.state === "conflict") throw new ApiError("Conflicting ledger evidence needs review; it cannot be overwritten by retry.", 409, "LEDGER_CONTENT_CONFLICT");
  return { operationId: input.operationId, bookkeepingState: await finishFinanceOperation(input.operationId) ? "complete" as const : "pending" as const };
}
