import { connectDB } from "@/lib/db";
import { CRON_STALE_AFTER_MS } from "@/lib/cron/health";
import { CronRun } from "@/models/cron-run.model";
import {
  EmailDelivery,
  type EmailDeliveryStatus,
} from "@/models/email-delivery.model";

/**
 * Emails stuck in the outbox, for the warning on Settings → Email.
 *
 * An email that fails its first try is retried by one background job,
 * `/api/cron/email-deliveries`, every 5 minutes. Where that job is never
 * scheduled — no CRON_SECRET, a server with no scheduler, a Vercel plan that
 * drops the schedule — the email waits forever, and the day the job starts it
 * sends the whole backlog: order confirmations weeks after the order. Nothing
 * on the page said so; the log only counted them as "pending".
 *
 * Stuck means waiting with its next try overdue by more than `STUCK_AFTER_MS`:
 * three runs of the job should have reached it by then.
 */
export const STUCK_AFTER_MS = 15 * 60 * 1000;

const JOB = "email-deliveries";

const WAITING: EmailDeliveryStatus[] = ["queued", "retrying"];
const SENDING: EmailDeliveryStatus = "sending";
const CANCELLED: EmailDeliveryStatus = "cancelled";

function stuckFilter(now: number) {
  const overdue = new Date(now - STUCK_AFTER_MS);
  return {
    $or: [
      {
        status: { $in: WAITING },
        $or: [
          { nextAttemptAt: { $lte: overdue } },
          { nextAttemptAt: null, createdAt: { $lte: overdue } },
        ],
      },
      // A send that died part-way: only the job picks these up again.
      { status: SENDING, lastAttemptAt: { $lte: overdue } },
    ],
  };
}

export interface EmailQueueHealth {
  /** Waiting emails nothing has retried in time. */
  stuck: number;
  /** When the oldest of them was first queued (ISO), or null. */
  oldestStuckAt: string | null;
  job: {
    /** The retry job's last run (ISO), or null when it never ran here. */
    lastRunAt: string | null;
    /** It ran within its allowance (30 minutes for a 5-minute job). */
    running: boolean;
  };
  /**
   * The newest email tried in the last week, and whether that try worked. A
   * test that passed in September says nothing about a password revoked
   * since; with sign-up verification on, new accounts would wait for links
   * that never come.
   */
  lastAttempt: { ok: boolean; at: string; error?: string } | null;
}

export async function getEmailQueueHealth(
  now: number = Date.now(),
): Promise<EmailQueueHealth> {
  await connectDB();
  const filter = stuckFilter(now);
  const [stuck, oldest, run, latest] = await Promise.all([
    EmailDelivery.countDocuments(filter),
    EmailDelivery.findOne(filter).sort({ createdAt: 1 }).select("createdAt").lean(),
    CronRun.findOne({ job: JOB }).select("lastRunAt").lean(),
    // By creation, which is indexed: a new email is tried as it is created.
    EmailDelivery.findOne({
      createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
      lastAttemptAt: { $exists: true },
      status: { $in: ["sent", "failed", "retrying"] },
    })
      .sort({ createdAt: -1 })
      .select("status lastAttemptAt lastError")
      .lean(),
  ]);
  const lastRunAt = run?.lastRunAt ? new Date(run.lastRunAt) : null;
  return {
    stuck,
    oldestStuckAt: oldest?.createdAt ? new Date(oldest.createdAt).toISOString() : null,
    job: {
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
      running:
        lastRunAt !== null && now - lastRunAt.getTime() <= CRON_STALE_AFTER_MS[JOB],
    },
    lastAttempt:
      latest?.lastAttemptAt
        ? {
            ok: latest.status === "sent",
            at: new Date(latest.lastAttemptAt).toISOString(),
            ...(latest.status !== "sent" && latest.lastError
              ? { error: latest.lastError }
              : {}),
          }
        : null,
  };
}

/**
 * Stop the stuck emails from ever going out. They stay in the log as
 * cancelled, with the reason they failed, until the log's 90-day expiry; their
 * bodies and attachments (invoice PDFs) are dropped, as a sent email's are.
 *
 * Only what is stuck: an email queued a minute ago is still being sent.
 */
export async function cancelStuckEmailDeliveries(
  now: number = Date.now(),
): Promise<number> {
  await connectDB();
  const result = await EmailDelivery.updateMany(stuckFilter(now), {
    $set: { status: CANCELLED },
    $unset: { html: 1, text: 1, attachments: 1, nextAttemptAt: 1 },
  });
  return result.modifiedCount;
}
