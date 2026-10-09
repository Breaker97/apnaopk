/**
 * Email Service Configuration
 * Using Nodemailer with SMTP (Gmail compatible)
 */

import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { ISettingsData } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import { EmailDelivery } from "@/models/email-delivery.model";
import { getSettings } from "@/models/settings.model";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import {
  resolveSmtpConfig,
  resolveSmtpFromEmail,
  type ResolvedSmtpConfig,
} from "@/lib/settings/credentials";

type EmailConfig = ResolvedSmtpConfig;

/**
 * Build the email "From" header, resolving the sender address from DB settings
 * with a per-field .env fallback (SMTP_FROM). Works with or without settings.
 *
 * If the resolved value is already a full RFC header (e.g. SMTP_FROM is
 * `"Store" <no-reply@example.com>`), it is used verbatim instead of being
 * wrapped again with the display name.
 */
function buildFromHeader(settings?: ISettingsData | null): string {
  // Switched off, the page's login and sender are not in use (.env sends).
  const page = settings?.email?.enabled ? settings.email : undefined;
  const resolved =
    resolveSmtpFromEmail(settings) || page?.smtp?.user || getSenderEmail();

  if (resolved.includes("<") && resolved.includes(">")) return resolved;

  const name = page?.fromName || settings?.general?.storeName || getAppName();
  return `"${name}" <${resolved}>`;
}

/**
 * One pooled transport per SMTP configuration, on a server that keeps running.
 *
 * A transport per email opened a fresh connection — TCP, TLS and a login — for
 * every message, and an order sends several (the shopper's confirmation, each
 * seller's notice). Pooled, they share connections that stay open between
 * messages. A changed configuration gets a new pool; the old one is closed.
 *
 * Not on a serverless host (Vercel): a frozen function wakes to sockets the
 * mail server has long since dropped, and the send would fail on them.
 */
let pooledTransport: { key: string; transporter: Transporter } | null = null;

function getTransporter(config: EmailConfig): Transporter {
  if (process.env.VERCEL) return nodemailer.createTransport(config);
  const key = createHash("sha256").update(JSON.stringify(config)).digest("hex");
  if (pooledTransport?.key !== key) {
    pooledTransport?.transporter.close();
    pooledTransport = {
      key,
      transporter: nodemailer.createTransport({ ...config, pool: true }),
    };
  }
  return pooledTransport.transporter;
}

/**
 * Resolve and create the one SMTP transport used by tests and live email.
 * TLS mode is derived from the port by resolveSmtpConfig:
 * 465 uses implicit TLS; 587 requires STARTTLS.
 */
export function createSmtpTransport(
  settings?: ISettingsData | null,
): { config: EmailConfig; transporter: Transporter } | null {
  const config = resolveSmtpConfig(settings);
  if (!config) return null;
  return { config, transporter: getTransporter(config) };
}

/**
 * Whether an email can actually go out, by the transport's own rule: SMTP
 * switched on in Settings, OR SMTP credentials in `.env`.
 *
 * The one question every "should I bother sending?" gate must ask. They used
 * to answer it three ways: six call sites (password reset, both staff
 * invites, the contact form, both quote emails) checked only the Settings
 * switch, so an `.env`-configured store silently never sent a password reset;
 * boost emails checked only `.env`, so a Settings-configured store never sent
 * those.
 */
export function isEmailDeliveryConfigured(
  settings?: Pick<ISettingsData, "email"> | null,
): boolean {
  return Boolean(resolveSmtpConfig(settings));
}

/**
 * Get sender email
 */
function getSenderEmail(): string {
  return (
    process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@storify.com"
  );
}

/**
 * Get app name for emails
 */
export function getAppName(): string {
  return process.env.NEXT_PUBLIC_APP_NAME || DEFAULT_STORE_NAME;
}

interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

function sanitizeEmailError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Email delivery failed";
  return raw
    .replace(/(pass(?:word)?|token|secret|authorization)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/smtp:\/\/[^@\s]+@/gi, "smtp://[redacted]@")
    .slice(0, 1000);
}

/**
 * Attachment bytes as nodemailer needs them. The outbox keeps attachments in a
 * Mixed path, and a Buffer written there comes back from MongoDB as a BSON
 * `Binary`, which nodemailer refuses ('The "chunk" argument must be of type
 * string or an instance of Buffer…') — so every order confirmation carrying
 * its invoice PDF failed on every attempt and was finally marked failed.
 */
function toAttachmentContent(content: unknown): Buffer | string {
  if (typeof content === "string" || Buffer.isBuffer(content)) return content;
  if (content instanceof Uint8Array) return Buffer.from(content);
  const binary = content as { buffer?: unknown; data?: unknown } | null;
  if (binary?.buffer instanceof Uint8Array) return Buffer.from(binary.buffer);
  if (Array.isArray(binary?.data)) return Buffer.from(binary.data as number[]);
  throw new Error("Queued email attachment content is unreadable");
}

