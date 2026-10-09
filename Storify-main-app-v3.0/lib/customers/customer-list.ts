import { Types } from "mongoose";
import type { PipelineStage } from "mongoose";
import { CustomerProfile, Order, User } from "@/models";
import { connectDB } from "@/lib/db";
import { USER_ACCOUNT_STATUS } from "@/config/app.config";
import { listResult, type ListResult } from "@/lib/api/list-query";
import {
  buildStaffOrderScopeFilter,
  hasStaffScope,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import { NON_CUSTOMER_ACCOUNT_FILTER } from "@/lib/access/customer-account";
import { isLoyaltyEnabled } from "@/lib/customers/loyalty";
import { emailConsentStateFilter } from "@/lib/customers/marketing-consent";
import { placedOrderMatch } from "@/lib/orders/order-payment-status";
import { POS_WALK_IN_EXPR } from "@/lib/orders/pos-walk-in";
import { MARKETING_CONSENT_STATE } from "@/config/app.config";
import type { MarketingConsentState } from "@/config/app.config";

/**
 * Admin/staff customer list query.
 *
 * Shared by `GET /api/admin/customers` and the customers page's server
 * component so the endpoint and the rendered page always agree on what a
 * given query string means.
 */

interface AdminCustomerListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  loyaltyTier?: string;
  /** Email marketing consent state, as the "Email subscription" filter sends it. */
  subscription?: string;
  tag?: string;
  minSpent?: number;
  maxSpent?: number;
}

/**
 * The list's filters without its paging and sort — what "everyone matching"
 * means for an action taken on the whole filtered list.
 */
export type AdminCustomerListFilter = Pick<
  AdminCustomerListParams,
  | "search"
  | "status"
  | "loyaltyTier"
  | "subscription"
  | "tag"
  | "minSpent"
  | "maxSpent"
>;

/** User fields the customer list can sort by; they live behind the join. */
const USER_SORT_FIELDS = new Set(["name", "email", "status"]);

/**
 * Guest rows have no user to join, so the list keeps them through a
 * preserving unwind and renders identity from the profile's own guest
 * fields. This also squares the page with its count: the old strict unwind
 * silently dropped user-less profiles from the rows while the count
 * pipeline (which skips the join entirely on the default listing) still
 * counted them, so the total advertised customers the list never showed.
 */
export const USER_UNWIND: PipelineStage = {
  $unwind: { path: "$user", preserveNullAndEmptyArrays: true },
};

export const USER_LOOKUP: PipelineStage = {
  $lookup: {
    from: "user",
    localField: "userId",
    foreignField: "_id",
    as: "user",
    pipeline: [
      {
        $project: {
          name: 1,
          email: 1,
          image: 1,
          phone: 1,
          role: 1,
          status: 1,
          createdAt: 1,
        },
      },
    ],
  },
};

/**
 * The admins, vendors and staff whose customer profiles the admin list and
 * its stats leave out. Such an account can hold one — made at sign-up before
 * it had the role, or by opening its own account page or placing an order —
 * and it stays theirs (orders, points) if the role goes away; only the
 * customer list is not the place for it. These accounts are few beside the
 * shoppers, so they are listed once and their profiles excluded up front,
 * instead of joining every profile to its user before the page is cut.
 */
export async function fetchNonCustomerUserIds(): Promise<Types.ObjectId[]> {
  const users = await User.find(NON_CUSTOMER_ACCOUNT_FILTER)
    .select("_id")
    .lean<{ _id: Types.ObjectId }[]>();
  return users.map((user) => user._id);
}

export function matchStage(
  conditions: Record<string, unknown>[],
): PipelineStage | null {
  if (conditions.length === 1) return { $match: conditions[0] };
  if (conditions.length > 1) return { $match: { $and: conditions } };
  return null;
}

