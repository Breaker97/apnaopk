import { randomBytes } from "crypto";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { CustomerProfile, MarketingSuppression, User } from "@/models";
import {
  createEmailUnsubscribeToken,
  readEmailUnsubscribeToken,
} from "@/lib/customers/unsubscribe-token";
import {
  MARKETING_CHANNEL,
  MARKETING_CONSENT_SOURCE,
  MARKETING_CONSENT_STATE,
  MARKETING_OPT_IN_LEVEL,
  type MarketingChannel,
  type MarketingConsentSource,
  type MarketingConsentState,
  type MarketingOptInLevel,
} from "@/config/app.config";

/**
 * The one way marketing consent is written.
 *
 * Before this, three places set `marketingOptIn` directly — the checkout, the
 * shopper's own preferences page and the admin customer form — and each had
 * its own idea of what the tick-box meant. A checkout could only ever turn it
 * on (so a shopper who unsubscribed was re-subscribed by nothing more than
 * their next order untouching the box), nothing recorded WHEN or from where,
 * and a guest who later registered lost the answer entirely.
 *
 * Everything that changes consent now comes through `setMarketingConsent`,
 * which owns three rules the callers kept getting wrong:
 *
 *  1. **The newest change wins.** Every record carries `consentUpdatedAt`, and
 *     a write dated before the stored one is dropped. That is what makes a
 *     guest row and an account row mergeable without choosing a "winner" by
 *     hand, and what stops a slow webhook from undoing a later click.
 *  2. **`unsubscribed` means "was subscribed and left".** Asking to
 *     unsubscribe someone who never subscribed leaves them `not_subscribed` —
 *     the distinction is the whole point of having states instead of a flag.
 *  3. **`invalid` and `redacted` are the system's.** A bounce, a spam report
 *     or an erasure is not something an admin toggle or a checkout may undo.
 *  4. **Asking for a confirmation never un-confirms.** `pending` is a request
 *     to become a subscriber, so it leaves a record that already is one
 *     untouched. A double opt-in checkout by a shopper already on the list
 *     used to move them back to `pending` — off the list until they clicked
 *     yet another confirmation email.
 *
 * The legacy `marketingOptIn` boolean is kept in step on every write, so code
 * that still reads it (and stores that have not run the migration) behave.
 */

const HISTORY_LIMIT = 20;

type ConsentField = "emailMarketing" | "smsMarketing";

interface SetMarketingConsentParams {
  /** Defaults to email — the only channel the checkout asks about today. */
  channel?: MarketingChannel;
  state: MarketingConsentState;
  optInLevel?: MarketingOptInLevel;
  source: MarketingConsentSource;
  /** When the shopper acted. Defaults to now; pass the real time when replaying. */
  at?: Date;

  // Identity: the first of these that resolves is used.
  profileId?: string | null;
  userId?: string | null;
  guestEmail?: string | null;
  /** E.164, for an SMS consent on a row already carrying that number. */
  phone?: string | null;

  // Provenance, all optional.
  sourceOrderId?: string | null;
  sourceCountry?: string | null;
  ip?: string | null;

  /**
   * Create the customer row when there is none. A checkout does (the shopper
   * is about to become a customer); an admin edit or an unsubscribe link does
   * not — those act on a row that already exists.
   */
  createIfMissing?: boolean;
}

export interface MarketingConsentResult {
  applied: boolean;
  /** The state the record is in after the call, applied or not. */
  state: MarketingConsentState;
  /**
   * The state it was in before, when there was a record to read. Tells a
   * caller whether this call is what moved it — a confirmation email is owed
   * once, on the way into `pending`, not on every retry of the same checkout.
   */
  previousState?: MarketingConsentState;
  reason?:
    | "stale"
    | "locked"
    | "already-subscribed"
    | "no-identity"
    | "not-found"
    | "conflict";
}

interface StoredConsent {
  state?: MarketingConsentState;
  optInLevel?: MarketingOptInLevel;
  consentUpdatedAt?: Date | null;
  confirmedAt?: Date | null;
}

/** The slice of a customer row a consent decision is made from. */
type ConsentProfileRow = {
  _id: Types.ObjectId;
  emailMarketing?: StoredConsent;
  smsMarketing?: StoredConsent;
  /** The pre-record boolean — see `readEmailConsentState`. */
  marketingOptIn?: boolean;
  unsubscribeToken?: string;
};

