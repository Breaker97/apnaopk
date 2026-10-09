import type { Types } from "mongoose";
import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/biz/v1/common";
import type {
  VendorApplicationAnswer,
  VendorApplicationDetail,
  VendorApplicationDocument,
  VendorApplicationList,
  VendorApplicationListItem,
  VendorApplicationListQuery,
} from "@/contracts/mobile/biz/v1/vendor-applications";
import { VENDOR_STATUS } from "@/config/app.config";
import { MobileApiError } from "@/lib/api-core/errors";
import { isValidObjectId } from "@/lib/api/validate";
import { absoluteUrl } from "@/lib/api-core/shop/absolute-url";
import { imageSet } from "@/lib/api-core/shop/images";
import { toMoney } from "@/lib/api-core/shop/money";
import { encodeTimeCursor, afterTimeCursor, readTimeCursor } from "@/lib/api-core/shop/time-cursor";
import { connectDB } from "@/lib/db";
import { readStoreCurrency } from "@/lib/intl/server-currency";
import { getStorageService } from "@/lib/storage";
import type { StorageService } from "@/lib/storage/types";
import { escapeRegExp } from "@/lib/strings";
import { getExternalVendorFilter, isDefaultVendorRecord } from "@/lib/vendors/multi-vendor";
import {
  VENDOR_APPLICATION_LATEST_SORT,
  findLatestVendorApplication,
  vendorDecisionBlocker,
} from "@/lib/vendors/vendor-application";
import { isVendorDocumentKey, isVendorDocumentReference } from "@/lib/vendors/vendor-documents";
import { Vendor, VendorApplication, VendorPlan } from "@/models";

/**
 * Sellers' applications as the business app reads them (GET
 * /vendor-applications, GET /vendor-applications/{id}).
 *
 * An application is the seller's `Vendor` (the website's admin decides per
 * vendor, and an admin-created vendor has no application row); its latest
 * `VendorApplication` (the website's lookup, newest first) adds when it was
 * submitted, the plan bought and the payment state.
 */

/** How long a document's signed link works: the website admin's own link time. */
const DOCUMENT_LINK_SECONDS = 300;

const TAB_STATUSES: Record<NonNullable<VendorApplicationListQuery["tab"]>, string[] | null> = {
  pending: [VENDOR_STATUS.PENDING],
  approved: [VENDOR_STATUS.APPROVED, VENDOR_STATUS.PAYMENT_REQUIRED],
  rejected: [VENDOR_STATUS.REJECTED],
  all: null,
};

/** The vendor documents' fields, as the app names their kinds. */
const DOCUMENT_KINDS = [
  ["businessLicense", "business_license"],
  ["taxCertificate", "tax_certificate"],
  ["governmentId", "government_id"],
] as const;

interface ApplicantVendor {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  isDefault?: boolean;
  slug?: string;
  storeName: string;
  description?: string;
  logo?: string;
  banner?: string;
  status: string;
  planId?: Types.ObjectId | null;
  createdAt?: Date;
  address?: Record<string, unknown> | null;
  socialLinks?: { website?: string } | null;
  documents?: Record<string, string | undefined> | null;
  onboardingResponses?: Record<string, { label?: string; value?: string | boolean } | undefined> | null;
  user?: { name?: string; email?: string } | null;
}

interface ApplicantApplication {
  vendorId?: Types.ObjectId | null;
  userId?: Types.ObjectId;
  status?: string;
  paymentStatus?: string;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
  planSnapshot?: {
    name: string;
    price: number;
    currency: string;
    billingInterval: string;
    trialDays?: number;
  } | null;
}

interface ApplicantPlan {
  _id: Types.ObjectId;
  name: string;
  price?: number;
  billingInterval?: string;
}

const LIST_VENDOR_FIELDS = "storeName logo status userId planId createdAt";
const APPLICATION_FIELDS =
  "vendorId userId status paymentStatus submittedAt approvedAt rejectedAt rejectionReason planSnapshot createdAt";

/**
 * The store's word for where an application stands (contract:
 * `VendorApplicationListItem.status`): what the vendor's status means to the
 * person deciding, with the application's own word for one never finished.
 */
