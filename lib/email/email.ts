/**
 * Email Service Configuration
 * Using Nodemailer with SMTP (Gmail compatible)
 */

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
  const resolved =
    resolveSmtpFromEmail(settings) ||
    settings?.email?.smtp?.user ||
    getSenderEmail();

  if (resolved.includes("<") && resolved.includes(">")) return resolved;

  const name =
    settings?.email?.fromName || settings?.general?.storeName || getAppName();
  return `"${name}" <${resolved}>`;
}

/**
 * Get email transporter
 */
function getTransporter(config: EmailConfig): Transporter {
  return nodemailer.createTransport(config);
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
    console.log("Email sent:", info.messageId);
    return true;
  } catch (error) {
    const exhausted = job.attempts >= job.maxAttempts;
    job.status = exhausted ? "failed" : "retrying";
    job.lastError = sanitizeEmailError(error);
    job.nextAttemptAt = exhausted
      ? undefined
      : new Date(Date.now() + retryDelayMs(job.attempts));
    if (exhausted) {
      job.expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    }
    await job.save();
    console.error("Failed to send email:", job.lastError);
    return false;
  }
}

export async function processPendingEmailDeliveries(limit = 20) {
  await connectDB();
  const now = new Date();
  const staleBefore = new Date(Date.now() - 10 * 60_000);
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

/**
 * Send email helper
 */
export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  settings?: ISettingsData;
  attachments?: EmailAttachment[];
  category?: string;
  /**
   * The event this email announces, for this recipient. A second call with
   * the same key queues nothing and reports the first as sent: an event that
   * fires twice — a courier webhook racing a merchant's "mark shipped" — must
   * not mail the customer twice, and a guest has no in-app row to remember
   * that it already did. Checked before the insert as well as enforced by the
   * unique index, so a store whose index was never built still holds.
   */
  dedupeKey?: string;
}): Promise<boolean> {
  try {
    await connectDB();
    const settings = options.settings;
    // A store that never set up SMTP has opted out of email: queueing would
    // only log a failure per event and leave rows for the retry cron to chew.
    if (!isEmailDeliveryConfigured(settings ?? (await getSettings()))) {
      return false;
    }
    if (options.dedupeKey && (await EmailDelivery.exists({ dedupeKey: options.dedupeKey }))) {
      return true;
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
      ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
      status: "queued",
      nextAttemptAt: new Date(),
    });
    return deliverEmailJob(String(job._id), settings);
  } catch (error) {
    if ((error as { code?: number } | null)?.code === 11000) return true;
    console.error("Failed to queue email:", sanitizeEmailError(error));
    return false;
  }
}
