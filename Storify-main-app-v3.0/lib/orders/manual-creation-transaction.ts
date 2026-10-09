import "server-only";
import { DefiniteOperationFailure, type BizOperationExecution } from "@/lib/api-core/biz/durable-operation";
import { financeTransaction } from "@/lib/finance/transaction";
import { TransactionsUnavailableError, TransactionContendedError } from "@/lib/db-transaction";

/** A write intent survives a missing commit acknowledgement; absence alone is not proof. */
export async function manualCreationTransaction<T>(operation: BizOperationExecution, label: string, work: () => Promise<T>): Promise<T> {
  await operation.remember({ ...operation.checkpoint, primaryStarted: true, primaryAborted: false });
  let callbackFailed = false;
  try {
    return await financeTransaction(label, async () => {
      // The transaction helper may retry its callback on a write conflict.
      callbackFailed = false;
      try {
        return await work();
      } catch (error) {
        callbackFailed = true;
        throw error;
      }
    });
  } catch (error) {
    // Callback failure never requested a commit. These topology/contention
    // errors also certify abort. Commit/network uncertainty retains the intent.
    if (callbackFailed || error instanceof TransactionsUnavailableError || error instanceof TransactionContendedError) {
      await operation.remember({ ...operation.checkpoint, primaryAborted: true });
    }
    if (error instanceof TransactionsUnavailableError) {
      throw new DefiniteOperationFailure({ status: 409, code: "CONFLICT", reason: "TRANSACTIONS_UNAVAILABLE",
        message: "Order creation requires database transaction support. No order was created." });
    }
    throw error;
  }
}