const LOCKED_STATES: MarketingConsentState[] = [
  MARKETING_CONSENT_STATE.INVALID,
  MARKETING_CONSENT_STATE.REDACTED,
];

function fieldFor(channel: MarketingChannel): ConsentField {
  return channel === MARKETING_CHANNEL.SMS ? "smsMarketing" : "emailMarketing";
}

/** E.164 as the caller resolved it; this only trims and sanity-checks. */
function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\+[1-9]\d{6,15}$/.test(trimmed) ? trimmed : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function buildIdentityFilter(
  params: SetMarketingConsentParams,
  field: ConsentField,
): Record<string, unknown> | null {
  const profileId = String(params.profileId || "");
  if (profileId && Types.ObjectId.isValid(profileId)) {
    return { _id: new Types.ObjectId(profileId) };
  }
  const userId = String(params.userId || "");
  if (userId && Types.ObjectId.isValid(userId)) {
    return { userId: new Types.ObjectId(userId) };
  }
  const email = normalizeEmail(params.guestEmail);
  if (email) return { isGuest: true, email };
  // A shopper who gave a phone number and no email has no other identity: the
  // row is keyed on the number itself, the way a guest's is keyed on their
  // address. Only for SMS, which is the only consent such a shopper can give.
  const phone = normalizePhone(params.phone);
  if (phone && field === "smsMarketing") return { isGuest: true, phone };
  return null;
}

/**
 * The state a record ends in, given where it is and what was asked for.
 * Returns null when the change must not be applied at all.
 */
function resolveNextState(
  current: MarketingConsentState,
  requested: MarketingConsentState,
  source: MarketingConsentSource,
): MarketingConsentState | null {
  if (
    LOCKED_STATES.includes(current) &&
    source !== MARKETING_CONSENT_SOURCE.SYSTEM
  ) {
    return null;
  }
  if (
    requested === MARKETING_CONSENT_STATE.UNSUBSCRIBED &&
    current === MARKETING_CONSENT_STATE.NOT_SUBSCRIBED
  ) {
    // Never subscribed, so there is nothing to leave.
    return MARKETING_CONSENT_STATE.NOT_SUBSCRIBED;
  }
  return requested;
}

function resolveOptInLevel(
  state: MarketingConsentState,
  requested: MarketingOptInLevel | undefined,
  stored: MarketingOptInLevel | undefined,
): MarketingOptInLevel | undefined {
  if (requested) return requested;
  if (state === MARKETING_CONSENT_STATE.PENDING) {
    return MARKETING_OPT_IN_LEVEL.CONFIRMED;
  }
  if (state === MARKETING_CONSENT_STATE.SUBSCRIBED) {
    return stored ?? MARKETING_OPT_IN_LEVEL.SINGLE;
  }
  return stored;
}

function newUnsubscribeToken(): string {
  return randomBytes(24).toString("hex");
}

/**
 * Apply a consent change. Safe to call with a state the record is already in —
 * that refreshes the provenance without adding a history entry.
 */