/**
 * Whether the mail server refused this recipient for good — the SMTP shape of
 * a hard bounce.
 *
 * Deliberately narrow. A 5xx also covers "relay access denied" and other
 * sender-side misconfiguration, and treating those as dead addresses would
 * unsubscribe a store's whole list the first time their SMTP credentials
 * lapsed. Only a rejection naming this recipient, or the "no such mailbox"
 * enhanced codes, counts. Exported for the test that pins that line.
 */
export function isHardBounce(error: unknown, recipient: string): boolean {
  const err = error as {
    responseCode?: number;
    response?: string;
    rejected?: unknown[];
  } | null;
  if (!err) return false;
  const code = Number(err.responseCode || 0);
  if (code < 500 || code >= 600) return false;

  const rejected = Array.isArray(err.rejected)
    ? err.rejected.map((value) => String(value).toLowerCase())
    : [];
  if (rejected.includes(recipient.toLowerCase())) return true;

  const response = String(err.response || "");
  return /5\.1\.[0-6]|unknown user|user unknown|no such user|mailbox (?:unavailable|not found)|recipient (?:rejected|not found)|does not exist/i.test(
    response,
  );
}

function retryDelayMs(attempts: number) {
  const minutes = [1, 5, 30, 120];
  return minutes[Math.min(Math.max(attempts - 1, 0), minutes.length - 1)] * 60_000;
}

async function deliverEmailJob(
  jobId: string,
  settings?: ISettingsData,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - 10 * 60_000);
  const job = await EmailDelivery.findOneAndUpdate(
    {
      _id: jobId,
      $or: [
        { status: { $in: ["queued", "retrying", "failed"] } },
        { status: "sending", lastAttemptAt: { $lte: staleBefore } },
      ],
    },
    {
      $set: { status: "sending", lastAttemptAt: new Date() },
      $inc: { attempts: 1 },
    },
    { returnDocument: "after" },
  );
  if (!job) {
    const existing = await EmailDelivery.findById(jobId).select("status").lean();
    return existing?.status === "sent";
  }

  try {
    const resolvedSettings = settings || (await getSettings());
    const transport = createSmtpTransport(resolvedSettings);
    if (!transport) throw new Error("SMTP is not configured or enabled");

    const from = job.from || buildFromHeader(resolvedSettings);
    if (!job.html) throw new Error("Queued email content is unavailable");
    const info = await transport.transporter.sendMail({
      from,
      to: job.to,
      subject: job.subject,
      replyTo: job.replyTo,
      html: job.html,
      text: job.text || job.html.replace(/<[^>]*>/g, ""),
      // `List-Unsubscribe` and friends: set per message by the caller.
      ...(job.headers ? { headers: job.headers } : {}),
      attachments: job.attachments?.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: toAttachmentContent(attachment.content),
      })),
    });

    job.status = "sent";
    job.sentAt = new Date();
    job.providerMessageId = info.messageId;
    job.lastError = undefined;
    job.nextAttemptAt = undefined;
    const retentionDays = resolvedSettings.email?.logRetentionDays ?? 30;
    job.expiresAt = new Date(
      job.sentAt.getTime() + retentionDays * 24 * 60 * 60 * 1000,
    );
    // A sent message cannot be retried, so retain metadata only.
    job.html = undefined;
    job.text = undefined;
    job.attachments = undefined;
    await job.save();
    return true;
  } catch (error) {
    // A refused recipient will be refused again, so it ends the job here
    // rather than after four more attempts, and takes the address off the
    // marketing list: continuing to send to a dead mailbox is what ruins a
    // store's sending reputation for the addresses that do work.
    const hardBounce = isHardBounce(error, job.to);
    const exhausted = hardBounce || job.attempts >= job.maxAttempts;
    job.status = exhausted ? "failed" : "retrying";
    if (hardBounce) job.hardBounce = true;
    job.lastError = sanitizeEmailError(error);
    job.nextAttemptAt = exhausted
      ? undefined
      : new Date(Date.now() + retryDelayMs(job.attempts));
    if (exhausted) {
      job.expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    }
    await job.save();
    if (hardBounce) {
      const { suppressEmailAddress } = await import(
        "@/lib/customers/marketing-consent"
      );
      await suppressEmailAddress({ email: job.to }).catch((suppressError) =>
        console.error("Failed to suppress bounced address:", suppressError),
      );
    }
    console.error("Failed to send email:", job.lastError);
    return false;
  }
}

