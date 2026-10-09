import "server-only";

import { Types, type PipelineStage } from "mongoose";
import { connectDB } from "@/lib/db";
import { CustomerProfile, User } from "@/models";
import {
  AccountEmailJob,
  type AccountEmailSkipCounts,
  type AccountEmailSkipReason,
} from "@/models/account-email-job.model";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { isValidLocale } from "@/config/i18n.config";
import { isCustomerAccount } from "@/lib/access/customer-account";
import type { StaffAccessScope } from "@/lib/access/staff-scope";
import {
  recentAccountAccessEmails,
  resolveAccountAccessPurpose,
  type AccountAccessPurpose,
} from "@/lib/auth/account-access";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import {
  USER_LOOKUP,
  USER_UNWIND,
  buildAdminCustomerListConditions,
  matchStage,
  type AdminCustomerListFilter,
} from "@/lib/customers/customer-list";

/**
 * Who an account email from the customers screen goes to.
 *
 * The same answer for the confirm dialog's count (the dry run), the send
 * itself and the single-customer button, so the number an admin agrees to is
 * the number that goes out. Everyone left out is counted by reason.
 *
 * "Everyone matching" is rebuilt here from the list's own filter
 * (`buildAdminCustomerListConditions`), never from ids the browser sends: the
 * browser only has the page it is showing, and a staff member limited to some
 * sellers' customers must not reach the rest by posting ids.
 */

export interface AccountEmailRecipient {
  profileId: string;
  /** Absent for a guest with no account yet — the worker makes one. */
  userId?: string;
  email: string;
  /** The language the link opens in. */
  locale: string;
}

export interface AccountEmailRecipients {
  /** Customer rows the selection or filter covered. */
  matched: number;
  recipients: AccountEmailRecipient[];
  skipped: AccountEmailSkipCounts;
}

export type AccountEmailSelection =
  | { profileIds: string[] }
  | { filter: AdminCustomerListFilter };

type Row = {
  _id: Types.ObjectId;
  userId?: Types.ObjectId | null;
  email?: string;
  preferredLanguage?: string;
  user?: {
    _id?: Types.ObjectId;
    email?: string;
    role?: string;
    status?: string;
  } | null;
};

type Candidate = {
  profileId: string;
  userId?: string;
  email: string;
  preferredLanguage?: string;
};

type AccountState = {
  _id: Types.ObjectId;
  email?: string;
  role?: string;
  roles?: string[];
  status?: string;
};

/**
 * Why an account may not be sent one, or null when it may. A legacy account
 * with no status behaves as active, as everywhere else.
 */
export function accountEmailRefusal(
  user: { role?: string | null; roles?: string[] | null; status?: string | null },
): AccountEmailSkipReason | null {
  if (!isCustomerAccount(user)) return "nonCustomer";
  if (user.status === USER_ACCOUNT_STATUS.BANNED) return "banned";
  if (user.status && user.status !== USER_ACCOUNT_STATUS.ACTIVE) return "inactive";
  return null;
}

function addSkip(skipped: AccountEmailSkipCounts, reason: AccountEmailSkipReason) {
  skipped[reason] = (skipped[reason] ?? 0) + 1;
}