export async function setMarketingConsent(
  params: SetMarketingConsentParams,
  attempt = 0,
): Promise<MarketingConsentResult> {
  const channel = params.channel ?? MARKETING_CHANNEL.EMAIL;
  const field = fieldFor(channel);
  const filter = buildIdentityFilter(params, field);
  if (!filter) {
    return {
      applied: false,
      state: MARKETING_CONSENT_STATE.NOT_SUBSCRIBED,
      reason: "no-identity",
    };
  }

  await connectDB();
  const at = params.at ?? new Date();

  let profile = await CustomerProfile.findOne(filter)
    .select(`${field} marketingOptIn unsubscribeToken`)
    .lean<ConsentProfileRow>();

  if (!profile) {
    if (!params.createIfMissing) {
      return {
        applied: false,
        state: MARKETING_CONSENT_STATE.NOT_SUBSCRIBED,
        reason: "not-found",
      };
    }
    const email = normalizeEmail(params.guestEmail);
    const userId = String(params.userId || "");
    const phone = field === "smsMarketing" ? normalizePhone(params.phone) : null;
    // Only an identity a row can be keyed on may be created.
    if (!email && !phone && !(userId && Types.ObjectId.isValid(userId))) {
      return {
        applied: false,
        state: MARKETING_CONSENT_STATE.NOT_SUBSCRIBED,
        reason: "no-identity",
      };
    }
    await CustomerProfile.updateOne(
      filter,
      {
        $setOnInsert: {
          loyaltyPoints: 0,
          lifetimePoints: 0,
          loyaltyTier: "bronze",
          lastActiveAt: at,
        },
      },
      { upsert: true },
    );
    profile = await CustomerProfile.findOne(filter)
      .select(`${field} marketingOptIn unsubscribeToken`)
      .lean<ConsentProfileRow>();
    if (!profile) {
      return {
        applied: false,
        state: MARKETING_CONSENT_STATE.NOT_SUBSCRIBED,
        reason: "not-found",
      };
    }
  }

  const stored: StoredConsent =
    (field === "emailMarketing" ? profile.emailMarketing : profile.smsMarketing) ??
    {};
  // An email record written before the consent record existed carries only
  // the boolean; read as "not subscribed" it would be treated as someone who
  // never joined — an unsubscribe filed as not_subscribed, a double opt-in
  // checkout taking a subscriber off the list.
  const currentState =
    field === "emailMarketing"
      ? readEmailConsentState(profile)
      : (stored.state ?? MARKETING_CONSENT_STATE.NOT_SUBSCRIBED);
  const storedAt = stored.consentUpdatedAt
    ? new Date(stored.consentUpdatedAt)
    : null;

  if (storedAt && at.getTime() < storedAt.getTime()) {
    return {
      applied: false,
      state: currentState,
      previousState: currentState,
      reason: "stale",
    };
  }

  // Rule 4: already a subscriber, so there is nothing left to confirm.
  if (
    params.state === MARKETING_CONSENT_STATE.PENDING &&
    currentState === MARKETING_CONSENT_STATE.SUBSCRIBED
  ) {
    return {
      applied: false,
      state: currentState,
      previousState: currentState,
      reason: "already-subscribed",
    };
  }

  const nextState = resolveNextState(currentState, params.state, params.source);
  if (!nextState) {
    return {
      applied: false,
      state: currentState,
      previousState: currentState,
      reason: "locked",
    };
  }

  const optInLevel = resolveOptInLevel(
    nextState,
    params.optInLevel,
    stored.optInLevel,
  );

  const set: Record<string, unknown> = {
    [`${field}.state`]: nextState,
    [`${field}.consentUpdatedAt`]: at,
    [`${field}.source`]: params.source,
  };
  if (optInLevel) set[`${field}.optInLevel`] = optInLevel;
  if (params.sourceOrderId) set[`${field}.sourceOrderId`] = params.sourceOrderId;
  if (params.sourceCountry) set[`${field}.sourceCountry`] = params.sourceCountry;
  if (params.ip) set[`${field}.ip`] = params.ip;
  if (field === "smsMarketing" && params.phone) {
    set["smsMarketing.phone"] = params.phone.trim();
  }
  if (
    nextState === MARKETING_CONSENT_STATE.SUBSCRIBED &&
    optInLevel === MARKETING_OPT_IN_LEVEL.CONFIRMED &&
    !stored.confirmedAt
  ) {
    set[`${field}.confirmedAt`] = at;
  }
  // The boolean the rest of the codebase still reads.
  if (field === "emailMarketing") {
    set.marketingOptIn = nextState === MARKETING_CONSENT_STATE.SUBSCRIBED;
  }
  // A shopper on the list needs a way off it, and mail already sent keeps the
  // token it was sent with — so mint once, never rotate.
  if (
    !profile.unsubscribeToken &&
    (nextState === MARKETING_CONSENT_STATE.SUBSCRIBED ||
      nextState === MARKETING_CONSENT_STATE.PENDING)
  ) {
    set.unsubscribeToken = newUnsubscribeToken();
  }

  const update: Record<string, unknown> = { $set: set };
  if (nextState !== currentState) {
    update.$push = {
      marketingConsentHistory: {
        $each: [
          {
            channel,
            state: nextState,
            ...(optInLevel ? { optInLevel } : {}),
            at,
            source: params.source,
            ...(params.sourceOrderId
              ? { sourceOrderId: params.sourceOrderId }
              : {}),
          },
        ],
        $slice: -HISTORY_LIMIT,
      },
    };
  }

  // Guarded on the timestamp this decision was made against: a concurrent
  // change re-runs the decision rather than overwriting it. `null` matches a
  // record that has never been written, which is the common case.
  const result = await CustomerProfile.updateOne(
    { _id: profile._id, [`${field}.consentUpdatedAt`]: storedAt ?? null },
    update,
  );

  if (result.matchedCount === 0) {
    if (attempt >= 1) {
      return {
        applied: false,
        state: currentState,
        previousState: currentState,
        reason: "conflict",
      };
    }
    return setMarketingConsent(params, attempt + 1);
  }

  return { applied: true, state: nextState, previousState: currentState };
}

