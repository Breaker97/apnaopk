import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import { CustomerProfile, User } from "@/models";
import { USER_ACCOUNT_STATUS, USER_ROLES } from "@/config/app.config";
import { ApiError, ConflictError } from "@/lib/api/errors";
import { isCustomerAccount } from "@/lib/access/customer-account";
import {
  claimGuestCustomerData,
  computeLoyaltyTier,
  ensureCustomerProfile,
} from "@/lib/customers/customer";
import { isLoyaltyEnabled } from "@/lib/customers/loyalty";
import { auditCreate, type AuditContext } from "@/lib/audit";
import { notifyAdminsNewCustomer } from "@/lib/notifications/notifications";
import { MAX_NOTE_LENGTH } from "@/lib/customers/customer-import-format";
import type { ISettings } from "@/models/settings.model";

/**
 * Making a customer, in one place: the admin's "Add customer", a vendor's
 * "create customer" on its order form, and the customer import.
 *
 * Each of them used to write the User and its customer row by hand, and none
 * looked first for the guest row a shopper's checkout had already left under
 * the same email — so the shopper who had bought as a guest appeared twice in
 * the list, and only one of the two rows had their orders. Now:
 *
 *  - An email that belongs to an account is refused here, as before; an
 *    admin's, a team member's or a seller's login above all, because a
 *    customer screen must never re-point one of those.
 *  - An email with only a guest row behind it becomes an account that keeps
 *    that row. The orders under the email move with it (`claimGuestCustomerData`),
 *    which is the one place the store vouches for an address the shopper has
 *    not proven: the person who will get into the account still has to open
 *    the emailed link, since it has no password.
 *  - The import goes its own way for that second case — a guest row there is
 *    an existing customer, skipped or updated like any other — and asks this
 *    module only for the account itself, without the stats pass and without
 *    a notice to the admins for every row of a file.
 */

type AccountStatus = (typeof USER_ACCOUNT_STATUS)[keyof typeof USER_ACCOUNT_STATUS];

export interface CustomerAddressInput {
  firstName?: string;
  lastName?: string;
  street: string;
  city: string;
  state?: string;
  apartment?: string;
  postalCode?: string;
  country: string;
  phone?: string;
  label?: "home" | "work" | "other";
}

export type ProfileRow = {
  _id: Types.ObjectId;
  userId?: Types.ObjectId | null;
  isGuest?: boolean;
  email?: string;
  phone?: string;
  name?: string;
  tags?: string[];
  notes?: string;
  loyaltyPoints?: number;
  lifetimePoints?: number;
  acquisitionSource?: string;
  shippingAddress?: Record<string, unknown> | null;
  emailMarketing?: { state?: string; consentUpdatedAt?: Date | null } | null;
  smsMarketing?: { state?: string; consentUpdatedAt?: Date | null; phone?: string } | null;
  marketingOptIn?: boolean;
  preferredLanguage?: string;
};

export type UserRow = {
  _id: Types.ObjectId;
  name?: string;
  email: string;
  phone?: string;
  role?: string;
  roles?: string[];
  status?: string;
  addresses?: Array<Record<string, unknown>>;
};

/** What an email already is in this store. */
export type CustomerEmailMatch =
  | { kind: "none" }
  /** An admin's, team member's or seller's login. */
  | { kind: "staff"; user: UserRow }
  /**
   * A shopper's account. `profile` is its customer row; `guestProfile` is an
   * older guest row under the same email that the account has not claimed
   * yet — the one row the list shows for an invited guest.
   */
  | { kind: "account"; user: UserRow; profile: ProfileRow | null; guestProfile: ProfileRow | null }
  /** Only a guest row: someone who bought without an account. */
  | { kind: "guest"; profile: ProfileRow };

export const CUSTOMER_PROFILE_FIELDS =
  "userId isGuest email phone name tags notes loyaltyPoints lifetimePoints acquisitionSource shippingAddress emailMarketing smsMarketing marketingOptIn preferredLanguage";

const USER_FIELDS = "name email phone role roles status addresses";

/**
 * Every email's match in three indexed reads, however many emails — the
 * import asks this for a few hundred rows at a time.
 */