function statusWord(vendor: ApplicantVendor, application: ApplicantApplication | null): string {
  if (vendor.status === VENDOR_STATUS.PENDING) {
    return vendorDecisionBlocker(vendor, application) === "NOT_SUBMITTED"
      ? String(application?.status)
      : "submitted";
  }
  if (vendor.status === VENDOR_STATUS.PAYMENT_REQUIRED) return VENDOR_STATUS.APPROVED;
  return vendor.status;
}

const iso = (value: Date | null | undefined) => (value ? new Date(value).toISOString() : undefined);

function listItem(
  vendor: ApplicantVendor,
  application: ApplicantApplication | null,
  plan: ApplicantPlan | null,
): VendorApplicationListItem {
  const logo = imageSet(vendor.logo, vendor.storeName);
  const submittedAt = iso(application?.submittedAt ?? vendor.createdAt);
  const planName = application?.planSnapshot?.name ?? plan?.name;
  return {
    id: String(vendor._id),
    storeName: vendor.storeName,
    ...(logo ? { logo } : {}),
    applicantName: vendor.user?.name ?? "",
    applicantEmail: vendor.user?.email ?? "",
    status: statusWord(vendor, application),
    ...(submittedAt ? { submittedAt } : {}),
    ...(planName ? { planName } : {}),
  };
}

/**
 * Each vendor's latest application, as `findLatestVendorApplication` picks
 * it (bound to the vendor or only to its owner, newest first), in one read.
 */
async function latestApplications(
  vendors: ApplicantVendor[],
): Promise<Map<string, ApplicantApplication>> {
  const found = new Map<string, ApplicantApplication>();
  if (vendors.length === 0) return found;
  const rows = await VendorApplication.find({
    $or: [
      { vendorId: { $in: vendors.map((vendor) => vendor._id) } },
      { userId: { $in: vendors.map((vendor) => vendor.userId).filter(Boolean) } },
    ],
  })
    .sort(VENDOR_APPLICATION_LATEST_SORT)
    .select(APPLICATION_FIELDS)
    .lean<ApplicantApplication[]>();
  for (const vendor of vendors) {
    const id = String(vendor._id);
    const owner = vendor.userId ? String(vendor.userId) : null;
    const latest = rows.find(
      (row) => String(row.vendorId ?? "") === id || (owner !== null && String(row.userId) === owner),
    );
    if (latest) found.set(id, latest);
  }
  return found;
}

/** The plans of vendors whose application carries no snapshot of one. */
async function plansWithoutSnapshot(
  vendors: ApplicantVendor[],
  applications: Map<string, ApplicantApplication>,
): Promise<Map<string, ApplicantPlan>> {
  const ids = vendors.flatMap((vendor) =>
    vendor.planId && !applications.get(String(vendor._id))?.planSnapshot ? [vendor.planId] : [],
  );
  if (ids.length === 0) return new Map();
  const plans = await VendorPlan.find({ _id: { $in: ids } })
    .select("name price billingInterval")
    .lean<ApplicantPlan[]>();
  return new Map(plans.map((plan) => [String(plan._id), plan]));
}

async function listPage(
  vendors: ApplicantVendor[],
  applications: Map<string, ApplicantApplication>,
): Promise<VendorApplicationListItem[]> {
  const plans = await plansWithoutSnapshot(vendors, applications);
  return vendors.map((vendor) =>
    listItem(
      vendor,
      applications.get(String(vendor._id)) ?? null,
      vendor.planId ? (plans.get(String(vendor.planId)) ?? null) : null,
    ),
  );
}

/**
 * GET /vendor-applications. The waiting ones oldest first, by when each was
 * last submitted — a rejected seller who applied again waits from their new
 * submission, which only the application knows — so that tab is ordered
 * here; the store has few applications waiting at once. Every other tab is
 * the newest shop first, on the vendor's `createdAt` index.
 */
