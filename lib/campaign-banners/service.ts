import "server-only";

import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { revalidateCampaignBannerContent } from "@/lib/cache-invalidation";
import { connectDB, mongoose } from "@/lib/db";
import { Coupon } from "@/models";
import { CampaignBanner } from "@/models/campaign-banner.model";
import { revalidateVendorCampaignBanners } from "./cache";
import {
  CAMPAIGN_BANNER_PROBLEMS,
  PLATFORM_CAMPAIGN_BANNER_LIMIT,
  VENDOR_CAMPAIGN_BANNER_LIMIT,
  campaignBannerLinkProblem,
  campaignBannerProblem,
  campaignBannerState,
  normalizeCampaignBannerFields,
  toCampaignBanner,
  type CampaignBanner as CampaignBannerView,
  type CampaignBannerFields,
  type CampaignBannerState,
} from "./types";

/**
 * Campaign Banner reads and writes for one owner. The platform's banners and
 * each vendor's share a collection, so the owner is applied to EVERY query
 * here, not by the callers: a vendor route that forgot would otherwise read
 * the platform's banners, or another vendor's.
 */
export type CampaignBannerOwnerRef =
  | { kind: "platform" }
  | { kind: "vendor"; vendorId: string };

/** The fields an editor may set; anything else in a payload is ignored. */
const EDITABLE_KEYS = [
  "name",
  "type",
  "status",
  "priority",
  "schedule",
  "content",
  "couponCode",
  "countdown",
  "signup",
  "rules",
] as const;

function ownerFilter(owner: CampaignBannerOwnerRef) {
  return {
    vendorId:
      owner.kind === "vendor"
        ? new mongoose.Types.ObjectId(owner.vendorId)
        : null,
  };
}

const limitFor = (owner: CampaignBannerOwnerRef) =>
  owner.kind === "vendor"
    ? VENDOR_CAMPAIGN_BANNER_LIMIT
    : PLATFORM_CAMPAIGN_BANNER_LIMIT;

/** Expire what the storefront cached, when a live banner moved. */
function revalidateFor(owner: CampaignBannerOwnerRef) {
  if (owner.kind === "platform") revalidateCampaignBannerContent();
  else revalidateVendorCampaignBanners(owner.vendorId);
}

async function findOwned(owner: CampaignBannerOwnerRef, id: string) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Campaign banner");
  await connectDB();
  const doc = await CampaignBanner.findOne({
    _id: id,
    ...ownerFilter(owner),
  }).lean();
  if (!doc) throw new NotFoundError("Campaign banner");
  return doc;
}

/**
 * A button link that is not a page or an https address is refused, and a
 * vendor's must stay on this marketplace — said out loud, because the
 * normalizer would otherwise drop it and save a banner with no link.
 */
function assertLink(owner: CampaignBannerOwnerRef, content: unknown) {
  const code = campaignBannerLinkProblem(content, owner.kind);
  if (code) throw new ValidationError(CAMPAIGN_BANNER_PROBLEMS[code]);
}

/** The advertised code must be one of the owner's own discounts. */
async function assertCoupon(owner: CampaignBannerOwnerRef, code: string) {
  if (!code) return;
  const owned = await Coupon.exists({ code, ...ownerFilter(owner) });
  if (!owned) {
    throw new ValidationError(
      "Pick one of your store's own discounts for the coupon",
    );
  }
}

async function assertRoom(owner: CampaignBannerOwnerRef) {
  const count = await CampaignBanner.countDocuments(ownerFilter(owner));
  if (count >= limitFor(owner)) {
    throw new ValidationError(
      `You can keep up to ${limitFor(owner)} campaign banners — delete one to add another`,
    );
  }
}

