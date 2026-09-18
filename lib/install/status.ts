import "server-only";

import { NotFoundError } from "@/lib/api/errors";
import { findAuthSecretProblem, describeAuthSecretProblem } from "@/lib/auth/auth-secret";
import { resolveStorageCredentials } from "@/lib/settings/credentials";
import { connectDB } from "@/lib/db";
import { USER_ROLES } from "@/config/app.config";
import { Settings, User } from "@/models";
import {
  INSTALL_CLAIM_LEASE_MS,
  isInstallLocked,
  meetsNodeVersionFloor,
} from "./payload";

/**
 * Install state and preflight. The lock is checked SERVER-SIDE on every
 * wizard API and on the page itself — a reachable post-install wizard is
 * the classic CodeCanyon vulnerability, so the answer to a locked call is a
 * plain 404, not an explanation.
 */

export async function isInstalled(): Promise<boolean> {
  await connectDB();
  const [admin, settings] = await Promise.all([
    User.exists({ role: USER_ROLES.ADMIN }),
    Settings.findOne({}).select("installedAt").lean<{ installedAt?: Date } | null>(),
  ]);
  return isInstallLocked({
    adminExists: Boolean(admin),
    installedAt: settings?.installedAt ?? null,
  });
}

/** 404 (not 403): a locked wizard should not even acknowledge it exists. */
export async function assertInstallable(): Promise<void> {
  if (await isInstalled()) {
    throw new NotFoundError("Not found");
  }
}

export async function markInstalled(): Promise<void> {
  await Settings.updateOne(
    {},
    { $set: { installedAt: new Date() } },
    { upsert: true },
  );
}

/**
 * Take the wizard's one lease, atomically.
 *
 * `isInstalled()` is a read, so two requests arriving together both pass it
 * and both go on to create an admin — a several-hundred-millisecond window
 * (the password hash alone) on an UNAUTHENTICATED endpoint, which is long
 * enough to race deliberately. A single conditional update is atomic in
 * MongoDB, so exactly one caller flips the field from free to held and the
 * loser is turned away like any other post-install caller.
 *
 * The filter is `isInstallClaimFree` (payload.ts) as a query — keep the two
 * in step. The settings document must already exist: call `getSettings()`
 * first, or the update matches nothing and nobody can ever claim.
 */
export async function claimInstall(): Promise<boolean> {
  const expired = new Date(Date.now() - INSTALL_CLAIM_LEASE_MS);
  const result = await Settings.updateOne(
    {
      $or: [
        { installClaimedAt: null },
        { installClaimedAt: { $exists: false } },
        { installClaimedAt: { $lt: expired } },
      ],
    },
    { $set: { installClaimedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

/**
 * Hand the lease back after a run that failed BEFORE the admin existed —
 * the wizard is still open in that case and the buyer must be able to fix
 * their password and try again immediately, not wait out the lease.
 */
export async function releaseInstallClaim(): Promise<void> {
  await Settings.updateOne({}, { $set: { installClaimedAt: null } });
}

/**
 * Whether `.env` alone already carries a usable S3 credential set, in which
 * case the wizard's storage step offers to leave the form empty instead of
 * making the buyer retype what they have already configured: with nothing in
 * the database, `resolveStorageCredentials` falls through to the env vars and
 * media keeps working. Passing `null` asks exactly that question — no stored
 * value, what survives?
 */
export function hasStorageEnvCredentials(): boolean {
  const env = resolveStorageCredentials(null);
  return Boolean(env.bucketName && env.accessKeyId && env.secretAccessKey);
}

interface InstallPreflight {
  nodeVersion: string;
  nodeOk: boolean;
  databaseOk: boolean;
  /** null = healthy; otherwise a human-readable problem the buyer must fix. */
  authSecretProblem: string | null;
  /**
   * BETTER_AUTH_URL as the server sees it. The browser compares it, and its
   * own build-time NEXT_PUBLIC_APP_URL, against the address it is open on
   * (`findAppUrlProblem`) — only the browser knows that address for certain.
   */
  authUrl: string | null;
}

/** Cheapest possible proof that this app can actually READ its database. */
async function pingDatabase(): Promise<boolean> {
  try {
    await connectDB();
    await Settings.findOne({}).select("_id").lean();
    return true;
  } catch {
    return false;
  }
}

export async function getInstallPreflight(): Promise<InstallPreflight> {
  const nodeVersion = process.version;
  const problem = findAuthSecretProblem(process.env.BETTER_AUTH_SECRET);
  return {
    nodeVersion,
    nodeOk: meetsNodeVersionFloor(nodeVersion),
    // A real round trip, not a constant. Connecting is not the same as
    // being able to read: a wrong `MONGODB_DB_NAME`, a user without read
    // rights, or a cluster mid-failover all connect and then refuse, and a
    // green tick there sends the buyer hunting in the wrong place.
    databaseOk: await pingDatabase(),
    authSecretProblem: problem ? describeAuthSecretProblem(problem) : null,
    authUrl: process.env.BETTER_AUTH_URL?.trim() || null,
  };
}
