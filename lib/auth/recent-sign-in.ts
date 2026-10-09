import { AuthorizationError } from "@/lib/api/errors";

/**
 * How recent a sign-in has to be. Better Auth's own "fresh session" window
 * (`session.freshAge` in lib/auth/auth.ts, which guards its /delete-user) is
 * this same ten minutes.
 */
export const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

export const RECENT_SIGN_IN_MESSAGE =
  "For your account's safety, sign out and sign in again, then make this change within ten minutes.";

/** Whether `signedInAt` is within the last ten minutes. No time is no proof. */
export function isRecentSignIn(
  signedInAt: Date | string | undefined | null,
  now: number = Date.now(),
): boolean {
  const at = new Date(signedInAt ?? Number.NaN).getTime();
  return Number.isFinite(at) && now - at <= RECENT_SIGN_IN_MS;
}

/**
 * Refuses unless this session signed in within the last ten minutes.
 *
 * Changing the login email, setting a first password on an account that signs
 * in with Google, repointing a seller's payouts: what someone holding a stolen
 * session would do to keep the account or its money. None of them asked for
 * anything the session did not already have. A recent sign-in is the account's
 * own credentials, just now.
 */
export function assertRecentSignIn(
  session: { session: { createdAt?: Date | string } },
  now: number = Date.now(),
): void {
  if (!isRecentSignIn(session.session.createdAt, now)) {
    throw new AuthorizationError(RECENT_SIGN_IN_MESSAGE);
  }
}
