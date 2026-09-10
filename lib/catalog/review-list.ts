import mongoose from "mongoose";
import { CustomerProfile, Review } from "@/models";
import { connectDB } from "@/lib/db";
import {
  countForQuery,
  listResult,
  resolveListSort,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Admin review list query.
 *
 * Shared by `GET /api/admin/reviews` and the reviews page's server component
 * so the endpoint and the rendered page always agree on what a given query
 * string means.
 */

interface AdminReviewListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  rating?: string | number;
  productId?: string;
  hasReply?: string;
  view?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

const SORT_FIELDS = ["createdAt", "rating", "isApproved"];

/** Exactly what the table cells and the reply dialog read. */
const LIST_PROJECTION =
  "rating title comment images isVerified isApproved reply.comment createdAt productId userId";

function buildReviewListFilter({
  search,
  status,
  rating,
  productId,
  hasReply,
  view,
}: Omit<AdminReviewListParams, "page" | "limit" | "sortBy" | "sortOrder">) {
  const andConditions: Record<string, unknown>[] = [];

  // The tab (`view`) and the status filter address the same field; the tab
  // wins when it names a concrete status.
  const effectiveStatus =
    view === "published" || view === "on_hold" ? view : status;
  if (effectiveStatus && effectiveStatus !== "all") {
    andConditions.push({ isApproved: effectiveStatus === "published" });
  }

  const effectiveHasReply =
    view === "with_reply" ? "yes" : view === "no_reply" ? "no" : hasReply;
  if (effectiveHasReply === "yes") {
    andConditions.push({ "reply.comment": { $exists: true, $ne: "" } });
  } else if (effectiveHasReply === "no") {
    andConditions.push({
      $or: [
        { reply: { $exists: false } },
        { "reply.comment": { $in: [null, ""] } },
      ],
    });
  }

  if (rating !== undefined && rating !== "all") {
    andConditions.push({ rating: Number(rating) });
  }

  if (productId) {
    andConditions.push({ productId: new mongoose.Types.ObjectId(productId) });
  }

  // `search` arrives regex-escaped from SafeSearchSchema.
  if (search) {
    andConditions.push({
      $or: [
        { title: { $regex: search, $options: "i" } },
        { comment: { $regex: search, $options: "i" } },
      ],
    });
  }

  return andConditions.length > 0 ? { $and: andConditions } : {};
}

export async function fetchAdminReviewList(
  params: AdminReviewListParams,
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, sortBy, sortOrder } = params;
  const query = buildReviewListFilter(params);
  const sort = resolveListSort({
    sortBy,
    sortOrder,
    allowed: SORT_FIELDS,
    // Neither rating nor isApproved is remotely unique, so both need the
    // `_id` tiebreaker or paging repeats and skips rows.
    unique: ["createdAt"],
  });

  const [reviews, total] = await Promise.all([
    Review.find(query)
      .select(LIST_PROJECTION)
      .populate("userId", "name email image")
      // Sliced to the cover because that is the only image the table renders.
      .populate({ path: "productId", select: { name: 1, images: { $slice: 1 } } })
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    countForQuery(Review, query),
  ]);

  // The reviewer's name links to their customer record, which lives on a
  // different collection — resolved for the page of rows we are returning.
  const reviewerIds = reviews
    .map((review) => {
      const user = review.userId as unknown;
      if (!user || typeof user !== "object") return null;
      return String((user as { _id?: unknown })._id || "");
    })
    .filter(Boolean);

  const customerProfiles =
    reviewerIds.length > 0
      ? await CustomerProfile.find({ userId: { $in: reviewerIds } })
          .select("_id userId")
          .lean()
      : [];

  const customerProfileByUserId = new Map(
    customerProfiles.map((profile) => [
      String(profile.userId),
      String(profile._id),
    ]),
  );

  const items = reviews.map((review) => {
    const user = review.userId as unknown;
    if (!user || typeof user !== "object") return review;

    const userId = String((user as { _id?: unknown })._id || "");
    const customerProfileId = customerProfileByUserId.get(userId);
    if (!customerProfileId) return review;

    return {
      ...review,
      userId: { ...(user as Record<string, unknown>), customerProfileId },
    };
  });

  return listResult(items as unknown[], page, limit, total);
}
