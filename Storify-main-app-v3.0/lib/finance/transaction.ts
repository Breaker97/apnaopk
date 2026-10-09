import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientSession } from "mongoose";
import { runTransaction } from "@/lib/db-transaction";

const context = new AsyncLocalStorage<ClientSession>();
export const financeSession = () => context.getStore();

/** Attach the enclosing money transaction without changing ordinary read callers. */
export function financeQuery<T>(query: T): T {
  const session = financeSession();
  if (session) (query as { session: (s: ClientSession) => unknown }).session(session);
  return query;
}

export async function financeTransaction<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (financeSession()) return work();
  return runTransaction(label, (session) => context.run(session, work));
}

export function financeVersionFilter(version: number) {
  return version === 0
    ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
    : { version };
}
