import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  ImportRun,
  ImportRunInvitee,
  type IImportRun,
  type ImportEntity,
} from "@/models/import-run.model";
import { audit, type AuditContext } from "@/lib/audit";
import type { AuditResource } from "@/config/audit.config";

/**
 * The bookkeeping of a CSV import sent a few hundred rows at a time, shared by
 * the customer and vendor imports: who opened the run and with which options,
 * which requests were counted, and the one Activity Log row it leaves.
 *
 * Each entity brings what differs: its importer (the route's own), and a
 * definition saying how its record reads and what a finished run does with
 * what it created (invitations).
 */

/** A run no request has touched for this long was left by its browser. */
const ABANDONED_AFTER_MS = 30 * 60 * 1000;

/** How long a finished run's row is kept: long enough to look up, not forever. */
const RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface ImportRunActor {
  id: string;
  email?: string;
  role?: string;
}

export interface ImportRunCounts {
  create: number;
  update: number;
  skip: number;
  error: number;
}

/** A record the run created, for the invitations sent when it ends. */
export interface ImportRunInviteeInput {
  recordId: Types.ObjectId;
  userId: Types.ObjectId;
  email: string;
}

export interface ImportRunDefinition {
  entity: ImportEntity;
  /** The run's one Activity Log row; `stopped` when it did not reach the end. */
  audit: (
    run: IImportRun,
    outcome: { stopped: boolean; invitesQueued: number },
  ) => { resource: AuditResource; summary: string; metadata?: Record<string, unknown> };
  /**
   * What a run does with the records it created, once it ends. Called for a
   * stopped run too: a customer run then sends nothing (its tag finds those
   * customers later), while a vendor run still invites the owners of the live
   * stores it made, which no re-run would reach (they match as existing).
   */
  onFinish?: (
    run: IImportRun,
    invitees: Array<{ recordId: Types.ObjectId; userId: Types.ObjectId; email: string }>,
    outcome: { stopped: boolean },
  ) => Promise<{ invitesQueued: number }>;
}

export class ImportRunError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The run a request belongs to, opened by its first request. A run belongs to
 * whoever opened it, and its options are fixed then: a later request cannot
 * switch updating on halfway through a file.
 */
export async function openImportRun(
  definition: ImportRunDefinition,
  params: {
    runId: string;
    actor: ImportRunActor;
    fileName: string;
    options: Record<string, unknown>;
  },
): Promise<IImportRun> {
  await connectDB();
  const run = await ImportRun.findOneAndUpdate(
    { runId: params.runId },
    {
      $setOnInsert: {
        runId: params.runId,
        entity: definition.entity,
        requestedBy: new Types.ObjectId(params.actor.id),
        requestedByEmail: params.actor.email,
        requestedByRole: params.actor.role,
        fileName: params.fileName.slice(0, 255) || `${definition.entity}s.csv`,
        options: params.options,
      },
    },
    { upsert: true, returnDocument: "after" },
  ).lean<IImportRun>();
  if (!run || run.entity !== definition.entity || String(run.requestedBy) !== params.actor.id) {
    throw new ImportRunError("This import belongs to someone else.", 403);
  }
  if (run.status !== "running") {
    throw new ImportRunError("This import has already ended.", 409);
  }
  return run;
}

/**
 * Take one request's place in the run before its rows are written, so the same
 * request sent twice — a retry after a dropped connection — counts once.
 */
export async function claimImportChunk(runId: string, chunkIndex: number) {
  const claimed = await ImportRun.updateOne(
    { runId, status: "running", chunks: { $ne: chunkIndex } },
    { $push: { chunks: chunkIndex }, $inc: { activeChunks: 1 } },
  );
  if (claimed.modifiedCount === 0) {
    throw new ImportRunError("This part of the file was already imported.", 409);
  }
}

/** A claimed request is done writing, whether or not it got through. */
export async function releaseImportChunk(runId: string) {
  await ImportRun.updateOne({ runId }, { $inc: { activeChunks: -1 } });
}