export async function findCustomersByEmail(
  emails: readonly string[],
): Promise<Map<string, CustomerEmailMatch>> {
  const wanted = Array.from(new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean)));
  const matches = new Map<string, CustomerEmailMatch>();
  if (wanted.length === 0) return matches;
  await connectDB();

  const [users, guestRows] = await Promise.all([
    User.find({ email: { $in: wanted } }).select(USER_FIELDS).lean<UserRow[]>(),
    CustomerProfile.find({ isGuest: true, email: { $in: wanted } })
      .select(CUSTOMER_PROFILE_FIELDS)
      .lean<ProfileRow[]>(),
  ]);
  const accountRows = users.length
    ? await CustomerProfile.find({ userId: { $in: users.map((user) => user._id) } })
        .select(CUSTOMER_PROFILE_FIELDS)
        .lean<ProfileRow[]>()
    : [];

  const guestByEmail = new Map(guestRows.map((row) => [String(row.email), row]));
  const profileByUser = new Map(accountRows.map((row) => [String(row.userId), row]));

  for (const email of wanted) {
    const user = users.find((candidate) => candidate.email === email);
    if (user) {
      matches.set(
        email,
        isCustomerAccount(user)
          ? {
              kind: "account",
              user,
              profile: profileByUser.get(String(user._id)) ?? null,
              guestProfile: guestByEmail.get(email) ?? null,
            }
          : { kind: "staff", user },
      );
      continue;
    }
    const guest = guestByEmail.get(email);
    matches.set(email, guest ? { kind: "guest", profile: guest } : { kind: "none" });
  }
  return matches;
}

export async function findCustomerByEmail(email: string): Promise<CustomerEmailMatch> {
  const normalized = email.trim().toLowerCase();
  return (await findCustomersByEmail([normalized])).get(normalized) ?? { kind: "none" };
}

/** Tags already on the row first, then the new ones it lacks — never a replacement. */
export function mergeTags(existing: readonly string[] | undefined, added: readonly string[]): string[] {
  const tags = [...(existing ?? [])];
  const seen = new Set(tags.map((tag) => tag.toLowerCase()));
  for (const tag of added) {
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    tags.push(trimmed);
  }
  return tags;
}

/**
 * A note written when the row already had one goes underneath it: a guest's
 * old note is the store's own record of them, not something to overwrite.
 */
export function appendNote(existing: string | undefined, added: string | undefined): string | undefined {
  const before = existing?.trim();
  const note = added?.trim();
  if (!note) return before || undefined;
  if (!before || before === note) return note.slice(0, MAX_NOTE_LENGTH);
  return `${before}\n\n${note}`.slice(0, MAX_NOTE_LENGTH);
}

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 11000;
}

/**
 * The account an admin, a vendor or an import makes: a shopper's login with
 * no password. The person gets in through the emailed link that sets one
 * (an account invite), which is also what proves the address.
 */
async function createPasswordlessUser(input: {
  name: string;
  email: string;
  phone?: string;
  address?: CustomerAddressInput;
  status?: AccountStatus;
}) {
  try {
    return await User.create({
      name: input.name,
      email: input.email,
      phone: input.phone || undefined,
      addresses: input.address
        ? [
            {
              ...input.address,
              // Blank, not absent, where the country has none: the account's
              // address book types it as text.
              postalCode: input.address.postalCode ?? "",
              isDefault: true,
              label: input.address.label || "home",
            },
          ]
        : [],
      role: USER_ROLES.CUSTOMER,
      roles: [USER_ROLES.CUSTOMER],
      status: input.status || USER_ACCOUNT_STATUS.ACTIVE,
      emailVerified: false,
    });
  } catch (error) {
    // Someone made it a moment ago — the same answer as finding it first.
    if (isDuplicateKey(error)) throw new ConflictError("A user with this email already exists");
    throw error;
  }
}

/**
 * The import's account: a User and a fresh customer row, written straight —
 * no stats pass (a new account has no orders to count) and no word to the
 * admins. Undone when its row cannot be written, so a failure leaves no
 * account without a row behind it.
 */
export async function createImportedAccount(input: {
  name: string;
  email: string;
  phone?: string;
  address?: CustomerAddressInput;
  profile: {
    tags: string[];
    notes?: string;
    shippingAddress?: CustomerAddressInput;
  };
}): Promise<{ userId: Types.ObjectId; profileId: Types.ObjectId }> {
  await connectDB();
  const user = await createPasswordlessUser(input);
  try {
    const profile = await CustomerProfile.create({
      userId: user._id,
      loyaltyPoints: 0,
      lifetimePoints: 0,
      loyaltyTier: "bronze",
      acquisitionSource: "import",
      tags: input.profile.tags,
      ...(input.profile.notes ? { notes: input.profile.notes } : {}),
      ...(input.profile.shippingAddress
        ? { shippingAddress: { ...input.profile.shippingAddress, isDefault: true, label: "home" } }
        : {}),
    });
    return { userId: user._id, profileId: profile._id };
  } catch (error) {
    await User.deleteOne({ _id: user._id }).catch(() => undefined);
    throw error;
  }
}

/** A customer row for a shopper known only by a phone number. */
export async function createImportedPhoneGuest(input: {
  phone: string;
  name?: string;
  tags: string[];
  notes?: string;
  shippingAddress?: CustomerAddressInput;
}): Promise<Types.ObjectId | null> {
  await connectDB();
  try {
    const profile = await CustomerProfile.create({
      isGuest: true,
      phone: input.phone,
      ...(input.name ? { name: input.name } : {}),
      loyaltyPoints: 0,
      lifetimePoints: 0,
      loyaltyTier: "bronze",
      acquisitionSource: "import",
      tags: input.tags,
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.shippingAddress
        ? { shippingAddress: { ...input.shippingAddress, isDefault: true, label: "home" } }
        : {}),
    });
    return profile._id;
  } catch (error) {
    // The same number made a moment ago: it is an existing customer now.
    if (isDuplicateKey(error)) return null;
    throw error;
  }
}

