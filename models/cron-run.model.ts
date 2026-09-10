import { mongoose } from "@/lib/db";

const { Schema, models, model } = mongoose;

/**
 * The last time each background job actually ran.
 *
 * Exists because the alternative is a class of failure with no symptom. The
 * eight jobs in `vercel.json` are what send queued messages, hand shipments to
 * carriers, expire boosts and post the ledger — and on a Vercel Hobby plan the
 * schedule that drives them is silently truncated, so most of them never fire.
 * Nothing errors. The store looks healthy and outbound messages simply never
 * leave, until a customer asks why nobody replied.
 *
 * A row per job, written by the job itself. `lib/cron/health.ts` compares the
 * stamp against the interval the job is supposed to keep and raises the ones
 * that have gone quiet.
 */
interface ICronRun extends mongoose.Document {
  /** Route slug, e.g. "messaging-outbox". */
  job: string;
  lastRunAt: Date;
  lastStatus: "ok" | "failed";
  /** Truncated failure text, for the operator rather than for logic. */
  lastError?: string;
  /** Consecutive failures, so a job that runs but never succeeds is visible. */
  consecutiveFailures: number;
}

const CronRunSchema = new Schema<ICronRun>(
  {
    job: { type: String, required: true, unique: true, trim: true },
    lastRunAt: { type: Date, required: true },
    lastStatus: { type: String, enum: ["ok", "failed"], default: "ok" },
    lastError: { type: String, trim: true, maxlength: 500 },
    consecutiveFailures: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const CronRun: mongoose.Model<ICronRun> =
  (models.CronRun as mongoose.Model<ICronRun>) ||
  model<ICronRun>("CronRun", CronRunSchema);
