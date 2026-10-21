import "server-only";

import { Types } from "mongoose";
import { USER_ROLES } from "@/config/app.config";
import { CustomerProfile, User } from "@/models";
import { ValidationError } from "@/lib/api/errors";
import { sanitizeSearchString } from "@/lib/api/validate";
import { normalizePhoneNumber } from "@/lib/sms/phone";
import { normalizeGuestEmail } from "@/lib/customers/customer";

/**
 * Who the till can ring a sale up for.
 *
 * Two kinds of record, because the store has two kinds of customer:
 *
 * - **account** — a `User` with the customer role. What the till has always
 *   attached: the sale is filed under them (`Order.customerId`).
 * - **guest** — a guest `CustomerProfile` (the Shopify-model record behind
 *   guest checkout): one row per email, or per phone number for a shopper who
 *   gave no email. A guest has no `User`, so the sale stays filed under the
 *   cashier (the walk-in shape every `customerId` reader expects) and carries
 *   the guest on `posCustomerProfileId` / `posCustomerName` instead.
 *
 * The phone-only guest is the point: a walk-in known only by their number used
 * to be impossible to record, because creating a customer at the till demanded
 * an email.
 */

export type POSCustomerKind = "account" | "guest";

export interface POSCustomerRecord {
  _id: string;
  kind: POSCustomerKind;
  name: string;
  email?: string;
  phone?: string;
  image?: string;
}

/** Store settings the phone rule reads: where a local number belongs. */
export interface POSPhoneSettings {
  sms?: { defaultCountry?: string | null } | null;
  shipping?: { origin?: { country?: string | null } | null } | null;
}

export function normalizePOSPhone(
  raw: unknown,
  settings: POSPhoneSettings | null | undefined,
): string | undefined {
  return normalizePhoneNumber(raw, {
    defaultCountry:
      settings?.sms?.defaultCountry || settings?.shipping?.origin?.country,
  });
}

const SEARCH_LIMIT = 10;

/**
 * Accounts and guests matching what the cashier typed, accounts first.
 *
 * Customers only: without the role filter a cashier could type a common name
 * and enumerate the store's admin and vendor accounts. A phone number is also
 * tried in E.164, because a guest's number is stored that way while a
 * cashier types it the way it is printed.
 */
export async function searchPOSCustomers(
  rawSearch: string,
  settings: POSPhoneSettings | null | undefined,
): Promise<POSCustomerRecord[]> {
  const term = rawSearch.trim();
  if (term.length < 2) return [];
  const search = sanitizeSearchString(term);
  const e164 = normalizePOSPhone(term, settings);

  const accountConditions: Record<string, unknown>[] = [
    { name: { $regex: search, $options: "i" } },
    { email: { $regex: search, $options: "i" } },
    { phone: { $regex: search, $options: "i" } },
  ];
  if (e164) accountConditions.push({ phone: e164 });

  const guestConditions: Record<string, unknown>[] = [
    { name: { $regex: search, $options: "i" } },
    { email: { $regex: search, $options: "i" } },
    { phone: { $regex: search, $options: "i" } },
  ];
  if (e164) guestConditions.push({ phone: e164 });

  const [accounts, guests] = await Promise.all([
    User.find({ role: USER_ROLES.CUSTOMER, $or: accountConditions })
      .select("name email phone image")
      .limit(SEARCH_LIMIT)
      .lean<Array<{ _id: unknown; name?: string; email?: string; phone?: string; image?: string }>>(),
    CustomerProfile.find({ isGuest: true, $or: guestConditions })
      .select("name email phone")
      .limit(SEARCH_LIMIT)
      .lean<Array<{ _id: unknown; name?: string; email?: string; phone?: string }>>(),
  ]);

  const results: POSCustomerRecord[] = accounts.map((user) => ({
    _id: String(user._id),
    kind: "account",
    name: user.name || user.email || "",
    email: user.email || undefined,
    phone: user.phone || undefined,
    image: user.image || undefined,
  }));
  for (const guest of guests) {
    if (results.length >= SEARCH_LIMIT) break;
    results.push({
      _id: String(guest._id),
      kind: "guest",
      name: guest.name || guest.phone || guest.email || "",
      email: guest.email || undefined,
      phone: guest.phone || undefined,
    });
  }
  return results;
}

