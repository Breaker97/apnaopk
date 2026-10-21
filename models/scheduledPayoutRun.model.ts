import { mongoose } from "@/lib/db";
const { Schema } = mongoose;

/**
 * One seller's scheduled payout for one due day, done.
 *
 * The cron that draws payouts up has a time budget, and a run that stopped
 * early used to forget how far it got — the next one started at the first
 * seller again, and the sellers at the back were never reached. A mark per
 * seller and due day is the progress: a seller with a mark is not looked at
 * again for that due day, so each run (it also covers the days after a due day,
 * see lib/finance/scheduled-payouts.ts) carries on with those that have none.
 *
 * Written only when every currency of the seller has been dealt with — drafted,
 * already open, or nothing to pay. Rows expire by themselves.
 */
const schema = new Schema({
  vendorId: { type: Schema.Types.ObjectId, required: true },
  /** The payout day this run was for, `YYYY-MM-DD` (UTC). */
  dueDay: { type: String, required: true },
  created: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  doneAt: { type: Date, default: Date.now },
});
schema.index({ dueDay: 1, vendorId: 1 }, { unique: true });
schema.index({ doneAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const ScheduledPayoutRun =
  mongoose.models.ScheduledPayoutRun || mongoose.model("ScheduledPayoutRun", schema);