/**
 * The search box and status tabs, in filter form — shared by the admin and
 * vendor lists so a "guest" or "active" tab means the same thing on both.
 * Search spans the joined user and the profile's own guest identity; the
 * account-status tabs exclude guest rows (they have no account, and the
 * Active tab's legacy-null branch would otherwise scoop them all up), which
 * instead answer to `status === "guest"`.
 */
function applyCustomerIdentityFilters(
  { search, status }: { search?: string; status?: string },
  profileConditions: Record<string, unknown>[],
  userConditions: Record<string, unknown>[],
) {
  if (search) {
    userConditions.push({
      $or: [
        { "user.name": { $regex: search, $options: "i" } },
        { "user.email": { $regex: search, $options: "i" } },
        // Guest rows keep identity on the profile itself.
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ],
    });
  }
  if (status === "guest") {
    profileConditions.push({ isGuest: true });
  } else if (
    status &&
    status !== "all" &&
    Object.values(USER_ACCOUNT_STATUS).includes(
      status as (typeof USER_ACCOUNT_STATUS)[keyof typeof USER_ACCOUNT_STATUS],
    )
  ) {
    userConditions.push({ "user._id": { $exists: true } });
    if (status === USER_ACCOUNT_STATUS.ACTIVE) {
      // Legacy users without status should behave like active accounts.
      userConditions.push({
        $or: [
          { "user.status": USER_ACCOUNT_STATUS.ACTIVE },
          { "user.status": { $exists: false } },
          { "user.status": null },
        ],
      });
    } else {
      userConditions.push({ "user.status": status });
    }
  }
}

interface AdminCustomerStats {
  totalCustomers: number;
  activeCustomers: number;
  vipCustomers: number;
  totalSpend: number;
  avgSpendPerCustomer: number;
}

/**
 * Counters for the customers stats strip.
 *
 * One pass instead of the four-branch `$facet` this replaced (whose
 * sub-pipelines cannot use an index, and which re-ran the user `$lookup`
 * inside one branch). The staff page carried its own copy that matched
 * `status` and summed `totalSpend` — neither field exists on CustomerProfile,
 * so it reported 0 active customers and 0 spend; sharing this one fixes that.
 */
export async function fetchAdminCustomerStats(): Promise<AdminCustomerStats> {
  await connectDB();

  // "Active" is an account state (a guest row has none and never counts), so
  // the count needs the linked user's status. Joining every profile to its
  // user with a $lookup made this grow linearly with the customer base on
  // every load of the customers page. Non-active accounts are rare, so list
  // those once and subtract the profiles they own instead. The admins,
  // vendors and staff the list leaves out count nowhere here either.
  const [nonCustomerIds, inactiveUsers] = await Promise.all([
    fetchNonCustomerUserIds(),
    User.find({
      status: { $exists: true, $ne: USER_ACCOUNT_STATUS.ACTIVE },
      $nor: [NON_CUSTOMER_ACCOUNT_FILTER],
    })
      .select("_id")
      .lean(),
  ]);

  // A profile whose user record is missing, or whose user has no status at
  // all, counted as active before and still does: only an explicit non-active
  // status removes it.
  const [totals, inactiveCustomers] = await Promise.all([
    CustomerProfile.aggregate<{
      totalCustomers: number;
      accountCustomers: number;
      vipCustomers: number;
      totalSpend: number;
    }>([
      { $match: { userId: { $nin: nonCustomerIds } } },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          accountCustomers: {
            $sum: { $cond: [{ $ne: ["$isGuest", true] }, 1, 0] },
          },
          vipCustomers: {
            $sum: {
              $cond: [{ $in: ["$loyaltyTier", ["gold", "platinum"]] }, 1, 0],
            },
          },
          totalSpend: { $sum: { $ifNull: ["$stats.totalSpent", 0] } },
        },
      },
    ]).then((rows) => rows[0]),
    inactiveUsers.length
      ? CustomerProfile.countDocuments({
          isGuest: { $ne: true },
          userId: { $in: inactiveUsers.map((user) => user._id) },
        })
      : 0,
  ]);

  const totalCustomers = totals?.totalCustomers ?? 0;
  const totalSpend = totals?.totalSpend ?? 0;

  return {
    totalCustomers,
    activeCustomers: Math.max(
      0,
      (totals?.accountCustomers ?? 0) - inactiveCustomers,
    ),
    vipCustomers: totals?.vipCustomers ?? 0,
    totalSpend,
    avgSpendPerCustomer: totalCustomers > 0 ? totalSpend / totalCustomers : 0,
  };
}