/**
 * The email consent state of a profile, for rows written before the record
 * existed: those carry only the boolean, and reading them as "not subscribed"
 * would quietly drop every subscriber a store had until the migration runs.
 */
export function readEmailConsentState(profile: {
  emailMarketing?: { state?: MarketingConsentState | null } | null;
  marketingOptIn?: boolean | null;
}): MarketingConsentState {
  const state = profile?.emailMarketing?.state;
  if (state) return state;
  return profile?.marketingOptIn
    ? MARKETING_CONSENT_STATE.SUBSCRIBED
    : MARKETING_CONSENT_STATE.NOT_SUBSCRIBED;
}

/**
 * The Mongo filter for one email consent state, written so it also matches
 * rows still carrying only the old boolean — before the migration runs, every
 * subscriber a store has looks like an unwritten record.
 */
export function emailConsentStateFilter(
  state: MarketingConsentState,
): Record<string, unknown> {
  if (state === MARKETING_CONSENT_STATE.SUBSCRIBED) {
    return {
      $or: [
        { "emailMarketing.state": MARKETING_CONSENT_STATE.SUBSCRIBED },
        { "emailMarketing.state": { $exists: false }, marketingOptIn: true },
      ],
    };
  }
  if (state === MARKETING_CONSENT_STATE.NOT_SUBSCRIBED) {
    return {
      $or: [
        { "emailMarketing.state": MARKETING_CONSENT_STATE.NOT_SUBSCRIBED },
        {
          "emailMarketing.state": { $exists: false },
          marketingOptIn: { $ne: true },
        },
      ],
    };
  }
  return { "emailMarketing.state": state };
}

/**
 * The email consent state of each address given, whoever holds it — the guest
 * row keyed by the address, or the profile of the account registered with it.
 *
 * Marketing is addressed to an inbox, not to a customer id, so the question
 * "may we email this address" has to be answerable from the address alone.
 * Where both a guest row and an account profile exist for one address, the
 * newer record wins, exactly as it does everywhere else.
 */
export async function getEmailConsentStates(
  emails: string[],
): Promise<Map<string, MarketingConsentState>> {
  const records = await readEmailConsentRecords(emails);
  return new Map(
    Array.from(records, ([email, record]) => [email, record.state]),
  );
}

type EmailConsentRecord = {
  state: MarketingConsentState;
  /** `consentUpdatedAt` in ms; 0 for a row that predates the record. */
  at: number;
};

function uniqueEmails(emails: string[]): string[] {
  return Array.from(
    new Set(emails.map((email) => normalizeEmail(email)).filter(Boolean)),
  ) as string[];
}

/** `getEmailConsentStates`, keeping when each answer was given. */
async function readEmailConsentRecords(
  emails: string[],
): Promise<Map<string, EmailConsentRecord>> {
  const wanted = uniqueEmails(emails);
  const states = new Map<string, EmailConsentRecord>();
  if (wanted.length === 0) return states;

  await connectDB();
  const users = await User.find({ email: { $in: wanted } })
    .select("_id email")
    .lean<{ _id: Types.ObjectId; email: string }[]>();
  const emailByUserId = new Map(
    users.map((user) => [String(user._id), normalizeEmail(user.email) ?? ""]),
  );

  const profiles = await CustomerProfile.find({
    $or: [
      { isGuest: true, email: { $in: wanted } },
      ...(users.length > 0
        ? [{ userId: { $in: users.map((user) => user._id) } }]
        : []),
    ],
  })
    .select("email userId emailMarketing marketingOptIn")
    .lean<
      {
        email?: string;
        userId?: Types.ObjectId;
        emailMarketing?: StoredConsent;
        marketingOptIn?: boolean;
      }[]
    >();

  for (const profile of profiles) {
    const email =
      normalizeEmail(profile.email) ||
      emailByUserId.get(String(profile.userId)) ||
      "";
    if (!email) continue;
    const at = profile.emailMarketing?.consentUpdatedAt
      ? new Date(profile.emailMarketing.consentUpdatedAt).getTime()
      : 0;
    if (states.has(email) && (states.get(email)?.at ?? 0) >= at) continue;
    states.set(email, { state: readEmailConsentState(profile), at });
  }
  return states;
}

