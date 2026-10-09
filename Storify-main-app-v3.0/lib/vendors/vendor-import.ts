import "server-only";

import { Types, type HydratedDocument } from "mongoose";
import { User, Vendor, VendorPlan, VendorSubscription } from "@/models";
import {
  USER_ACCOUNT_STATUS,
  VENDOR_BILLING_INTERVAL,
  VENDOR_STATUS,
} from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import { holdsTeamRole } from "@/lib/access/staff-role";
import { afterResponse } from "@/lib/after-response";
import { revalidateProductContent } from "@/lib/cache-invalidation";
import {
  areCountryValuesEquivalent,
  isCountryAllowed,
} from "@/lib/intl/country-availability";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import type { ImportRunDefinition, ImportRunInviteeInput } from "@/lib/imports/import-run";
import { addressGeocodeKey, geocodeAddress } from "@/lib/intl/geocoding";
import { syncInheritedLocationGeo } from "@/lib/locations/location-geo";
import { vendorGeoPoint } from "@/lib/locations/vendor-geo";
import { RemoteImageError, importRemoteImage } from "@/lib/media-upload/remote-image";
import { getStorageService } from "@/lib/storage";
import { vendorMediaScope } from "@/lib/storage/key";
import { assertOwnStorageUrl } from "@/lib/storage/own-storage-url";
import { slugify } from "@/lib/strings";
import { isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import { resolveVendorCommission } from "@/lib/vendors/vendor-commission";
import { createVendorWithOwner } from "@/lib/vendors/vendor-create";
import {
  assignFreeVendorPlan,
  findDefaultVendorPlan,
  isPaidVendorPlan,
  vendorPlansEnabled,
} from "@/lib/vendors/vendor-plan-assignment";
import {
  readVendorRow,
  type ImportMessage,
  type ImportedVendorAddress,
  type NormalizedVendorRow,
  type VendorCells,
} from "@/lib/vendors/vendor-import-format";
import type { ISettings } from "@/models/settings.model";
import type { IVendorPlan } from "@/models/vendorPlan.model";
import type { IVendor } from "@/types";

/**
 * The vendor import's server side: one request's rows, judged and written.
 *
 * A row is matched to a store by its slug, then by its owner's email. A match
 * is skipped unless "Update existing vendors" is on, and then only the cells
 * the row fills in change anything. A new store goes through the same
 * `createVendorWithOwner` as the admin's form, its pictures are downloaded
 * into the store's own media storage first (the old site will close), and an
 * approved one's owner is invited at the end of the run.
 *
 * A dry run reads and matches every row exactly the same way and writes
 * nothing: no account, no store, no download.
 */

export interface VendorImportOptions {
  /** Existing stores take the row's filled-in cells instead of being skipped. */
  updateExisting: boolean;
  /** What a new store starts as. */
  startAs: typeof VENDOR_STATUS.APPROVED | typeof VENDOR_STATUS.PENDING;
}

export type VendorRowOutcome = "create" | "update" | "unchanged" | "skip" | "error";

export interface VendorRowResult {
  row: number;
  outcome: VendorRowOutcome;
  /** The owner email the row was matched by, as the dialog lists it. */
  key?: string;
  storeName?: string;
  vendorId?: string;
  error?: ImportMessage;
  warnings: ImportMessage[];
}

/** An approved store's owner, to be sent the vendor invite once the run ends. */
export interface VendorInvite {
  vendorId: string;
  userId: string;
  email: string;
  storeName: string;
}

export interface VendorImportChunkResult {
  results: VendorRowResult[];
  invites: VendorInvite[];
  /** About the run rather than a row: plans switched off, a paid default plan. */
  warnings: ImportMessage[];
}

export interface VendorImportDependencies {
  importImage?: typeof importRemoteImage;
  /** Stores whose address changed; they get their map pin after the response. */
  geocodeLater?: (vendorIds: string[]) => void;
  removeStoredFiles?: (keys: string[]) => Promise<void>;
}

class RowError extends Error {
  constructor(readonly error: ImportMessage) {
    super(error.code);
  }
}

type StoredVendor = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  isDefault?: boolean;
  storeName: string;
  slug: string;
  description?: string;
  logo?: string;
  banner?: string;
  address?: IVendor["address"];
  verified?: boolean;
  notes?: string;
  planId?: Types.ObjectId | null;
  commission?: number;
  commissionSource?: "default" | "plan" | "manual";
};