export async function resolveAccountEmailRecipients(
  selection: AccountEmailSelection,
  staffScope?: StaffAccessScope | null,
): Promise<AccountEmailRecipients> {
  await connectDB();

  const filter = "filter" in selection ? selection.filter : {};
  const { profileConditions, userConditions } =
    await buildAdminCustomerListConditions(filter, staffScope);
  if ("profileIds" in selection) {
    const ids = selection.profileIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    profileConditions.push({ _id: { $in: ids } });
  }

  const pipeline: PipelineStage[] = [];
  const profileMatch = matchStage(profileConditions);
  if (profileMatch) pipeline.push(profileMatch);
  pipeline.push(USER_LOOKUP, USER_UNWIND);
  const userMatch = matchStage(userConditions);
  if (userMatch) pipeline.push(userMatch);
  pipeline.push({
    $project: {
      userId: 1,
      email: 1,
      preferredLanguage: 1,
      "user._id": 1,
      "user.email": 1,
      "user.role": 1,
      "user.status": 1,
    },
  });

  const skipped: AccountEmailSkipCounts = {};
  const candidates: Candidate[] = [];
  const guests: Candidate[] = [];
  let matched = 0;

  for await (const row of CustomerProfile.aggregate<Row>(pipeline).cursor({
    batchSize: 500,
  })) {
    matched += 1;
    const profileId = String(row._id);
    if (row.userId) {
      // The list already leaves out the profiles of admins, sellers and
      // staff; a profile whose account is gone has no address to send to.
      const user = row.user;
      const email = user?.email?.trim().toLowerCase();
      if (!user?._id || !email) {
        addSkip(skipped, "noEmail");
        continue;
      }
      const refusal = accountEmailRefusal({
        role: user.role ?? USER_ROLES.CUSTOMER,
        status: user.status,
      });
      if (refusal) {
        addSkip(skipped, refusal);
        continue;
      }
      candidates.push({
        profileId,
        userId: String(user._id),
        email,
        preferredLanguage: row.preferredLanguage,
      });
      continue;
    }
    const email = row.email?.trim().toLowerCase();
    if (!email) {
      addSkip(skipped, "noEmail");
      continue;
    }
    guests.push({ profileId, email, preferredLanguage: row.preferredLanguage });
  }

  // A guest row whose address already has an account is that account's: the
  // email goes to it (and the row is folded into it once the link is used).
  // An address that belongs to a team member or a seller gets nothing.
  if (guests.length > 0) {
    const accounts = await User.find({
      email: { $in: guests.map((guest) => guest.email) },
    })
      .select("email role roles status")
      .lean<AccountState[]>();
    const byEmail = new Map(
      accounts.map((account) => [String(account.email).toLowerCase(), account]),
    );
    for (const guest of guests) {
      const account = byEmail.get(guest.email);
      if (account) {
        const refusal = accountEmailRefusal(account);
        if (refusal) {
          addSkip(skipped, refusal);
          continue;
        }
        guest.userId = String(account._id);
      }
      candidates.push(guest);
    }
  }

  // One email per person: an account row and the guest row it has not yet
  // absorbed share an address. The account row wins.
  const byAddress = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = byAddress.get(candidate.email);
    if (!existing) {
      byAddress.set(candidate.email, candidate);
      continue;
    }
    addSkip(skipped, "duplicate");
    if (!existing.userId && candidate.userId) byAddress.set(candidate.email, candidate);
  }

  const emails = Array.from(byAddress.keys());
  const [recent, queued, routing] = await Promise.all([
    recentAccountAccessEmails(emails),
    emails.length
      ? AccountEmailJob.distinct("email", {
          email: { $in: emails },
          status: { $in: ["pending", "processing"] },
        })
      : Promise.resolve([] as string[]),
    getLocaleRouting(),
  ]);
  const busy = new Set([...recent, ...(queued as string[])]);

  const recipients: AccountEmailRecipient[] = [];
  for (const candidate of byAddress.values()) {
    if (busy.has(candidate.email)) {
      addSkip(skipped, "recent");
      continue;
    }
    const wanted = String(candidate.preferredLanguage ?? "").toLowerCase();
    recipients.push({
      profileId: candidate.profileId,
      ...(candidate.userId ? { userId: candidate.userId } : {}),
      email: candidate.email,
      locale:
        isValidLocale(wanted) && routing.enabled.includes(wanted)
          ? wanted
          : routing.storeDefault,
    });
  }

  return { matched, recipients, skipped };
}

/**
 * The account an invitation to a guest is for. A guest row has no login, so
 * one is made — without a password, with the address unproven, and without a
 * customer row of its own: the guest row stays the customer's one row, and
 * becomes the account's when the link is used (`claimGuestCustomerData`).
 * An address that already has an account gets that account.
 */
export async function ensureGuestAccount(
  profileId: string,
): Promise<{ userId: string } | { refused: AccountEmailSkipReason | "missing" }> {
  await connectDB();
  if (!Types.ObjectId.isValid(profileId)) return { refused: "missing" };
  const profile = await CustomerProfile.findById(profileId)
    .select("userId email name phone")
    .lean<{
      userId?: Types.ObjectId | null;
      email?: string;
      name?: string;
      phone?: string;
    } | null>();
  if (!profile) return { refused: "missing" };
  if (profile.userId) return { userId: String(profile.userId) };

  const email = profile.email?.trim().toLowerCase();
  if (!email) return { refused: "noEmail" };

  const existing = await User.findOne({ email })
    .select("role roles status")
    .lean<AccountState | null>();
  if (existing) {
    const refusal = accountEmailRefusal(existing);
    return refusal ? { refused: refusal } : { userId: String(existing._id) };
  }

  const name = (profile.name?.trim() || email.split("@")[0] || "Customer").slice(0, 100);
  try {
    const user = await User.create({
      name,
      email,
      ...(profile.phone ? { phone: profile.phone } : {}),
      role: USER_ROLES.CUSTOMER,
      roles: [USER_ROLES.CUSTOMER],
      status: USER_ACCOUNT_STATUS.ACTIVE,
      emailVerified: false,
    });
    return { userId: String(user._id) };
  } catch (error) {
    // Another send made it a moment ago.
    if ((error as { code?: number } | null)?.code !== 11000) throw error;
    const raced = await User.findOne({ email }).select("role roles status").lean<AccountState | null>();
    if (!raced) throw error;
    const refusal = accountEmailRefusal(raced);
    return refusal ? { refused: refusal } : { userId: String(raced._id) };
  }
}

/**
 * Which button the customer page offers: "reset" for an account with a
 * password, "invite" for one without (a guest included), or none for a
 * customer no account email may go to — banned, inactive, a team member's or
 * seller's login, or a guest with no email address.
 */
export async function accountEmailOption(profile: {
  userId?: unknown;
  email?: string | null;
}): Promise<AccountAccessPurpose | null> {
  await connectDB();
  const linked =
    profile.userId && typeof profile.userId === "object" && "_id" in profile.userId
      ? String((profile.userId as { _id: unknown })._id)
      : profile.userId
        ? String(profile.userId)
        : null;
  const account = linked
    ? await User.findById(linked).select("role roles status").lean<AccountState | null>()
    : profile.email
      ? await User.findOne({ email: profile.email.trim().toLowerCase() })
          .select("role roles status")
          .lean<AccountState | null>()
      : null;
  if (linked && !account) return null;
  if (!account) return profile.email ? "invite" : null;
  if (accountEmailRefusal(account)) return null;
  return resolveAccountAccessPurpose(String(account._id));
}
