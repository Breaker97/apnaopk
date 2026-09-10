import { CronRun } from "@/models/cron-run.model";

/**
 * Whether the background jobs are actually running.
 *
 * The problem this solves is not a job that throws — that logs, and somebody
 * eventually reads the log. It is a job that is never *invoked*: a Vercel Hobby
 * plan silently truncates the eight schedules in `vercel.json`, so outbound
 * messaging and carrier hand-off never fire and nothing anywhere says so.
 *
 * Which is why the check is deliberately **not** itself a scheduled job. It
 * would fail in exactly the same silence. It runs when an admin opens the
 * dashboard, which is the one moment a human is present to be told.
 */

/**
 * How long each job may go quiet before it is treated as not running.
 *
 * Generously above its schedule — several times the interval — because the
 * point is to catch "never fires", not to grumble about a late minute. A job
 * whose cadence changes in `vercel.json` needs its entry changed here too, or
 * the alert becomes noise and gets ignored, which is the same as not having it.
 */
export const CRON_STALE_AFTER_MS: Record<string, number> = {
  "messaging-outbox": 15 * 60 * 1000, // every minute
  "carrier-shipments": 15 * 60 * 1000, // every minute
  "email-deliveries": 30 * 60 * 1000, // every 5 minutes
  "messaging-escalations": 30 * 60 * 1000, // every 5 minutes
  boosts: 30 * 60 * 1000, // every 5 minutes
  "carrier-tracking": 3 * 60 * 60 * 1000, // every 30 minutes
  "orange-money-reconcile": 90 * 60 * 1000, // every 15 minutes
  "mtn-momo-reconcile": 90 * 60 * 1000, // every 15 minutes
  "vendor-subscriptions": 6 * 60 * 60 * 1000, // hourly
  finance: 36 * 60 * 60 * 1000, // daily
};

/**
 * Record that a job ran. Called by the job, at the end of its own work.
 *
 * Never throws: a bookkeeping write must not turn a successful run into a
 * failed one, and must not stop the next job in a sequence.
 */
async function recordCronRun(
  job: string,
  outcome: { ok: boolean; error?: unknown } = { ok: true },
): Promise<void> {
  try {
    const error =
      outcome.error instanceof Error
        ? outcome.error.message
        : outcome.error
          ? String(outcome.error)
          : undefined;

    await CronRun.updateOne(
      { job },
      outcome.ok
        ? {
            $set: {
              lastRunAt: new Date(),
              lastStatus: "ok",
              consecutiveFailures: 0,
            },
            $unset: { lastError: "" },
          }
        : {
            // `lastRunAt` still moves on a failure: the job *was* invoked, which
            // is the thing this record exists to prove. A run that fails every
            // time is a different problem, and `consecutiveFailures` names it.
            $set: {
              lastRunAt: new Date(),
              lastStatus: "failed",
              lastError: error?.slice(0, 500),
            },
            $inc: { consecutiveFailures: 1 },
          },
      { upsert: true },
    );
  } catch (writeError) {
    console.error(`Failed to record the ${job} cron run:`, writeError);
  }
}

interface CronHealthEntry {
  job: string;
  lastRunAt: Date | null;
  /** True when the job has never run, or not within its allowance. */
  stale: boolean;
  /** True when it is running but failing every time. */
  failing: boolean;
  lastError?: string;
}

/**
 * One line per configured job, and whether it is keeping its schedule.
 *
 * A job that has never run at all is reported as stale rather than skipped —
 * on a plan that cannot schedule it, "never" is precisely the symptom.
 */
export async function getCronHealth(
  now: number = Date.now(),
): Promise<CronHealthEntry[]> {
  const rows = await CronRun.find({})
    .select("job lastRunAt lastStatus lastError consecutiveFailures")
    .lean();
  const byJob = new Map(rows.map((row) => [row.job, row]));

  return Object.entries(CRON_STALE_AFTER_MS).map(([job, allowance]) => {
    const row = byJob.get(job);
    const lastRunAt = row?.lastRunAt ? new Date(row.lastRunAt) : null;

    return {
      job,
      lastRunAt,
      stale: !lastRunAt || now - lastRunAt.getTime() > allowance,
      // Three strikes rather than one: a single failure is usually a provider
      // hiccup the next run clears on its own.
      failing: (row?.consecutiveFailures ?? 0) >= 3,
      lastError: row?.lastError,
    };
  });
}

/**
 * Wrap a cron route so every invocation is recorded.
 *
 * A wrapper rather than a line inside each handler: there are eight of them,
 * each shaped a little differently, and the whole value of this record is that
 * it is never missed. A handler that returns early — demo mode skipping a real
 * carrier purchase, say — still counts as a run, because the schedule did fire
 * and that is the thing being proved. An unauthorized call does not: it is
 * somebody's curl, not the scheduler.
 */
export function withCronRun(
  job: string,
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      const response = await handler(request);
      if (response.status === 200) await recordCronRun(job, { ok: true });
      return response;
    } catch (error) {
      // Recorded, then rethrown: the failure still belongs in the platform's
      // own logs, and the caller still gets its 500.
      await recordCronRun(job, { ok: false, error });
      throw error;
    }
  };
}

/**
 * Check the schedule and tell the merchant if it has stopped.
 *
 * Called from the admin dashboard's render rather than from a job, because a
 * job cannot report that jobs are not running. Best effort and never awaited by
 * anything the page needs: the dashboard must not fail, or slow, because a
 * health write did.
 *
 * Routed through the payment-anomaly notifier for the same reason the oversold
 * report is — it bypasses routine notification preferences, which is right for
 * "your store has silently stopped sending messages" and wrong for a sales
 * notification somebody may have switched off. Deduped by the set of stale
 * jobs, so a store that stays broken is told once rather than on every page
 * load, and told again if a different job joins them.
 */
export async function reportStaleCronJobs(): Promise<void> {
  try {
    const health = await getCronHealth();
    const stale = health.filter((entry) => entry.stale).map((e) => e.job);
    const failing = health.filter((entry) => entry.failing).map((e) => e.job);
    if (stale.length === 0 && failing.length === 0) return;

    const { notifyAdminsPaymentAnomaly } = await import("@/lib/notifications/notifications");

    const parts: string[] = [];
    if (stale.length > 0) {
      parts.push(
        `Not running: ${stale.join(", ")}. On Vercel this usually means the ` +
          `plan cannot run the schedule in vercel.json — see ` +
          `docs/DEPLOYMENT_VERCEL.md.`,
      );
    }
    if (failing.length > 0) {
      parts.push(`Running but failing every time: ${failing.join(", ")}.`);
    }

    await notifyAdminsPaymentAnomaly({
      title: "Background jobs have stopped",
      message:
        `Queued messages, carrier hand-off, boosts and the ledger all depend ` +
        `on scheduled jobs. ${parts.join(" ")}`,
      paymentIntentId: `cron-stale:${[...stale, ...failing].sort().join("|")}`,
    });
  } catch (error) {
    console.error("Failed to check background job health:", error);
  }
}
