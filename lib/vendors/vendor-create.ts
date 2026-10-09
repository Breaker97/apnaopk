import { Types, type HydratedDocument } from "mongoose";
import { User, Vendor, VendorSubscription } from "@/models";
import {
  USER_ACCOUNT_STATUS,
  USER_ROLES,
  VENDOR_STATUS,
  type UserAccountStatus,
  type VendorStatus,
} from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { holdsTeamRole } from "@/lib/access/staff-role";
import { setUserRole } from "@/lib/access/user-role";
import { audit, type AuditContext } from "@/lib/audit";
import { slugify } from "@/lib/strings";
import { DEFAULT_VENDOR_SLUG } from "@/lib/vendors/multi-vendor";
import { resolveVendorCommission } from "@/lib/vendors/vendor-commission";
import { assignFreeVendorPlan } from "@/lib/vendors/vendor-plan-assignment";
import type { ISettings } from "@/models/settings.model";
import type { IVendorPlan } from "@/models/vendorPlan.model";
import type { IVendor } from "@/types";

/**
 * Making a store and the account that owns it, for the admin's "Add vendor"
 * form and the vendor import.
 *
 * The owner is found by email: an admin's or a team member's login is
 * refused (they hold a store through another lifecycle), so is an account
 * that already owns one, and any other account — a shopper's, most often —
 * becomes the owner. A new owner gets an account with no password; the
 * caller decides how they are told.
 *
 * There is no transaction (the dev database is a standalone mongod), so every
 * write after the first is undone by hand when a later one fails: an import
 * that dies half-way must not leave an owner without a store, which would
 * then refuse the corrected row as "already has an account".
 */

/** The model's limits, refused up front with the same words. */
export const VENDOR_FIELD_LIMITS = {
  storeName: 100,
  ownerName: 100,
  description: 1000,
  notes: 5000,
} as const;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** How many `-2`, `-3`… a slug may try before falling back to a timestamp. */
const MAX_SLUG_SUFFIX = 200;

export function isValidOwnerEmail(email: string): boolean {
  return email.length <= 320 && EMAIL_PATTERN.test(email);
}

export interface CreateVendorWithOwnerInput {
  storeName?: string;
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  slug?: string;
  status?: VendorStatus;
  /** The admin form's account status for the owner. */
  userStatus?: UserAccountStatus;
  description?: string;
  logo?: string;
  banner?: string;
  /** A rate typed for this store; manual only when it is not the rate it would get anyway. */
  commission?: number;
  address?: IVendor["address"];
  verified?: boolean;
  notes?: string;
  /** Set in advance, so the store's media can be filed under it before it exists. */
  vendorId?: Types.ObjectId;
}

export interface CreateVendorWithOwnerActor {
  /** Who made it: the plan subscription's `createdBy`. */
  userId: string;
  /** Audit this store on its own. An import leaves it out and records one row per run. */
  auditContext?: AuditContext;
}

export interface CreateVendorWithOwnerOptions {
  settings: ISettings;
  /** A free, active plan to open the store on; the caller has checked both. */
  plan?: HydratedDocument<IVendorPlan> | null;
  /**
   * What happens to an existing account that becomes the owner. "replace" (the
   * admin form) writes the typed name, phone and account status over it. "fill"
   * (an import) keeps what the account has, adds a missing phone, and refuses a
   * banned or deactivated account rather than quietly reopening it.
   */
  existingAccount?: "replace" | "fill";
}

export interface CreatedVendor {
  vendorId: string;
  userId: string;
  slug: string;
  status: VendorStatus;
  commission: number;
  /** The owner had no account; one was made, without a password. */
  createdAccount: boolean;
}

