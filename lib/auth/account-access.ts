import "server-only";

import { ObjectId } from "mongodb";
import { connectDB, mongoose } from "@/lib/db";
import { PasswordReset, User, Vendor } from "@/models";
import {
  PASSWORD_TOKEN_LIFETIME_MS,
  type PasswordTokenPurpose,
} from "@/models/password-reset.model";
import { getSettingsLean, type ISettingsData } from "@/models/settings.model";
import { USER_ACCOUNT_STATUS } from "@/config/app.config";
import { DEFAULT_STORE_NAME } from "@/config/branding.config";
import { isValidLocale, type Locale } from "@/config/i18n.config";
import { getCredentialAccount } from "@/lib/auth/auth-credentials";
import {
  discardEmailContent,
  isEmailDeliveryConfigured,
  queueEmailWithEvidence,
  recentEmailRecipients,
  sendEmail,
} from "@/lib/email/email";
import {
  accountAccessEmail,
  type AccountAccessCopy,
} from "@/lib/email/account-access-email";
import { appBaseUrl } from "@/lib/app-url";
import { getLocaleRouting, localeHref } from "@/lib/i18n/locale-routing";
import { audit, type AuditContext } from "@/lib/audit";

/**
 * The emailed "set a password" link, made and sent in one place.
 *
 * The shopper's own forgot-password request, an admin's "Send password reset"
 * or "Send account invite" on a customer, the bulk send from the customers
 * list, and the customer and vendor imports all come through here, so the
 * link, its lifetime, its wording and its language are decided once.
 *
 * The token itself never leaves this module except inside the email: it is
 * not logged, not audited and not returned.
 */

export type AccountAccessPurpose = PasswordTokenPurpose;
export type { AccountAccessCopy };

/** The outbox category of each kind of email — what the 15-minute rule reads. */
export const ACCOUNT_ACCESS_EMAIL_CATEGORY: Record<AccountAccessPurpose, string> = {
  reset: "password-reset",
  invite: "account-invite",
};

/** No second account email to one address within this long. */
export const ACCOUNT_ACCESS_RESEND_AFTER_MS = 15 * 60 * 1000;

function database() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database not connected");
  return db;
}

/**
 * Reset when the account has a password to reset, invite when it has none —
 * an admin-made customer, a guest, someone who only ever signed in with
 * Google. The email and the page then say "set" rather than "reset".
 */
export async function resolveAccountAccessPurpose(
  userId: string,
): Promise<AccountAccessPurpose> {
  await connectDB();
  const credential = await getCredentialAccount(database(), new ObjectId(userId));
  return credential?.password ? "reset" : "invite";
}

/**
 * The language a link opens in: the one asked for when the store serves it,
 * else the store's default. A language the store has switched off would open
 * the English page under a foreign prefix.
 */
export async function resolveAccountAccessLocale(
  preferred?: string | null,
): Promise<Locale> {
  const routing = await getLocaleRouting();
  const wanted = String(preferred ?? "").toLowerCase();
  if (isValidLocale(wanted) && routing.enabled.includes(wanted)) return wanted;
  return routing.storeDefault;
}

/** The link in the email, on the store's own address and in the shopper's language. */
export async function accountAccessUrl(token: string, locale: string): Promise<string> {
  const path = await localeHref(locale, "/reset-password");
  return `${appBaseUrl()}${path}?token=${encodeURIComponent(token)}`;
}

export type AccountAccessResult =
  | { status: "sent"; purpose: AccountAccessPurpose; email: string }
  | {
      status: "failed";
      purpose: AccountAccessPurpose;
      email: string;
      /** The mail server's answer, sanitized by the outbox. Never holds the link. */
      error?: string;
      /** The address itself was refused; trying again will not help. */
      hardBounce?: boolean;
    }
  | { status: "unconfigured" }
  | { status: "refused"; reason: "missing" | "banned" | "no_email" };

interface SendAccountAccessEmailParams {
  userId: string;
  /** "auto" (the default) picks reset or invite from the account itself. */
  purpose?: AccountAccessPurpose | "auto";
  locale?: string | null;
  settings?: ISettingsData;
  /**
   * "outbox" leaves a failed send to the email retry job, with the link still
   * good — the shopper who asked for it is not watching for an answer.
   *
   * "once" tries one time and, when that fails, spends the link and takes it
   * out of the outbox row, so neither a retry from the email log nor a later
   * look at the row can use it. The caller retries with a fresh link: an
   * admin who is shown the failure, or the bulk queue on its own schedule.
   */
  delivery?: "outbox" | "once";
  /** "once" only: the outbox key, so a repeated attempt is recognised. */
  dedupeKey?: string;
  /** Present when an admin sent it: one row per account in the Activity Log. */
  auditContext?: AuditContext;
  /**
   * The account's owner asked for it themselves (forgot-password). The link
   * then works for an hour whatever it is for: they asked a moment ago and
   * are at their inbox, and a self-requested link left lying there for a
   * week is a key nobody is watching. An invitation the store sends keeps
   * its week.
   */
  selfService?: boolean;
  /**
   * Whose words the email speaks in. "customer" (the default) is a shopper's
   * account. "vendor-moved" is an imported store's owner, told their store has
   * moved here; "vendor-approved" an owner with no password whose store an
   * admin just approved. Both vendor wordings name the owner's store.
   */
  copy?: AccountAccessCopy;
}

