/**
 * Account lockout after repeated failed sign-ins.
 *
 * Admin → Settings → Security exposes "Max login attempts" and "Lockout
 * duration". Both were stored and rendered but read by nothing, so a merchant
 * could configure a lockout and have none: the only brute-force defence was
 * Better Auth's per-IP request rate limit, which is a different control with a
 * different shape. This module is what makes those two fields mean something.
 *
 * **The counter is keyed on email *and* client IP.** Locking on the email alone
 * is the textbook design and it hands anyone who knows the owner's address a
 * denial of service: fail five sign-ins every fifteen minutes and the store
 * owner never gets back in. Scoping to the IP as well stops the attack this
 * control exists to stop — one host grinding one account — without giving a
 * stranger a lever on someone else's login. The distributed case, many hosts or
 * many accounts, is covered by the shared rate limits in `lib/auth.ts`
 * (`/sign-in/email`: 8 per minute, database-backed so every instance shares one
 * budget).
 *
 * Every failed sign-in counts the same way whether or not the address belongs
 * to a real account — Better Auth answers 401 for both — so the lockout reveals
 * nothing about which emails are registered.
 */

import "server-only";

import { connectDB } from "@/lib/db";
import {
  ATTEMPTS_WARNING_THRESHOLD,
  DEFAULT_LOCKOUT_MINUTES,
  DEFAULT_MAX_LOGIN_ATTEMPTS,
  MAX_LOCKOUT_MINUTES,
  MAX_LOGIN_ATTEMPTS,
  MIN_LOCKOUT_MINUTES,
} from "@/lib/security-limits";
import { LoginAttempt } from "@/models/login-attempts.model";
import { getSettingsLean } from "@/models/settings.model";

type LockoutPolicy = {
  /** Failures allowed before the lock applies. `0` disables lockout entirely. */
  maxAttempts: number;
  lockoutMinutes: number;
};

export type LockoutState = {
  locked: boolean;
  /** Seconds until the lock lifts; `0` when not locked. */
  retryAfterSeconds: number;
  /**
   * Failures left before the lock applies. `null` when there is nothing useful
   * to say — lockout disabled, already locked, or still far from the limit.
   */
  attemptsRemaining: number | null;
};

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = {
  maxAttempts: DEFAULT_MAX_LOGIN_ATTEMPTS,
  lockoutMinutes: DEFAULT_LOCKOUT_MINUTES,
};

const UNLOCKED: LockoutState = {
  locked: false,
  retryAfterSeconds: 0,
  attemptsRemaining: null,
};

/**
 * Clamp the admin-supplied numbers into a range that can actually be enforced.
 *
 * The settings API accepts any number for these two fields, and the naive
 * comparison is catastrophic at the bottom of the range: with `maxAttempts: 0`
 * the very first failure satisfies `attempts >= max` and every account in the
 * store locks on its first typo. So a value below one is read as "lockout
 * switched off" — the only reading that is both safe and useful, since the
 * settings screen offers no separate toggle. A missing or unparseable value
 * falls back to the schema default rather than to "off".
 */
export function normalizeLockoutPolicy(
  security:
    | { maxLoginAttempts?: unknown; lockoutDurationMinutes?: unknown }
    | undefined
    | null,
): LockoutPolicy {
  const rawAttempts = Number(security?.maxLoginAttempts);
  const maxAttempts = !Number.isFinite(rawAttempts)
    ? DEFAULT_LOCKOUT_POLICY.maxAttempts
    : rawAttempts < 1
      ? 0
      : Math.min(MAX_LOGIN_ATTEMPTS, Math.floor(rawAttempts));

  const rawMinutes = Number(security?.lockoutDurationMinutes);
  const lockoutMinutes = Number.isFinite(rawMinutes)
    ? Math.min(
        MAX_LOCKOUT_MINUTES,
        Math.max(MIN_LOCKOUT_MINUTES, Math.floor(rawMinutes)),
      )
    : DEFAULT_LOCKOUT_POLICY.lockoutMinutes;

  return { maxAttempts, lockoutMinutes };
}

/** The message shown to someone who is locked out. */
export function describeLockout(state: LockoutState): string {
  const minutes = Math.max(1, Math.ceil(state.retryAfterSeconds / 60));
  return `Too many failed sign-in attempts. Try again in ${minutes} minute${
    minutes === 1 ? "" : "s"
  }.`;
}

/**
 * `<email>|<ip>`. The separator assumes the address contains no `|` — RFC 5321
 * permits one inside a quoted local part, but no mail system in practice issues
 * such an address, and the only consequence would be an admin's unlock clearing
 * one neighbouring record.
 */
