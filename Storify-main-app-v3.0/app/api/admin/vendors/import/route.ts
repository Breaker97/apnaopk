import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { errorResponse, successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { AuthorizationError, NotFoundError } from "@/lib/api/errors";
import { createAuditContext } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { VENDOR_STATUS } from "@/config/app.config";
import { getSettings } from "@/models/settings.model";
import { ImportRun } from "@/models/import-run.model";
import {
  claimImportChunk,
  closeAbandonedImports,
  finishImportRun,
  ImportRunError,
  openImportRun,
  recordImportChunk,
  releaseImportChunk,
} from "@/lib/imports/import-run";
import {
  checkVendorHeaders,
  readVendorCells,
  VENDOR_IMPORT_CHUNK_ROWS,
  VENDOR_IMPORT_LIMITS,
  VENDOR_IMPORT_MAX_ROWS,
} from "@/lib/vendors/vendor-import-format";
import {
  importVendorRows,
  summarizeVendorRows,
  VENDOR_IMPORT_RUN,
  vendorInvitees,
} from "@/lib/vendors/vendor-import";

/**
 * POST /api/admin/vendors/import — one request's rows of a vendor import (see
 * lib/vendors/vendor-import.ts): a preview with `dryRun`, the import itself
 * without, and `stop` to end a run early.
 *
 * Platform admins only: there is no staff permission over vendors, and a
 * seller's staff act for one shop. A store without multi-vendor mode has no
 * vendors to import.
 */

/** A few rows of downloads and writes, on a slow database and a slow image host. */
export const maxDuration = 60;

/** How long a stop waits for a request still writing its rows. */
const STOP_WAIT_MS = 45_000;

const MAX_COLUMNS = 60;
const MAX_CELL_LENGTH = VENDOR_IMPORT_LIMITS.notes + 100;

const ChunkSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "Invalid run id"),
  dryRun: z.boolean(),
  chunkIndex: z.number().int().min(0).max(10_000),
  /** The last request of the file: the run ends after its rows. */
  final: z.boolean().optional().default(false),
  /** End the run here, without rows: the person pressed Stop or left. */
  stop: z.boolean().optional().default(false),
  /** With a run's first request: rows the browser held back as repeats of a later row. */
  heldBack: z.number().int().min(0).max(VENDOR_IMPORT_MAX_ROWS).optional().default(0),
  fileName: z.string().max(255).optional().default("vendors.csv"),
  options: z.object({
    updateExisting: z.boolean(),
    startAs: z.enum([VENDOR_STATUS.APPROVED, VENDOR_STATUS.PENDING]),
  }),
  headers: z.array(z.string().max(200)).max(MAX_COLUMNS),
  rows: z
    .array(
      z.object({
        row: z.number().int().min(1).max(10_000_000),
        cells: z.array(z.string().max(MAX_CELL_LENGTH)).max(MAX_COLUMNS),
      }),
    )
    .max(VENDOR_IMPORT_CHUNK_ROWS),
});

export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:vendors:import", preset: "lenient" },
    // It writes accounts and stores, and the run sends real email.
    demo: "block-mutations",
  },
  async ({ request, session }) => {
    await connectDB();
    const settings = await getSettings();
    if (!settings.multiVendorMode?.enabled) throw new NotFoundError("Vendor");

    const body = await validateBody(request, ChunkSchema);
    const auditContext = createAuditContext(request, session);
    const actor = { id: session.user.id, email: session.user.email, role: session.user.role };

    if (body.stop) {
      const run = await ImportRun.findOne({ runId: body.runId, entity: "vendor" })
        .select("requestedBy")
        .lean<{ requestedBy: unknown } | null>();
      if (!run) return successResponse({ finished: null });
      if (String(run.requestedBy) !== actor.id) throw new AuthorizationError();
      const finished = await finishImportRun(VENDOR_IMPORT_RUN, {
        runId: body.runId,
        stopped: true,
        auditContext,
        // A tab closed mid-request: its last rows are still being written.
        waitForWritesMs: STOP_WAIT_MS,
      });
      return successResponse({ finished });
    }

    // The route reads the header row itself; the browser's reading only guides it.
    const checked = checkVendorHeaders(body.headers);
    if (!checked.ok) {
      return errorResponse(
        "The file needs the Store name, Owner email and Owner name columns.",
        400,
      );
    }
    const rows = body.rows.map(({ row, cells }) => ({
      row,
      cells: readVendorCells(checked.map, cells),
    }));
    const options = body.options;

    try {
      if (body.dryRun) {
        const { results } = await importVendorRows({
          rows,
          options,
          dryRun: true,
          settings,
          actor: { userId: actor.id },
        });
        return successResponse(summarizeVendorRows(results));
      }

      if (body.chunkIndex === 0) await closeAbandonedImports(VENDOR_IMPORT_RUN);
      const run = await openImportRun(VENDOR_IMPORT_RUN, {
        runId: body.runId,
        actor,
        fileName: body.fileName,
        options,
      });
      // The options the run opened with, whatever a later request says.
      const runOptions = run.options as typeof options;
      await claimImportChunk(run.runId, body.chunkIndex);
      let summary: ReturnType<typeof summarizeVendorRows>;
      try {
        const { results, invites } = await importVendorRows({
          rows,
          options: runOptions,
          dryRun: false,
          settings,
          actor: { userId: actor.id },
        });
        summary = summarizeVendorRows(results);
        await recordImportChunk(run, summary.counts, {
          invitees: vendorInvitees(invites),
          heldBack: body.chunkIndex === 0 ? body.heldBack : 0,
        });
      } finally {
        await releaseImportChunk(run.runId);
      }
      const finished = body.final
        ? await finishImportRun(VENDOR_IMPORT_RUN, { runId: run.runId, stopped: false, auditContext })
        : null;
      return successResponse({ ...summary, finished });
    } catch (error) {
      if (error instanceof ImportRunError) return errorResponse(error.message, error.status);
      throw error;
    }
  },
);
