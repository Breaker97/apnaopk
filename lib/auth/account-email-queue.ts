import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { User, Vendor } from "@/models";
import { USER_ACCOUNT_STATUS, VENDOR_STATUS } from "@/config/app.config";
import {
  AccountEmailBatch,
  AccountEmailJob,
  type AccountEmailAudience,
  type AccountEmailSkipCounts,
  type IAccountEmailBatch,
  type IAccountEmailJob,
} from "@/models/account-email-job.model";
import {
  findSentEmailByKeyPrefix,
  recentEmailRecipients,
} from "@/lib/email/email";
import { getSettingsLean } from "@/models/settings.model";
import {
  ACCOUNT_ACCESS_EMAIL_CATEGORY,
  ACCOUNT_ACCESS_RESEND_AFTER_MS,
  sendAccountAccessEmail,
} from "@/lib/auth/account-access";
import {
  accountEmailRefusal,
  ensureGuestAccount,
  type AccountEmailRecipient,
} from "@/lib/customers/account-email-recipients";

/**
 * The worker behind bulk account emails.
 *
 * Shaped like the carrier queue (lib/shipping/carriers/shipment-worker.ts): a
 * job is claimed under a lease, so a run that dies mid-send frees it for the
 * next; a failure waits on a backoff ladder and gives up after a few tries;
 * each run stops at a time budget. Started straight after a send is queued
 * (`afterResponse`) and drained every minute by /api/cron/account-emails.
 *
 * Each link is minted the moment its email goes out, never at enqueue: a
 * one-hour reset link queued behind 2,000 others would be dead on arrival.
 * A failed try spends its link (see `sendAccountAccessEmail`'s "once"), and
 * the next try mints a fresh one.
 */

/** Emails per rolling minute, store-wide, however many runs overlap. */
export const ACCOUNT_EMAILS_PER_MINUTE = 20;
/** A run stops claiming after this long; the cron route allows 60s. */
const RUN_BUDGET_MS = 45_000;
/** Longer than one SMTP send can block, so a live send keeps its job. */
const LEASE_MS = 3 * 60_000;
/** Waits before each retry: 1 minute, 5, 30, then 2 hours; then it has failed. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
export const ACCOUNT_EMAIL_MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
const JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function retentionDate(ms: number) {
  return new Date(Date.now() + ms);
}

/**
 * The outbox key of one try, so a rerun can tell whether its email went out.
 * Unique per try: a failed send retried from the progress line starts its
 * attempts again, and a key reused from the first round would find that
 * round's failed row instead of sending.
 */
function deliveryKey(jobId: Types.ObjectId | string, attempt: number) {
  return `${deliveryKeyPrefix(jobId)}${attempt}-${new Types.ObjectId().toString()}`;
}

function deliveryKeyPrefix(jobId: Types.ObjectId | string) {
  return `account-email:${String(jobId)}:`;
}

/**
 * Who a job is for: a customer row (`profileId`), an account (`userId`), or
 * both. A vendor import's owners have an account and no customer row.
 */
export type QueuedAccountEmail = Omit<AccountEmailRecipient, "profileId"> & {
  profileId?: string;
};

/**
 * Write one job row per recipient and the batch they belong to. Recipients
 * come from `resolveAccountEmailRecipients` (customers) or an import.
 */
export async function enqueueAccountEmails(params: {
  requestedBy: { id: string; email?: string };
  source: IAccountEmailBatch["source"];
  /** Absent: customers. "vendor": store owners, worded as a store that moved. */
  audience?: AccountEmailAudience;
  filter?: Record<string, unknown>;
  recipients: QueuedAccountEmail[];
  skippedAtStart: AccountEmailSkipCounts;
}): Promise<{ batchId: string; queued: number }> {
  await connectDB();
  const forVendors = params.audience === "vendor";
  const batch = await AccountEmailBatch.create({
    requestedBy: new Types.ObjectId(params.requestedBy.id),
    requestedByEmail: params.requestedBy.email,
    source: params.source,
    ...(forVendors ? { audience: "vendor" } : {}),
    ...(params.filter ? { filter: params.filter } : {}),
    status: "running",
    queued: params.recipients.length,
    skippedAtStart: params.skippedAtStart,
  });

  const now = new Date();
  for (let index = 0; index < params.recipients.length; index += 1000) {
    await AccountEmailJob.insertMany(
      params.recipients.slice(index, index + 1000).map((recipient) => ({
        batchId: batch._id,
        profileId: recipient.profileId ? new Types.ObjectId(recipient.profileId) : null,
        userId: recipient.userId ? new Types.ObjectId(recipient.userId) : null,
        ...(forVendors ? { audience: "vendor" } : {}),
        email: recipient.email,
        locale: recipient.locale,
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
      })),
      { ordered: false },
    );
  }

  if (params.recipients.length === 0) await finishBatchIfDone(batch._id);
  return { batchId: String(batch._id), queued: params.recipients.length };
}