export async function processPendingEmailDeliveries(limit = 20) {
  await connectDB();
  const now = new Date();
  const staleBefore = new Date(Date.now() - 10 * 60_000);

  // A send that died on its last try can never be reclaimed (it is out of
  // attempts), so without this it would sit at "sending" for good: never
  // sent, never failed, never reaped. The SMS outbox has the same sweep
  // (lib/sms/sms.ts).
  await EmailDelivery.updateMany(
    {
      status: "sending",
      lastAttemptAt: { $lte: staleBefore },
      $expr: { $gte: ["$attempts", "$maxAttempts"] },
    },
    {
      $set: {
        status: "failed",
        lastError:
          "The last attempt never finished, so the email may or may not have been sent.",
        expiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      },
      $unset: { nextAttemptAt: "" },
    },
  );

  const jobs = await EmailDelivery.find({
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

  const results = await Promise.allSettled(
    jobs.map((job) => deliverEmailJob(String(job._id))),
  );
  return {
    processed: results.length,
    sent: results.filter(
      (result) => result.status === "fulfilled" && result.value,
    ).length,
  };
}

export async function retryEmailDelivery(jobId: string) {
  await connectDB();
  const job = await EmailDelivery.findOneAndUpdate(
    { _id: jobId, status: { $in: ["failed", "retrying"] } },
    {
      $set: { status: "queued", attempts: 0, nextAttemptAt: new Date() },
      $unset: { lastError: 1 },
    },
    { returnDocument: "after" },
  );
  if (!job) return false;
  return deliverEmailJob(String(job._id));
}

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  settings?: ISettingsData;
  attachments?: EmailAttachment[];
  category?: string;
  /**
   * Extra SMTP headers. Marketing mail sets `List-Unsubscribe` and
   * `List-Unsubscribe-Post` here: Gmail and Outlook show their own one-click
   * unsubscribe from them, and bulk senders that do not offer one get their
   * mail filed as spam — including, eventually, the store's order updates.
   */
  headers?: Record<string, string>;
  /**
   * The event this email announces, for this recipient. A second call with
   * the same key queues nothing and reports the first as sent: an event that
   * fires twice — a courier webhook racing a merchant's "mark shipped" — must
   * not mail the customer twice, and a guest has no in-app row to remember
   * that it already did. Checked before the insert as well as enforced by the
   * unique index, so a store whose index was never built still holds.
   */
  dedupeKey?: string;
  /**
   * Tries before the job is marked failed (4 by default). The settings page's
   * test email sends once: a test that failed and then went out by itself
   * half an hour later said nothing about the settings being tested.
   */
  maxAttempts?: number;
}

/**
 * Send email helper
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  return (await sendEmailWithOutcome(options)).sent;
}

/**
 * `sendEmail`, with the mail server's answer when the send failed: the
 * sanitized error the outbox keeps on the job. The settings page's test email
 * shows it where the admin is looking, instead of pointing at the log.
 */
export async function sendEmailWithOutcome(
  options: SendEmailOptions,
): Promise<{ sent: boolean; error?: string }> {
  try {
    await connectDB();
    const settings = options.settings;
    // A store that never set up SMTP has opted out of email: queueing would
    // only log a failure per event and leave rows for the retry cron to chew.
    if (!isEmailDeliveryConfigured(settings ?? (await getSettings()))) {
      return { sent: false };
    }
    if (options.dedupeKey && (await EmailDelivery.exists({ dedupeKey: options.dedupeKey }))) {
      return { sent: true };
    }
    // Marketing is the one category consent governs. Order updates, password
    // resets and invoices are transactional and go out regardless — an
    // unsubscribe is from news and offers, not from being told where a parcel
    // is. The caller decides who to mail; this is the backstop that keeps an
    // unsubscribed or bounced address off a campaign whoever built it.
    if (options.category === "marketing") {
      const { isMarketingSuppressed } = await import(
        "@/lib/customers/marketing-consent"
      );
      if (await isMarketingSuppressed(options.to)) return { sent: false };
    }
    const job = await EmailDelivery.create({
      to: options.to,
      subject: options.subject,
      from: buildFromHeader(settings),
      replyTo: options.replyTo,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, ""),
      attachments: options.attachments?.map((att) => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType || "application/pdf",
      })),
      category: options.category || "transactional",
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
      ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
      status: "queued",
      nextAttemptAt: new Date(),
    });
    if (await deliverEmailJob(String(job._id), settings)) return { sent: true };
    const failed = await EmailDelivery.findById(job._id).select("lastError").lean();
    return { sent: false, error: failed?.lastError };
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) return { sent: true };
    const message = sanitizeEmailError(error);
    console.error("Failed to queue email:", message);
    return { sent: false, error: message };
  }
}

/**
 * What became of one outbox email, as evidence: `sent` only once the mail
 * server ACCEPTED it (`sentAt` is that moment), `failed` with whether the
 * address itself was refused, anything else still on its way.
 */