/** Scoped staff see the customers of the orders they can see. */
async function staffScopeProfileCondition(
  staffScope?: StaffAccessScope | null,
): Promise<Record<string, unknown> | null> {
  if (!hasStaffScope(staffScope)) return null;
  const scopeFilter = buildStaffOrderScopeFilter(staffScope);
  const [customerIds, guestEmails] = await Promise.all([
    Order.distinct("customerId", scopeFilter),
    // Guest orders carry no usable customerId (it points at the guest's
    // cart), so scoped staff match their customers by checkout email.
    Order.distinct("guestEmail", {
      ...scopeFilter,
      guestEmail: { $exists: true, $ne: null },
    }),
  ]);
  return {
    $or: [
      { userId: { $in: customerIds } },
      ...(guestEmails.length > 0
        ? [{ isGuest: true, email: { $in: guestEmails } }]
        : []),
    ],
  };
}

/** The profiles the admin list covers before any filter or tab. */
async function customerProfileConditions(
  staffScope?: StaffAccessScope | null,
): Promise<Record<string, unknown>[]> {
  const [nonCustomerIds, staffScopeCondition] = await Promise.all([
    fetchNonCustomerUserIds(),
    staffScopeProfileCondition(staffScope),
  ]);
  return [
    { userId: { $nin: nonCustomerIds } },
    ...(staffScopeCondition ? [staffScopeCondition] : []),
  ];
}

/** The list's All-tab total, for a dashboard that shows only the count. */
export async function countAdminCustomers(
  staffScope?: StaffAccessScope | null,
): Promise<number> {
  await connectDB();
  return CustomerProfile.countDocuments({
    $and: await customerProfileConditions(staffScope),
  });
}

/**
 * What the admin list's query string means, as conditions: the ones on the
 * profile itself, and the ones that need its user joined first. The list
 * page and every "everyone matching this filter" action build from here, so
 * an action can never reach a customer the list would not have shown.
 */
export async function buildAdminCustomerListConditions(
  filter: AdminCustomerListFilter,
  staffScope?: StaffAccessScope | null,
): Promise<{
  profileConditions: Record<string, unknown>[];
  userConditions: Record<string, unknown>[];
}> {
  const {
    search,
    status,
    loyaltyTier,
    subscription,
    tag,
    minSpent,
    maxSpent,
  } = filter;

  const profileConditions = await customerProfileConditions(staffScope);
  const userConditions: Record<string, unknown>[] = [];

  // A hidden filter must not narrow the list: while loyalty is off an old
  // `?tier=gold` link shows every customer, as the page without it would.
  if (loyaltyTier && isLoyaltyEnabled()) profileConditions.push({ loyaltyTier });
  // Rows written before the consent record carry only the old boolean, so the
  // filter has to speak both — see `emailConsentStateFilter`.
  if (subscription) {
    profileConditions.push(
      emailConsentStateFilter(subscription as MarketingConsentState),
    );
  }
  if (tag) profileConditions.push({ tags: tag });
  if (minSpent !== undefined || maxSpent !== undefined) {
    const totalSpentFilter: Record<string, number> = {};
    if (minSpent !== undefined) totalSpentFilter.$gte = minSpent;
    if (maxSpent !== undefined) totalSpentFilter.$lte = maxSpent;
    profileConditions.push({ "stats.totalSpent": totalSpentFilter });
  }

  applyCustomerIdentityFilters(
    { search, status },
    profileConditions,
    userConditions,
  );

  return { profileConditions, userConditions };
}

