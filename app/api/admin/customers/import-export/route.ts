import * as z from "zod";
import { withApi } from "@/lib/api/handler";
import { errorResponse, successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { AuthorizationError } from "@/lib/api/errors";
import { csvFileResponse, datedCsvFilename } from "@/lib/catalog/csv";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { createAuditContext, audit } from "@/lib/audit";
import { CustomerListQuerySchema } from "@/lib/validations/list-query";
import { buildCustomerExport } from "@/lib/customers/customer-export";
import {
  CUSTOMER_IMPORT_CHUNK_ROWS,
  CUSTOMER_IMPORT_MAX_ROWS,
  CUSTOMER_IMPORT_MAX_CELL_LENGTH,
  CUSTOMER_IMPORT_MAX_COLUMNS,
  normalizeImportTag,
} from "@/lib/customers/customer-import-format";
import {
  CUSTOMER_IMPORT_RUN,
  CustomerImportFileError,
  importCustomerRows,
  summarizeRows,
} from "@/lib/customers/customer-import";
import {
  claimImportChunk,
  closeAbandonedImports,
  finishImportRun,
  ImportRunError,
  openImportRun,
  recordImportChunk,
  releaseImportChunk,
} from "@/lib/imports/import-run";
import { ImportRun } from "@/models/import-run.model";
import { customerImportAccess } from "@/lib/customers/customer-import-access";

/**
 * GET  /api/admin/customers/import-export — every customer the list's filters
 *      match, as a CSV in the import template's columns.
 * POST /api/admin/customers/import-export — one request's rows of an import
 *      (see lib/customers/customer-import.ts): a preview with `dryRun`, the
 *      import itself without, and `stop` to end a run early.
 *
 * Both belong to the store's own team, never to a seller: the customer list
 * is shared by every vendor, and a vendor's staff act for one shop only.
 */

const IMPORT_PERMISSIONS = [
  STAFF_PERMISSIONS.CREATE_CUSTOMERS,
  STAFF_PERMISSIONS.MANAGE_CUSTOMERS,
];

/** Function time for a full request of rows on a slow database. */
export const maxDuration = 60;

/** How long a stop waits for a request still writing (within `maxDuration`). */
const STOP_WAIT_MS = 45_000;

function listParam(value: string | null) {
  return value && value !== "all" ? value : undefined;
}

export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_CUSTOMERS],
    rateLimit: { action: "admin:customers:export", preset: "lenient" },
  },
  async ({ request, session, staff }) => {
    // The page's own query string: the list renames `tier` and
    // `subscription` on the way in, and the export reads them the same way.
    const params = request.nextUrl.searchParams;
    const query = CustomerListQuerySchema.parse({
      search: params.get("search") || undefined,
      status: listParam(params.get("status")),
      loyaltyTier: listParam(params.get("tier")) ?? listParam(params.get("loyaltyTier")),
      emailSubscription:
        listParam(params.get("subscription")) ?? listParam(params.get("emailSubscription")),
      tag: listParam(params.get("tag")),
      minSpent: params.get("minSpent") || undefined,
      maxSpent: params.get("maxSpent") || undefined,
    });
    const filter = {
      search: query.search,
      status: query.status,
      loyaltyTier: query.loyaltyTier,
      subscription: query.emailSubscription,
      tag: query.tag,
      minSpent: query.minSpent,
      maxSpent: query.maxSpent,
    };

    const { lines, rowCount, truncated } = await buildCustomerExport(filter, staff?.scope);
    const response = csvFileResponse(datedCsvFilename("customers"), lines);
    if (truncated) response.headers.set("X-Export-Truncated", String(rowCount));

    // The only trace that a copy of the customer list left the store.
    await audit(createAuditContext(request, session), {
      action: "EXPORT",
      resource: "user",
      changes: {
        summary: `Exported ${rowCount} ${rowCount === 1 ? "customer" : "customers"} to CSV${
          truncated ? " (the first of more)" : ""
        }`,
      },
      metadata: {
        kind: "customer_export",
        rowCount,
        truncated,
        filters: Object.fromEntries(
          Object.entries(filter).filter(([, value]) => value !== undefined),
        ),
      },
    });
    return response;
  },
);