type Owner = {
  _id: Types.ObjectId;
  role?: string;
  roles?: string[];
  status?: string;
  name?: string;
  phone?: string;
};

const STORE_FIELDS =
  "_id userId isDefault storeName slug description logo banner address verified notes planId commission commissionSource";

type Plan = HydratedDocument<IVendorPlan>;

/** Plans, read once per request: a store has a handful. */
function createPlanBook(settings: ISettings, runWarnings: ImportMessage[]) {
  let plans: Promise<Plan[]> | undefined;
  let defaultPlan: Promise<Plan | null> | undefined;
  const warnedOnce = new Set<string>();
  const warnRun = (message: ImportMessage) => {
    if (warnedOnce.has(message.code)) return;
    warnedOnce.add(message.code);
    runWarnings.push(message);
  };

  const all = () => (plans ??= VendorPlan.find({}).sort({ sortOrder: 1 }).exec());

  /** The default plan when a new store may go on it: active and free. */
  async function usableDefault(): Promise<Plan | null> {
    defaultPlan ??= findDefaultVendorPlan(settings);
    const plan = await defaultPlan;
    if (plan && isPaidVendorPlan(plan)) {
      warnRun({ code: "run_default_plan_paid", params: { plan: plan.name } });
      return null;
    }
    return plan;
  }

  /**
   * The plan a row's cell names, as a free active plan to assign, or null with
   * a warning. A name nothing matches is refused: a typo must not quietly land
   * a store on the default plan.
   */
  async function named(
    value: string,
    warnings: ImportMessage[],
    currentPlanId?: unknown,
  ): Promise<Plan | null> {
    const slug = slugify(value);
    const lower = value.trim().toLowerCase();
    const rows = await all();
    const bySlug = rows.find((plan) => plan.slug === slug);
    const byName = rows.filter((plan) => plan.name.trim().toLowerCase() === lower);
    if (!bySlug && byName.length > 1) {
      throw new RowError({ code: "row_plan_ambiguous", params: { plan: value } });
    }
    const plan = bySlug ?? byName[0];
    if (!plan) throw new RowError({ code: "row_plan_not_found", params: { plan: value } });
    // The plan the store is already on — an exported row — changes nothing,
    // whatever it costs.
    if (currentPlanId && String(plan._id) === String(currentPlanId)) return null;
    if (plan.status !== "active") {
      warnings.push({ code: "row_plan_archived", params: { plan: plan.name } });
      return null;
    }
    if (isPaidVendorPlan(plan)) {
      warnings.push({ code: "row_plan_paid", params: { plan: plan.name } });
      return null;
    }
    return plan;
  }

  return {
    /** The plan a new store opens on. */
    async forCreate(value: string | undefined, warnings: ImportMessage[]) {
      if (!vendorPlansEnabled(settings)) {
        if (value) warnRun({ code: "run_plans_off" });
        return null;
      }
      const plan = value ? await named(value, warnings) : null;
      return plan ?? (await usableDefault());
    },
    /** A plan an existing store moves to; null leaves its plan alone. */
    async forUpdate(value: string | undefined, warnings: ImportMessage[], currentPlanId?: unknown) {
      if (!value) return null;
      if (!vendorPlansEnabled(settings)) {
        warnRun({ code: "run_plans_off" });
        return null;
      }
      return named(value, warnings, currentPlanId);
    },
    async byId(id: unknown): Promise<Plan | null> {
      if (!id) return null;
      return (await all()).find((plan) => String(plan._id) === String(id)) ?? null;
    },
  };
}

