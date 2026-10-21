import "server-only";

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { User } from "@/models";
import type { UserPosPin } from "@/models/user.model";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { loadMerchantCashier, type MerchantCashier } from "@/lib/pos/offline-cashier";
import { registerVendorScope, type SessionUser } from "@/lib/pos/register-session";

/**
 * Cashier switching at the till.
 *
 * The register stays signed in as whoever opened it; a colleague takes over
 * by choosing their name and typing their register PIN. From then on the
 * till's sales, returns, refunds and drawer movements are theirs — stamped
 * with their id and allowed by their rights — until they switch back or the
 * switch runs out.
 *
 * The switch is a short-lived token signed with the auth secret, bound to the
 * signed-in session's account, carried in a strict cookie so every POS route
 * reads it without the till having to send it. A token from another account's
 * session, or a stale one, is ignored: the session user stands.
 *
 * A PIN is set by its owner, at the till, while signed in as themselves. Five
 * wrong tries lock it for five minutes. Switching needs the server (online).
 */

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const POS_OPERATOR_COOKIE = "pos_operator";
/** How long one switch lasts: a shift. */
export const POS_OPERATOR_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

const PIN_PATTERN = /^\d{4,8}$/;

export function posPinProblem(pin: string): string | null {
  if (!PIN_PATTERN.test(pin)) return "A PIN is 4 to 8 digits";
  if (/^(\d)\1+$/.test(pin)) return "Choose a PIN that is not one digit repeated";
  if ("0123456789".includes(pin) || "9876543210".includes(pin)) return "Choose a PIN that is not a run of digits";
  return null;
}

async function hashPin(pin: string, salt: Buffer): Promise<string> {
  return (await scrypt(pin, salt, 32)).toString("hex");
}

/** Set (or replace) the signed-in person's own register PIN. */
export async function setOwnPosPin(user: SessionUser, pin: string, now = new Date()): Promise<void> {
  // Only someone who can stand at a register has a use for a PIN.
  await registerVendorScope(user);
  const problem = posPinProblem(pin);
  if (problem) throw new ValidationError(problem);
  const salt = randomBytes(16);
  const posPin: UserPosPin = {
    hash: await hashPin(pin, salt),
    salt: salt.toString("hex"),
    setAt: now,
    failedAttempts: 0,
    lockedUntil: null,
  };
  await User.updateOne({ _id: user.id }, { $set: { posPin } });
}

/** Whether the signed-in person has a PIN yet. */
export async function hasPosPin(userId: string): Promise<boolean> {
  const row = await User.findById(userId).select("+posPin").lean<{ posPin?: UserPosPin } | null>();
  return Boolean(row?.posPin?.hash);
}

/** The people who can take over this till: this merchant's cashiers with a PIN. */
export async function listPosOperators(user: SessionUser): Promise<Array<{ id: string; name: string }>> {
  const vendorScope = await registerVendorScope(user);
  const rows = await User.find({ "posPin.hash": { $exists: true } })
    .select("_id")
    .limit(300)
    .lean<Array<{ _id: unknown }>>();
  const cashiers = await Promise.all(
    rows.map((row) => loadMerchantCashier(String(row._id), vendorScope, { requireActive: true })),
  );
  return cashiers
    .filter((cashier): cashier is MerchantCashier => Boolean(cashier))
    .map((cashier) => ({ id: cashier.id, name: cashier.name || cashier.email || "—" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function signingKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update("pos-operator-v1").digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function issueOperatorToken(params: { operatorId: string; sessionUserId: string; now?: Date }): {
  token: string;
  expiresAt: Date;
} {
  const expiresAt = new Date((params.now ?? new Date()).getTime() + POS_OPERATOR_TTL_MS);
  const payload = Buffer.from(
    JSON.stringify({ o: params.operatorId, s: params.sessionUserId, e: expiresAt.getTime() }),
  ).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

/** The operator a token names, when it is genuine, unexpired and this session's. */
export function readOperatorToken(token: string | null | undefined, sessionUserId: string, now = new Date()): string | null {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { o?: string; s?: string; e?: number };
    if (data.s !== sessionUserId || typeof data.e !== "number" || data.e <= now.getTime() || !data.o) return null;
    return data.o;
  } catch {
    return null;
  }
}

/**
 * Check a colleague's PIN and hand back who they are. Refused for anyone who
 * is not this merchant's cashier, and while the PIN is locked.
 */
export async function verifyOperatorPin(params: {
  user: SessionUser;
  operatorId: string;
  pin: string;
  now?: Date;
}): Promise<MerchantCashier> {
  const now = params.now ?? new Date();
  const vendorScope = await registerVendorScope(params.user);
  const cashier = await loadMerchantCashier(params.operatorId, vendorScope, { requireActive: true });
  // One answer for "no such cashier" and "wrong PIN": the list is public at the till.
  const refused = () => new AuthorizationError("That PIN is not right");
  if (!cashier) throw refused();
  const row = await User.findById(cashier.id).select("+posPin").lean<{ posPin?: UserPosPin } | null>();
  const pin = row?.posPin;
  if (!pin?.hash) throw refused();
  if (pin.lockedUntil && new Date(pin.lockedUntil).getTime() > now.getTime()) {
    throw new AuthorizationError("Too many wrong PINs. Try again in a few minutes.");
  }
  const given = Buffer.from(await hashPin(String(params.pin || ""), Buffer.from(pin.salt, "hex")), "hex");
  const stored = Buffer.from(pin.hash, "hex");
  const matches = given.length === stored.length && timingSafeEqual(given, stored);
  if (!matches) {
    const failed = Number(pin.failedAttempts || 0) + 1;
    await User.updateOne(
      { _id: cashier.id },
      failed >= MAX_FAILED_ATTEMPTS
        ? { $set: { "posPin.failedAttempts": 0, "posPin.lockedUntil": new Date(now.getTime() + LOCK_MS) } }
        : { $set: { "posPin.failedAttempts": failed } },
    );
    throw refused();
  }
  if (pin.failedAttempts || pin.lockedUntil) {
    await User.updateOne({ _id: cashier.id }, { $set: { "posPin.failedAttempts": 0, "posPin.lockedUntil": null } });
  }
  return cashier;
}

type CookieReader = { get(name: string): { value: string } | undefined };

/**
 * Who is working the till: the switched-in colleague when the request carries
 * a genuine switch that still stands, else the signed-in user. Every POS route
 * that stamps a person or checks a right asks this.
 */
export async function resolvePosOperator<U extends SessionUser & { name?: string | null; email?: string | null }>(
  sessionUser: U,
  cookies: CookieReader,
): Promise<U | { id: string; role?: string; roles?: string[]; name?: string; email?: string; switched: true }> {
  const operatorId = readOperatorToken(cookies.get(POS_OPERATOR_COOKIE)?.value, sessionUser.id);
  if (!operatorId || operatorId === sessionUser.id) return sessionUser;
  const vendorScope = await registerVendorScope(sessionUser);
  const cashier = await loadMerchantCashier(operatorId, vendorScope, { requireActive: true });
  if (!cashier) return sessionUser;
  return {
    id: cashier.id,
    role: cashier.role,
    roles: cashier.roles,
    name: cashier.name,
    email: cashier.email,
    switched: true,
  };
}