const ChunkSchema = z.object({
  runId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "Invalid run id"),
  dryRun: z.boolean(),
  chunkIndex: z.number().int().min(0).max(10_000),
  /** The last request of the file: the run ends after its rows. */
  final: z.boolean().optional().default(false),
  /** End the run here, without rows: the person pressed Stop or left. */
  stop: z.boolean().optional().default(false),
  /**
   * With a run's first request: the rows the browser held back because a
   * later row is the same customer. Only counted, for the run's record.
   */
  heldBack: z.number().int().min(0).max(CUSTOMER_IMPORT_MAX_ROWS).optional().default(0),
  fileName: z.string().max(255).optional().default("customers.csv"),
  options: z.object({
    updateExisting: z.boolean(),
    tag: z.string().max(100),
    sendInvites: z.boolean(),
  }),
  headers: z.array(z.string().max(200)).max(CUSTOMER_IMPORT_MAX_COLUMNS),
  rows: z
    .array(
      z.object({
        row: z.number().int().min(1).max(10_000_000),
        cells: z.array(z.string().max(CUSTOMER_IMPORT_MAX_CELL_LENGTH)).max(CUSTOMER_IMPORT_MAX_COLUMNS),
      }),
    )
    .max(CUSTOMER_IMPORT_CHUNK_ROWS),
});

export const POST = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: IMPORT_PERMISSIONS,
    rateLimit: { action: "admin:customers:import", preset: "lenient" },
    demo: "block-mutations",
  },
  async ({ request, session, staff }) => {
    const access = customerImportAccess({
      role: session.user.role,
      staffPermissions: staff?.permissions,
      staffScope: staff?.scope,
      vendorOwned: staff?.vendorOwned,
    });
    // A vendor's staff act for one shop; the customer list is everyone's.
    if (!access.canImportCustomers) throw new AuthorizationError();

    const body = await validateBody(request, ChunkSchema);
    const tag = normalizeImportTag(body.options.tag);
    if (!tag) return errorResponse("Use one tag of up to 50 characters, without commas.", 400);
    const options = { ...body.options, tag };

    const auditContext = createAuditContext(request, session);
    const actor = { id: session.user.id, email: session.user.email, role: session.user.role };

    if (body.stop) {
      const run = await ImportRun.findOne({ runId: body.runId, entity: "customer" })
        .select("requestedBy")
        .lean<{ requestedBy: unknown } | null>();
      if (!run) return successResponse({ finished: null });
      if (String(run.requestedBy) !== actor.id) throw new AuthorizationError();
      const finished = await finishImportRun(CUSTOMER_IMPORT_RUN, {
        runId: body.runId,
        stopped: true,
        auditContext,
        // A tab closed mid-request: its last rows are still being written.
        waitForWritesMs: STOP_WAIT_MS,
      });
      return successResponse({ finished });
    }

    // Updating is editing (see customerImportAccess).
    if (options.updateExisting && !access.canUpdateOnImport) {
      throw new AuthorizationError(
        "Updating existing customers needs the Edit customers permission and access to every customer.",
      );
    }

    try {
      if (body.dryRun) {
        const { results } = await importCustomerRows({
          headers: body.headers,
          rows: body.rows,
          options,
          dryRun: true,
        });
        return successResponse(summarizeRows(results));
      }

      if (body.chunkIndex === 0) await closeAbandonedImports(CUSTOMER_IMPORT_RUN);
      const run = await openImportRun(CUSTOMER_IMPORT_RUN, {
        runId: body.runId,
        actor,
        fileName: body.fileName,
        options,
      });
      // The options the run opened with, whatever a later request says.
      const runOptions = run.options as typeof options;
      await claimImportChunk(run.runId, body.chunkIndex);
      let summary: ReturnType<typeof summarizeRows>;
      try {
        const { results, invitees } = await importCustomerRows({
          headers: body.headers,
          rows: body.rows,
          options: runOptions,
          dryRun: false,
        });
        summary = summarizeRows(results);
        await recordImportChunk(run, summary.counts, {
          invitees: runOptions.sendInvites ? invitees : undefined,
          heldBack: body.chunkIndex === 0 ? body.heldBack : 0,
        });
      } finally {
        await releaseImportChunk(run.runId);
      }
      const finished = body.final
        ? await finishImportRun(CUSTOMER_IMPORT_RUN, { runId: run.runId, stopped: false, auditContext })
        : null;
      return successResponse({ ...summary, finished });
    } catch (error) {
      if (error instanceof CustomerImportFileError) {
        return errorResponse(
          "The file needs an Email or Phone column to match customers by.",
          400,
        );
      }
      if (error instanceof ImportRunError) {
        return errorResponse(error.message, error.status);
      }
      throw error;
    }
  },
);
