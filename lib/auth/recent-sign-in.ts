import { AuthorizationError } from "@/lib/api/errors";

/** How recent a sign-in has to be. */
const RECENT_SIGN_IN_MS = 10 * 60 * 1000;

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
  // No sign-in time is no proof of a recent one.
  const signedInAt = new Date(session.session.createdAt ?? Number.NaN).getTime();
  if (!Number.isFinite(signedInAt) || now - signedInAt > RECENT_SIGN_IN_MS) {
    throw new AuthorizationError(
      "For your account's safety, sign out and sign in again, then make this change within ten minutes.",
    );
  }
}