export async function fetchAdminCustomerList(
  params: AdminCustomerListParams,
  staffScope?: StaffAccessScope | null,
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, sortBy, sortOrder } = params;
  const { profileConditions, userConditions } =
    await buildAdminCustomerListConditions(params, staffScope);

  const sortField = sortBy || "createdAt";
  const sortDir = sortOrder === "asc" ? 1 : -1;
  // The user join is expensive, so partition the work: anything on the
  // CustomerProfile itself is matched/sorted/paginated BEFORE the $lookup so
  // only the page of rows we return gets joined. Only a user-field filter or
  // sort forces the join first.
  const needsUserBeforePage =
    userConditions.length > 0 || USER_SORT_FIELDS.has(sortField);

  const pipeline: PipelineStage[] = [];
  const countPipeline: PipelineStage[] = [];
  const profileMatch = matchStage(profileConditions);
  if (profileMatch) {
    pipeline.push(profileMatch);
    countPipeline.push(profileMatch);
  }

  if (needsUserBeforePage) {
    const userMatch = matchStage(userConditions);
    pipeline.push(USER_LOOKUP, USER_UNWIND);
    countPipeline.push(USER_LOOKUP, USER_UNWIND);
    if (userMatch) {
      pipeline.push(userMatch);
      countPipeline.push(userMatch);
    }
    // User fields live under the unwound `user` subdocument here — sorting on
    // the bare field name would match nothing (all docs missing → no-op).
    const effectiveSortField = USER_SORT_FIELDS.has(sortField)
      ? `user.${sortField}`
      : sortField;
    pipeline.push({ $sort: { [effectiveSortField]: sortDir, _id: sortDir } });
    pipeline.push({ $skip: (page - 1) * limit }, { $limit: limit });
  } else {
    pipeline.push({ $sort: { [sortField]: sortDir, _id: sortDir } });
    pipeline.push({ $skip: (page - 1) * limit }, { $limit: limit });
    pipeline.push(USER_LOOKUP, USER_UNWIND);
  }
  countPipeline.push({ $count: "total" });

  const [customers, countResult] = await Promise.all([
    CustomerProfile.aggregate(pipeline),
    CustomerProfile.aggregate(countPipeline),
  ]);

  return listResult(
    customers as unknown[],
    page,
    limit,
    countResult[0]?.total || 0,
  );
}

/**
 * Every tag on the customers this viewer can see, for the list's Tag filter.
 * Read from the whole collection: built from the rows on the current page, a
 * tag on no visible row could not be picked, though filtering by it is the
 * only way to reach those customers.
 */
export async function fetchAdminCustomerTags(
  staffScope?: StaffAccessScope | null,
): Promise<string[]> {
  await connectDB();
  const tags = await CustomerProfile.distinct("tags", {
    $and: await customerProfileConditions(staffScope),
  });
  return (tags as unknown[])
    .filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
    .sort((a, b) => a.localeCompare(b));
}

interface VendorCustomerListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  /** Email marketing consent state, as the "Email subscription" filter sends it. */
  subscription?: string;
  tag?: string;
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

type VendorStats = {
  totalOrders: number;
  totalSpent: number;
  lastOrderDate: Date | null;
};

/**
 * Who has bought from a vendor, and what they bought: one pass over the
 * vendor's orders. Money follows the same "actually collected" rule as the
 * profile stats (paid-ish payment status, or a delivered COD order);
 * membership only needs the order to not be cancelled, so a shopper with one
 * pending order is already visible with zeroed figures.
 *
 * But a checkout abandoned at a gateway is not a shopper of this vendor's.
 * It sits on `pending` and was counted here, so a vendor's customer list
 * filled up with people who had reached a payment page and closed it — every
 * one of them with zeroes in every column, because the money rule below has
 * always been right about them.
 */