function ownerRefusal(owner: Owner): ImportMessage | null {
  if (holdsTeamRole(owner)) return { code: "row_owner_team" };
  if (owner.status === USER_ACCOUNT_STATUS.BANNED) return { code: "row_owner_banned" };
  if (owner.status === USER_ACCOUNT_STATUS.INACTIVE) return { code: "row_owner_inactive" };
  return null;
}

/** The service's refusals, as the codes the dialog words. */
function serviceRefusal(error: ValidationError): ImportMessage {
  const message = error.message;
  if (/already has .* role/.test(message)) return { code: "row_owner_team" };
  if (/vendor profile already exists/.test(message)) return { code: "row_owner_has_store" };
  if (/banned account/.test(message)) return { code: "row_owner_banned" };
  if (/deactivated account/.test(message)) return { code: "row_owner_inactive" };
  return { code: "row_failed", params: { message } };
}

function duplicateKeyOn(error: unknown, field: string): boolean {
  const record = error as { code?: number; keyPattern?: Record<string, unknown> } | null;
  return record?.code === 11000 && Boolean(record.keyPattern && field in record.keyPattern);
}

function addressParts(address: IVendor["address"] | ImportedVendorAddress | undefined) {
  const source = (address ?? {}) as Record<string, unknown>;
  const part = (key: string) => (typeof source[key] === "string" ? (source[key] as string) : "");
  return {
    street: part("street"),
    city: part("city"),
    state: part("state"),
    postalCode: part("postalCode"),
    country: part("country"),
    phone: part("phone"),
  };
}

async function isOwnStorageUrl(url: string): Promise<boolean> {
  try {
    await assertOwnStorageUrl(url);
    return true;
  } catch {
    return false;
  }
}

async function removeStoredFilesDefault(keys: string[]) {
  if (keys.length === 0) return;
  const storage = await getStorageService();
  for (const key of keys) {
    await storage.deleteFile(key).catch((error) =>
      console.error("[vendor-import] could not remove an unused picture:", key, error),
    );
  }
}

/**
 * Give imported addresses their map pin, one Nominatim lookup at a time,
 * after the response: the geocoder allows one request a second, which a
 * request carrying ten stores cannot wait for. A miss leaves the address
 * stored as typed, as the admin's own save does.
 */
function geocodeLaterDefault(vendorIds: string[]) {
  if (vendorIds.length === 0) return;
  afterResponse(async () => {
    for (const id of vendorIds) {
      const vendor = await Vendor.findById(id).select("address").lean<{ address?: IVendor["address"] } | null>();
      if (!vendor?.address) continue;
      const coordinates = await geocodeAddress(vendor.address);
      if (!coordinates) continue;
      const geo = vendorGeoPoint({ coordinates });
      await Vendor.updateOne(
        { _id: id },
        { $set: { "address.coordinates": coordinates, ...(geo ? { "address.geo": geo } : {}) } },
      );
      await syncInheritedLocationGeo(id, geo);
    }
  });
}