export async function listVendorApplications(
  query: VendorApplicationListQuery,
): Promise<VendorApplicationList> {
  await connectDB();
  const tab = query.tab ?? "pending";
  const limit = query.limit ?? LIST_DEFAULT_LIMIT;
  const statuses = TAB_STATUSES[tab];
  const filter: Record<string, unknown> = {
    ...getExternalVendorFilter(),
    ...(statuses ? { status: { $in: statuses } } : {}),
    ...(query.search ? { storeName: { $regex: escapeRegExp(query.search), $options: "i" } } : {}),
  };

  if (tab === "pending") {
    const waiting = await Vendor.find(filter)
      .select("_id userId createdAt")
      .lean<ApplicantVendor[]>();
    const applications = await latestApplications(waiting);
    const since = (vendor: ApplicantVendor) =>
      new Date(applications.get(String(vendor._id))?.submittedAt ?? vendor.createdAt ?? 0);
    const ordered = waiting
      .map((vendor) => ({ vendor, at: since(vendor), id: String(vendor._id) }))
      .sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id));
    const after = query.cursor ? readTimeCursor(query.cursor) : null;
    const rest = after
      ? ordered.filter(
          ({ at, id }) =>
            at.getTime() > after.time.getTime() ||
            (at.getTime() === after.time.getTime() && id > String(after.id)),
        )
      : ordered;
    const page = rest.slice(0, limit);
    const full = await Vendor.find({ _id: { $in: page.map(({ vendor }) => vendor._id) } })
      .select(LIST_VENDOR_FIELDS)
      .populate("user", "name email")
      .lean<ApplicantVendor[]>();
    const byId = new Map(full.map((vendor) => [String(vendor._id), vendor]));
    const rows = page.map(({ id }) => byId.get(id)).filter((vendor): vendor is ApplicantVendor => Boolean(vendor));
    const last = page.at(-1);
    return {
      items: await listPage(rows, applications),
      nextCursor:
        rest.length > limit && last ? encodeTimeCursor({ createdAt: last.at, _id: last.vendor._id }) : null,
    };
  }

  const rows = await Vendor.find(
    query.cursor ? { $and: [filter, afterTimeCursor(query.cursor)] } : filter,
  )
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .select(LIST_VENDOR_FIELDS)
    .populate("user", "name email")
    .lean<ApplicantVendor[]>();
  const page = rows.slice(0, limit);
  return {
    items: await listPage(page, await latestApplications(page)),
    nextCursor: rows.length > limit ? encodeTimeCursor(page[page.length - 1]) : null,
  };
}

/**
 * A link the app can open for a stored document: a private file's signed,
 * short-lived link (inline, so a phone shows it rather than saving it), or a
 * file kept before documents were private, as it is. Nothing for a private
 * file on a legacy server's own disk, which has no link to sign.
 */
async function documentLink(
  reference: string,
  storage: () => Promise<StorageService>,
): Promise<string | undefined> {
  if (isVendorDocumentKey(reference)) {
    const download = await (await storage()).getPrivateDownload(reference, {
      expiresInSeconds: DOCUMENT_LINK_SECONDS,
      filename: reference.split("/").pop() || "document",
      disposition: "inline",
    });
    if (download.kind === "redirect") return download.url;
    await download.body.cancel().catch(() => undefined);
    return undefined;
  }
  return isVendorDocumentReference(reference) ? absoluteUrl(reference) : undefined;
}

/**
 * The vendor's documents, then the documents and answers of the store's own
 * application questions. A document that cannot be linked is left out (and
 * logged): the rest of the application still shows.
 */
async function documentsAndAnswers(
  vendor: ApplicantVendor,
  now: Date,
): Promise<{ documents: VendorApplicationDocument[]; answers: VendorApplicationAnswer[] }> {
  const expiresAt = new Date(now.getTime() + DOCUMENT_LINK_SECONDS * 1000).toISOString();
  let service: Promise<StorageService> | undefined;
  const storage = () => (service ??= getStorageService());

  const wanted: { kind: string; label?: string; reference: string }[] = [];
  for (const [field, kind] of DOCUMENT_KINDS) {
    const reference = vendor.documents?.[field]?.trim();
    if (reference) wanted.push({ kind, reference });
  }
  const answers: VendorApplicationAnswer[] = [];
  for (const [key, answer] of Object.entries(vendor.onboardingResponses ?? {})) {
    if (!answer || typeof answer !== "object") continue;
    const label = String(answer.label || key);
    if (typeof answer.value === "boolean") {
      answers.push({ label, value: answer.value ? "Yes" : "No", checked: answer.value });
    } else if (isVendorDocumentKey(answer.value)) {
      wanted.push({ kind: key, label, reference: answer.value as string });
    } else if (typeof answer.value === "string" && answer.value.trim()) {
      answers.push({ label, value: answer.value });
    }
  }

  const links = await Promise.all(
    wanted.map(({ reference }) =>
      documentLink(reference, storage).catch((error) => {
        console.error("Vendor application: could not link a document", String(vendor._id), error);
        return undefined;
      }),
    ),
  );
  const documents = wanted.flatMap(({ kind, label }, index) => {
    const url = links[index];
    return url ? [{ kind, ...(label ? { label } : {}), url, expiresAt }] : [];
  });
  return { documents, answers };
}