export async function sendAccountAccessEmail(
  params: SendAccountAccessEmailParams,
): Promise<AccountAccessResult> {
  await connectDB();
  if (!ObjectId.isValid(params.userId)) return { status: "refused", reason: "missing" };

  const user = await User.findById(params.userId)
    .select("name email status")
    .lean<{ name?: string; email?: string; status?: string } | null>();
  if (!user) return { status: "refused", reason: "missing" };
  // A banned account gets no way back in by email, whoever asks.
  if (user.status === USER_ACCOUNT_STATUS.BANNED) {
    return { status: "refused", reason: "banned" };
  }
  const email = user.email?.trim().toLowerCase();
  if (!email) return { status: "refused", reason: "no_email" };

  const settings = params.settings ?? (await getSettingsLean());
  if (!isEmailDeliveryConfigured(settings)) return { status: "unconfigured" };

  const purpose =
    !params.purpose || params.purpose === "auto"
      ? await resolveAccountAccessPurpose(params.userId)
      : params.purpose;
  const locale = await resolveAccountAccessLocale(params.locale);

  const lifetimeMs = params.selfService
    ? PASSWORD_TOKEN_LIFETIME_MS.reset
    : PASSWORD_TOKEN_LIFETIME_MS[purpose];
  const { token, resetDoc } = await PasswordReset.createToken(params.userId, purpose, {
    lifetimeMs,
  });
  const vendorStoreName =
    params.copy === "vendor-moved" || params.copy === "vendor-approved"
      ? (
          await Vendor.findOne({ userId: params.userId })
            .select("storeName")
            .lean<{ storeName?: string } | null>()
        )?.storeName
      : undefined;
  const { subject, html } = accountAccessEmail({
    purpose,
    name: user.name || "there",
    storeName: settings.general?.storeName || DEFAULT_STORE_NAME,
    url: await accountAccessUrl(token, locale),
    lifetimeMs,
    selfService: params.selfService,
    copy: params.copy,
    vendorStoreName,
  });
  const category = ACCOUNT_ACCESS_EMAIL_CATEGORY[purpose];

  let result: AccountAccessResult;
  if (params.delivery === "once") {
    const outcome = await queueEmailWithEvidence({
      to: email,
      subject,
      html,
      settings,
      category,
      maxAttempts: 1,
      dedupeKey: params.dedupeKey ?? `account-access:${String(resetDoc._id)}`,
    });
    if (outcome.status === "sent") {
      result = { status: "sent", purpose, email };
    } else {
      await PasswordReset.updateOne({ _id: resetDoc._id }, { $set: { used: true } });
      if (outcome.jobId) await discardEmailContent(outcome.jobId);
      result =
        outcome.status === "unconfigured"
          ? { status: "unconfigured" }
          : {
              status: "failed",
              purpose,
              email,
              ...(outcome.error ? { error: outcome.error } : {}),
              ...(outcome.hardBounce ? { hardBounce: true } : {}),
            };
    }
  } else {
    const sent = await sendEmail({ to: email, subject, html, settings, category });
    result = sent ? { status: "sent", purpose, email } : { status: "failed", purpose, email };
  }

  if (result.status === "sent" && params.auditContext) {
    await audit(params.auditContext, {
      action: purpose === "invite" ? "INVITE_SENT" : "PASSWORD_RESET",
      resource: "user",
      resourceId: params.userId,
      resourceName: email,
      changes: {
        summary:
          purpose === "invite"
            ? `Sent an account invitation to ${email} to set their password`
            : `Sent a password reset link to ${email}`,
      },
      metadata: { purpose },
    });
  }

  return result;
}

/**
 * Whether an account email already went to this address within the last 15
 * minutes, or is on its way: either kind counts, since the purpose is chosen
 * from the account and a second email would only replace the first link.
 */
export async function recentAccountAccessEmails(
  emails: string[],
  now: number = Date.now(),
): Promise<Set<string>> {
  return recentEmailRecipients({
    to: emails,
    categories: Object.values(ACCOUNT_ACCESS_EMAIL_CATEGORY),
    since: new Date(now - ACCOUNT_ACCESS_RESEND_AFTER_MS),
  });
}
