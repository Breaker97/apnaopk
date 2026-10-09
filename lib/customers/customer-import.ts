import "server-only";

import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { CustomerProfile, User } from "@/models";
import { getSettings, type ISettings } from "@/models/settings.model";
import {
  MARKETING_CHANNEL,
  MARKETING_CONSENT_SOURCE,
  MARKETING_CONSENT_STATE,
  MARKETING_OPT_IN_LEVEL,
  type MarketingChannel,
  type MarketingConsentState,
} from "@/config/app.config";
import { isCountryAllowed } from "@/lib/intl/country-availability";
import { isPostcodeRequired } from "@/lib/shipping/address-verification";
import {
  getMarketingSuppressions,
  readEmailConsentState,
  setMarketingConsent,
} from "@/lib/customers/marketing-consent";
import {
  checkCustomerHeaders,
  normalizeCustomerRow,
  readCustomerCells,
  type CustomerColumnMap,
  type ImportMessage,
  type ImportedAddress,
  type NormalizedCustomerRow,
} from "@/lib/customers/customer-import-format";
import {
  createImportedAccount,
  createImportedPhoneGuest,
  CUSTOMER_PROFILE_FIELDS,
  findCustomersByEmail,
  mergeTags,
  type CustomerEmailMatch,
  type ProfileRow,
  type UserRow,
} from "@/lib/customers/customer-upsert";
import { afterResponse } from "@/lib/after-response";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import { ConflictError } from "@/lib/api/errors";
import type { ImportRunDefinition } from "@/lib/imports/import-run";

/**
 * The customer import, a few hundred rows at a time.
 *
 * The browser reads the file and sends its rows in order — first all of them
 * with `dryRun` for the preview, then the same rows for real — and every row
 * is read again here from its raw cells: the browser's reading is only ever a
 * preview of this one. A preview writes nothing at all.
 *
 * A customer is found by email, or by phone when the row has no email, so a
 * file imported twice matches its own customers the second time: they are
 * skipped, or updated when "Update existing customers" is on, and nothing is
 * created twice. Inside one file the last row for a customer wins, as in
 * Shopify — the browser holds the earlier ones back and reports them, and a
 * request that still carries two keeps the later one.
 *
 * What a run did is counted here, not in the browser, because the one
 * Activity Log row a run leaves has to be true.
 */

export interface CustomerImportOptions {
  updateExisting: boolean;
  /** Given to every customer the run creates or updates. */
  tag: string;
  /** Queue account invites for the customers the run creates, once it ends. */
  sendInvites: boolean;
}

export interface CustomerImportRowInput {
  /** The row number a spreadsheet shows; the header is row 1. */
  row: number;
  cells: string[];
}

export type CustomerImportRowStatus = "create" | "update" | "skip" | "error";

export interface CustomerImportRowResult {
  row: number;
  status: CustomerImportRowStatus;
  /** The email or phone the row was matched by, so the list can name it. */
  key?: string;
  /** Why a row was skipped or refused. */
  reason?: ImportMessage;
  /** What a created or updated row lost on the way in. */
  warnings?: ImportMessage[];
}

export interface CustomerImportCounts {
  create: number;
  update: number;
  skip: number;
  error: number;
}

export interface CustomerImportChunkResult {
  counts: CustomerImportCounts;
  /**
   * The rows worth a look: refused, skipped for a reason other than being a
   * customer already, or imported with something left out.
   */
  problems: CustomerImportRowResult[];
}

/** Customers written at once; enough to hide the round trips, few enough to be kind to the pool. */
const WRITE_CONCURRENCY = 8;

const LOCKED_CONSENT_STATES = new Set<MarketingConsentState>([
  MARKETING_CONSENT_STATE.UNSUBSCRIBED,
  MARKETING_CONSENT_STATE.INVALID,
  MARKETING_CONSENT_STATE.REDACTED,
]);

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** What the store's settings say about a row, read once per request. */
interface StoreRules {
  defaultCountry?: string;
  postcodeRequired: boolean;
  countryAvailability: unknown;
}