/** Why marketing to an address must not be sent — see `getMarketingSuppressions`. */
export type MarketingSuppressionReason =
  | typeof MARKETING_CONSENT_STATE.UNSUBSCRIBED
  | typeof MARKETING_CONSENT_STATE.INVALID
  | typeof MARKETING_CONSENT_STATE.REDACTED
  | typeof MARKETING_CONSENT_STATE.PENDING;

/**
 * The addresses marketing must not go to, each with the reason: they left the
 * list, the address itself is dead, or — under double opt-in — they have not
 * confirmed yet. `pending` is the one that is easy to miss: the shopper ticked
 * the box, so every other signal says yes, and sending before the confirmation
 * link is opened is exactly what double opt-in exists to prevent.
 *
 * "Left" is read from two places. A customer record that went `unsubscribed`,
 * and a `MarketingSuppression` — the refusal of someone with no record, or
 * with one that could only ever say "not subscribed". The suppression stands
 * until they subscribe AFTER it; nothing else outranks a click on "stop".
 *
 * A shopper with no record and no suppression is not suppressed: deciding
 * whether they may be mailed is the caller's business (the recovery sweep
 * asks about consent); this only blocks a refusal or an unfinished one.
 */
export async function getMarketingSuppressions(
  emails: string[],
): Promise<Map<string, MarketingSuppressionReason>> {
  const wanted = uniqueEmails(emails);
  const result = new Map<string, MarketingSuppressionReason>();
  if (wanted.length === 0) return result;

  await connectDB();
  const [records, rows] = await Promise.all([
    readEmailConsentRecords(wanted),
    MarketingSuppression.find({ email: { $in: wanted } })
      .select("email suppressedAt")
      .lean<{ email?: string; suppressedAt?: Date }[]>(),
  ]);

  const suppressedAt = new Map<string, number>();
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const at = row.suppressedAt ? new Date(row.suppressedAt).getTime() : 0;
    // Two rows for one address (a store without the unique index): the
    // latest click is the one a later subscription has to be newer than.
    suppressedAt.set(email, Math.max(suppressedAt.get(email) ?? 0, at));
  }

  for (const email of wanted) {
    const record = records.get(email);
    const state = record?.state;
    // The system's verdicts first: the more specific reason, and never
    // outranked by anything a shopper does.
    if (
      state === MARKETING_CONSENT_STATE.INVALID ||
      state === MARKETING_CONSENT_STATE.REDACTED
    ) {
      result.set(email, state);
      continue;
    }
    const clickedAt = suppressedAt.get(email);
    if (clickedAt !== undefined) {
      const subscribedSince =
        state === MARKETING_CONSENT_STATE.SUBSCRIBED &&
        (record?.at ?? 0) > clickedAt;
      if (!subscribedSince) {
        result.set(email, MARKETING_CONSENT_STATE.UNSUBSCRIBED);
        continue;
      }
    }
    if (
      state === MARKETING_CONSENT_STATE.UNSUBSCRIBED ||
      state === MARKETING_CONSENT_STATE.PENDING
    ) {
      result.set(email, state);
    }
  }
  return result;
}

/** `getMarketingSuppressions` for one address. */
export async function isMarketingSuppressed(email: string): Promise<boolean> {
  const suppressions = await getMarketingSuppressions([email]);
  return suppressions.has(normalizeEmail(email) ?? "");
}

/**
 * Suppress an address the mail server rejected outright, or that reported the
 * store as spam. Written as the system, so no admin toggle or checkout can
 * quietly un-suppress it; the address has to be fixed, not re-ticked.
 */
export async function suppressEmailAddress(params: {
  email: string;
  reason?: string;
}): Promise<MarketingConsentResult> {
  const email = normalizeEmail(params.email);
  if (!email) {
    return {
      applied: false,
      state: MARKETING_CONSENT_STATE.NOT_SUBSCRIBED,
      reason: "no-identity",
    };
  }

  await connectDB();
  const user = await User.findOne({ email })
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();

  return setMarketingConsent({
    state: MARKETING_CONSENT_STATE.INVALID,
    source: MARKETING_CONSENT_SOURCE.SYSTEM,
    ...(user ? { userId: String(user._id) } : { guestEmail: email }),
  });
}