function addressOf(vendor: ApplicantVendor): VendorApplicationDetail["address"] {
  const fields = ["street", "city", "state", "postalCode", "country", "phone"] as const;
  const address = Object.fromEntries(
    fields.flatMap((field) => {
      const value = vendor.address?.[field];
      return typeof value === "string" && value.trim() ? [[field, value.trim()]] : [];
    }),
  );
  return Object.keys(address).length > 0 ? address : undefined;
}

const DETAIL_VENDOR_FIELDS =
  "isDefault slug storeName description logo banner status userId planId createdAt address socialLinks documents onboardingResponses";

/** GET /vendor-applications/{id}: one application, its documents signed now. */
export async function readVendorApplication(
  id: string,
  now = new Date(),
): Promise<VendorApplicationDetail> {
  await connectDB();
  const vendor = isValidObjectId(id)
    ? await Vendor.findById(id)
        .select(DETAIL_VENDOR_FIELDS)
        .populate("user", "name email")
        .lean<ApplicantVendor | null>()
    : null;
  if (!vendor || isDefaultVendorRecord(vendor)) {
    throw new MobileApiError(404, "NOT_FOUND", "There is no such vendor application.");
  }

  const application = await findLatestVendorApplication({ vendorId: vendor._id, userId: vendor.userId })
    .select(APPLICATION_FIELDS)
    .lean<ApplicantApplication | null>();
  // An admin-assigned plan has no snapshot; approval then reads the live
  // plan, and so does this (in the store's currency, with no trial: an admin
  // assignment never starts one).
  const [livePlan, currency, { documents, answers }] = await Promise.all([
    !application?.planSnapshot && vendor.planId
      ? VendorPlan.findById(vendor.planId).select("name price billingInterval").lean<ApplicantPlan | null>()
      : null,
    application?.planSnapshot || !vendor.planId ? null : readStoreCurrency(),
    documentsAndAnswers(vendor, now),
  ]);

  const snapshot = application?.planSnapshot;
  const plan = snapshot
    ? {
        name: snapshot.name,
        price: toMoney(snapshot.price, snapshot.currency),
        billingInterval: snapshot.billingInterval,
        trialDays: Math.max(0, Math.floor(Number(snapshot.trialDays ?? 0) || 0)),
      }
    : livePlan && currency
      ? {
          name: livePlan.name,
          price: toMoney(livePlan.price ?? 0, currency),
          billingInterval: String(livePlan.billingInterval ?? ""),
          trialDays: 0,
        }
      : undefined;

  const decidedAt =
    vendor.status === VENDOR_STATUS.APPROVED || vendor.status === VENDOR_STATUS.PAYMENT_REQUIRED
      ? iso(application?.approvedAt)
      : vendor.status === VENDOR_STATUS.REJECTED
        ? iso(application?.rejectedAt)
        : undefined;
  const banner = imageSet(vendor.banner, vendor.storeName);
  const address = addressOf(vendor);
  const website = absoluteUrl(vendor.socialLinks?.website);
  const taxId = vendor.documents?.taxId?.trim();
  const rejectionReason =
    vendor.status === VENDOR_STATUS.REJECTED ? application?.rejectionReason?.trim() : undefined;

  return {
    ...listItem(vendor, application, livePlan),
    description: vendor.description ?? "",
    ...(banner ? { banner } : {}),
    ...(address ? { address } : {}),
    ...(website ? { website } : {}),
    ...(taxId ? { taxId } : {}),
    documents,
    answers,
    ...(plan ? { plan } : {}),
    paymentStatus: application?.paymentStatus ?? "not_required",
    ...(decidedAt ? { decidedAt } : {}),
    ...(rejectionReason ? { rejectionReason } : {}),
    canDecide: vendorDecisionBlocker(vendor, application) === null,
  };
}