export async function importVendorRows(input: {
  rows: ReadonlyArray<{ row: number; cells: VendorCells }>;
  options: VendorImportOptions;
  dryRun: boolean;
  settings: ISettings;
  actor: { userId: string };
  deps?: VendorImportDependencies;
}): Promise<VendorImportChunkResult> {
  const { options, dryRun, settings, actor } = input;
  const importImage = input.deps?.importImage ?? importRemoteImage;
  const geocodeLater = input.deps?.geocodeLater ?? geocodeLaterDefault;
  const removeStoredFiles = input.deps?.removeStoredFiles ?? removeStoredFilesDefault;

  const runWarnings: ImportMessage[] = [];
  const plans = createPlanBook(settings, runWarnings);
  const invites: VendorInvite[] = [];
  const results: VendorRowResult[] = [];
  const geocode: string[] = [];
  let changedStorefront = false;
  // A dry run writes nothing, so a second row for a store an earlier row of
  // the same request would create has to be recognised here.
  const dryRunStores = new Map<string, string>();

  const rowContext = {
    isCountryAllowed: (country: string) =>
      isCountryAllowed(country, settings.general?.countryAvailability),
  };

  /**
   * Whether a picture link will be kept (the store's own storage: an exported
   * file links its own copies) or downloaded — which only an https link may be.
   */
  async function checkImageUrl(url: string, column: string): Promise<"keep" | "download"> {
    if (await isOwnStorageUrl(url)) return "keep";
    if (!url.startsWith("https://")) {
      throw new RowError({ code: "row_image_not_https", params: { column } });
    }
    return "download";
  }

  async function storeImage(
    url: string,
    column: string,
    vendorId: Types.ObjectId,
    stored: string[],
  ): Promise<string> {
    if ((await checkImageUrl(url, column)) === "keep") return url;
    try {
      const record = await importImage(url, {
        ownerScope: vendorMediaScope(String(vendorId)),
        uploadedBy: actor.userId,
      });
      stored.push(record.key);
      return record.url;
    } catch (error) {
      if (error instanceof RemoteImageError) {
        throw new RowError({
          code: "row_image_failed",
          params: { column, reason: error.failure, detail: error.message },
        });
      }
      throw error;
    }
  }

  async function createStore(value: NormalizedVendorRow, owner: Owner | null, warnings: ImportMessage[]) {
    if (owner) {
      const refusal = ownerRefusal(owner);
      if (refusal) throw new RowError(refusal);
    }
    const plan = await plans.forCreate(value.plan, warnings);
    if (value.logoUrl) await checkImageUrl(value.logoUrl, "Logo URL");
    if (value.bannerUrl) await checkImageUrl(value.bannerUrl, "Banner URL");
    if (dryRun) return { outcome: "create" as const };

    const vendorId = new Types.ObjectId();
    const stored: string[] = [];
    try {
      const logo = value.logoUrl ? await storeImage(value.logoUrl, "Logo URL", vendorId, stored) : undefined;
      const banner = value.bannerUrl
        ? await storeImage(value.bannerUrl, "Banner URL", vendorId, stored)
        : undefined;
      const created = await createVendorWithOwner(
        {
          vendorId,
          storeName: value.storeName,
          ownerName: value.ownerName,
          ownerEmail: value.ownerEmail,
          ownerPhone: value.ownerPhone,
          slug: value.slug,
          status: options.startAs,
          description: value.description,
          logo,
          banner,
          commission: value.commission,
          address: value.address as IVendor["address"],
          verified: value.verified,
          notes: value.notes,
        },
        { userId: actor.userId },
        { settings, plan, existingAccount: "fill" },
      );
      if (value.address) geocode.push(created.vendorId);
      if (created.status === VENDOR_STATUS.APPROVED) {
        changedStorefront = true;
        invites.push({
          vendorId: created.vendorId,
          userId: created.userId,
          email: value.ownerEmail,
          storeName: value.storeName,
        });
      }
      return { outcome: "create" as const, vendorId: created.vendorId };
    } catch (error) {
      await removeStoredFiles(stored);
      if (error instanceof ValidationError) throw new RowError(serviceRefusal(error));
      throw error;
    }
  }

  async function updateStore(
    value: NormalizedVendorRow,
    store: StoredVendor,
    owner: Owner,
    warnings: ImportMessage[],
  ) {
    const set: Record<string, unknown> = {};
    const userSet: Record<string, unknown> = {};

    if (value.storeName !== store.storeName) set.storeName = value.storeName;
    if (value.slug && value.slug !== store.slug) set.slug = value.slug;
    if (value.description !== undefined && value.description !== (store.description ?? "")) {
      set.description = value.description;
    }
    if (value.verified !== undefined && value.verified !== Boolean(store.verified)) {
      set.verified = value.verified;
    }
    if (value.notes !== undefined && value.notes !== (store.notes ?? "")) set.notes = value.notes;

    let addressMoved = false;
    if (value.address) {
      const before = addressParts(store.address);
      // Only the parts the row fills in; an empty cell keeps the stored part,
      // and so does a country written another way ("US" for "United States").
      const after = { ...before };
      for (const [key, part] of Object.entries(value.address)) {
        if (part === undefined) continue;
        if (key === "country" && areCountryValuesEquivalent(part, before.country)) continue;
        after[key as keyof typeof after] = part;
      }
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        addressMoved = addressGeocodeKey(after) !== addressGeocodeKey(before);
        const existing = (store.address ?? {}) as Record<string, unknown>;
        set.address = {
          ...after,
          // A changed street gets a new pin after the response; the old one
          // would mark the wrong place until then.
          ...(addressMoved ? {} : { coordinates: existing.coordinates, geo: existing.geo }),
        };
      }
    }

    if (value.ownerName !== (owner.name ?? "")) userSet.name = value.ownerName;
    if (value.ownerPhone && value.ownerPhone !== (owner.phone ?? "")) userSet.phone = value.ownerPhone;

    // A plan change only for a store with no paid subscription: moving a
    // paying store to a free plan would cancel days it has paid for, and a
    // Stripe one is changed through Stripe.
    let nextPlan = await plans.forUpdate(value.plan, warnings, store.planId);
    if (nextPlan && String(nextPlan._id) === String(store.planId ?? "")) nextPlan = null;
    const current = nextPlan
      ? await VendorSubscription.findOne({ vendorId: store._id, occupiesActiveSlot: true }).sort({
          createdAt: -1,
        })
      : null;
    if (
      nextPlan &&
      current &&
      (current.provider === "stripe" ||
        (current.planSnapshot?.billingInterval !== VENDOR_BILLING_INTERVAL.NONE &&
          Number(current.planSnapshot?.price ?? 0) > 0))
    ) {
      warnings.push({ code: "row_plan_kept_paid", params: { plan: nextPlan.name } });
      nextPlan = null;
    }

    // The rate: a typed one is the store's own only when it differs from what
    // its plan (or the store default) would charge; an empty cell keeps the
    // stored rate, a manual one included.
    const plan = nextPlan ?? (await plans.byId(store.planId));
    const expected = resolveVendorCommission(store, plan, settings);
    const currentSource = store.commissionSource ?? "default";
    let commission: { rate: number; source: "default" | "plan" | "manual" } | null = null;
    if (value.commission !== undefined && value.commission === store.commission && !nextPlan) {
      // The rate the store already has (an exported row) changes nothing,
      // where it came from included.
      commission = null;
    } else if (value.commission !== undefined) {
      commission =
        value.commission !== expected
          ? { rate: value.commission, source: "manual" }
          : { rate: expected, source: plan ? "plan" : "default" };
    } else if (nextPlan && currentSource === "manual") {
      commission = { rate: store.commission ?? expected, source: "manual" };
    }
    const afterPlanRate = nextPlan ? { rate: expected, source: "plan" } : null;
    const baseline = afterPlanRate ?? { rate: store.commission, source: currentSource };
    if (commission && commission.rate === baseline.rate && commission.source === baseline.source) {
      commission = null;
    }

    const newLogo = value.logoUrl && value.logoUrl !== store.logo ? value.logoUrl : undefined;
    const newBanner = value.bannerUrl && value.bannerUrl !== store.banner ? value.bannerUrl : undefined;
    const changes =
      Object.keys(set).length + Object.keys(userSet).length + (nextPlan ? 1 : 0) + (commission ? 1 : 0) +
      (newLogo ? 1 : 0) + (newBanner ? 1 : 0);
    if (changes === 0) return { outcome: "unchanged" as const, vendorId: String(store._id) };
    if (newLogo) await checkImageUrl(newLogo, "Logo URL");
    if (newBanner) await checkImageUrl(newBanner, "Banner URL");
    if (dryRun) return { outcome: "update" as const, vendorId: String(store._id) };

    const stored: string[] = [];
    try {
      if (newLogo) set.logo = await storeImage(newLogo, "Logo URL", store._id, stored);
      if (newBanner) set.banner = await storeImage(newBanner, "Banner URL", store._id, stored);
      if (Object.keys(set).length > 0) {
        try {
          await Vendor.updateOne({ _id: store._id }, { $set: set });
        } catch (error) {
          if (duplicateKeyOn(error, "slug")) {
            throw new RowError({ code: "row_slug_taken", params: { slug: String(set.slug) } });
          }
          throw error;
        }
      }
    } catch (error) {
      await removeStoredFiles(stored);
      throw error;
    }

    if (nextPlan) {
      const vendor = await Vendor.findById(store._id);
      if (vendor) {
        await assignFreeVendorPlan({ vendor, plan: nextPlan, current, actorId: actor.userId, settings });
      }
    }
    if (commission) {
      await Vendor.updateOne(
        { _id: store._id },
        { $set: { commission: commission.rate, commissionSource: commission.source } },
      );
    }
    if (Object.keys(userSet).length > 0) {
      await User.updateOne({ _id: owner._id }, { $set: userSet });
    }
    if (addressMoved) geocode.push(String(store._id));
    changedStorefront = true;
    return { outcome: "update" as const, vendorId: String(store._id) };
  }

  async function importRow(value: NormalizedVendorRow, warnings: ImportMessage[]) {
    const owner = await User.findOne({ email: value.ownerEmail })
      .select("_id role roles status name phone")
      .lean<Owner | null>();
    const bySlug = value.slug
      ? await Vendor.findOne({ slug: value.slug }).select(STORE_FIELDS).lean<StoredVendor | null>()
      : null;
    const ownersStore = owner
      ? await Vendor.findOne({ userId: owner._id }).select(STORE_FIELDS).lean<StoredVendor | null>()
      : null;

    if ((bySlug && isDefaultVendorRecord(bySlug)) || (ownersStore && isDefaultVendorRecord(ownersStore))) {
      throw new RowError({ code: "row_default_store" });
    }
    // The import never hands a store to someone else.
    if (bySlug && String(bySlug.userId) !== String(owner?._id ?? "")) {
      throw new RowError({ code: "row_slug_taken", params: { slug: bySlug.slug } });
    }
    const store = bySlug ?? ownersStore;

    if (dryRun && !store) {
      const earlier =
        dryRunStores.get(`email:${value.ownerEmail}`) ??
        (value.slug ? dryRunStores.get(`slug:${value.slug}`) : undefined);
      if (earlier) {
        if (earlier !== value.ownerEmail) {
          throw new RowError({ code: "row_slug_taken", params: { slug: value.slug ?? "" } });
        }
        warnings.push({ code: "row_duplicate_in_file" });
        return { outcome: options.updateExisting ? ("update" as const) : ("skip" as const) };
      }
    }

    if (store && owner) {
      if (!options.updateExisting) return { outcome: "skip" as const, vendorId: String(store._id) };
      return updateStore(value, store, owner, warnings);
    }

    const created = await createStore(value, owner, warnings);
    if (dryRun) {
      dryRunStores.set(`email:${value.ownerEmail}`, value.ownerEmail);
      if (value.slug) dryRunStores.set(`slug:${value.slug}`, value.ownerEmail);
    }
    return created;
  }

  for (const { row, cells } of input.rows) {
    const reading = readVendorRow(cells, rowContext);
    if (!reading.ok) {
      results.push({
        row,
        outcome: "error",
        key: cells.ownerEmail?.trim().toLowerCase() || undefined,
        storeName: cells.storeName,
        error: reading.error,
        warnings: [],
      });
      continue;
    }
    const warnings = [...reading.warnings];
    try {
      const result = await importRow(reading.value, warnings);
      results.push({
        row,
        key: reading.value.ownerEmail,
        storeName: reading.value.storeName,
        warnings,
        ...result,
      });
    } catch (error) {
      if (!(error instanceof RowError)) {
        console.error("[vendor-import] row failed:", error);
      }
      results.push({
        row,
        outcome: "error",
        key: reading.value.ownerEmail,
        storeName: reading.value.storeName,
        error: error instanceof RowError ? error.error : { code: "row_failed", params: { message: "" } },
        warnings,
      });
    }
  }

  if (!dryRun) {
    geocodeLater(geocode);
    if (changedStorefront) revalidateProductContent();
  }
  return { results, invites, warnings: runWarnings };
}

