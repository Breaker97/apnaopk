import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ClientSession } from "mongoose";
import { runTransaction } from "@/lib/db-transaction";
import { processSingleton } from "@/lib/process-singleton";

// Shared by every bundled copy of this module: a session one copy opens is
// the session another copy's write must join.
const context = processSingleton("finance:session", () => new AsyncLocalStorage<ClientSession>());
const effects = processSingleton("finance:after-commit", () => new AsyncLocalStorage<Array<() => Promise<void>>>());
export const financeSession = () => context.getStore();

/** Participate in an existing stock/order transaction without nesting a session. */
export function inFinanceSession<T>(session: ClientSession, work: () => Promise<T>): Promise<T> {
  return context.run(session, work);
}

/** Attach the enclosing money transaction without changing ordinary read callers. */
export function financeQuery<T>(query: T): T {
  const session = financeSession();
  if (session) (query as { session: (s: ClientSession) => unknown }).session(session);
  return query;
}

export async function financeTransaction<T>(label: string, work: () => Promise<T>): Promise<T> {
  if (financeSession()) return work();
  const completed = await runTransaction(label, (session) => context.run(session, () => effects.run([], async () => ({ value: await work(), effects: effects.getStore()! }))));
  for (const effect of completed.effects) { try { await effect(); } catch (error) { console.error("Inventory post-commit effect failed:", error); } }
  return completed.value;
}

export function afterFinanceCommit(work: () => Promise<void>): boolean {
  const pending = effects.getStore();
  if (!pending) return false;
  pending.push(work);
  return true;
}

export function financeVersionFilter(version: number) {
  return version === 0
    ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
    : { version };
}
