import { NextResponse } from "next/server";
import { isCronRequestAuthorized } from "@/lib/cron/cron-auth";
import { CronRun } from "@/models/cron-run.model";
import type { CronRunOutcome } from "@/lib/cron/reconciliation-outcome";

/**
 * Whether the background jobs are actually running.
 *
 * The problem this solves is not a job that throws — that logs, and somebody
 * eventually reads the log. It is a job that is never *invoked*: a Vercel Hobby
 * plan silently truncates the schedules in `vercel.json`, so outbound
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
  "account-emails": 15 * 60 * 1000, // every minute
  "meta-catalog": 15 * 60 * 1000, // every minute
  "email-deliveries": 30 * 60 * 1000, // every 5 minutes
  "messaging-escalations": 30 * 60 * 1000, // every 5 minutes
  boosts: 30 * 60 * 1000, // every 5 minutes
  "carrier-tracking": 3 * 60 * 60 * 1000, // every 30 minutes
  "orange-money-reconcile": 90 * 60 * 1000, // every 15 minutes
  "mtn-momo-reconcile": 90 * 60 * 1000, // every 15 minutes
  "vendor-subscriptions": 6 * 60 * 60 * 1000, // hourly
  "gateway-disputes": 6 * 60 * 60 * 1000, // hourly
  finance: 36 * 60 * 60 * 1000, // daily
  preorders: 36 * 60 * 60 * 1000, // daily
  "preorder-jobs": 90 * 60 * 1000, // every 15 minutes
  "abandoned-checkouts": 90 * 60 * 1000, // every 15 minutes
  "checkout-expiry": 3 * 60 * 60 * 1000, // every 30 minutes
  "store-credit": 6 * 60 * 60 * 1000, // hourly
  "vendor-payouts": 36 * 60 * 60 * 1000, // daily
};

/**
 * Record that a job ran. Called by the job, at the end of its own work.
 *
 * Never throws: a bookkeeping write must not turn a successful run into a
 * failed one, and must not stop the next job in a sequence.
 */
async function recordCronRun(
  job: string,
  outcome: { ok: boolean; error?: unknown; reconciliation?: CronRunOutcome } = {
    ok: true,
  },
): Promise<void> {
  try {
    const error =
      outcome.error instanceof Error
        ? outcome.error.message
        : outcome.error
          ? String(outcome.error)
          : undefined;

    const now = new Date();
    const status =
      outcome.reconciliation?.status ?? (outcome.ok ? "ok" : "failed");
    const reporting = outcome.reconciliation
      ? {
          lastOutcome: outcome.reconciliation,
          ...(outcome.reconciliation.complete ? { lastCompletedAt: now } : {}),
        }
      : {};
    await CronRun.updateOne(
      { job },
      status !== "failed"
        ? {
            $set: {
              lastRunAt: now,
              lastStatus: status,
              consecutiveFailures: 0,
              ...reporting,
            },
            $unset: { lastError: "" },
          }
        : {
            // `lastRunAt` still moves on a failure: the job *was* invoked, which
            // is the thing this record exists to prove. A run that fails every
            // time is a different problem, and `consecutiveFailures` names it.
            $set: {
              lastRunAt: now,
              lastStatus: "failed",
              lastError: error?.slice(0, 500),
              ...reporting,
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
  /** Explicit reconciliation failed, or a legacy job reached three failures. */
  failing: boolean;
  lastError?: string;
  lastStatus?: CronRunOutcome["status"];
  lastCompletedAt?: Date | null;
  outcome?: CronRunOutcome;
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
    .select(
      "job lastRunAt lastStatus lastError consecutiveFailures lastCompletedAt lastOutcome",
    )
    .lean();
  const byJob = new Map(rows.map((row) => [row.job, row]));

  return Object.entries(CRON_STALE_AFTER_MS).map(([job, allowance]) => {
    const row = byJob.get(job);
    const lastRunAt = row?.lastRunAt ? new Date(row.lastRunAt) : null;

    return {
      job,
      lastRunAt,
      stale: !lastRunAt || now - lastRunAt.getTime() > allowance,
      // Explicit reconciliation failures are visible immediately. Older jobs
      // retain their existing three-strike alert policy.
      failing: row?.lastOutcome
        ? row.lastStatus === "failed"
        : (row?.consecutiveFailures ?? 0) >= 3,
      lastError: row?.lastError,
      lastStatus: row?.lastStatus,
      ...(row?.lastOutcome
        ? {
            outcome: row.lastOutcome,
            lastCompletedAt: row.lastCompletedAt
              ? new Date(row.lastCompletedAt)
              : null,
          }
        : {}),
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
 *
 * Jobs that catch their own failures can opt into `options.outcome`. For those
 * jobs HTTP status proves neither completion nor success: record the declared
 * result, including deferred/skipped invocations and returned error responses.
 * Jobs without this option retain their existing HTTP-200/throw contract.
 */
export function withCronRun(
  job: string,
  handler: (request: Request) => Promise<Response>,
  options: {
    outcome?: (response: Response) => CronRunOutcome | Promise<CronRunOutcome>;
  } = {},
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (!isCronRequestAuthorized(request)) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }
    try {
      const response = await handler(request);
      if (options.outcome) {
        const reconciliation = await options.outcome(response);
        await recordCronRun(job, {
          ok: reconciliation.status !== "failed",
          error: reconciliation.error,
          reconciliation,
        });
      } else if (response.status === 200)
        await recordCronRun(job, { ok: true });
      return response;
    } catch (error) {
      // Recorded, then rethrown: the failure still belongs in the platform's
      // own logs, and the caller still gets its 500.
      await recordCronRun(job, {
        ok: false,
        error,
        ...(options.outcome
          ? {
              reconciliation: {
                status: "failed" as const,
                complete: false,
                error: error instanceof Error ? error.message : String(error),
              },
            }
          : {}),
      });
      throw error;
    }
  };
}

/**
 * A few names, then a count. The notice has 500 characters: naming all
 * nineteen jobs on a store whose scheduler runs nothing overran it, the save
 * failed, and the admin was never told — on every dashboard load.
 */
function listJobs(jobs: string[], shown = 4): string {
  return jobs.length <= shown
    ? jobs.join(", ")
    : `${jobs.slice(0, shown).join(", ")} and ${jobs.length - shown} more`;
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

    const { notifyAdminsPaymentAnomaly } = await import(
      "@/lib/notifications/notifications"
    );

    const parts: string[] = [];
    if (stale.length > 0) {
      parts.push(
        `${
          stale.length === health.length
            ? `None of the ${health.length} jobs is running`
            : `Not running: ${listJobs(stale)}`
        }. On Vercel this usually means the plan cannot run the schedule in ` +
          `vercel.json — see https://storify.neurolightstudio.com/docs#deploy-vercel.`,
      );
    }
    if (failing.length > 0) {
      const failedEntries = health.filter((entry) => entry.failing);
      parts.push(
        failedEntries.some((entry) => entry.outcome)
          ? `Reconciliation failures: ${listJobs(failedEntries.map((entry) => `${entry.job}${entry.lastError ? ` (${entry.lastError.slice(0, 60)})` : ""}`))}.`
          : `Running but failing every time: ${listJobs(failing)}.`,
      );
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
