import mongoose, { Schema, type Model } from "mongoose";

/**
 * One CSV import as it runs: the browser sends the file a few hundred rows at
 * a time (`ChunkedImportDialog`), and this is where the requests add up to one
 * import — customers, or vendors.
 *
 * The counts are kept here rather than trusted from the browser, because the
 * Activity Log row written at the end — one per import, never edited — has to
 * say what the import really did. The records it created are listed beside it
 * (`ImportRunInvitee`) only when it was asked to invite them, so the
 * invitations go out as one batch once the whole file is in.
 */

export const IMPORT_ENTITIES = ["customer", "vendor"] as const;
export type ImportEntity = (typeof IMPORT_ENTITIES)[number];

export type ImportRunStatus = "running" | "finished" | "stopped";

export interface IImportRun {
  _id: mongoose.Types.ObjectId;
  /** Made by the browser for the run; each request names it. */
  runId: string;
  entity: ImportEntity;
  requestedBy: mongoose.Types.ObjectId;
  requestedByEmail?: string;
  /** Who ran it, as the Activity Log row names them when another request closes the run. */
  requestedByRole?: string;
  fileName: string;
  /** The entity's own options, fixed by the run's first request. */
  options: Record<string, unknown>;
  status: ImportRunStatus;
  counts: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
  /** Request numbers already counted, so a repeated one cannot count twice. */
  chunks: number[];
  /** Of the skipped, rows the file itself overruled with a later row. */
  repeatedRows?: number;
  /**
   * Requests whose rows are being written right now. A run that is ended
   * (Stop, or a closed tab) waits for them, so its record counts their rows.
   */
  activeChunks?: number;
  /** Invitations queued when the run finished. */
  invitesQueued?: number;
  finishedAt?: Date | null;
  /** Set when the run ends, so the TTL never reaps one still running. */
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const ImportRunSchema = new Schema<IImportRun>(
  {
    runId: { type: String, required: true },
    entity: { type: String, enum: IMPORT_ENTITIES, required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestedByEmail: { type: String },
    requestedByRole: { type: String },
    fileName: { type: String, required: true, maxlength: 255 },
    options: { type: Schema.Types.Mixed, default: () => ({}) },
    status: {
      type: String,
      enum: ["running", "finished", "stopped"],
      default: "running",
      required: true,
    },
    counts: {
      created: { type: Number, default: 0, min: 0 },
      updated: { type: Number, default: 0, min: 0 },
      skipped: { type: Number, default: 0, min: 0 },
      failed: { type: Number, default: 0, min: 0 },
    },
    chunks: { type: [Number], default: [] },
    repeatedRows: { type: Number, default: 0, min: 0 },
    activeChunks: { type: Number, default: 0 },
    invitesQueued: { type: Number, min: 0 },
    finishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

ImportRunSchema.index({ runId: 1 }, { unique: true });
// The sweep that closes runs a browser walked away from.
ImportRunSchema.index({ entity: 1, status: 1, updatedAt: 1 });
ImportRunSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export interface IImportRunInvitee {
  _id: mongoose.Types.ObjectId;
  runId: string;
  /** The record the import created: a customer row, a vendor. */
  recordId: mongoose.Types.ObjectId;
  /** The account the invitation is for. */
  userId: mongoose.Types.ObjectId;
  email: string;
  createdAt: Date;
}

/**
 * A record an import created, waiting for the run to end so its invitation
 * goes out with everyone else's. Deleted when the run ends; the TTL only
 * catches a run nobody ever closed.
 */
const ImportRunInviteeSchema = new Schema<IImportRunInvitee>(
  {
    runId: { type: String, required: true },
    recordId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ImportRunInviteeSchema.index({ runId: 1 });
ImportRunInviteeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export const ImportRun: Model<IImportRun> =
  mongoose.models.ImportRun || mongoose.model<IImportRun>("ImportRun", ImportRunSchema);

export const ImportRunInvitee: Model<IImportRunInvitee> =
  mongoose.models.ImportRunInvitee ||
  mongoose.model<IImportRunInvitee>("ImportRunInvitee", ImportRunInviteeSchema);