async function loadVendorPurchasers(vendorObjectId: Types.ObjectId) {
  const purchasers = await Order.aggregate([
    {
      $match: {
        "subOrders.vendorId": vendorObjectId,
        status: { $ne: "cancelled" },
        ...placedOrderMatch(),
        // A walk-in POS sale is filed under its cashier — often this vendor —
        // and is nobody's purchase (lib/orders/pos-walk-in.ts).
        $expr: { $not: [POS_WALK_IN_EXPR] },
      },
    },
    {
      $addFields: {
        vendorSpent: {
          $sum: {
            $map: {
              input: {
                $filter: {
                  input: "$subOrders",
                  as: "so",
                  cond: { $eq: ["$$so.vendorId", vendorObjectId] },
                },
              },
              as: "so",
              in: { $ifNull: ["$$so.subtotal", 0] },
            },
          },
        },
        collected: {
          $or: [
            {
              $in: [
                "$paymentStatus",
                ["paid", "partially_paid", "partially_refunded", "refunded"],
              ],
            },
            { $eq: ["$status", "delivered"] },
          ],
        },
        isGuestOrder: { $eq: [{ $type: "$guestEmail" }, "string"] },
      },
    },
    {
      $group: {
        _id: { $cond: ["$isGuestOrder", "$guestEmail", "$customerId"] },
        isGuest: { $max: "$isGuestOrder" },
        totalOrders: { $sum: { $cond: ["$collected", 1, 0] } },
        totalSpent: { $sum: { $cond: ["$collected", "$vendorSpent", 0] } },
        lastOrderDate: { $max: "$createdAt" },
      },
    },
  ]);

  const registeredIds: Types.ObjectId[] = [];
  const guestEmails: string[] = [];
  const vendorStats = new Map<string, VendorStats>();
  for (const row of purchasers) {
    if (!row._id) continue;
    if (row.isGuest) {
      guestEmails.push(String(row._id));
      vendorStats.set(`g:${row._id}`, row);
    } else {
      registeredIds.push(row._id);
      vendorStats.set(`u:${row._id}`, row);
    }
  }

  // The profiles those shoppers are: registered buyers by user, guests by the
  // checkout email their orders carry. Null when nobody has bought.
  const membership: Record<string, unknown> | null =
    registeredIds.length === 0 && guestEmails.length === 0
      ? null
      : {
          $or: [
            { userId: { $in: registeredIds } },
            ...(guestEmails.length > 0
              ? [{ isGuest: true, email: { $in: guestEmails } }]
              : []),
          ],
        };

  return { membership, vendorStats };
}

/**
 * Every tag on this seller's customers, for the list's Tag filter — the same
 * reason as the admin's (a tag on no visible row could not otherwise be
 * picked), but read only from the people who have bought from them, never the
 * store-wide list.
 */
export async function fetchVendorCustomerTags(
  vendorId: Types.ObjectId | string,
): Promise<string[]> {
  await connectDB();
  const { membership } = await loadVendorPurchasers(
    new Types.ObjectId(String(vendorId)),
  );
  if (!membership) return [];
  const tags = await CustomerProfile.distinct("tags", membership);
  return (tags as unknown[])
    .filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "")
    .sort((a, b) => a.localeCompare(b));
}

/**
 * A vendor's customer list: everyone — registered or guest — with a
 * non-cancelled order containing this vendor's items.
 *
 * Two things distinguish it from the admin list. Membership comes from the
 * vendor's own orders (see `loadVendorPurchasers`). And the stats on every row
 * are VENDOR-SCOPED — orders with this vendor, money spent on this vendor's
 * sub-orders — never the store-wide figures cached on the profile, which
 * would hand one vendor a readout of a customer's business with every other
 * vendor. Platform CRM fields (tags, notes, loyalty) are projected away for
 * the same reason: the Email subscription and Tag filters narrow the list
 * without putting the tags on a row, and a row carries only the consent
 * state, never its history or source.
 */