async function claimAccountEmailJob() {
  const now = new Date();
  return AccountEmailJob.findOneAndUpdate(
    {
      $or: [
        { status: "pending", nextAttemptAt: { $lte: now } },
        // A run that died mid-send: its lease ran out.
        { status: "processing", leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "processing",
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after", sort: { nextAttemptAt: 1, _id: 1 } },
  );
}

async function sentInLastMinute(): Promise<number> {
  return AccountEmailJob.countDocuments({
    lastAttemptAt: { $gte: new Date(Date.now() - 60_000) },
  });
}

async function finishBatchIfDone(batchId: Types.ObjectId) {
  const batch = await AccountEmailBatch.findById(batchId)
    .select("queued sent failed skipped status")
    .lean();
  if (!batch || batch.status !== "running") return;
  if (batch.sent + batch.failed + batch.skipped < batch.queued) return;
  await AccountEmailBatch.updateOne(
    { _id: batchId, status: "running" },
    {
      $set: {
        status: "done",
        finishedAt: new Date(),
        expiresAt: retentionDate(BATCH_RETENTION_MS),
      },
    },
  );
}

/** Settle a job for good and count it on its batch. */
async function settleJob(
  job: IAccountEmailJob,
  outcome:
    | { status: "sent"; purpose: "reset" | "invite" }
    | { status: "skipped"; reason: NonNullable<IAccountEmailJob["skipReason"]> }
    | { status: "failed"; error?: string; hardBounce?: boolean },
) {
  const settled = await AccountEmailJob.findOneAndUpdate(
    // Only the worker holding the job settles it: a lease that ran out and was
    // claimed again belongs to the newer run.
    { _id: job._id, status: "processing", attempts: job.attempts },
    {
      $set: {
        status: outcome.status,
        leaseUntil: null,
        expiresAt: retentionDate(JOB_RETENTION_MS),
        ...(outcome.status === "sent"
          ? { purpose: outcome.purpose, lastError: null }
          : outcome.status === "skipped"
            ? { skipReason: outcome.reason }
            : {
                lastError: outcome.error ?? null,
                ...(outcome.hardBounce ? { hardBounce: true } : {}),
              }),
      },
    },
  );
  if (!settled) return;
  await AccountEmailBatch.updateOne(
    { _id: job.batchId },
    { $inc: { [outcome.status]: 1 } },
  );
  await finishBatchIfDone(job.batchId);
}

async function retryLater(job: IAccountEmailJob, error?: string) {
  const delay = RETRY_DELAYS_MS[Math.min(job.attempts, RETRY_DELAYS_MS.length) - 1]!;
  await AccountEmailJob.updateOne(
    { _id: job._id, status: "processing", attempts: job.attempts },
    {
      $set: {
        status: "pending",
        leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + delay),
        lastError: error ?? null,
      },
    },
  );
}

/**
 * Why a store owner's invite may not go out now, or null when it may: the
 * account was banned or deactivated, or the store was rejected, suspended or
 * removed while the invite waited.
 */
async function vendorInviteRefusal(
  userId: string,
  user: { status?: string },
): Promise<NonNullable<IAccountEmailJob["skipReason"]> | null> {
  if (user.status === USER_ACCOUNT_STATUS.BANNED) return "banned";
  if (user.status && user.status !== USER_ACCOUNT_STATUS.ACTIVE) return "inactive";
  const store = await Vendor.findOne({ userId })
    .select("status")
    .lean<{ status?: string } | null>();
  return store?.status === VENDOR_STATUS.APPROVED ? null : "missing";
}

async function processAccountEmailJob(job: IAccountEmailJob) {
  try {
    // A run that died after its email went out must not send a second one:
    // the second link would also kill the first.
    const delivered = await findSentEmailByKeyPrefix(deliveryKeyPrefix(job._id));
    if (delivered) {
      await settleJob(job, {
        status: "sent",
        purpose:
          delivered.category === ACCOUNT_ACCESS_EMAIL_CATEGORY.invite ? "invite" : "reset",
      });
      return;
    }

    const forVendor = job.audience === "vendor";
    let userId = job.userId ? String(job.userId) : undefined;
    if (!userId) {
      // A store owner always has an account: an import made it with the store.
      if (forVendor || !job.profileId) {
        await settleJob(job, { status: "skipped", reason: "missing" });
        return;
      }
      const account = await ensureGuestAccount(String(job.profileId));
      if ("refused" in account) {
        await settleJob(job, { status: "skipped", reason: account.refused });
        return;
      }
      userId = account.userId;
      await AccountEmailJob.updateOne({ _id: job._id }, { $set: { userId } });
    }

    // Banned, demoted or deactivated while it waited.
    const user = await User.findById(userId)
      .select("role roles status")
      .lean<{ role?: string; roles?: string[]; status?: string } | null>();
    if (!user) {
      await settleJob(job, { status: "skipped", reason: "missing" });
      return;
    }
    const refusal = forVendor
      ? await vendorInviteRefusal(userId, user)
      : accountEmailRefusal(user);
    if (refusal) {
      await settleJob(job, { status: "skipped", reason: refusal });
      return;
    }

    // Someone sent this address an account email while it waited — the
    // shopper's own reset, or an admin's single send.
    const recent = await recentEmailRecipients({
      to: [job.email],
      categories: Object.values(ACCOUNT_ACCESS_EMAIL_CATEGORY),
      since: new Date(Date.now() - ACCOUNT_ACCESS_RESEND_AFTER_MS),
      excludeKeyPrefix: deliveryKeyPrefix(job._id),
    });
    if (recent.size > 0) {
      await settleJob(job, { status: "skipped", reason: "recent" });
      return;
    }

    // Stamped only when an email is really about to go: the per-minute
    // allowance counts sends, not the jobs that turned out to need none.
    await AccountEmailJob.updateOne(
      { _id: job._id },
      { $set: { lastAttemptAt: new Date() } },
    );
    const vendorBatch = forVendor
      ? await AccountEmailBatch.findById(job.batchId).select("source").lean<{ source: string } | null>()
      : null;
    const result = await sendAccountAccessEmail({
      userId,
      locale: job.locale,
      delivery: "once",
      dedupeKey: deliveryKey(job._id, job.attempts),
      settings: await getSettingsLean(),
      // Migration imports keep their seven-day invitation. Admin selections
      // use the account credential to choose a reset or invitation.
      ...(forVendor && vendorBatch?.source === "import"
        ? { purpose: "invite" as const, copy: "vendor-moved" as const } : {}),
    });

    if (result.status === "sent") {
      await settleJob(job, { status: "sent", purpose: result.purpose });
      return;
    }
    if (result.status === "refused") {
      await settleJob(job, {
        status: "skipped",
        reason: result.reason === "no_email" ? "noEmail" : result.reason,
      });
      return;
    }
    const error =
      result.status === "unconfigured"
        ? "Email is not set up"
        : result.error || "The email could not be sent";
    const hardBounce = result.status === "failed" && result.hardBounce;
    if (hardBounce || job.attempts >= ACCOUNT_EMAIL_MAX_ATTEMPTS) {
      await settleJob(job, { status: "failed", error, hardBounce });
      return;
    }
    await retryLater(job, error);
  } catch (error) {
    // Our own fault (a database blip, say), never the link: none is in it.
    const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
    console.error("Account email job failed:", message);
    if (job.attempts >= ACCOUNT_EMAIL_MAX_ATTEMPTS) {
      await settleJob(job, { status: "failed", error: message });
    } else {
      await retryLater(job, message);
    }
  }
}

/**
 * Send what is due, at most `limit` and never more than the per-minute
 * allowance — counted from the jobs themselves, so the cron and a send's own
 * kick-off running at once still share one allowance.
 */
export async function processAccountEmailJobs(limit = ACCOUNT_EMAILS_PER_MINUTE) {
  await connectDB();
  const startedAt = Date.now();
  let processed = 0;

  while (processed < limit && Date.now() - startedAt < RUN_BUDGET_MS) {
    if ((await sentInLastMinute()) >= ACCOUNT_EMAILS_PER_MINUTE) break;
    const job = await claimAccountEmailJob();
    if (!job) break;
    await processAccountEmailJob(job);
    processed += 1;
  }

  return { processed };
}

export interface AccountEmailBatchProgress {
  id: string;
  status: IAccountEmailBatch["status"];
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
  createdAt: string;
  finishedAt: string | null;
}

function toProgress(batch: IAccountEmailBatch): AccountEmailBatchProgress {
  return {
    id: String(batch._id),
    status: batch.status,
    queued: batch.queued,
    sent: batch.sent,
    failed: batch.failed,
    skipped: batch.skipped,
    createdAt: new Date(batch.createdAt).toISOString(),
    finishedAt: batch.finishedAt ? new Date(batch.finishedAt).toISOString() : null,
  };
}

/**
 * The batches one screen owns: the customers screen everything but a vendor
 * import's invitations (`$ne` rather than "customer": batches written before
 * audiences existed have none), the vendors screen only those.
 */
function audienceFilter(audience: AccountEmailAudience = "customer") {
  return audience === "vendor"
    ? { audience: "vendor" as const }
    : { audience: { $ne: "vendor" as const } };
}

/**
 * The send a screen reports on — the customers screen's account emails, or
 * the vendors screen's owner invitations: one still going, else the latest
 * that finished in the last day. The screen shows a finished one only when
 * some of it did not go out — the one thing about it worth an admin's
 * attention — and otherwise just says, once, that it is done.
 */
export async function currentAccountEmailBatch(
  options: { audience?: AccountEmailAudience } = {},
): Promise<AccountEmailBatchProgress | null> {
  await connectDB();
  const owned = audienceFilter(options.audience);
  const running = await AccountEmailBatch.findOne({ status: "running", ...owned })
    .sort({ createdAt: -1 })
    .lean<IAccountEmailBatch | null>();
  if (running) return toProgress(running);
  const finished = await AccountEmailBatch.findOne({
    status: "done",
    ...owned,
    finishedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  })
    .sort({ finishedAt: -1 })
    .lean<IAccountEmailBatch | null>();
  return finished ? toProgress(finished) : null;
}

/**
 * Try a finished send's failed emails again, each with a fresh link. An
 * address the mail server refused outright is left alone.
 */
export async function retryFailedAccountEmails(
  batchId: string,
  options: { audience?: AccountEmailAudience } = {},
): Promise<number> {
  await connectDB();
  if (!Types.ObjectId.isValid(batchId)) return 0;
  const batchObjectId = new Types.ObjectId(batchId);
  // Each screen retries only its own sends: a vendor import's invitations are
  // not customer-staff's to send again, nor the reverse.
  const ownBatch = await AccountEmailBatch.exists({
    _id: batchObjectId,
    ...audienceFilter(options.audience),
  });
  if (!ownBatch) return 0;
  const result = await AccountEmailJob.updateMany(
    { batchId: batchObjectId, status: "failed", hardBounce: { $ne: true } },
    {
      $set: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        leaseUntil: null,
        lastError: null,
        expiresAt: null,
      },
    },
  );
  const requeued = result.modifiedCount;
  if (requeued > 0) {
    await AccountEmailBatch.updateOne(
      { _id: batchObjectId },
      {
        $inc: { failed: -requeued },
        $set: { status: "running", finishedAt: null, expiresAt: null },
      },
    );
  }
  return requeued;
}
