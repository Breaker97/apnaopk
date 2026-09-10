/**
 * Turn a sign-in rejection into a sentence the visitor can act on.
 *
 * Better Auth answers in English, from the server, with no idea who is reading
 * — so a Bengali shop owner locked out of their own admin used to get
 * "Too many failed sign-in attempts. Try again in 15 minutes." The server now
 * sends the *facts* (`code`, `retryAfterSeconds`, `attemptsRemaining`) and this
 * builds the sentence in the visitor's language. The English `message` is kept
 * as the last resort, for codes we do not recognise.
 *
 * Client-safe by design: no server-only imports, so the sign-in form can use it.
 */

export type AuthErrorPayload = {
  code?: string | null;
  message?: string | null;
  retryAfterSeconds?: number | null;
  attemptsRemaining?: number | null;
  status?: number | null;
};

/** Minimal shape of a next-intl translator, so this stays testable. */
export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

function toCount(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

/**
 * "14 minutes" / "45 seconds" — whichever reads as the more honest answer to
 * "how long do I wait?". Rounding a 45-second wait up to a minute is the kind
 * of small dishonesty that makes people reload and try again anyway.
 */
export function describeWait(seconds: number, t: Translate): string {
  if (seconds < 60) {
    return t("auth.errors.durationSeconds", { count: Math.max(1, seconds) });
  }
  return t("auth.errors.durationMinutes", { count: Math.ceil(seconds / 60) });
}

export function describeAuthError(
  payload: AuthErrorPayload,
  t: Translate,
): string {
  const code = typeof payload.code === "string" ? payload.code : "";

  if (code === "ACCOUNT_LOCKED") {
    const seconds = toCount(payload.retryAfterSeconds);
    // No countdown means we cannot promise a time, so do not invent one.
    if (seconds === null || seconds === 0) {
      return t("auth.errors.accountLockedUnknown");
    }
    return t("auth.errors.accountLocked", {
      duration: describeWait(seconds, t),
    });
  }

  if (code === "INVALID_EMAIL_OR_PASSWORD") {
    const remaining = toCount(payload.attemptsRemaining);
    if (remaining === null || remaining <= 0) {
      return t("auth.errors.invalidCredentials");
    }
    // One message, not two joined with a space: Chinese and Japanese put no
    // space after their full stop, and that is the locale's call to make.
    return t("auth.errors.invalidCredentialsWithAttempts", {
      count: remaining,
    });
  }

  // Better Auth's own per-IP request limit, which has no code of its own. It
  // arrives as a bare 429 and used to surface as an untranslated "Too many
  // requests" with no hint of what to do about it.
  if (payload.status === 429) {
    return t("auth.errors.tooManyRequests");
  }

  return (
    (typeof payload.message === "string" && payload.message.trim()) ||
    t("errors.unauthorized")
  );
}
