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
 * Check if email is configured (via .env, with no DB settings loaded)
 */
export function isEmailConfigured(): boolean {
  return !!resolveSmtpConfig();
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
    { new: true },
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
      attachments: job.attachments,
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
    { new: true },
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
}): Promise<boolean> {
  try {
    await connectDB();
    const settings = options.settings;
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
      status: "queued",
      nextAttemptAt: new Date(),
    });
    return deliverEmailJob(String(job._id), settings);
  } catch (error) {
    console.error("Failed to queue email:", sanitizeEmailError(error));
    return false;
  }
}