/**
 * The unsubscribe token for an address, minting one if the customer record
 * has none yet. Null when no customer record exists for the address at all —
 * nothing has been consented to, and inventing a row to hold a token would
 * put a shopper in the customer list for having abandoned a checkout.
 */
export async function ensureUnsubscribeTokenForEmail(
  rawEmail: string,
): Promise<string | null> {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  await connectDB();
  const user = await User.findOne({ email })
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();
  const filter = user ? { userId: user._id } : { isGuest: true, email };

  const profile = await CustomerProfile.findOne(filter)
    .select("unsubscribeToken")
    .lean<{ _id: Types.ObjectId; unsubscribeToken?: string } | null>();
  if (!profile) return null;
  if (profile.unsubscribeToken) return profile.unsubscribeToken;

  const token = newUnsubscribeToken();
  await CustomerProfile.updateOne(
    { _id: profile._id, unsubscribeToken: { $exists: false } },
    { $set: { unsubscribeToken: token } },
  );
  const saved = await CustomerProfile.findById(profile._id)
    .select("unsubscribeToken")
    .lean<{ unsubscribeToken?: string } | null>();
  return saved?.unsubscribeToken ?? null;
}

/** The customer an unsubscribe link belongs to, or null for a stale token. */
export async function findProfileByUnsubscribeToken(token: string) {
  const trimmed = typeof token === "string" ? token.trim() : "";
  if (!/^[a-f0-9]{16,128}$/i.test(trimmed)) return null;
  await connectDB();
  const profile = await CustomerProfile.findOne({ unsubscribeToken: trimmed })
    .select("_id email userId emailMarketing marketingOptIn")
    .lean<{
      _id: Types.ObjectId;
      email?: string;
      userId?: Types.ObjectId;
      emailMarketing?: StoredConsent;
      marketingOptIn?: boolean;
    } | null>();
  if (!profile || profile.email || !profile.userId) return profile;

  // An account's profile does not carry the address — its User does — and the
  // unsubscribe routes need it to stop the recovery emails already scheduled
  // for that inbox. Without it a registered shopper who unsubscribed kept a
  // ladder whose every rung the next sweeps spent, and the admin's list said
  // "failed" where it should have said "unsubscribed".
  const user = await User.findById(profile.userId)
    .select("email")
    .lean<{ email?: string } | null>();
  return { ...profile, email: normalizeEmail(user?.email) ?? undefined };
}

type UnsubscribeProfile = NonNullable<
  Awaited<ReturnType<typeof findProfileByUnsubscribeToken>>
>;

/** The customer record an address belongs to, the way the lookups above find it. */
async function findProfileForEmail(
  email: string,
): Promise<UnsubscribeProfile | null> {
  await connectDB();
  const user = await User.findOne({ email })
    .select("_id")
    .lean<{ _id: Types.ObjectId } | null>();
  const profile = await CustomerProfile.findOne(
    user ? { userId: user._id } : { isGuest: true, email },
  )
    .select("_id email userId emailMarketing marketingOptIn")
    .lean<UnsubscribeProfile | null>();
  return profile ? { ...profile, email } : null;
}

/**
 * The token for the unsubscribe link in a marketing email to this address:
 * the customer record's own where there is a record, and a sealed one carrying
 * the address where there is not — which is most people an abandoned checkout
 * reminds, and until now they got no link at all. Null only for something
 * that is not an address, or a server with no auth secret.
 */
export async function unsubscribeTokenForEmail(
  rawEmail: string,
): Promise<string | null> {
  const stored = await ensureUnsubscribeTokenForEmail(rawEmail);
  if (stored) return stored;
  return createEmailUnsubscribeToken(rawEmail);
}

/**
 * Whose unsubscribe link this is: the address, and its customer record when
 * it has one. Null for a token that is neither kind.
 *
 * A sealed token is matched to a record by address at the moment it is used,
 * not when it was sent: someone who has placed an order since has a record
 * now, and their click belongs on it.
 */