/** One request's rows as the import dialog reads them. */
export interface VendorImportProblem {
  row: number;
  status: "create" | "update" | "skip" | "error";
  key?: string;
  reason?: ImportMessage;
  warnings?: ImportMessage[];
}

/**
 * Counts for every row, and only the rows worth a look: refusals, and rows
 * that went through with something to say. A store skipped as existing or left
 * unchanged is just a count — it is what a re-run of the same file is.
 */
export function summarizeVendorRows(results: VendorRowResult[]) {
  const counts = { create: 0, update: 0, skip: 0, error: 0 };
  const problems: VendorImportProblem[] = [];
  for (const result of results) {
    const status = result.outcome === "unchanged" ? "skip" : result.outcome;
    counts[status]++;
    if (status === "error" || result.warnings.length > 0) {
      problems.push({
        row: result.row,
        status,
        ...(result.key ? { key: result.key } : {}),
        ...(result.error ? { reason: result.error } : {}),
        ...(result.warnings.length > 0 ? { warnings: result.warnings } : {}),
      });
    }
  }
  return { counts, problems };
}

/** The run's invitees, as the shared run bookkeeping stores them. */
export function vendorInvitees(invites: VendorInvite[]): ImportRunInviteeInput[] {
  return invites.map((invite) => ({
    recordId: new Types.ObjectId(invite.vendorId),
    userId: new Types.ObjectId(invite.userId),
    email: invite.email,
  }));
}