export async function listCampaignBanners(
  owner: CampaignBannerOwnerRef,
  options: { search?: string; state?: CampaignBannerState | "all"; now?: Date } = {},
): Promise<CampaignBannerView[]> {
  await connectDB();
  const query: Record<string, unknown> = { ...ownerFilter(owner) };
  if (options.search) query.name = { $regex: options.search, $options: "i" };
  const docs = await CampaignBanner.find(query)
    .sort({ updatedAt: -1 })
    .limit(limitFor(owner))
    .lean();
  const now = options.now ?? new Date();
  const banners = docs.map(toCampaignBanner);
  return options.state && options.state !== "all"
    ? banners.filter((banner) => campaignBannerState(banner, now) === options.state)
    : banners;
}

export async function getCampaignBanner(
  owner: CampaignBannerOwnerRef,
  id: string,
): Promise<CampaignBannerView> {
  return toCampaignBanner(await findOwned(owner, id));
}

export async function createCampaignBanner(
  owner: CampaignBannerOwnerRef,
  input: Record<string, unknown>,
  createdBy: string,
): Promise<CampaignBannerView> {
  assertLink(owner, input.content);
  const fields = normalizeCampaignBannerFields(input, owner.kind);
  const problem = campaignBannerProblem(fields);
  if (problem) throw new ValidationError(problem);
  await connectDB();
  await assertRoom(owner);
  await assertCoupon(owner, fields.couponCode);

  const doc = await CampaignBanner.create({
    ...fields,
    ...ownerFilter(owner),
    createdBy,
  });
  const created = toCampaignBanner(doc.toObject());
  if (created.status === "active") revalidateFor(owner);
  return created;
}

export async function updateCampaignBanner(
  owner: CampaignBannerOwnerRef,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ before: CampaignBannerView; after: CampaignBannerView }> {
  const before = toCampaignBanner(await findOwned(owner, id));
  assertLink(owner, patch.content);

  const submitted: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) {
    if (patch[key] !== undefined) submitted[key] = patch[key];
  }
  // Fields a payload leaves out keep their stored value; a nested object it
  // sends replaces the stored one whole (the editor posts each section whole).
  const fields = normalizeCampaignBannerFields(
    { ...before, ...submitted },
    owner.kind,
  );
  const problem = campaignBannerProblem(fields);
  if (problem) throw new ValidationError(problem);
  // Only a changed code is checked: pausing a banner whose discount has since
  // been deleted must still work.
  if (fields.couponCode !== before.couponCode) {
    await assertCoupon(owner, fields.couponCode);
  }

  const doc = await CampaignBanner.findOneAndUpdate(
    { _id: id, ...ownerFilter(owner) },
    { $set: fields },
    { returnDocument: "after" },
  ).lean();
  if (!doc) throw new NotFoundError("Campaign banner");
  const after = toCampaignBanner(doc);
  if (before.status === "active" || after.status === "active") {
    revalidateFor(owner);
  }
  return { before, after };
}

export async function deleteCampaignBanner(
  owner: CampaignBannerOwnerRef,
  id: string,
): Promise<CampaignBannerView> {
  const doc = await findOwned(owner, id);
  await CampaignBanner.deleteOne({ _id: doc._id, ...ownerFilter(owner) });
  const removed = toCampaignBanner(doc);
  if (removed.status === "active") revalidateFor(owner);
  return removed;
}

/** A copy lands as a draft: duplicating a live banner must not double it on the shop. */
export async function duplicateCampaignBanner(
  owner: CampaignBannerOwnerRef,
  id: string,
  createdBy: string,
): Promise<CampaignBannerView> {
  const source = toCampaignBanner(await findOwned(owner, id));
  await assertRoom(owner);
  const copy: CampaignBannerFields = {
    // Through the normalizer so ids and timestamps never ride along.
    ...normalizeCampaignBannerFields(source, owner.kind),
    name: `${source.name.slice(0, 92)} (copy)`,
    status: "draft",
  };
  const doc = await CampaignBanner.create({
    ...copy,
    ...ownerFilter(owner),
    createdBy,
  });
  return toCampaignBanner(doc.toObject());
}