export async function fetchVendorCustomerList(
  vendorId: Types.ObjectId | string,
  params: VendorCustomerListParams,
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, search, status, sortBy, sortOrder, subscription, tag } =
    params;
  const vendorObjectId = new Types.ObjectId(String(vendorId));

  const { membership, vendorStats } = await loadVendorPurchasers(vendorObjectId);
  if (!membership) return listResult([], page, limit, 0);

  const profileConditions: Record<string, unknown>[] = [membership];
  // The same filters the admin list has, spoken the same way — see
  // `emailConsentStateFilter` for the rows that predate the consent record.
  if (subscription) {
    profileConditions.push(
      emailConsentStateFilter(subscription as MarketingConsentState),
    );
  }
  if (tag) profileConditions.push({ tags: tag });
  const userConditions: Record<string, unknown>[] = [];
  applyCustomerIdentityFilters({ search, status }, profileConditions, userConditions);

  const sortField = sortBy || "createdAt";
  const sortDir = sortOrder === "asc" ? 1 : -1;
  const effectiveSortField = USER_SORT_FIELDS.has(sortField)
    ? `user.${sortField}`
    : sortField;

  // Vendor membership sets are small, so the join always runs up front — no
  // need for the admin list's join-after-page optimization.
  const basePipeline: PipelineStage[] = [];
  const profileMatch = matchStage(profileConditions);
  if (profileMatch) basePipeline.push(profileMatch);
  basePipeline.push(USER_LOOKUP, USER_UNWIND);
  const userMatch = matchStage(userConditions);
  if (userMatch) basePipeline.push(userMatch);

  const pipeline: PipelineStage[] = [
    ...basePipeline,
    // The one consent fact a row keeps is the state the Email subscription
    // filter matches on, read the way that filter reads it: a profile that
    // predates the consent record has only the old boolean.
    {
      $addFields: {
        consentState: {
          $ifNull: [
            "$emailMarketing.state",
            {
              $cond: [
                "$marketingOptIn",
                MARKETING_CONSENT_STATE.SUBSCRIBED,
                MARKETING_CONSENT_STATE.NOT_SUBSCRIBED,
              ],
            },
          ],
        },
      },
    },
    // Platform CRM stays with the platform: no tags, notes, loyalty balance,
    // marketing consent history, or preferences in a vendor-facing row.
    {
      $project: {
        tags: 0,
        notes: 0,
        loyaltyPoints: 0,
        lifetimePoints: 0,
        loyaltyTier: 0,
        marketingOptIn: 0,
        emailMarketing: 0,
        smsMarketing: 0,
        marketingConsentHistory: 0,
        unsubscribeToken: 0,
        emailNotifications: 0,
        preferredCategories: 0,
        preferredPaymentMethod: 0,
        preferredCurrency: 0,
        preferredLanguage: 0,
        sizePreferences: 0,
        acquisitionSource: 0,
        referredBy: 0,
      },
    },
    { $sort: { [effectiveSortField]: sortDir, _id: sortDir } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
  ];
  const countPipeline: PipelineStage[] = [...basePipeline, { $count: "total" }];

  const [customers, countResult] = await Promise.all([
    CustomerProfile.aggregate(pipeline),
    CustomerProfile.aggregate(countPipeline),
  ]);

  const rows = (customers as Array<Record<string, unknown>>).map((row) => {
    const { consentState, ...profile } = row;
    const key = row.isGuest ? `g:${row.email}` : `u:${String(row.userId)}`;
    const stats = vendorStats.get(key);
    return {
      ...profile,
      emailMarketing: { state: consentState },
      stats: {
        totalOrders: stats?.totalOrders ?? 0,
        totalSpent: round2(stats?.totalSpent ?? 0),
        averageOrderValue: stats?.totalOrders
          ? round2((stats.totalSpent ?? 0) / stats.totalOrders)
          : 0,
        lastOrderDate: stats?.lastOrderDate ?? null,
        totalReviews: 0,
        totalWishlistItems: 0,
      },
    };
  });

  return listResult(rows, page, limit, countResult[0]?.total || 0);
}