/**
 * What a vendor import's run says and does at its end (the bookkeeping is
 * shared with the customer import: lib/imports/import-run.ts).
 *
 * The owners of the approved stores it created get the vendor invitation —
 * a stopped run's too: those stores are live, and a re-run of the file skips
 * them as existing, so this is the only moment their owners can be reached.
 */
export const VENDOR_IMPORT_RUN: ImportRunDefinition = {
  entity: "vendor",
  audit: (run, { stopped, invitesQueued }) => {
    const { created, updated, skipped, failed } = run.counts;
    const options = run.options as Partial<VendorImportOptions>;
    return {
      resource: "vendor",
      summary:
        `Imported vendors from "${run.fileName}": ${created} created${
          options.startAs ? ` (${options.startAs})` : ""
        }, ${updated} updated, ${skipped} skipped, ${failed} failed` +
        (stopped ? " — stopped before the end of the file" : "") +
        (invitesQueued > 0 ? `; ${invitesQueued} owner invitations queued` : ""),
      metadata: { startAs: options.startAs, updateExisting: options.updateExisting },
    };
  },
  onFinish: async (run, invitees) => {
    if (invitees.length === 0) return { invitesQueued: 0 };
    const [{ enqueueAccountEmails, processAccountEmailJobs }, routing] = await Promise.all([
      import("@/lib/auth/account-email-queue"),
      getLocaleRouting(),
    ]);
    const { queued } = await enqueueAccountEmails({
      requestedBy: { id: String(run.requestedBy), email: run.requestedByEmail },
      source: "import",
      audience: "vendor",
      recipients: invitees.map((invitee) => ({
        userId: String(invitee.userId),
        email: invitee.email,
        // An owner from another platform has no language on record here.
        locale: routing.storeDefault,
      })),
      skippedAtStart: {},
    });
    afterResponse(() => processAccountEmailJobs());
    return { invitesQueued: queued };
  },
};