export async function recordImportChunk(
  run: IImportRun,
  counts: ImportRunCounts,
  options: {
    /** Created records to invite when the run ends; only when it was asked to. */
    invitees?: ImportRunInviteeInput[];
    /** Rows the browser held back as repeats of a later row (first request only). */
    heldBack?: number;
  } = {},
) {
  const heldBack = options.heldBack ?? 0;
  await ImportRun.updateOne(
    { runId: run.runId },
    {
      $inc: {
        "counts.created": counts.create,
        "counts.updated": counts.update,
        "counts.skipped": counts.skip + heldBack,
        "counts.failed": counts.error,
        repeatedRows: heldBack,
      },
    },
  );
  if (options.invitees && options.invitees.length > 0) {
    await ImportRunInvitee.insertMany(
      options.invitees.map((invitee) => ({ runId: run.runId, ...invitee })),
      { ordered: false },
    );
  }
}

function runAuditContext(run: IImportRun, context?: AuditContext): AuditContext {
  if (context && context.userId === String(run.requestedBy)) return context;
  return {
    ...(context?.request ? { request: context.request } : {}),
    userId: String(run.requestedBy),
    userEmail: run.requestedByEmail,
    userRole: run.requestedByRole,
  };
}

/**
 * End a run: whatever a finished run does with what it created (a stopped one
 * does nothing — the run's tag finds those records later), then the one
 * Activity Log row that says what the import did. Safe to call twice; only
 * the first call ends it.
 */
export async function finishImportRun(
  definition: ImportRunDefinition,
  params: {
    runId: string;
    stopped: boolean;
    auditContext?: AuditContext;
    /**
     * How long to wait for requests still writing rows. A closed tab's last
     * request can still be on its way when the stop arrives; its rows belong
     * in the run's record, which is written once and never edited.
     */
    waitForWritesMs?: number;
  },
): Promise<{ status: "finished" | "stopped"; invitesQueued: number } | null> {
  await connectDB();
  const now = new Date();
  // Ended first, so no further request can join the run while it is closed.
  const ended = await ImportRun.findOneAndUpdate(
    { runId: params.runId, entity: definition.entity, status: "running" },
    {
      $set: {
        status: params.stopped ? "stopped" : "finished",
        finishedAt: now,
        expiresAt: new Date(now.getTime() + RUN_RETENTION_MS),
      },
    },
    { returnDocument: "after" },
  ).lean<IImportRun>();
  if (!ended) return null;

  let run = ended;
  const deadline = Date.now() + (params.waitForWritesMs ?? 0);
  while ((run.activeChunks ?? 0) > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    run = (await ImportRun.findOne({ runId: params.runId }).lean<IImportRun>()) ?? run;
  }

  let invitesQueued = 0;
  // After the wait, so a closed tab's last request is among the invitees.
  if (definition.onFinish) {
    const invitees = await ImportRunInvitee.find({ runId: run.runId })
      .select("recordId userId email")
      .lean<Array<{ recordId: Types.ObjectId; userId: Types.ObjectId; email: string }>>();
    ({ invitesQueued } = await definition.onFinish(run, invitees, { stopped: params.stopped }));
    if (invitesQueued > 0) {
      await ImportRun.updateOne({ runId: run.runId }, { $set: { invitesQueued } });
    }
  }
  await ImportRunInvitee.deleteMany({ runId: run.runId });

  const { created, updated, skipped, failed } = run.counts;
  if (created + updated + skipped + failed > 0) {
    const entry = definition.audit(run, { stopped: params.stopped, invitesQueued });
    await audit(runAuditContext(run, params.auditContext), {
      action: "BULK_ACTION",
      resource: entry.resource,
      changes: { summary: entry.summary },
      metadata: {
        kind: `${definition.entity}_import`,
        runId: run.runId,
        fileName: run.fileName,
        stopped: params.stopped,
        repeatedRows: run.repeatedRows ?? 0,
        created,
        updated,
        skipped,
        failed,
        invitesQueued,
        ...entry.metadata,
      },
    });
  }

  return { status: params.stopped ? "stopped" : "finished", invitesQueued };
}

/**
 * Close the runs a browser walked away from — a tab closed mid-file — so each
 * still leaves its Activity Log row. Called when the entity's next import starts.
 */
export async function closeAbandonedImports(
  definition: ImportRunDefinition,
  now: number = Date.now(),
) {
  await connectDB();
  const stale = await ImportRun.find({
    entity: definition.entity,
    status: "running",
    updatedAt: { $lt: new Date(now - ABANDONED_AFTER_MS) },
  })
    .select("runId")
    .limit(20)
    .lean<Array<{ runId: string }>>();
  for (const run of stale) {
    await finishImportRun(definition, { runId: run.runId, stopped: true }).catch((error) =>
      console.error(`Could not close an abandoned ${definition.entity} import:`, error),
    );
  }
}
