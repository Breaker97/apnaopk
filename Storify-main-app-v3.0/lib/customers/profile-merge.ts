import {
  MARKETING_CONSENT_STATE,
  MARKETING_OPT_IN_LEVEL,
} from "@/config/app.config";

/**
 * Folding a retiring guest customer row into the account that claims it.
 *
 * Its own module, with no database imports, because the rule it encodes — what
 * a guest hands over and what the account keeps — is worth testing directly
 * and worth reading without the loyalty machinery around it.
 */

export type ProfileLike = Record<string, unknown>;

interface ConsentLike {
  state?: string;
  consentUpdatedAt?: Date | string | null;
  [key: string]: unknown;
}

function consentTime(record: ConsentLike | undefined): number {
  return record?.consentUpdatedAt
    ? new Date(record.consentUpdatedAt as Date).getTime()
    : 0;
}

/**
 * The email consent as a record, including rows written before the record
 * existed — those carry the boolean alone, and reading them as "no consent"
 * would drop a subscriber on the way into their new account.
 */
function emailConsentOf(profile: ProfileLike): ConsentLike | undefined {
  const record = profile.emailMarketing as ConsentLike | undefined;
  if (record?.state) return record;
  return profile.marketingOptIn
    ? {
        state: MARKETING_CONSENT_STATE.SUBSCRIBED,
        optInLevel: MARKETING_OPT_IN_LEVEL.UNKNOWN,
      }
    : undefined;
}

const POSITIVE_CONSENT_STATES: string[] = [
  MARKETING_CONSENT_STATE.SUBSCRIBED,
  MARKETING_CONSENT_STATE.PENDING,
];

/**
 * Of two consent records, the one that stands: the newer by
 * `consentUpdatedAt`. Where neither is dated — a legacy boolean on one side,
 * the empty record the signup hook just created on the other — an actual
 * subscription beats a blank.
 */
function pickConsent(
  account: ConsentLike | undefined,
  guest: ConsentLike | undefined,
): ConsentLike | undefined {
  if (!guest) return account;
  if (!account) return guest;
  const accountAt = consentTime(account);
  const guestAt = consentTime(guest);
  if (guestAt !== accountAt) return guestAt > accountAt ? guest : account;
  if (
    POSITIVE_CONSENT_STATES.includes(String(guest.state)) &&
    !POSITIVE_CONSENT_STATES.includes(String(account.state))
  ) {
    return guest;
  }
  return account;
}

/**
 * What a retiring guest row hands to the account profile that absorbs it.
 *
 * The merge used to take the loyalty balance and nothing else, then delete the
 * row — so a shopper who ticked "email me with news and offers" at a guest
 * checkout and opened an account afterwards silently became a non-subscriber,
 * because the signup hook had already created a blank profile for the account
 * and the blank one is the row that survived. Tags an admin had put on the
 * guest, their notes, and the address they checked out with went the same way.
 *
 * Only fields the account has not answered for itself are carried; consent is
 * decided by date, the same rule every other consent write follows.
 */
export function carryGuestProfileForward(
  guest: ProfileLike,
  account: ProfileLike,
): Record<string, unknown> {
  const set: Record<string, unknown> = {};

  const email = pickConsent(emailConsentOf(account), emailConsentOf(guest));
  if (email && email !== account.emailMarketing) {
    set.emailMarketing = email;
    set.marketingOptIn = email.state === MARKETING_CONSENT_STATE.SUBSCRIBED;
  }

  const sms = pickConsent(
    account.smsMarketing as ConsentLike | undefined,
    guest.smsMarketing as ConsentLike | undefined,
  );
  if (sms && sms !== account.smsMarketing) set.smsMarketing = sms;

  // Links in mail already sent have to keep working, so an account with no
  // token of its own inherits the guest's rather than minting a new one.
  if (!account.unsubscribeToken && guest.unsubscribeToken) {
    set.unsubscribeToken = guest.unsubscribeToken;
  }

  const history = [
    ...((account.marketingConsentHistory as unknown[]) || []),
    ...((guest.marketingConsentHistory as unknown[]) || []),
  ]
    .filter(Boolean)
    .sort((a, b) => {
      const at = new Date((a as { at?: Date }).at ?? 0).getTime();
      const bt = new Date((b as { at?: Date }).at ?? 0).getTime();
      return at - bt;
    })
    .slice(-20);
  if (history.length > ((account.marketingConsentHistory as unknown[]) || []).length) {
    set.marketingConsentHistory = history;
  }

  const accountTags = Array.isArray(account.tags) ? (account.tags as string[]) : [];
  const guestTags = Array.isArray(guest.tags) ? (guest.tags as string[]) : [];
  const mergedTags = Array.from(new Set([...accountTags, ...guestTags]));
  if (mergedTags.length > accountTags.length) set.tags = mergedTags;

  const accountNotes = typeof account.notes === "string" ? account.notes.trim() : "";
  const guestNotes = typeof guest.notes === "string" ? guest.notes.trim() : "";
  if (guestNotes && !accountNotes.includes(guestNotes)) {
    set.notes = accountNotes ? `${accountNotes}\n\n${guestNotes}` : guestNotes;
  }

  // Everything else is filled in only where the account said nothing.
  for (const key of [
    "acquisitionSource",
    "preferredPaymentMethod",
    "preferredCurrency",
    "preferredLanguage",
    "sizePreferences",
    "shippingAddress",
  ] as const) {
    if (account[key] === undefined || account[key] === null) {
      if (guest[key] !== undefined && guest[key] !== null) set[key] = guest[key];
    }
  }
  const accountCategories = Array.isArray(account.preferredCategories)
    ? (account.preferredCategories as unknown[])
    : [];
  const guestCategories = Array.isArray(guest.preferredCategories)
    ? (guest.preferredCategories as unknown[])
    : [];
  if (accountCategories.length === 0 && guestCategories.length > 0) {
    set.preferredCategories = guestCategories;
  }

  return set;
}