export interface AdminCustomerInput {
  name: string;
  email: string;
  phone?: string;
  status?: AccountStatus;
  tags?: string[];
  notes?: string;
  loyaltyPoints?: number;
  acquisitionSource?: string;
  shippingAddress?: CustomerAddressInput;
}

/**
 * "Add customer", from the admin's customer form or a seller's order form.
 *
 * The response's `profile` is what both forms read back — the order form
 * picks the new customer by the account on it — so it is the customer row
 * with its account populated, the same shape the route always returned.
 */
export async function createCustomerFromForm(
  input: AdminCustomerInput,
  options: {
    auditContext: AuditContext;
    createdBy: string;
    /** "vendor" also records which seller made the account. */
    audience: "admin" | "vendor";
    settings?: ISettings;
  },
) {
  await connectDB();
  const email = input.email.trim().toLowerCase();
  const match = await findCustomerByEmail(email);
  if (match.kind === "account" || match.kind === "staff") {
    throw new ConflictError("A user with this email already exists");
  }

  const tags = input.tags?.map((tag) => tag.trim()).filter(Boolean) || undefined;
  const user = await createPasswordlessUser({
    name: input.name.trim(),
    email,
    phone: input.phone?.trim() || undefined,
    address: input.shippingAddress,
    status: input.status,
  });
  const userId = user._id.toString();

  let profileId: Types.ObjectId;
  const updates: Record<string, unknown> = {};
  if (match.kind === "guest") {
    // The guest row becomes this account's row, with its orders, quotes and
    // returns. The form's values join what the store already knew of them.
    await claimGuestCustomerData(userId, email);
    const converted = await CustomerProfile.findOne({ userId: user._id })
      .select("_id tags notes")
      .lean<{ _id: Types.ObjectId; tags?: string[]; notes?: string } | null>();
    const profile = converted ?? (await ensureCustomerProfile(userId));
    if (!profile) throw new ApiError("Failed to initialize customer profile", 500);
    profileId = profile._id as Types.ObjectId;
    if (tags) updates.tags = mergeTags(converted?.tags, tags);
    const notes = appendNote(converted?.notes, input.notes);
    if (notes !== undefined && notes !== converted?.notes) updates.notes = notes;
  } else {
    const profile = await ensureCustomerProfile(userId);
    if (!profile) throw new ApiError("Failed to initialize customer profile", 500);
    profileId = profile._id as Types.ObjectId;
    if (tags) updates.tags = Array.from(new Set(tags));
    if (input.notes !== undefined) updates.notes = input.notes;
  }

  // A manual adjustment has to move `lifetimePoints` with the balance and
  // re-derive the tier, because the order-backed service derives the tier
  // from `lifetimePoints` on every award and reversal. While loyalty is hidden
  // (`isLoyaltyEnabled`) the balance takes no edits. A guest's own points are
  // kept unless a balance was actually typed: the form sends 0 by default.
  if (
    input.loyaltyPoints !== undefined &&
    isLoyaltyEnabled() &&
    (match.kind !== "guest" || input.loyaltyPoints > 0)
  ) {
    const points = Math.max(0, Math.floor(input.loyaltyPoints));
    updates.loyaltyPoints = points;
    updates.lifetimePoints = points;
    updates.loyaltyTier = computeLoyaltyTier(points);
  }
  if (input.acquisitionSource !== undefined) updates.acquisitionSource = input.acquisitionSource;
  if (input.shippingAddress) {
    updates.shippingAddress = {
      ...input.shippingAddress,
      isDefault: true,
      label: input.shippingAddress.label || "home",
    };
  }
  if (Object.keys(updates).length > 0) {
    await CustomerProfile.updateOne({ _id: profileId }, { $set: updates });
  }

  const profile = await CustomerProfile.findById(profileId)
    .populate({
      path: "userId",
      select: "name email image phone role status createdAt",
    })
    .lean();

  await auditCreate(
    options.auditContext,
    "user",
    userId,
    {
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      customerProfileId: String(profileId),
      ...(match.kind === "guest" ? { fromGuestCustomer: true } : {}),
      ...(options.audience === "vendor" ? { createdViaVendor: options.createdBy } : {}),
    },
    user.email,
  );

  await notifyAdminsNewCustomer(
    {
      customerId: userId,
      name: user.name,
      email: user.email,
      createdBy: options.createdBy,
    },
    options.settings ? { settings: options.settings } : {},
  );

  return profile;
}