async function loadStoreRules(settings: ISettings): Promise<StoreRules> {
  return {
    defaultCountry:
      (settings.sms as { defaultCountry?: string } | undefined)?.defaultCountry ||
      settings.shipping?.origin?.country ||
      undefined,
    postcodeRequired: await isPostcodeRequired(settings),
    countryAvailability: settings.general?.countryAvailability,
  };
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

type ConsentWrite = { state: MarketingConsentState };

/**
 * What one channel's answer in the file does to the record. Consent only ever
 * moves the way the shopper themselves could have moved it:
 *
 *  - "yes" subscribes someone who has never answered, or answered no. Anyone
 *    who left the list, an address that bounced, an erased one, or an address
 *    that clicked "stop" in an email stays where they are — an old platform's
 *    tick is older than any of those. Someone still confirming a double
 *    opt-in is left to finish it.
 *  - "no" or blank writes "not subscribed" only where there is no answer on
 *    record yet, so the import never takes a subscriber off the list.
 *  - A column the file does not have changes nothing.
 */
function planConsent(
  channel: MarketingChannel,
  requested: boolean | null,
  profile: ProfileRow | null,
  suppressed: boolean,
): { write: ConsentWrite | null; warning?: ImportMessage } {
  if (requested === null) return { write: null };
  const record = channel === MARKETING_CHANNEL.EMAIL ? profile?.emailMarketing : profile?.smsMarketing;
  const current: MarketingConsentState = profile
    ? channel === MARKETING_CHANNEL.EMAIL
      ? readEmailConsentState(profile as Parameters<typeof readEmailConsentState>[0])
      : ((record?.state as MarketingConsentState | undefined) ?? MARKETING_CONSENT_STATE.NOT_SUBSCRIBED)
    : MARKETING_CONSENT_STATE.NOT_SUBSCRIBED;

  if (!requested) {
    const answered =
      Boolean(record?.consentUpdatedAt) || current !== MARKETING_CONSENT_STATE.NOT_SUBSCRIBED;
    return answered ? { write: null } : { write: { state: MARKETING_CONSENT_STATE.NOT_SUBSCRIBED } };
  }

  // The record's own answer first: it says which refusal this is.
  if (LOCKED_CONSENT_STATES.has(current)) {
    return {
      write: null,
      warning: {
        code: channel === MARKETING_CHANNEL.EMAIL ? "consent_kept" : "sms_consent_kept",
        params: { state: current },
      },
    };
  }
  // Subscribed already, or still confirming: nothing to add.
  if (current !== MARKETING_CONSENT_STATE.NOT_SUBSCRIBED) return { write: null };
  // "Stop emailing me" from someone who never subscribed lives on the
  // suppression list, not on their record.
  if (suppressed) {
    return { write: null, warning: { code: "consent_suppressed" } };
  }
  return { write: { state: MARKETING_CONSENT_STATE.SUBSCRIBED } };
}

async function writeConsent(params: {
  channel: MarketingChannel;
  write: ConsentWrite | null;
  profileId: Types.ObjectId;
  phone?: string;
  /** When the state was read: a change made after it wins over this one. */
  decidedAt: Date;
}) {
  if (!params.write) return;
  await setMarketingConsent({
    channel: params.channel,
    state: params.write.state,
    ...(params.write.state === MARKETING_CONSENT_STATE.SUBSCRIBED
      ? { optInLevel: MARKETING_OPT_IN_LEVEL.UNKNOWN }
      : {}),
    source: MARKETING_CONSENT_SOURCE.IMPORT,
    at: params.decidedAt,
    profileId: String(params.profileId),
    ...(params.channel === MARKETING_CHANNEL.SMS && params.phone ? { phone: params.phone } : {}),
  });
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

type ReadRow = {
  row: number;
  key?: string;
  reading: ReturnType<typeof normalizeCustomerRow>;
};

type PhoneMatch = { guest: ProfileRow | null; onAccount: boolean };

async function findPhoneCustomers(phones: string[]): Promise<Map<string, PhoneMatch>> {
  const matches = new Map<string, PhoneMatch>();
  if (phones.length === 0) return matches;
  const [guests, accounts] = await Promise.all([
    CustomerProfile.find({ isGuest: true, phone: { $in: phones } })
      .select(CUSTOMER_PROFILE_FIELDS)
      .lean<ProfileRow[]>(),
    User.find({ phone: { $in: phones } }).select("phone").lean<Array<{ phone?: string }>>(),
  ]);
  for (const phone of phones) {
    matches.set(phone, {
      guest: guests.find((row) => row.phone === phone) ?? null,
      onAccount: accounts.some((user) => user.phone === phone),
    });
  }
  return matches;
}

type Plan =
  | { kind: "error"; reason: ImportMessage }
  | { kind: "skip"; reason: ImportMessage }
  | { kind: "create-account"; value: NormalizedCustomerRow & { email: string } }
  | { kind: "create-phone-guest"; value: NormalizedCustomerRow & { phone: string } }
  | { kind: "update-account"; value: NormalizedCustomerRow; user: UserRow; profile: ProfileRow | null }
  | { kind: "update-row"; value: NormalizedCustomerRow; profile: ProfileRow };

const EXISTS: ImportMessage = { code: "exists" };

function planRow(
  value: NormalizedCustomerRow,
  emailMatch: CustomerEmailMatch | undefined,
  phoneMatch: PhoneMatch | undefined,
  options: CustomerImportOptions,
): Plan {
  if (value.email) {
    const match = emailMatch ?? { kind: "none" as const };
    switch (match.kind) {
      case "staff":
        return { kind: "error", reason: { code: "staff_account" } };
      case "account":
        if (!options.updateExisting) return { kind: "skip", reason: EXISTS };
        // An invited guest's account has no row of its own until they use the
        // link; their guest row is the one the list shows, so it is the one updated.
        return match.profile || !match.guestProfile
          ? { kind: "update-account", value, user: match.user, profile: match.profile }
          : { kind: "update-account", value, user: match.user, profile: match.guestProfile };
      case "guest":
        // Someone who bought as a guest is a customer already. Their row stays
        // a guest row until they prove the address; the import does not make
        // them an account.
        if (!options.updateExisting) return { kind: "skip", reason: EXISTS };
        return { kind: "update-row", value, profile: match.profile };
      default:
        return { kind: "create-account", value: value as NormalizedCustomerRow & { email: string } };
    }
  }

  const phone = value.phone as string;
  if (phoneMatch?.guest) {
    if (!options.updateExisting) return { kind: "skip", reason: EXISTS };
    return { kind: "update-row", value, profile: phoneMatch.guest };
  }
  // A number is typed, never proven, and households share one; a row with
  // nothing but a number that an account already carries is left alone
  // rather than made into a second customer.
  if (phoneMatch?.onAccount) return { kind: "skip", reason: { code: "phone_on_account" } };
  return { kind: "create-phone-guest", value: value as NormalizedCustomerRow & { phone: string } };
}

function addressKey(address: Record<string, unknown> | ImportedAddress | undefined | null): string {
  if (!address) return "";
  return ["street", "apartment", "city", "postalCode", "country"]
    .map((field) => String((address as Record<string, unknown>)[field] ?? "").trim().toLowerCase())
    .join("|");
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

interface WriteOutcome {
  status: CustomerImportRowStatus;
  reason?: ImportMessage;
  warnings: ImportMessage[];
  /** A created account, for the invitations sent when the run ends. */
  invitee?: { recordId: Types.ObjectId; userId: Types.ObjectId; email: string };
}

/** The profile fields an update sets; an empty cell keeps what is stored. */
function profileUpdates(
  value: NormalizedCustomerRow,
  profile: ProfileRow | null,
  tag: string,
): Record<string, unknown> {
  const set: Record<string, unknown> = {
    tags: mergeTags(profile?.tags, [...value.tags, tag]),
  };
  if (value.note) set.notes = value.note;
  if (value.address) set.shippingAddress = { ...value.address, isDefault: true, label: "home" };
  return set;
}

async function applyPlan(
  plan: Plan,
  options: CustomerImportOptions,
  suppressed: Set<string>,
  decidedAt: Date,
  dryRun: boolean,
): Promise<WriteOutcome> {
  if (plan.kind === "error") return { status: "error", reason: plan.reason, warnings: [] };
  if (plan.kind === "skip") return { status: "skip", reason: plan.reason, warnings: [] };

  const value = plan.value;
  const existing =
    plan.kind === "update-account" ? plan.profile : plan.kind === "update-row" ? plan.profile : null;
  const isSuppressed = Boolean(value.email && suppressed.has(value.email));
  const emailConsent = value.email
    ? planConsent(MARKETING_CHANNEL.EMAIL, value.acceptsEmailMarketing, existing, isSuppressed)
    : { write: null };
  const smsConsent = value.phone
    ? planConsent(MARKETING_CHANNEL.SMS, value.acceptsSmsMarketing, existing, false)
    : { write: null };
  const warnings = [emailConsent.warning, smsConsent.warning].filter(
    (warning): warning is ImportMessage => Boolean(warning),
  );
  // A guest row keyed by email has nowhere of its own for a number; it goes
  // on the address, and is lost when there is no address to put it on.
  if (plan.kind === "update-row" && plan.profile.email && value.phone && !value.address?.phone) {
    if (value.address) value.address.phone = value.phone;
    else warnings.push({ code: "phone_not_saved" });
  }

  const status: CustomerImportRowStatus = plan.kind.startsWith("create") ? "create" : "update";
  if (dryRun) return { status, warnings };

  const tag = options.tag;
  switch (plan.kind) {
    case "create-account": {
      let created: { userId: Types.ObjectId; profileId: Types.ObjectId };
      try {
        created = await createImportedAccount({
          name: value.name || plan.value.email.split("@")[0],
          email: plan.value.email,
          phone: value.phone,
          address: value.address,
          profile: {
            tags: mergeTags([], [...value.tags, tag]),
            notes: value.note,
            shippingAddress: value.address,
          },
        });
      } catch (error) {
        // Made by someone else between the lookup and now.
        if (error instanceof ConflictError) return { status: "skip", reason: EXISTS, warnings: [] };
        throw error;
      }
      await writeConsent({ channel: MARKETING_CHANNEL.EMAIL, write: emailConsent.write, profileId: created.profileId, decidedAt });
      await writeConsent({ channel: MARKETING_CHANNEL.SMS, write: smsConsent.write, profileId: created.profileId, phone: value.phone, decidedAt });
      return {
        status,
        warnings,
        invitee: { recordId: created.profileId, userId: created.userId, email: plan.value.email },
      };
    }
    case "create-phone-guest": {
      const profileId = await createImportedPhoneGuest({
        phone: plan.value.phone,
        name: value.name,
        tags: mergeTags([], [...value.tags, tag]),
        notes: value.note,
        shippingAddress: value.address,
      });
      if (!profileId) return { status: "skip", reason: EXISTS, warnings: [] };
      await writeConsent({ channel: MARKETING_CHANNEL.SMS, write: smsConsent.write, profileId, phone: value.phone, decidedAt });
      return { status, warnings };
    }
    case "update-account": {
      const userSet: Record<string, unknown> = {};
      if (value.name) userSet.name = value.name;
      if (value.phone) userSet.phone = value.phone;
      const userUpdate: Record<string, unknown> = {};
      if (Object.keys(userSet).length > 0) userUpdate.$set = userSet;
      const addresses = plan.user.addresses ?? [];
      if (value.address && !addresses.some((saved) => addressKey(saved) === addressKey(value.address))) {
        userUpdate.$push = {
          addresses: { ...value.address, isDefault: addresses.length === 0, label: "home" },
        };
      }
      if (Object.keys(userUpdate).length > 0) {
        await User.updateOne({ _id: plan.user._id }, userUpdate);
      }

      let profileId = plan.profile?._id;
      if (plan.profile) {
        const set = profileUpdates(value, plan.profile, tag);
        // The guest row an invited account has not claimed yet still shows the
        // shopper's name itself.
        if (plan.profile.isGuest && value.name) set.name = value.name;
        await CustomerProfile.updateOne({ _id: plan.profile._id }, { $set: set });
      } else {
        // An account whose row was never made: make it now, as an import would.
        const created = await CustomerProfile.findOneAndUpdate(
          { userId: plan.user._id },
          {
            $setOnInsert: {
              loyaltyPoints: 0,
              lifetimePoints: 0,
              loyaltyTier: "bronze",
              acquisitionSource: "import",
            },
            $set: profileUpdates(value, null, tag),
          },
          { upsert: true, returnDocument: "after" },
        ).lean<{ _id: Types.ObjectId }>();
        profileId = created?._id;
      }
      if (profileId) {
        await writeConsent({ channel: MARKETING_CHANNEL.EMAIL, write: emailConsent.write, profileId, decidedAt });
        await writeConsent({ channel: MARKETING_CHANNEL.SMS, write: smsConsent.write, profileId, phone: value.phone, decidedAt });
      }
      return { status, warnings };
    }
    case "update-row": {
      const set = profileUpdates(value, plan.profile, tag);
      if (value.name) set.name = value.name;
      await CustomerProfile.updateOne({ _id: plan.profile._id }, { $set: set });
      await writeConsent({ channel: MARKETING_CHANNEL.EMAIL, write: emailConsent.write, profileId: plan.profile._id, decidedAt });
      await writeConsent({ channel: MARKETING_CHANNEL.SMS, write: smsConsent.write, profileId: plan.profile._id, phone: value.phone, decidedAt });
      return { status, warnings };
    }
  }
}

// ---------------------------------------------------------------------------
// One request's rows
// ---------------------------------------------------------------------------

export class CustomerImportFileError extends Error {
  constructor(public readonly reason: ImportMessage) {
    super(reason.code);
  }
}

/**
 * Read, match and — unless `dryRun` — write one request's rows. Every row
 * gets an answer; a row that fails on the way in fails alone.
 */
export async function importCustomerRows(params: {
  headers: string[];
  rows: CustomerImportRowInput[];
  options: CustomerImportOptions;
  dryRun: boolean;
  settings?: ISettings;
}): Promise<{
  results: CustomerImportRowResult[];
  invitees: NonNullable<WriteOutcome["invitee"]>[];
}> {
  const header = checkCustomerHeaders(params.headers);
  if (!header.ok) throw new CustomerImportFileError(header.error);
  const map: CustomerColumnMap = header.map;

  await connectDB();
  const settings = params.settings ?? (await getSettings());
  const rules = await loadStoreRules(settings);
  const context = {
    hasEmailConsentColumn: map.columns.includes("acceptsEmailMarketing"),
    hasSmsConsentColumn: map.columns.includes("acceptsSmsMarketing"),
    defaultCountry: rules.defaultCountry,
    isCountryAllowed: (code: string) => isCountryAllowed(code, rules.countryAvailability),
    postcodeRequired: rules.postcodeRequired,
  };

  const read: ReadRow[] = params.rows.map(({ row, cells }) => {
    const reading = normalizeCustomerRow(readCustomerCells(map, cells), context);
    const key = reading.ok
      ? reading.value.email ?? reading.value.phone
      : undefined;
    return { row, key, reading };
  });

  // The last row for a customer wins; the browser holds the earlier ones back,
  // and this catches any that still arrive together.
  const lastRowByKey = new Map<string, number>();
  for (const entry of read) if (entry.key) lastRowByKey.set(entry.key, entry.row);

  // Read before the lookups: a consent change made after this moment is newer
  // than anything this import knew, and `setMarketingConsent` lets it win.
  const decidedAt = new Date();
  const values = read.flatMap((entry) =>
    entry.reading.ok && lastRowByKey.get(entry.key as string) === entry.row ? [entry.reading.value] : [],
  );
  const emails = values.flatMap((value) => (value.email ? [value.email] : []));
  const phones = values.flatMap((value) => (!value.email && value.phone ? [value.phone] : []));
  const subscribing = values.flatMap((value) =>
    value.email && value.acceptsEmailMarketing ? [value.email] : [],
  );
  const [emailMatches, phoneMatches, suppressions] = await Promise.all([
    findCustomersByEmail(emails),
    findPhoneCustomers(phones),
    getMarketingSuppressions(subscribing),
  ]);
  const suppressed = new Set(suppressions.keys());

  const invitees: NonNullable<WriteOutcome["invitee"]>[] = [];
  const results = await mapWithConcurrency(read, WRITE_CONCURRENCY, async (entry) => {
    const { row, key, reading } = entry;
    if (!reading.ok) return { row, status: "error" as const, reason: reading.error };
    const winner = lastRowByKey.get(key as string);
    if (winner !== row) {
      return { row, key, status: "skip" as const, reason: { code: "duplicate_in_file", params: { row: winner as number } } };
    }
    const value = reading.value;
    const plan = planRow(
      value,
      value.email ? emailMatches.get(value.email) : undefined,
      !value.email && value.phone ? phoneMatches.get(value.phone) : undefined,
      params.options,
    );
    try {
      const outcome = await applyPlan(plan, params.options, suppressed, decidedAt, params.dryRun);
      if (outcome.invitee) invitees.push(outcome.invitee);
      const warnings = [...reading.warnings, ...outcome.warnings];
      return {
        row,
        key,
        status: outcome.status,
        ...(outcome.reason ? { reason: outcome.reason } : {}),
        ...(warnings.length > 0 && (outcome.status === "create" || outcome.status === "update")
          ? { warnings }
          : {}),
      };
    } catch (error) {
      console.error(`Customer import: row ${row} failed:`, error);
      return { row, key, status: "error" as const, reason: { code: "write_failed" } };
    }
  });

  return { results, invitees };
}

export function summarizeRows(results: CustomerImportRowResult[]): CustomerImportChunkResult {
  const counts: CustomerImportCounts = { create: 0, update: 0, skip: 0, error: 0 };
  const problems: CustomerImportRowResult[] = [];
  for (const result of results) {
    counts[result.status]++;
    const quietSkip = result.status === "skip" && result.reason?.code === EXISTS.code;
    if (result.status === "error" || (result.status === "skip" && !quietSkip) || result.warnings?.length) {
      problems.push(result);
    }
  }
  return { counts, problems };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * What a customer import's run says and does at its end (the bookkeeping is
 * shared with the vendor import: lib/imports/import-run.ts). A finished run
 * with invitations asked for queues one Phase 1 batch for the accounts it
 * created; a stopped one sends none, and the run's tag finds those customers.
 */
export const CUSTOMER_IMPORT_RUN: ImportRunDefinition = {
  entity: "customer",
  audit: (run, { stopped, invitesQueued }) => {
    const { created, updated, skipped, failed } = run.counts;
    const options = run.options as Partial<CustomerImportOptions>;
    return {
      resource: "user",
      summary:
        `Imported customers from "${run.fileName}": ${created} created, ${updated} updated, ${skipped} skipped, ${failed} failed` +
        (stopped ? " — stopped before the end of the file" : "") +
        (invitesQueued > 0 ? `; ${invitesQueued} account invites queued` : ""),
      metadata: {
        tag: options.tag,
        updateExisting: options.updateExisting,
        sendInvites: options.sendInvites,
      },
    };
  },
  onFinish: async (run, invitees, { stopped }) => {
    // A stopped run sends none: the run's tag finds those customers later.
    if (stopped) return { invitesQueued: 0 };
    if (!(run.options as Partial<CustomerImportOptions>).sendInvites || invitees.length === 0) {
      return { invitesQueued: 0 };
    }
    const [{ enqueueAccountEmails, processAccountEmailJobs }, routing] = await Promise.all([
      import("@/lib/auth/account-email-queue"),
      getLocaleRouting(),
    ]);
    const { queued } = await enqueueAccountEmails({
      requestedBy: { id: String(run.requestedBy), email: run.requestedByEmail },
      source: "import",
      recipients: invitees.map((invitee) => ({
        profileId: String(invitee.recordId),
        userId: String(invitee.userId),
        email: invitee.email,
        // A customer from another platform has no language on record here.
        locale: routing.storeDefault,
      })),
      skippedAtStart: {},
    });
    afterResponse(() => processAccountEmailJobs());
    return { invitesQueued: queued };
  },
};
