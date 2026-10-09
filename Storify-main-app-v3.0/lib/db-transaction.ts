import type { ClientSession } from "mongoose";
import { mongoose } from "@/lib/db";

/**
 * Multi-document transactions, and an honest answer when there are none.
 *
 * Some pre-order changes are only correct as a unit: taking units off a
 * product's shelf, freeing the reservation counter they were promised against,
 * and writing the evidence on the order that says which branch they came from.
 * Done as separate writes, a second request that reads between them sees an
 * order with no reservation left and calls it allocated — while the first is
 * still about to fail for want of stock. So those changes run in one MongoDB
 * transaction, and nowhere else.
 *
 * Transactions need a replica set (or a sharded cluster). A standalone server
 * refuses them, and the caller is told so with {@link
 * TransactionsUnavailableError} rather than being quietly handed the old
 * write-by-write path: that path is the bug. Every managed MongoDB (Atlas and
 * the like) is a replica set; a local server becomes one with `--replSet rs0`
 * and a single `rs.initiate()`.
 *
 * The callback can run more than once — a write conflict with a concurrent
 * request aborts it and it is tried again on a fresh snapshot — so it must not
 * send email, call a gateway, or do anything else that cannot be rolled back.
 * Those belong after the commit.
 */

export type TransactionTopology =
  | "replica_set"
  | "sharded"
  | "standalone"
  | "unknown";

export type TransactionSupport = {
  supported: boolean;
  topology: TransactionTopology;
  /** Why not, in words an operator can act on. Absent when supported. */
  reason?: string;
};

export const TRANSACTIONS_UNAVAILABLE_REASON =
  "MongoDB transactions are unavailable: this database is not a replica set. Run it as a replica set (managed MongoDB already is; locally, start mongod with --replSet and run rs.initiate()) before pre-order stock can be allocated.";

/** The deployment cannot run transactions, so the unit of work did not run. */
export class TransactionsUnavailableError extends Error {
  readonly code = "TRANSACTIONS_UNAVAILABLE";
  readonly topology: TransactionTopology;

  constructor(topology: TransactionTopology, label?: string) {
    super(
      `${label ? `${label}: ` : ""}${TRANSACTIONS_UNAVAILABLE_REASON} (topology: ${topology})`,
    );
    this.name = "TransactionsUnavailableError";
    this.topology = topology;
  }
}

/**
 * Concurrent work on the same documents kept winning, so this one gave up
 * after its retries — nothing it wrote was committed. Safe to try again.
 */
export class TransactionContendedError extends Error {
  readonly code = "TRANSACTION_CONTENDED";