async function resolveUnsubscribeToken(
  token: string,
): Promise<{ email: string; profile: UnsubscribeProfile | null } | null> {
  const sealedEmail = readEmailUnsubscribeToken(token);
  if (sealedEmail) {
    return { email: sealedEmail, profile: await findProfileForEmail(sealedEmail) };
  }
  const profile = await findProfileByUnsubscribeToken(token);
  if (!profile) return null;
  return { email: normalizeEmail(profile.email) ?? "", profile };
}

/**
 * What the unsubscribe page should say about an address: its record's state,
 * unless a click on "stop" says more. A record that never joined reads
 * `not_subscribed` either way, and only the suppression tells "has not asked
 * to stop" from "asked to stop".
 */
async function effectiveUnsubscribeState(
  email: string,
  profile: UnsubscribeProfile | null,
): Promise<MarketingConsentState> {
  const state = profile
    ? readEmailConsentState(profile)
    : MARKETING_CONSENT_STATE.NOT_SUBSCRIBED;
  if (
    !email ||
    state === MARKETING_CONSENT_STATE.INVALID ||
    state === MARKETING_CONSENT_STATE.REDACTED
  ) {
    return state;
  }
  const suppression = (await getMarketingSuppressions([email])).get(email);
  return suppression === MARKETING_CONSENT_STATE.UNSUBSCRIBED
    ? MARKETING_CONSENT_STATE.UNSUBSCRIBED
    : state;
}

/** The unsubscribe page's reading of a link, or null for one that is not. */
export async function getUnsubscribePageState(
  token: string,
): Promise<{ email: string; state: MarketingConsentState } | null> {
  const resolved = await resolveUnsubscribeToken(token);
  if (!resolved) return null;
  return {
    email: resolved.email,
    state: await effectiveUnsubscribeState(resolved.email, resolved.profile),
  };
}

/**
 * What an unsubscribe link does when it is used — from the page's button, or
 * from the mailbox's own one-click button.
 *
 * Leaving writes two things. The customer record, where there is one, goes to
 * `unsubscribed` (a subscriber who left), and a suppression is written for the
 * address whatever the record says. A record can only say `not_subscribed` for
 * someone who never joined, and a store that sends checkout reminders to
 * everyone reads that as "may be mailed" — so before this, the one link those
 * shoppers had told them "You are unsubscribed" and changed nothing, and their
 * next abandoned checkout mailed them again.
 *
 * Coming back undoes exactly that: the suppression goes, and a record that was
 * a subscriber's is a subscriber's again. One that never joined stays as it
 * was — taking back an unsubscribe is not signing up for the newsletter.
 *
 * Returns the address and the state the page should now show, or null for a
 * token that is not one. Stopping the recovery ladders already running is the
 * caller's (`stopRecoveryLadderForEmail`), which this module cannot import.
 */
export async function applyUnsubscribeLink(params: {
  token: string;
  subscribe?: boolean;
}): Promise<{ email: string; state: MarketingConsentState } | null> {
  const resolved = await resolveUnsubscribeToken(params.token);
  if (!resolved) return null;
  const { email, profile } = resolved;
  await connectDB();

  if (params.subscribe) {
    if (
      profile &&
      readEmailConsentState(profile) === MARKETING_CONSENT_STATE.UNSUBSCRIBED
    ) {
      await setMarketingConsent({
        profileId: String(profile._id),
        state: MARKETING_CONSENT_STATE.SUBSCRIBED,
        optInLevel: MARKETING_OPT_IN_LEVEL.SINGLE,
        source: MARKETING_CONSENT_SOURCE.UNSUBSCRIBE_LINK,
      });
    }
    if (email) await MarketingSuppression.deleteMany({ email });
  } else {
    if (profile) {
      await setMarketingConsent({
        profileId: String(profile._id),
        state: MARKETING_CONSENT_STATE.UNSUBSCRIBED,
        source: MARKETING_CONSENT_SOURCE.UNSUBSCRIBE_LINK,
      });
    }
    if (email) {
      await MarketingSuppression.updateOne(
        { email },
        {
          $set: {
            suppressedAt: new Date(),
            source: MARKETING_CONSENT_SOURCE.UNSUBSCRIBE_LINK,
          },
        },
        { upsert: true },
      ).catch((error: { code?: number }) => {
        // Two clicks at once, and the other one wrote it.
        if (error?.code !== 11000) throw error;
      });
    }
  }

  const after = await resolveUnsubscribeToken(params.token);
  return {
    email,
    state: await effectiveUnsubscribeState(email, after?.profile ?? null),
  };
}