function identifierFor(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}|${ip.trim() || "unknown"}`;
}

async function resolveLockoutPolicy(): Promise<LockoutPolicy> {
  const settings = await getSettingsLean();
  return normalizeLockoutPolicy(settings.security);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

function remainingLock(lockedUntil: unknown): LockoutState {
  if (!lockedUntil) return UNLOCKED;
  const expiresAt = new Date(lockedUntil as string | Date).getTime();
  if (!Number.isFinite(expiresAt)) return UNLOCKED;

  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return UNLOCKED;
  return {
    locked: true,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
    attemptsRemaining: 0,
  };
}

/** Whether this email/IP pair is currently locked out. */
export async function getLoginLockout(
  email: string,
  ip: string,
): Promise<LockoutState> {
  await connectDB();
  const policy = await resolveLockoutPolicy();
  if (policy.maxAttempts < 1) return UNLOCKED;

  const record = await LoginAttempt.findOne({
    identifier: identifierFor(email, ip),
  })
    .select("lockedUntil")
    .lean<{ lockedUntil?: Date } | null>();

  return remainingLock(record?.lockedUntil);
}

/**
 * Count one failed sign-in, returning the lock it may have just triggered.
 *
 * The increment is a single atomic `$inc` rather than a read-modify-write: two
 * wrong passwords arriving together must both be counted, and the document's
 * own `attempts += 1; save()` helper would drop one of them.
 */
export async function recordFailedLogin(
  email: string,
  ip: string,
): Promise<LockoutState> {
  await connectDB();
  const policy = await resolveLockoutPolicy();
  if (policy.maxAttempts < 1) return UNLOCKED;

  const identifier = identifierFor(email, ip);
  const now = Date.now();

  const increment = () =>
    LoginAttempt.findOneAndUpdate(
      { identifier },
      { $inc: { attempts: 1 }, $set: { lastAttempt: new Date(now) } },
      // `returnDocument` rather than the `new` flag: Mongoose 9 deprecates the
      // latter and warns once per process. Matches `lib/rate-limit.ts`, which
      // is the same upsert-a-counter shape.
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    ).lean<{ attempts?: number } | null>();

  let record: { attempts?: number } | null;
  try {
    record = await increment();
  } catch (error) {
    // Two first-ever failures for the same identifier can race the upsert; the
    // unique index rejects the loser, whose retry now finds the document.
    if (!isDuplicateKeyError(error)) throw error;
    record = await increment();
  }

  const attempts = record?.attempts ?? 0;
  if (attempts < policy.maxAttempts) {
    const remaining = policy.maxAttempts - attempts;
    return {
      locked: false,
      retryAfterSeconds: 0,
      // Only once it is close enough to be worth saying. Far from the limit the
      // number is noise, and it is the near miss people need warning about.
      attemptsRemaining:
        remaining <= ATTEMPTS_WARNING_THRESHOLD ? remaining : null,
    };
  }

  // The counter resets alongside the lock so the next window opens with a full
  // budget — otherwise one failure after the lock expires would re-lock it, and
  // the account would never recover.
  await LoginAttempt.updateOne(
    { identifier },
    {
      $set: {
        attempts: 0,
        lockedUntil: new Date(now + policy.lockoutMinutes * 60_000),
      },
    },
  );

  return {
    locked: true,
    retryAfterSeconds: policy.lockoutMinutes * 60,
    attemptsRemaining: 0,
  };
}

/** Forget this pair's failures. Called on every successful sign-in. */
export async function clearLoginLockout(
  email: string,
  ip: string,
): Promise<void> {
  await connectDB();
  await LoginAttempt.deleteOne({ identifier: identifierFor(email, ip) });
}

/**
 * Lift every lock on an address, whichever host earned them.
 *
 * Without this the only way out of a lockout was to wait, which is fine for an
 * attacker and miserable for the merchant who mistyped their own password from
 * the shop floor. Admin-only, and it clears rather than shortens: a half-lifted
 * lock is a worse thing to explain than a cleared one.
 *
 * Matched as a key range rather than a regex — it rides the unique index, and
 * an address can never be read as a pattern.
 */
export async function clearLockoutsForEmail(email: string): Promise<number> {
  await connectDB();
  const normalized = email.trim().toLowerCase();
  if (!normalized) return 0;

  const result = await LoginAttempt.deleteMany({
    identifier: { $gte: `${normalized}|`, $lt: `${normalized}|￿` },
  });
  return result.deletedCount ?? 0;
}

/** Which hosts currently hold a live lock on this address. */
export async function listActiveLockouts(
  email: string,
): Promise<Array<{ ip: string; retryAfterSeconds: number }>> {
  await connectDB();
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  const records = await LoginAttempt.find({
    identifier: { $gte: `${normalized}|`, $lt: `${normalized}|￿` },
  })
    .select("identifier lockedUntil")
    .lean<Array<{ identifier: string; lockedUntil?: Date }>>();

  return records
    .map((record) => ({
      ip: record.identifier.slice(normalized.length + 1),
      state: remainingLock(record.lockedUntil),
    }))
    .filter((entry) => entry.state.locked)
    .map((entry) => ({
      ip: entry.ip,
      retryAfterSeconds: entry.state.retryAfterSeconds,
    }));
}