  constructor(label: string, cause?: unknown) {
    super(`${label}: another change to the same records is in progress`);
    this.name = "TransactionContendedError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * The commit was sent and its answer was lost. The work may or may not have
 * committed; only reading the records again can tell. Never treated as either.
 */
export class TransactionOutcomeUnknownError extends Error {
  readonly code = "TRANSACTION_OUTCOME_UNKNOWN";

  constructor(label: string, cause?: unknown) {
    super(`${label}: the database did not confirm whether the change was saved`);
    this.name = "TransactionOutcomeUnknownError";
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

const supportByClient = new WeakMap<object, Promise<TransactionSupport>>();

/**
 * Whether the connected deployment can run transactions.
 *
 * Asked of the server (`hello`), once per client, rather than inferred from an
 * environment variable that can disagree with it. An unconnected or
 * unreachable database answers "unknown", which every caller treats as "no":
 * failing closed is the point.
 */
export async function getTransactionSupport(): Promise<TransactionSupport> {
  const connection = mongoose.connection;
  if (connection.readyState !== 1 || !connection.db) {
    return {
      supported: false,
      topology: "unknown",
      reason: "The database connection is not open",
    };
  }
  const client = connection.getClient() as unknown as object;
  let pending = supportByClient.get(client);
  if (!pending) {
    pending = detectTransactionSupport(connection.db);
    supportByClient.set(client, pending);
    // A failed probe is not remembered: the next caller asks again.
    pending
      .then((support) => {
        if (support.topology === "unknown") supportByClient.delete(client);
      })
      .catch(() => supportByClient.delete(client));
  }
  return pending;
}

async function detectTransactionSupport(db: {
  admin: () => { command: (cmd: Record<string, unknown>) => Promise<unknown> };
}): Promise<TransactionSupport> {
  try {
    const hello = (await db.admin().command({ hello: 1 })) as {
      setName?: string;
      msg?: string;
      logicalSessionTimeoutMinutes?: number;
    };
    if (hello.msg === "isdbgrid") return { supported: true, topology: "sharded" };
    if (hello.setName) {
      return hello.logicalSessionTimeoutMinutes == null
        ? {
            supported: false,
            topology: "replica_set",
            reason: "The replica set does not support sessions",
          }
        : { supported: true, topology: "replica_set" };
    }
    return {
      supported: false,
      topology: "standalone",
      reason: TRANSACTIONS_UNAVAILABLE_REASON,
    };
  } catch (error) {
    return {
      supported: false,
      topology: "unknown",
      reason: `Could not ask the database whether it supports transactions: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Test seam: forget what was learned about the current client. */
export function resetTransactionSupportCache(): void {
  const client = mongoose.connection.getClient?.() as unknown as object | undefined;
  if (client) supportByClient.delete(client);
}

function errorLabels(error: unknown): string[] {
  const candidate = error as {
    errorLabels?: string[] | Set<string>;
    hasErrorLabel?: (label: string) => boolean;
  } | null;
  if (!candidate) return [];
  if (Array.isArray(candidate.errorLabels)) return candidate.errorLabels;
  if (candidate.errorLabels instanceof Set) return [...candidate.errorLabels];
  return [];
}

function hasLabel(error: unknown, label: string): boolean {
  const candidate = error as { hasErrorLabel?: (label: string) => boolean } | null;
  if (typeof candidate?.hasErrorLabel === "function") {
    try {
      if (candidate.hasErrorLabel(label)) return true;
    } catch {
      // fall through to the plain array
    }
  }
  return errorLabels(error).includes(label);
}

/** A conflict or failover the whole transaction may simply be run again for. */
export function isTransientTransactionError(error: unknown): boolean {
  if (hasLabel(error, "TransientTransactionError")) return true;
  const code = (error as { code?: number; codeName?: string } | null)?.code;
  // WriteConflict, outside a labelled error (older drivers).
  return code === 112;
}

function isUnknownCommitResult(error: unknown): boolean {
  return hasLabel(error, "UnknownTransactionCommitResult");
}

function isTransactionUnsupportedMessage(error: unknown): boolean {
  return (
    error instanceof Error &&
    /Transaction numbers are only allowed on a replica set member or mongos/i.test(
      error.message,
    )
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type TransactionOptions = {
  /**
   * Runs of the callback before a persistent conflict is reported as
   * {@link TransactionContendedError}. Kept small on purpose: a request should
   * answer "in progress, try again" rather than queue behind another request
   * for the two minutes the driver's own helper would wait.
   */
  maxAttempts?: number;
  /** Base pause between runs; grows with each one. */
  backoffMs?: number;
};

/**
 * Run `work` as one transaction and return what it returned.
 *
 * Throws {@link TransactionsUnavailableError} without running anything on a
 * deployment that cannot do this; {@link TransactionContendedError} when it
 * kept losing to concurrent writers; {@link TransactionOutcomeUnknownError}
 * when the commit's answer was lost. Any other error is the callback's own,
 * after the transaction was aborted.
 */
export async function runTransaction<T>(
  label: string,
  work: (session: ClientSession) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const support = await getTransactionSupport();
  if (!support.supported) {
    throw new TransactionsUnavailableError(support.topology, label);
  }

  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const backoffMs = Math.max(0, options.backoffMs ?? 40);
  const session = await mongoose.connection.startSession();
  try {
    for (let attempt = 1; ; attempt += 1) {
      session.startTransaction({
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      });
      let result: T;
      try {
        result = await work(session);
      } catch (error) {
        if (session.inTransaction()) {
          await session.abortTransaction().catch(() => undefined);
        }
        if (isTransactionUnsupportedMessage(error)) {
          throw new TransactionsUnavailableError(support.topology, label);
        }
        if (isTransientTransactionError(error)) {
          if (attempt < maxAttempts) {
            await delay(backoffMs * attempt);
            continue;
          }
          throw new TransactionContendedError(label, error);
        }
        throw error;
      }

      try {
        await commitWithRetry(session);
        return result;
      } catch (error) {
        if (isUnknownCommitResult(error)) {
          throw new TransactionOutcomeUnknownError(label, error);
        }
        if (session.inTransaction()) {
          await session.abortTransaction().catch(() => undefined);
        }
        if (isTransientTransactionError(error)) {
          if (attempt < maxAttempts) {
            await delay(backoffMs * attempt);
            continue;
          }
          throw new TransactionContendedError(label, error);
        }
        throw error;
      }
    }
  } finally {
    await session.endSession().catch(() => undefined);
  }
}

/**
 * Commit, retrying only the commit when its answer was lost — committing an
 * already-committed transaction is a no-op the server answers truthfully.
 */
async function commitWithRetry(session: ClientSession, attempts = 3): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await session.commitTransaction();
      return;
    } catch (error) {
      if (isUnknownCommitResult(error) && attempt < attempts) {
        await delay(50 * attempt);
        continue;
      }
      throw error;
    }
  }
}
