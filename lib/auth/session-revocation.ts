import { getAuthContext } from "@/lib/auth/auth";

/**
 * Session revocation, through Better Auth's own adapter.
 *
 * These used to be raw deletes on the `session` collection filtered by the
 * user's id as a string. The Mongo adapter stores `userId` as an ObjectId, so
 * the filter matched nothing: a password reset left a hijacked session alive,
 * a password change left every other device signed in, and "Sign out other
 * devices" signed out nobody. The adapter converts ids itself and clears
 * secondary storage when one is configured.
 *
 * A revoked session stops working on its next request — not when its cookie
 * cache runs out — because the session read in `lib/auth/auth.ts` starts from
 * the session row (see `lib/auth/live-session.ts`).
 */

type UserSessionSummary = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
};

async function listSessions(userId: string) {
  const ctx = await getAuthContext();
  return {
    adapter: ctx.internalAdapter,
    sessions: await ctx.internalAdapter.listSessions(userId),
  };
}

/** The user's sessions that have not expired, for a "your devices" list. */
export async function listActiveSessions(
  userId: string,
): Promise<UserSessionSummary[]> {
  const ctx = await getAuthContext();
  const sessions = await ctx.internalAdapter.listSessions(userId, {
    onlyActiveSessions: true,
  });
  return sessions.map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
  }));
}

/** Signs the user out everywhere. Returns how many sessions were revoked. */
/**
 * Everything Better Auth keeps for a user who is being deleted: their
 * sessions, their sign-in accounts (the password hash among them) and their
 * two-factor secret. A user deleted through the app's own model left all
 * three behind.
 */
export async function deleteUserAuthRecords(userId: string): Promise<void> {
  const ctx = await getAuthContext();
  await revokeAllSessions(userId);
  await ctx.internalAdapter.deleteAccounts(userId);
  await ctx.adapter.deleteMany({
    model: "twoFactor",
    where: [{ field: "userId", value: userId }],
  });
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const { adapter, sessions } = await listSessions(userId);
  if (sessions.length === 0) return 0;
  await adapter.deleteSessions(sessions.map((session) => session.token));
  return sessions.length;
}

/**
 * Signs the user out everywhere except the session making the request.
 * Returns how many sessions were revoked.
 */
export async function revokeOtherSessions(
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const { adapter, sessions } = await listSessions(userId);
  const tokens = sessions
    .filter((session) => session.id !== keepSessionId)
    .map((session) => session.token);
  if (tokens.length === 0) return 0;
  await adapter.deleteSessions(tokens);
  return tokens.length;
}

/**
 * Revokes one of the user's own sessions. False when the user has no session
 * with that id — including another user's session, which is never touched.
 */
export async function revokeSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const { adapter, sessions } = await listSessions(userId);
  const target = sessions.find((session) => session.id === sessionId);
  if (!target) return false;
  await adapter.deleteSession(target.token);
  return true;
}
