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

/**
 * The `?error=` codes a failed Google/Facebook sign-in brings back to the
 * login page, by the sentence each one gets. Matched lowercased: Better Auth
 * sends its own codes in snake_case but forwards our session hook's
 * (`OAUTH_ACCOUNT_ROLE_CONFLICT`, …) exactly as thrown.
 */
const OAUTH_ERROR_KEYS: Record<string, string> = {
  // The shopper said no on the provider's consent screen.
  access_denied: "auth.errors.oauthCancelled",
  user_cancelled_login: "auth.errors.oauthCancelled",
  user_cancelled_authorize: "auth.errors.oauthCancelled",
  // The state cookie set when sign-in began is gone or does not match: the
  // round trip took longer than ten minutes, ended in another browser, or
  // came back on a different host than it started from.
  state_mismatch: "auth.errors.oauthSessionExpired",
  state_not_found: "auth.errors.oauthSessionExpired",
  state_invalid: "auth.errors.oauthSessionExpired",
  state_security_mismatch: "auth.errors.oauthSessionExpired",
  please_restart_the_process: "auth.errors.oauthSessionExpired",
  email_not_found: "auth.errors.oauthEmailMissing",
  unable_to_get_user_info: "auth.errors.oauthEmailMissing",
  account_not_linked: "auth.errors.oauthAccountExists",
  account_already_linked_to_different_user: "auth.errors.oauthAccountExists",
  "email_doesn't_match": "auth.errors.oauthAccountExists",
  unable_to_link_account: "auth.errors.oauthAccountExists",
  email_not_verified: "auth.errors.oauthEmailNotVerified",
  account_inactive_or_banned: "auth.errors.oauthAccountInactive",
  oauth_customer_only: "auth.oauthCustomerOnly",
  oauth_signin_is_only_available_for_customers: "auth.oauthCustomerOnly",
};

/**
 * The sentence for a failed social sign-in, or null when the login page was
 * opened without one. Only the code is ever read — never Better Auth's
 * `error_description` — so a crafted link cannot put its own words on the
 * sign-in page. A code nobody listed still gets the generic sentence, never
 * silence: an OAuth round trip that lands back on the form with nothing said
 * reads as a broken button.
 */
export function describeOAuthError(
  error: { code: string | null; role?: string; email?: string },
  t: Translate,
): string | null {
  const code = error.code?.trim().toLowerCase();
  if (!code) return null;

  if (code === "oauth_account_role_conflict") {
    const rawRole = error.role?.trim() ?? "";
    const role = rawRole
      ? rawRole.charAt(0).toUpperCase() + rawRole.slice(1)
      : t("auth.vendorRole");
    // Better Auth's own redirect carries the code alone; only a refusal that
    // came back as JSON names the (masked) address.
    const email = error.email?.trim();
    return email
      ? t("auth.oauthRoleConflict", { email, role })
      : t("auth.oauthRoleConflictNoEmail", { role });
  }

  return t(OAUTH_ERROR_KEYS[code] ?? "auth.errors.oauthFailed");
}
