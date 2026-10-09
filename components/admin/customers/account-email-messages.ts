import type { ApiClientError } from "@/lib/api/client";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Why a customer was left out of an account email, as the server names it. */
export const ACCOUNT_EMAIL_REASONS = [
  "nonCustomer",
  "banned",
  "inactive",
  "noEmail",
  "recent",
  "duplicate",
] as const;

export type AccountEmailReason = (typeof ACCOUNT_EMAIL_REASONS)[number];
export type AccountEmailSkipped = Partial<Record<AccountEmailReason, number>>;

/**
 * A refused or failed send, in the admin's language: the server's `reason`
 * picks the sentence, and an unknown one falls back to the server's own
 * message (which, for a mail server's refusal, is the useful part).
 */
export function accountEmailErrorMessage(
  error: Partial<Pick<ApiClientError, "details" | "message" | "status">> | null,
  t: Translate,
): string {
  const reason = error?.details?.reason;
  if (typeof reason === "string") {
    if ((ACCOUNT_EMAIL_REASONS as readonly string[]).includes(reason)) {
      return t(`reason.${reason}`);
    }
    if (reason === "unconfigured") return t("emailNotSetUp");
    if (reason === "failed") return t("sendFailed");
  }
  if (error?.status === 429 && error.message) return error.message;
  return error?.message || t("sendFailed");
}

/**
 * "3 will be left out: 2 banned, 1 without an email." — or nothing at all when
 * nobody is, so the dialog only mentions what is out of the ordinary.
 */
export function describeSkipped(skipped: AccountEmailSkipped, t: Translate): string {
  const parts = ACCOUNT_EMAIL_REASONS.filter((reason) => (skipped[reason] ?? 0) > 0).map(
    (reason) => t(`skippedReason.${reason}`, { count: skipped[reason] ?? 0 }),
  );
  if (parts.length === 0) return "";
  const total = ACCOUNT_EMAIL_REASONS.reduce((sum, reason) => sum + (skipped[reason] ?? 0), 0);
  return t("skippedSummary", { count: total, reasons: parts.join(", ") });
}