type OwnerAccount = {
  _id: Types.ObjectId;
  role?: string;
  roles?: string[];
  status?: string;
  name?: string;
  phone?: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function assertLength(value: string, limit: number, label: string) {
  if (value.length > limit) {
    throw new ValidationError(`${label} cannot exceed ${limit} characters`);
  }
}

/** The field a duplicate-key error is about, when that is what it is. */
function duplicateKeyField(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const record = error as {
    code?: number;
    keyPattern?: Record<string, unknown>;
    message?: string;
  };
  if (record.code !== 11000) return null;
  const field = record.keyPattern ? Object.keys(record.keyPattern)[0] : undefined;
  if (field) return field;
  return /index: (\w+)_/.exec(record.message ?? "")?.[1] ?? "unknown";
}

/**
 * The first free slug from `base`: `base`, then `base-2`, `base-3`… A store
 * name a marketplace already has gets the next number, not a timestamp.
 */
async function firstFreeSlug(base: string, from = 1): Promise<string> {
  for (let suffix = from; suffix <= MAX_SLUG_SUFFIX; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const taken = await Vendor.findOne({ slug: candidate }).select("_id").lean();
    if (!taken) return candidate;
  }
  return `${base}-${Date.now()}`;
}

function slugSuffix(slug: string, base: string): number {
  if (slug === base) return 1;
  const suffix = Number(slug.slice(base.length + 1));
  return Number.isInteger(suffix) && suffix > 1 ? suffix : MAX_SLUG_SUFFIX;
}

export async function createVendorWithOwner(
  input: CreateVendorWithOwnerInput,
  actor: CreateVendorWithOwnerActor,
  options: CreateVendorWithOwnerOptions,
): Promise<CreatedVendor> {
  const { settings, plan } = options;
  const fillOnly = options.existingAccount === "fill";

  const storeName = text(input.storeName);
  const ownerName = text(input.ownerName);
  const ownerEmail = text(input.ownerEmail).toLowerCase();
  const ownerPhone = text(input.ownerPhone);
  const description = text(input.description);
  const notes = text(input.notes);

  if (!storeName) throw new ValidationError("Store name is required");
  if (!ownerName) throw new ValidationError("Owner name is required");
  if (!ownerEmail) throw new ValidationError("Owner email is required");
  if (!isValidOwnerEmail(ownerEmail)) {
    throw new ValidationError("Owner email is not a valid email address");
  }
  assertLength(storeName, VENDOR_FIELD_LIMITS.storeName, "Store name");
  assertLength(ownerName, VENDOR_FIELD_LIMITS.ownerName, "Owner name");
  assertLength(description, VENDOR_FIELD_LIMITS.description, "Description");
  assertLength(notes, VENDOR_FIELD_LIMITS.notes, "Notes");

  const baseSlug = slugify(text(input.slug) || storeName);
  if (!baseSlug) throw new ValidationError("Invalid store slug");
  if (baseSlug === DEFAULT_VENDOR_SLUG) {
    throw new ValidationError("This store slug is reserved for the default store");
  }

  const status =
    input.status && (Object.values(VENDOR_STATUS) as string[]).includes(input.status)
      ? input.status
      : VENDOR_STATUS.PENDING;

  const existingUser = await User.findOne({ email: ownerEmail })
    .select("_id role roles status name phone")
    .lean<OwnerAccount | null>();

  if (existingUser) {
    if (holdsTeamRole(existingUser)) {
      throw new ValidationError(`User already has ${existingUser.role} role`);
    }
    const existingVendor = await Vendor.findOne({ userId: existingUser._id })
      .select("_id")
      .lean();
    if (existingVendor) {
      throw new ValidationError("A vendor profile already exists for this user");
    }
    if (fillOnly && existingUser.status === USER_ACCOUNT_STATUS.BANNED) {
      throw new ValidationError("This email belongs to a banned account");
    }
    if (fillOnly && existingUser.status === USER_ACCOUNT_STATUS.INACTIVE) {
      throw new ValidationError("This email belongs to a deactivated account");
    }
  }

  // A typed rate is this store's own only when it differs from what the store
  // would be charged anyway — its plan's rate, or the store default. The admin
  // form arrives pre-filled with the default, and an exported file carries
  // every store's current rate; neither number is an override, and marking it
  // manual would pin the store out of the default sweep.
  const expectedRate = resolveVendorCommission(null, plan ?? null, settings);
  const typedRate = typeof input.commission === "number" ? input.commission : undefined;
  const manualRate = typedRate !== undefined && typedRate !== expectedRate;

  let createdUserId: string | null = null;
  let vendorDoc: HydratedDocument<IVendor> | null = null;
  let ownerUpdated = false;
  let planAssigned = false;

  try {
    let userId: string;
    if (existingUser) {
      userId = String(existingUser._id);
    } else {
      const user = await User.create({
        name: ownerName,
        email: ownerEmail,
        phone: ownerPhone || undefined,
        role: USER_ROLES.CUSTOMER,
        roles: [USER_ROLES.CUSTOMER],
        status: input.userStatus || USER_ACCOUNT_STATUS.ACTIVE,
      });
      createdUserId = String(user._id);
      userId = createdUserId;
    }

    let slug = await firstFreeSlug(baseSlug);
    for (;;) {
      try {
        vendorDoc = (await Vendor.create({
          ...(input.vendorId ? { _id: input.vendorId } : {}),
          userId,
          storeName,
          slug,
          description: description || undefined,
          logo: text(input.logo) || undefined,
          banner: text(input.banner) || undefined,
          commission: manualRate ? typedRate : expectedRate,
          commissionSource: manualRate ? "manual" : "default",
          // Access is not copied onto the vendor any more: it is derived from
          // the plan's packs, or the commission-only baseline when no plan
          // governs them. An explicit empty override list is what marks this
          // row as being on that model — an ABSENT list is what makes
          // `resolveVendorAccess` fall back to the legacy `permissions` field
          // for rows the migration has not reached. So write `[]`, never
          // `undefined`.
          permissionOverrides: [],
          ...(input.address ? { address: input.address } : {}),
          ...(input.verified === true ? { verified: true } : {}),
          ...(notes ? { notes } : {}),
          status,
        })) as HydratedDocument<IVendor>;
        break;
      } catch (error) {
        const field = duplicateKeyField(error);
        if (field === "slug" && slugSuffix(slug, baseSlug) < MAX_SLUG_SUFFIX) {
          // Someone took it between the look and the insert.
          slug = await firstFreeSlug(baseSlug, slugSuffix(slug, baseSlug) + 1);
          continue;
        }
        if (field === "userId") {
          throw new ValidationError("A vendor profile already exists for this user");
        }
        throw error;
      }
    }

    // Only once the store exists: a refused store must not have rewritten the
    // account it was refused for.
    if (existingUser) {
      const update = fillOnly
        ? { ...(ownerPhone && !existingUser.phone ? { phone: ownerPhone } : {}) }
        : {
            name: ownerName,
            phone: ownerPhone || undefined,
            status: input.userStatus || USER_ACCOUNT_STATUS.ACTIVE,
          };
      if (Object.keys(update).length > 0) {
        ownerUpdated = true;
        await User.updateOne({ _id: existingUser._id }, { $set: update });
      }
    }

    let commission = manualRate ? (typedRate as number) : expectedRate;
    if (plan) {
      planAssigned = true;
      await assignFreeVendorPlan({
        vendor: vendorDoc,
        plan,
        current: null,
        actorId: actor.userId,
        settings,
      });
      commission = vendorDoc.commission;
      if (manualRate) {
        vendorDoc.commission = typedRate as number;
        vendorDoc.commissionSource = "manual";
        await vendorDoc.save();
        commission = typedRate as number;
      }
    }

    if (status === VENDOR_STATUS.APPROVED) {
      await setUserRole(userId, USER_ROLES.VENDOR);
    }

    if (actor.auditContext) {
      // The store, who owns it and on what terms. Nothing else of the owner's
      // account goes in, and no bank or tax detail: there is none to give.
      await audit(actor.auditContext, {
        action: "CREATE",
        resource: "vendor",
        resourceId: String(vendorDoc._id),
        resourceName: storeName,
        changes: {
          after: { storeName, ownerEmail, status, commission },
          summary: `Created vendor "${storeName}" owned by ${ownerEmail}${
            existingUser ? "" : " (new account)"
          }, status ${status}, commission ${commission}%`,
        },
      });
    }

    return {
      vendorId: String(vendorDoc._id),
      userId,
      slug,
      status,
      commission,
      createdAccount: !existingUser,
    };
  } catch (error) {
    await undoPartialVendor({
      vendorId: vendorDoc ? vendorDoc._id : null,
      planAssigned,
      createdUserId,
      restoreOwner:
        existingUser && ownerUpdated
          ? { _id: existingUser._id, name: existingUser.name, phone: existingUser.phone, status: existingUser.status }
          : null,
    });
    throw error;
  }
}

/**
 * Take back what a failed creation wrote, newest first. Best effort: a failure
 * here is logged and the original error is the one the caller sees.
 */
async function undoPartialVendor(written: {
  vendorId: unknown;
  planAssigned: boolean;
  createdUserId: string | null;
  restoreOwner: Pick<OwnerAccount, "_id" | "name" | "phone" | "status"> | null;
}) {
  try {
    if (written.vendorId) {
      if (written.planAssigned) {
        await VendorSubscription.deleteMany({ vendorId: written.vendorId });
      }
      await Vendor.deleteOne({ _id: written.vendorId });
    }
    if (written.createdUserId) {
      await User.deleteOne({ _id: written.createdUserId });
    } else if (written.restoreOwner) {
      const { _id, ...fields } = written.restoreOwner;
      const set: Record<string, unknown> = {};
      const unset: Record<string, ""> = {};
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) unset[key] = "";
        else set[key] = value;
      }
      await User.updateOne(
        { _id },
        {
          ...(Object.keys(set).length ? { $set: set } : {}),
          ...(Object.keys(unset).length ? { $unset: unset } : {}),
        },
      );
    }
  } catch (undoError) {
    console.error("[vendor-create] could not undo a half-made vendor:", undoError);
  }
}
