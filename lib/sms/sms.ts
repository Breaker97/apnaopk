/**
 * SMS delivery: the text-message twin of `lib/email/email.ts`.
 *
 * Every text is written to the `SmsDelivery` outbox first and then sent at
 * once, so a provider hiccup becomes a retry instead of a lost message, and an
 * admin can see in Settings → SMS what went out, what the carrier did with it,
 * and why anything failed. The cron that drains the email outbox drains this
 * one too (`/api/cron/email-deliveries`), so stores need no new schedule.
 */

import { createHash } from "node:crypto";
import { connectDB } from "@/lib/db";
import { appBaseUrl } from "@/lib/app-url";
import { resolveTwilioConfig } from "@/lib/settings/credentials";
import { getSettings, type ISettingsData } from "@/models/settings.model";
import {
  SmsDelivery,
  type SmsDeliveryStatus,
} from "@/models/sms-delivery.model";
import { maskPhoneNumber } from "@/lib/sms/phone";
import {
  TWILIO_MAX_BODY_LENGTH,
  TwilioApiError,
  describeTwilioError,
  sendTwilioMessage,
} from "@/lib/sms/twilio";

/** Where Twilio posts delivery receipts. */
export const TWILIO_WEBHOOK_PATH = "/api/webhooks/twilio";

/** A `sending` row older than this belongs to an attempt that died. */
const STALE_SENDING_MS = 10 * 60_000;
/** Failed rows stay long enough to be read and retried from the log. */
const FAILED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

type SmsSettings = Pick<ISettingsData, "sms">;

interface SmsSendResult {
  /** `retrying` is queued for the cron; `duplicate` was already sent once. */
  status: "sent" | "retrying" | "failed" | "duplicate";
  error?: string;
}

/** Whether a text can go out at all: switched on, credentials and a sender. */
export function isSmsDeliveryConfigured(settings?: SmsSettings | null): boolean {
  return Boolean(resolveTwilioConfig(settings));
}

/**
 * The receipt URL handed to Twilio with each message. Only a public https
 * origin can receive one — on a localhost or plain-http install the message
 * still goes out, it just stays at "sent" in the log.
 */
function statusCallbackUrl(): string | undefined {
  const base = appBaseUrl();
  return base.startsWith("https://") ? `${base}${TWILIO_WEBHOOK_PATH}` : undefined;
}

function retryDelayMs(attempts: number) {
  const minutes = [1, 5, 30, 120];
  return minutes[Math.min(Math.max(attempts - 1, 0), minutes.length - 1)] * 60_000;
}

/**
 * "Store: message link" — the store name first because a text arrives from a
 * bare number or a sender ID the shopper may not recognise.
 */
export function buildNotificationSmsBody(params: {
  storeName: string;
  message: string;
  link?: string;
}): string {
  const text = `${params.storeName.trim()}: ${params.message}`
    .replace(/\s+/g, " ")
    .trim();
  return (params.link ? `${text} ${params.link}` : text).slice(
    0,
    TWILIO_MAX_BODY_LENGTH,
  );
}

/**
 * A stable key for one event reaching one recipient — the `dedupeKey` both
 * outboxes (email and SMS) use to deliver an event once.
 */