export type EmailDeliveryOutcome = {
  jobId?: string;
  status: "queued" | "sending" | "retrying" | "sent" | "failed" | "cancelled" | "unconfigured";
  sentAt?: Date;
  hardBounce?: boolean;
  error?: string;
};

export async function readEmailDelivery(jobId: string): Promise<EmailDeliveryOutcome | null> {
  await connectDB();
  const job = await EmailDelivery.findById(jobId)
    .select("status sentAt hardBounce lastError")
    .lean<{
      _id: unknown;
      status: EmailDeliveryOutcome["status"];
      sentAt?: Date;
      hardBounce?: boolean;
      lastError?: string;
    } | null>();
  if (!job) return null;
  return {
    jobId,
    status: job.status,
    ...(job.sentAt ? { sentAt: job.sentAt } : {}),
    ...(job.hardBounce ? { hardBounce: true } : {}),
    ...(job.lastError ? { error: job.lastError } : {}),
  };
}

/**
 * `sendEmail` for a caller that needs evidence rather than a boolean: the
 * outbox job behind the message and what became of it. A message already
 * queued under the same `dedupeKey` is not sent again — its job and its real
 * status are returned, never a blanket "sent" (which `sendEmail` reports for
 * a duplicate, sent or not).
 */
export async function queueEmailWithEvidence(
  options: SendEmailOptions & { dedupeKey: string },
): Promise<EmailDeliveryOutcome> {
  await connectDB();
  const settings = options.settings;
  if (!isEmailDeliveryConfigured(settings ?? (await getSettings()))) {
    return { status: "unconfigured" };
  }
  const existing = await EmailDelivery.findOne({ dedupeKey: options.dedupeKey })
    .select("_id")
    .lean<{ _id: unknown } | null>();
  let jobId = existing ? String(existing._id) : undefined;
  if (!jobId) {
    try {
      const job = await EmailDelivery.create({
        to: options.to,
        subject: options.subject,
        from: buildFromHeader(settings),
        replyTo: options.replyTo,
        html: options.html,
        text: options.text || options.html.replace(/<[^>]*>/g, ""),
        category: options.category || "transactional",
        ...(options.headers ? { headers: options.headers } : {}),
        dedupeKey: options.dedupeKey,
        ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
        status: "queued",
        nextAttemptAt: new Date(),
      });
      jobId = String(job._id);
      await deliverEmailJob(jobId, settings);
    } catch (error) {
      if ((error as { code?: number } | null)?.code !== 11000) {
        return { status: "failed", error: sanitizeEmailError(error) };
      }
      const raced = await EmailDelivery.findOne({ dedupeKey: options.dedupeKey })
        .select("_id")
        .lean<{ _id: unknown } | null>();
      jobId = raced ? String(raced._id) : undefined;
    }
  }
  if (!jobId) return { status: "failed", error: "The email could not be queued" };
  return (await readEmailDelivery(jobId)) ?? { jobId, status: "queued" };
}


/**
 * Drop an unsent email's body from the outbox, leaving the row in the log
 * with its failure. For a message whose content must not be retried or read
 * later — a "set your password" link that has been spent.
 */
export async function discardEmailContent(jobId: string): Promise<void> {
  await connectDB();
  await EmailDelivery.updateOne(
    { _id: jobId, status: { $ne: "sent" } },
    { $unset: { html: 1, text: 1, attachments: 1 } },
  );
}

/**
 * The addresses among `to` (lower-cased) that were sent an email of one of
 * these categories since `since`, or have one on its way. Rows whose dedupe
 * key starts with `excludeKeyPrefix` — the caller's own earlier tries — do
 * not count.
 */
export async function recentEmailRecipients(params: {
  to: string[];
  categories: string[];
  since: Date;
  excludeKeyPrefix?: string;
}): Promise<Set<string>> {
  if (params.to.length === 0) return new Set();
  await connectDB();
  const rows = await EmailDelivery.find({
    to: { $in: params.to },
    category: { $in: params.categories },
    createdAt: { $gte: params.since },
    status: { $in: ["queued", "sending", "retrying", "sent"] },
    ...(params.excludeKeyPrefix
      ? { dedupeKey: { $not: new RegExp(`^${escapeRegExp(params.excludeKeyPrefix)}`) } }
      : {}),
  })
    .select("to")
    .lean<Array<{ to: string }>>();
  return new Set(rows.map((row) => row.to.toLowerCase()));
}

/** The sent email whose dedupe key starts with `prefix`, if one went out. */
export async function findSentEmailByKeyPrefix(
  prefix: string,
): Promise<{ category?: string } | null> {
  await connectDB();
  return EmailDelivery.findOne({
    dedupeKey: new RegExp(`^${escapeRegExp(prefix)}`),
    status: "sent",
  })
    .select("category")
    .lean<{ category?: string } | null>();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