/**
 * Add a customer from the till.
 *
 * With an email: the account the till has always created (or the existing
 * one, returned rather than refused). With only a phone number: the account
 * that already has that number, if there is one, else a guest record keyed by
 * the number in E.164 — one per number, so a second sale finds the first.
 */
export async function createPOSCustomer(params: {
  name?: string;
  email?: string;
  phone?: string;
  settings: POSPhoneSettings | null | undefined;
}): Promise<{ customer: POSCustomerRecord; created: boolean }> {
  const name = String(params.name ?? "").trim();
  const email = String(params.email ?? "").trim().toLowerCase();
  const rawPhone = String(params.phone ?? "").trim();

  if (!name) throw new ValidationError("Customer name is required");
  if (!email && !rawPhone) {
    throw new ValidationError("Enter an email or a phone number for the customer");
  }

  const phone = rawPhone ? normalizePOSPhone(rawPhone, params.settings) : undefined;
  if (rawPhone && !phone) {
    throw new ValidationError("Enter a valid phone number, with the country code if it is not local");
  }

  if (email) {
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      throw new ValidationError("Enter a valid email address");
    }
    const existing = await User.findOne({ email })
      .select("name email phone image role")
      .lean<{ _id: unknown; name?: string; email?: string; phone?: string; image?: string; role?: string } | null>();
    if (existing) {
      // A staff or vendor account with that email is not a customer the till
      // may file a sale under — the order route refuses it too.
      if (existing.role !== USER_ROLES.CUSTOMER) {
        throw new ValidationError("That email belongs to a store account, not a customer");
      }
      return { customer: toAccount(existing), created: false };
    }
    const user = await User.create({
      name,
      email,
      phone: phone || rawPhone || undefined,
      emailVerified: false,
    });
    return { customer: toAccount(user.toObject()), created: true };
  }

  // Phone only. An account that already carries this number is the customer.
  const account = await User.findOne({
    role: USER_ROLES.CUSTOMER,
    phone: { $in: [phone, rawPhone].filter((value): value is string => Boolean(value)) },
  })
    .select("name email phone image")
    .lean<{ _id: unknown; name?: string; email?: string; phone?: string; image?: string } | null>();
  if (account) return { customer: toAccount(account), created: false };

  const before = await CustomerProfile.findOne({ isGuest: true, phone })
    .select("_id")
    .lean();
  const guest = await CustomerProfile.findOneAndUpdate(
    { isGuest: true, phone },
    {
      $set: { name, lastActiveAt: new Date() },
      $setOnInsert: {
        loyaltyPoints: 0,
        lifetimePoints: 0,
        loyaltyTier: "bronze",
      },
    },
    { upsert: true, new: true },
  )
    .select("name email phone")
    .lean<{ _id: unknown; name?: string; email?: string; phone?: string }>();

  return {
    customer: {
      _id: String(guest._id),
      kind: "guest",
      name: guest.name || name,
      email: guest.email || undefined,
      phone: guest.phone || phone,
    },
    created: !before,
  };
}

/**
 * The guest a sale is being rung up for, checked on the server.
 *
 * Only a guest row: an account is attached by `customerId`, never through
 * here, so a crafted body cannot use this to file a sale under a User.
 */
export async function loadPOSGuestCustomer(
  profileId: unknown,
): Promise<{ _id: Types.ObjectId; name: string; email?: string; phone?: string }> {
  const id = String(profileId ?? "");
  const profile = Types.ObjectId.isValid(id)
    ? await CustomerProfile.findOne({ _id: id, isGuest: true })
        .select("name email phone")
        .lean<{ _id: Types.ObjectId; name?: string; email?: string; phone?: string } | null>()
    : null;
  if (!profile) throw new ValidationError("Customer not found");
  return {
    _id: profile._id,
    name: profile.name || profile.phone || profile.email || "",
    email: normalizeGuestEmail(profile.email) || undefined,
    phone: profile.phone || undefined,
  };
}

function toAccount(user: {
  _id: unknown;
  name?: string;
  email?: string;
  phone?: string;
  image?: string;
}): POSCustomerRecord {
  return {
    _id: String(user._id),
    kind: "account",
    name: user.name || user.email || "",
    email: user.email || undefined,
    phone: user.phone || undefined,
    image: user.image || undefined,
  };
}