export function notificationDedupeKey(parts: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(parts)
      .sort()
      .map((key) => [key, parts[key] ?? null]),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

class SmsNotConfiguredError extends Error {
  constructor() {
    super("SMS is switched off or Twilio is not fully configured.");
    this.name = "SmsNotConfiguredError";
  }
}

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

function outcomeOf(status: SmsDeliveryStatus | undefined): SmsSendResult["status"] {
  if (status === "sent" || status === "delivered") return "sent";
  if (status === "queued" || status === "sending" || status === "retrying") {
    return "retrying";
  }
  return "failed";
}

async function deliverSmsJob(
  jobId: string,
  settings?: SmsSettings,
): Promise<SmsSendResult> {
  const staleBefore = new Date(Date.now() - STALE_SENDING_MS);
  // `failed` is deliberately not claimable: a permanent failure only goes out
  // again through `retrySmsDelivery`, which an admin asks for.
  const job = await SmsDelivery.findOneAndUpdate(
    {
      _id: jobId,
      $or: [
        { status: { $in: ["queued", "retrying"] } },
        { status: "sending", lastAttemptAt: { $lte: staleBefore } },
      ],
    },
    { $set: { status: "sending", lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  if (!job) {
    const existing = await SmsDelivery.findById(jobId).select("status").lean();
    return { status: outcomeOf(existing?.status) };
  }

  try {
    const resolvedSettings = settings || (await getSettings());
    const config = resolveTwilioConfig(resolvedSettings);
    if (!config) throw new SmsNotConfiguredError();

    const result = await sendTwilioMessage(config, {
      to: job.to,
      body: job.body,
      statusCallback: statusCallbackUrl(),
    });

    const sentAt = new Date();
    const retentionDays = resolvedSettings.sms?.logRetentionDays ?? 30;
    await SmsDelivery.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "sent",
          sentAt,
          providerMessageId: result.sid,
          ...(result.segments ? { segments: result.segments } : {}),
          expiresAt: new Date(sentAt.getTime() + retentionDays * 24 * 60 * 60 * 1000),
        },
        $unset: { lastError: "", errorCode: "", nextAttemptAt: "" },
      },
    );
    return { status: "sent" };
  } catch (error) {
    // Switching SMS off stops the queue rather than retrying into the void,
    // and a refusal Twilio will repeat forever is not worth three more tries.
    const permanent =
      error instanceof SmsNotConfiguredError ||
      (error instanceof TwilioApiError && error.permanent);
    const exhausted = permanent || job.attempts >= job.maxAttempts;
    const message = (
      error instanceof Error ? error.message : "SMS delivery failed"
    ).slice(0, 1000);
    const errorCode =
      error instanceof TwilioApiError && error.code ? String(error.code) : undefined;
    const retryAfterMs =
      error instanceof TwilioApiError && error.retryAfterSeconds
        ? error.retryAfterSeconds * 1000
        : 0;

    const unset: Record<string, ""> = {
      // An earlier attempt's code must not be read as this attempt's.
      ...(errorCode ? {} : { errorCode: "" }),
      ...(exhausted ? { nextAttemptAt: "" } : {}),
    };
    await SmsDelivery.updateOne(
      { _id: job._id },
      {
        $set: {
          status: exhausted ? "failed" : "retrying",
          lastError: message,
          ...(errorCode ? { errorCode } : {}),
          ...(exhausted
            ? { expiresAt: new Date(Date.now() + FAILED_RETENTION_MS) }
            : {
                nextAttemptAt: new Date(
                  Date.now() + Math.max(retryDelayMs(job.attempts), retryAfterMs),
                ),
              }),
        },
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
    );
    console.error(`SMS to ${maskPhoneNumber(job.to)} failed:`, message);
    return { status: exhausted ? "failed" : "retrying", error: message };
  }
}

/**
 * Queue a text and try it straight away. Never throws: a notification must
 * not fail the order, status change or payment that triggered it.
 */
export async function sendSms(options: {
  /** E.164 — normalise with `normalizePhoneNumber` first. */
  to: string;
  body: string;
  category?: string;
  /** See `ISmsDelivery.dedupeKey`. */
  dedupeKey?: string;
  settings?: SmsSettings;
}): Promise<SmsSendResult> {
  try {
    await connectDB();
    // Checked before the insert as well as enforced by the unique index, so a
    // store running without that index (autoIndex off, migration not run)
    // still texts an event once.
    if (options.dedupeKey && (await SmsDelivery.exists({ dedupeKey: options.dedupeKey }))) {
      return { status: "duplicate" };
    }
    const job = await SmsDelivery.create({
      to: options.to,
      body: options.body.slice(0, TWILIO_MAX_BODY_LENGTH),
      category: options.category || "notification",
      ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
      status: "queued",
      nextAttemptAt: new Date(),
    });
    return await deliverSmsJob(String(job._id), options.settings);
  } catch (error) {
    if (isDuplicateKeyError(error)) return { status: "duplicate" };
    const message = error instanceof Error ? error.message : "Could not queue the SMS";
    console.error("Failed to queue SMS:", message);
    return { status: "failed", error: message };
  }
}

/** The cron's half: everything due, oldest first. */
export async function processPendingSmsDeliveries(limit = 20) {
  await connectDB();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS);

  // An attempt that died on its last try can never be reclaimed (it is out of
  // attempts), so without this it would sit at "sending" until the TTL.
  await SmsDelivery.updateMany(
    {
      status: "sending",
      lastAttemptAt: { $lte: staleBefore },
      $expr: { $gte: ["$attempts", "$maxAttempts"] },
    },
    {
      $set: {
        status: "failed",
        lastError:
          "The last attempt never finished, so the message may or may not have been sent.",
        expiresAt: new Date(now.getTime() + FAILED_RETENTION_MS),
      },
    },
  );

  const jobs = await SmsDelivery.find({
    $and: [
      { $expr: { $lt: ["$attempts", "$maxAttempts"] } },
      {
        $or: [
          {
            status: { $in: ["queued", "retrying"] },
            $or: [
              { nextAttemptAt: { $exists: false } },
              { nextAttemptAt: null },
              { nextAttemptAt: { $lte: now } },
            ],
          },
          { status: "sending", lastAttemptAt: { $lte: staleBefore } },
        ],
      },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(Math.min(Math.max(limit, 1), 100))
    .select("_id")
    .lean();
  if (jobs.length === 0) return { processed: 0, sent: 0 };

  const settings = await getSettings();
  const results = await Promise.allSettled(
    jobs.map((job) => deliverSmsJob(String(job._id), settings)),
  );
  return {
    processed: results.length,
    sent: results.filter(
      (result) => result.status === "fulfilled" && result.value.status === "sent",
    ).length,
  };
}

/** An admin's "retry now": a fresh set of attempts, sent immediately. */
export async function retrySmsDelivery(jobId: string): Promise<SmsSendResult> {
  await connectDB();
  const job = await SmsDelivery.findOneAndUpdate(
    { _id: jobId, status: { $in: ["failed", "retrying", "undelivered"] } },
    {
      $set: { status: "queued", attempts: 0, nextAttemptAt: new Date() },
      // A retried message is a new message to Twilio, with a new SID.
      $unset: { lastError: "", errorCode: "", expiresAt: "", providerMessageId: "" },
    },
    { returnDocument: "after" },
  );
  if (!job) {
    return { status: "failed", error: "Only failed or waiting messages can be retried." };
  }
  return deliverSmsJob(String(job._id));
}

/** Twilio's final verdicts; everything earlier than delivery changes nothing. */
const RECEIPT_STATUS: Record<string, SmsDeliveryStatus> = {
  delivered: "delivered",
  read: "delivered",
  undelivered: "undelivered",
  failed: "failed",
  canceled: "failed",
};

/**
 * Record a delivery receipt. Only a row still at `sent` moves: receipts can
 * arrive out of order, and a final verdict is never overwritten by a later,
 * less final one.
 */
export async function applySmsDeliveryReceipt(params: {
  messageSid: string;
  messageStatus: string;
  errorCode?: string;
}): Promise<boolean> {
  const status = RECEIPT_STATUS[params.messageStatus.trim().toLowerCase()];
  if (!status) return false;

  const result = await SmsDelivery.updateOne(
    { providerMessageId: params.messageSid, status: "sent" },
    status === "delivered"
      ? { $set: { status, deliveredAt: new Date() } }
      : {
          $set: {
            status,
            lastError: describeTwilioError(
              params.errorCode,
              `The carrier reported the message as ${params.messageStatus}.`,
            ).slice(0, 1000),
            ...(params.errorCode ? { errorCode: params.errorCode.slice(0, 20) } : {}),
          },
        },
  );
  return result.modifiedCount > 0;
}
