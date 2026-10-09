import { Types, type PipelineStage } from "mongoose";
import { connectDB } from "@/lib/db";
import { Order, Product, QuoteRequest } from "@/models";
import { ORDER_STATUS, PAYMENT_STATUS } from "@/config/app.config";
import {
  listResult,
  parsePageLimit,
  serializeRows,
  type ListResult,
} from "@/lib/api/list-query";
import { sanitizeSearchString } from "@/lib/api/validate";
import {
  hasStaffScope,
  mergeScopeFilter,
  type StaffAccessScope,
} from "@/lib/access/staff-scope";
import {
  isQuoteListTab,
  QUOTE_TAB_STAGES,
  QUOTE_WON_PAYMENT_STATUSES,
  quoteOfferRole,
  quoteOfferWithdrawnRole,
  type QuoteActorRole,
  type QuoteOfferState,
  type QuoteRequestStatus,
  type QuoteStage,
} from "@/lib/quotes/quote-status";
import { resolveOfferStates } from "@/lib/quotes/quote-offer";
import {
  quoteLotLimit,
  type QuoteLotLimit,
  type QuoteLotProduct,
} from "@/lib/quotes/quote-lot";

/**
 * Reading side of the quote inbox: the admin Quotes page (a server component
 * that calls these directly), `/api/admin/quotes`, the vendor's own Quotes
 * page and `/api/vendor/quotes`, and the shopper's own list. Filtering,
 * scoping, the derived stage and pagination all live here rather than being
 * restated at each boundary.
 *
 * The admin and vendor readers are separate functions on purpose. The admin
 * ones take an optional staff scope, and no scope means "every quote" — right
 * for an admin, and exactly the leak a vendor page would cause by forgetting
 * to pass one. The vendor ones take the vendor as a required argument and
 * match on it before anything else runs.
 */

/** The price the merchant sent back, as the tables read it. */
export type QuoteOfferRow = {
  unitPrice: number;
  quantity: number;
  note?: string;
  expiresAt?: string;
  offeredAt: string;
  withdrawnAt?: string;
  /** Whether the store or the vendor sent it; `admin` for every older offer. */
  offeredByRole: QuoteActorRole;
  /** Who pulled it back, when it was; `admin` for every older withdrawal. */
  withdrawnByRole?: QuoteActorRole;
};

/** A row of the shopper's own list at /account/quotes. */
export type QuoteRequestRow = {
  _id: string;
  productId: string;
  productName: string;
  productSlug?: string;
  /** The variant the price is for — the cart takes a variant product with one. */
  variantId?: string;
  variantName?: string;
  quantity: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  message?: string;
  status: QuoteRequestStatus;
  adminNote?: string;
  offer?: QuoteOfferRow;
  /**
   * Whether that offer is still open, and if not why — derived from its expiry
   * and the order it was spent on, never stored. See lib/quotes/quote-offer.ts.
   */
  offerState: QuoteOfferState;
  /** The order the offer was spent on, when one was placed. */
  orderId?: string;
  createdAt: string;
  updatedAt: string;
};

/** The order an offer was spent on, as much of it as the Quotes page shows. */
export type AdminQuoteOrder = {
  _id: string;
  orderNumber?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  createdAt?: string;
};

/**
 * A row of the Quotes table — the admin's, and the vendor's, which is the same
 * row with what the vendor may not see left out by the query itself.
 */
export type AdminQuoteRow = {
  _id: string;
  productId: string;
  /** The seller whose product it is, as the quote recorded it. */
  vendorId?: string;
  productName: string;
  productSlug?: string;
  variantId?: string;
  variantName?: string;
  /** What the shopper asked for. */
  quantity: number;
  name: string;
  /** Absent on a vendor's row while the store hides contact details. */
  email?: string;
  phone?: string;
  /**
   * True on a vendor's row when the store hides the shopper's email and phone
   * from vendors (Vendors → Configuration). The fields are not in the row at
   * all — they never left the database.
   */
  contactHidden?: boolean;
  company?: string;
  message?: string;
  /** Set when the request belongs to an account; guests leave it empty. */
  userId?: string;
  /** The stored status. Only `lost` still means anything to the page. */
  status: QuoteRequestStatus;
  /** Who closed it as lost, while it is; `admin` when not recorded. */
  lostByRole?: QuoteActorRole;
  stage: QuoteStage;
  /**
   * The store has priced this quote at some point, so its price is the
   * store's — see `quotePricedByAdmin`.
   */
  pricedByAdmin: boolean;
  offer?: QuoteOfferRow;
  /** Unit price × quantity of the current offer; null without one. */
  offerTotal: number | null;
  order: AdminQuoteOrder | null;
  productImage?: string;
  /** What the cart will let one order take of this quote's product. */
  lot: QuoteLotLimit;
  createdAt: string;
  updatedAt: string;
};

export type AdminQuoteVariantOption = {
  _id: string;
  name: string;
  lot: QuoteLotLimit;
};

/** One quote with everything the detail sheet and the price dialog read. */
export type AdminQuoteDetail = AdminQuoteRow & {
  /**
   * Set on the answer to sending a price: how many other open prices the same
   * shopper held for this product and variant, now withdrawn in its favour.
   */
  replacedOffers?: number;
  /** The store's own note. Never in the vendor's copy. */
  adminNote?: string;
  /** The vendor's own note; the store reads it, only the vendor writes it. */
  vendorNote?: string;
  /** Earlier offers, oldest first. */
  offerHistory: QuoteOfferRow[];
  productInfo: {
    exists: boolean;
    status?: string;
    priceOnRequest: boolean;
    /** Every variant the price could be for, with its own ceiling. */
    variants: AdminQuoteVariantOption[];
  };
};

type AdminQuoteStats = {
  needsReply: number;
  offersOpen: number;
  /** What the open offers add up to. */
  offersOpenValue: number;
  expired: number;
  /** Ordered and won together: the quotes that became orders. */
  ordered: number;
  orderedValue: number;
};

/**
 * Staff see only the vendors they are scoped to. A quote carries the product's
 * vendor, so the same scope that hides a product from a staff member hides the
 * requests about it — an unscoped staff member (no vendorIds) sees everything,
 * exactly as they do on the product list.
 */
export function buildQuoteScopeFilter(scope?: StaffAccessScope | null) {
  if (!hasStaffScope(scope) || scope!.vendorIds.length === 0) return {};
  return { vendorId: { $in: scope!.vendorIds } };
}

/**
 * The same scope for an aggregation, which Mongoose does not cast: the string
 * ids have to become ObjectIds here or `$in` matches nothing.
 */
function aggregateScopeFilter(
  scope?: StaffAccessScope | null,
): Record<string, unknown> {
  if (!hasStaffScope(scope) || scope!.vendorIds.length === 0) return {};
  return {
    vendorId: {
      $in: scope!.vendorIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id)),
    },
  };
}

/**
 * The one vendor's quotes, and nothing else — the filter every vendor read
 * and write starts from. An id that is not an ObjectId matches nothing rather
 * than falling through to an unfiltered query.
 */
export function buildVendorQuoteFilter(
  vendorId: string | Types.ObjectId,
): Record<string, unknown> {
  const id = String(vendorId);
  return Types.ObjectId.isValid(id)
    ? { vendorId: new Types.ObjectId(id) }
    : { _id: { $exists: false } };
}

/** What a vendor's view of its quotes is allowed to carry. */
export type VendorQuoteView = {
  vendorId: string | Types.ObjectId;
  /** The store's switch: may vendors see the shopper's email and phone? */
  showContact: boolean;
};

const NUMBER_TYPES = ["double", "int", "long", "decimal"];
const HAS_OFFER = { $in: [{ $type: "$offer.unitPrice" }, NUMBER_TYPES] };

/** An offer the store sent, or pulled back (absent roles read as the store). */
function storeActedOn(path: string) {
  return {
    $or: [
      { $ne: [`${path}.offeredByRole`, "vendor"] },
      {
        $and: [
          { $ne: [{ $ifNull: [`${path}.withdrawnAt`, null] }, null] },
          { $ne: [`${path}.withdrawnByRole`, "vendor"] },
        ],
      },
    ],
  };
}

/**
 * `quotePricedByAdmin`, in the database: any offer, current or earlier, the
 * store sent or withdrew. The list drops `offerHistory` from what it returns,
 * so the answer is worked out before that.
 */
const PRICED_BY_ADMIN = {
  $or: [
    { $and: [HAS_OFFER, storeActedOn("$offer")] },
    {
      $anyElementTrue: [
        {
          $map: {
            input: { $ifNull: ["$offerHistory", []] },
            as: "earlier",
            in: storeActedOn("$$earlier"),
          },
        },
      ],
    },
  ],
};

/**
 * The order an offer was spent on, joined as `boundOrder` with only the
 * fields the stage and the page read. Built per call rather than at import,
 * so the collection name is read from a model that exists by then.
 */
function boundOrderLookup(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: Order.collection.name,
        localField: "orderId",
        foreignField: "_id",
        as: "boundOrder",
        pipeline: [
          {
            $project: {
              orderNumber: 1,
              status: 1,
              paymentStatus: 1,
              paymentMethod: 1,
              createdAt: 1,
            },
          },
        ],
      },
    },
    { $addFields: { boundOrder: { $arrayElemAt: ["$boundOrder", 0] } } },
  ];
}

/**
 * Where a quote stands, worked out in the database so the list can filter,
 * count and page by it. Needs `boundOrder` from boundOrderLookup().
 *
 * The order of the branches is the rule:
 *   1. An order that still holds the offer decides it — paid is won, unpaid
 *      is ordered — whatever else is true of the quote: a sale happened. A
 *      cancelled, deleted or expired-unpaid order holds nothing, the same
 *      rule that hands its offer back (orderHoldsOffer in quote-offer.ts).
 *   2. A quote marked lost is closed.
 *   3. No price sent: it needs a reply.
 *   4. A withdrawn price closes it; a lapsed one has expired.
 *   5. Anything else is a live offer.
 */
export function quoteStageExpression(now: Date) {
  const boundOpen = {
    $and: [
      { $ne: [{ $ifNull: ["$boundOrder._id", null] }, null] },
      { $ne: ["$boundOrder.status", ORDER_STATUS.CANCELLED] },
      { $ne: ["$boundOrder.paymentStatus", PAYMENT_STATUS.EXPIRED] },
    ],
  };
  const boundPaid = {
    $in: [
      { $ifNull: ["$boundOrder.paymentStatus", ""] },
      [...QUOTE_WON_PAYMENT_STATUSES],
    ],
  };
  const withdrawn = { $ne: [{ $ifNull: ["$offer.withdrawnAt", null] }, null] };
  const expired = {
    $and: [
      { $ne: [{ $ifNull: ["$offer.expiresAt", null] }, null] },
      { $lte: ["$offer.expiresAt", now] },
    ],
  };

  return {
    $switch: {
      branches: [
        {
          case: { $and: [HAS_OFFER, boundOpen] },
          then: { $cond: [boundPaid, "won", "ordered"] },
        },
        { case: { $eq: ["$status", "lost"] }, then: "closed" },
        { case: { $not: [HAS_OFFER] }, then: "needs_reply" },
        { case: withdrawn, then: "closed" },
        { case: expired, then: "expired" },
      ],
      default: "offer_sent",
    },
  };
}

const OFFER_TOTAL = {
  $cond: [
    HAS_OFFER,
    { $multiply: ["$offer.unitPrice", "$offer.quantity"] },
    null,
  ],
};

function deriveStages(now: Date): PipelineStage[] {
  return [
    ...boundOrderLookup(),
    {
      $addFields: {
        stage: quoteStageExpression(now),
        offerTotal: OFFER_TOTAL,
        pricedByAdmin: PRICED_BY_ADMIN,
      },
    },
  ];
}

/** Fields the table never reads; the detail sheet asks for them itself. */
const LIST_PROJECTION = {
  offerHistory: 0,
  adminNote: 0,
  vendorNote: 0,
  conversationId: 0,
  "offer.offeredBy": 0,
};

/** What no reader of one quote is handed: who on the team sent each price. */
const DETAIL_PROJECTION = {
  conversationId: 0,
  "offer.offeredBy": 0,
  "offerHistory.offeredBy": 0,
};

/**
 * What a vendor never receives: the store's own note, and — while the store
 * hides them — the shopper's email and phone. Projected out in the query, so
 * no serializer downstream can hand them on.
 */
function vendorHiddenFields(showContact: boolean): Record<string, 0> {
  return {
    adminNote: 0,
    ...(showContact ? {} : { email: 0, phone: 0 }),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The "Requested" filter's windows, in days. */
const REQUESTED_WINDOWS: Record<string, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * The list's filters, ANDed with whose quotes they are (`owner`: a staff
 * scope's vendors, or the one vendor).
 *
 * `searchContact` is off for a vendor the store hides contact details from:
 * a search that still matched on email or phone would let them confirm an
 * address one guess at a time, without ever being shown it.
 */
function buildQuoteMatch(
  searchParams: URLSearchParams,
  owner: Record<string, unknown>,
  now: Date,
  options: { searchContact: boolean } = { searchContact: true },
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  const rawSearch = searchParams.get("search")?.trim();
  if (rawSearch) {
    const term = new RegExp(sanitizeSearchString(rawSearch), "i");
    conditions.push({
      $or: [
        { name: term },
        ...(options.searchContact ? [{ email: term }, { phone: term }] : []),
        { company: term },
        { productName: term },
        { variantName: term },
      ],
    });
  }

  const windowDays = REQUESTED_WINDOWS[searchParams.get("requested") ?? ""];
  if (windowDays) {
    conditions.push({
      createdAt: { $gte: new Date(now.getTime() - windowDays * DAY_MS) },
    });
  }

  // `null` in a query matches a missing field too, which is what a guest's
  // request has: no userId at all.
  const customer = searchParams.get("customer");
  if (customer === "account") conditions.push({ userId: { $ne: null } });
  if (customer === "guest") conditions.push({ userId: null });

  const match = conditions.length > 0 ? { $and: conditions } : {};
  return mergeScopeFilter(match, owner);
}

type LeanQuoteVariant = {
  _id?: unknown;
  name?: string;
  stock?: number;
  image?: string;
  mediaId?: string;
  preorder?: QuoteLotProduct["preorder"];
};

type LeanQuoteProduct = Omit<QuoteLotProduct, "variants"> & {
  _id: unknown;
  slug?: string;
  priceOnRequest?: boolean;
  images?: string[];
  media?: Array<{ _id?: string; url?: string; type?: string }>;
  variants?: LeanQuoteVariant[];
};

const PRODUCT_FACT_FIELDS =
  "status stock inventory shipping.isPhysicalProduct preorder images media slug priceOnRequest variants._id variants.name variants.stock variants.preorder variants.image variants.mediaId";

/** The picture the table shows for a quote: the variant's, else the product's. */
function quoteProductImage(
  product: LeanQuoteProduct | undefined,
  variantId?: string,
): string | undefined {
  if (!product) return undefined;
  const variant = variantId
    ? product.variants?.find((candidate) => String(candidate._id) === variantId)
    : undefined;
  const pictures = (product.media ?? []).filter(
    (item) => item.url && (!item.type || item.type === "image"),
  );
  const variantPicture = variant?.mediaId
    ? pictures.find((item) => item._id === variant.mediaId)?.url
    : undefined;
  return (
    variant?.image ||
    variantPicture ||
    product.images?.[0] ||
    pictures[0]?.url ||
    undefined
  );
}

type RawQuoteRow = Record<string, unknown> & {
  _id: unknown;
  productId?: unknown;
  variantId?: unknown;
  boundOrder?: Record<string, unknown> | null;
};

function toOrderSummary(order: RawQuoteRow["boundOrder"]): AdminQuoteOrder | null {
  if (!order?._id) return null;
  return {
    _id: String(order._id),
    orderNumber: order.orderNumber as string | undefined,
    status: order.status as string | undefined,
    paymentStatus: order.paymentStatus as string | undefined,
    paymentMethod: order.paymentMethod as string | undefined,
    createdAt:
      order.createdAt instanceof Date
        ? order.createdAt.toISOString()
        : (order.createdAt as string | undefined),
  };
}

async function loadQuoteProducts(
  rows: RawQuoteRow[],
): Promise<Map<string, LeanQuoteProduct>> {
  const ids = Array.from(
    new Set(rows.map((row) => String(row.productId ?? "")).filter(Boolean)),
  ).filter((id) => Types.ObjectId.isValid(id));
  if (ids.length === 0) return new Map();
  const products = await Product.find({ _id: { $in: ids } })
    .select(PRODUCT_FACT_FIELDS)
    .lean<LeanQuoteProduct[]>();
  return new Map(products.map((product) => [String(product._id), product]));
}

/** An offer as the tables read it, with who sent it spelled out. */
function toOfferRow(offer: unknown): QuoteOfferRow | undefined {
  if (!offer || typeof offer !== "object") return undefined;
  const raw = offer as Parameters<typeof quoteOfferWithdrawnRole>[0];
  const withdrawnBy = quoteOfferWithdrawnRole(raw);
  return {
    ...serializeRows<Omit<QuoteOfferRow, "offeredByRole" | "withdrawnByRole">>(raw),
    offeredByRole: quoteOfferRole(raw) ?? "admin",
    ...(withdrawnBy ? { withdrawnByRole: withdrawnBy } : {}),
  };
}

function toAdminRow(
  row: RawQuoteRow,
  product: LeanQuoteProduct | undefined,
  options: { contactHidden?: boolean } = {},
): AdminQuoteRow {
  const variantId = row.variantId ? String(row.variantId) : undefined;
  const { boundOrder, offer, lostByRole, ...rest } = row;
  return {
    ...serializeRows<
      Omit<
        AdminQuoteRow,
        "order" | "lot" | "productImage" | "offer" | "lostByRole" | "pricedByAdmin"
      >
    >(rest),
    offer: toOfferRow(offer),
    pricedByAdmin: row.pricedByAdmin === true,
    ...(row.status === "lost"
      ? { lostByRole: lostByRole === "vendor" ? "vendor" : "admin" }
      : {}),
    ...(options.contactHidden ? { contactHidden: true } : {}),
    order: toOrderSummary(boundOrder),
    productImage: quoteProductImage(product, variantId),
    lot: quoteLotLimit(product ?? null, variantId),
  };
}

/** Who a list or a detail read is for, and what it may carry. */
type QuoteReader = {
  /** Whose quotes: a staff scope's vendors, the one vendor, or `{}` for all. */
  owner: Record<string, unknown>;
  /** Fields projected out on top of the reader's usual ones. */
  hidden: Record<string, 0>;
  contactHidden: boolean;
};

function adminReader(scope?: StaffAccessScope | null): QuoteReader {
  return { owner: aggregateScopeFilter(scope), hidden: {}, contactHidden: false };
}

function vendorReader(view: VendorQuoteView): QuoteReader {
  return {
    owner: buildVendorQuoteFilter(view.vendorId),
    hidden: vendorHiddenFields(view.showContact),
    contactHidden: !view.showContact,
  };
}

/**
 * The admin Quotes table: one page of rows plus the total, for the query
 * string the page and `/api/admin/quotes` both read.
 *
 * Params: `page`, `limit`, `search`, `stage` (a tab of QUOTE_LIST_TABS),
 * `requested` (7d | 30d | 90d), `customer` (account | guest), `sortBy`
 * (createdAt | offerTotal) and `sortOrder`.
 */
export async function fetchAdminQuoteList(
  searchParams: URLSearchParams,
  context: { staffScope?: StaffAccessScope | null } = {},
): Promise<ListResult<AdminQuoteRow>> {
  return listQuotes(searchParams, adminReader(context.staffScope));
}

/**
 * The vendor's Quotes table: the same list, of this vendor's quotes only,
 * without the store's note and — while the store hides them — without the
 * shopper's email and phone, which the search then does not match on either.
 */
export async function fetchVendorQuoteList(
  searchParams: URLSearchParams,
  view: VendorQuoteView,
): Promise<ListResult<AdminQuoteRow>> {
  return listQuotes(searchParams, vendorReader(view));
}

async function listQuotes(
  searchParams: URLSearchParams,
  reader: QuoteReader,
): Promise<ListResult<AdminQuoteRow>> {
  await connectDB();

  const now = new Date();
  const { page, limit, skip } = parsePageLimit(searchParams, {
    defaultLimit: 10,
    maxLimit: 100,
  });
  const tab = searchParams.get("stage");
  const stages = isQuoteListTab(tab) ? QUOTE_TAB_STAGES[tab] : null;
  const sortField =
    searchParams.get("sortBy") === "offerTotal" ? "offerTotal" : "createdAt";
  const direction = searchParams.get("sortOrder") === "asc" ? 1 : -1;
  const sort: Record<string, 1 | -1> = { [sortField]: direction, _id: direction };
  const match = buildQuoteMatch(searchParams, reader.owner, now, {
    searchContact: !reader.contactHidden,
  });
  const projection = { ...LIST_PROJECTION, ...reader.hidden };

  let rows: RawQuoteRow[];
  let total: number;

  if (!stages && sortField === "createdAt") {
    // Nothing here depends on the stage, so the stored date pages the rows
    // and only the page is joined to its orders.
    const [pageRows, count] = await Promise.all([
      QuoteRequest.aggregate<RawQuoteRow>([
        { $match: match },
        { $sort: sort },
        { $skip: skip },
        { $limit: limit },
        ...deriveStages(now),
        { $project: projection },
      ]),
      QuoteRequest.countDocuments(match),
    ]);
    rows = pageRows;
    total = count;
  } else {
    const [result] = await QuoteRequest.aggregate<{
      items: RawQuoteRow[];
      total: Array<{ n: number }>;
    }>([
      { $match: match },
      ...deriveStages(now),
      ...(stages ? [{ $match: { stage: { $in: stages } } }] : []),
      {
        $facet: {
          items: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limit },
            { $project: projection },
          ],
          total: [{ $count: "n" }],
        },
      },
    ]);
    rows = result?.items ?? [];
    total = result?.total?.[0]?.n ?? 0;
  }

  const products = await loadQuoteProducts(rows);
  const items = rows.map((row) =>
    toAdminRow(row, products.get(String(row.productId ?? "")), {
      contactHidden: reader.contactHidden,
    }),
  );

  return listResult(items, page, limit, total);
}

/** The counters above the Quotes table. */
export async function fetchAdminQuoteStats(
  scope?: StaffAccessScope | null,
): Promise<AdminQuoteStats> {
  return quoteStats(aggregateScopeFilter(scope));
}

/** The same counters, over one vendor's quotes. */
export async function fetchVendorQuoteStats(
  vendorId: string | Types.ObjectId,
): Promise<AdminQuoteStats> {
  return quoteStats(buildVendorQuoteFilter(vendorId));
}

async function quoteStats(
  scopeFilter: Record<string, unknown>,
): Promise<AdminQuoteStats> {
  await connectDB();

  const groups = await QuoteRequest.aggregate<{
    _id: QuoteStage;
    count: number;
    value: number;
  }>([
    ...(Object.keys(scopeFilter).length > 0 ? [{ $match: scopeFilter }] : []),
    ...boundOrderLookup(),
    {
      $group: {
        _id: quoteStageExpression(new Date()),
        count: { $sum: 1 },
        value: { $sum: { $ifNull: [OFFER_TOTAL, 0] } },
      },
    },
  ]);

  const byStage = new Map(groups.map((group) => [group._id, group]));
  const count = (stage: QuoteStage) => byStage.get(stage)?.count ?? 0;
  const value = (stage: QuoteStage) => byStage.get(stage)?.value ?? 0;

  return {
    needsReply: count("needs_reply"),
    offersOpen: count("offer_sent"),
    offersOpenValue: value("offer_sent"),
    expired: count("expired"),
    ordered: count("ordered") + count("won"),
    orderedValue: value("ordered") + value("won"),
  };
}

/**
 * One quote for the detail sheet and the price dialog, scoped like the list:
 * a staff member limited to one vendor cannot open another vendor's quote by
 * its id. Null when there is no such quote in reach.
 */
export async function fetchAdminQuoteDetail(
  id: string,
  scope?: StaffAccessScope | null,
): Promise<AdminQuoteDetail | null> {
  return quoteDetail(id, adminReader(scope));
}

/**
 * One of this vendor's quotes. Another vendor's id reads as no quote at all —
 * null, which the routes answer with a 404 — exactly as a made-up one does.
 */
export async function fetchVendorQuoteDetail(
  id: string,
  view: VendorQuoteView,
): Promise<AdminQuoteDetail | null> {
  return quoteDetail(id, vendorReader(view));
}

async function quoteDetail(
  id: string,
  reader: QuoteReader,
): Promise<AdminQuoteDetail | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  await connectDB();

  const match = mergeScopeFilter({ _id: new Types.ObjectId(id) }, reader.owner);
  const [row] = await QuoteRequest.aggregate<RawQuoteRow>([
    { $match: match },
    ...deriveStages(new Date()),
    { $project: { ...DETAIL_PROJECTION, ...reader.hidden } },
  ]);
  if (!row) return null;

  const products = await loadQuoteProducts([row]);
  const product = products.get(String(row.productId ?? ""));
  const { adminNote, vendorNote, offerHistory, ...rest } = row;
  const base = toAdminRow(rest as RawQuoteRow, product, {
    contactHidden: reader.contactHidden,
  });
  const notes = serializeRows<{ adminNote?: string; vendorNote?: string }>({
    adminNote,
    vendorNote,
  });

  return {
    ...base,
    adminNote: notes.adminNote,
    vendorNote: notes.vendorNote,
    offerHistory: Array.isArray(offerHistory)
      ? offerHistory.flatMap((offer) => toOfferRow(offer) ?? [])
      : [],
    productInfo: {
      exists: Boolean(product),
      status: product?.status,
      priceOnRequest: product?.priceOnRequest === true,
      variants: (product?.variants ?? []).map((variant) => ({
        _id: String(variant._id),
        name: variant.name || String(variant._id),
        lot: quoteLotLimit(product ?? null, String(variant._id)),
      })),
    },
  };
}


/**
 * The shopper's own quotes, for /account/quotes.
 *
 * Same rows the merchant works from, minus the parts that are none of the
 * shopper's business: the internal note is never selected, so it cannot leak
 * through a serializer that spreads whatever it was handed. Capped rather than
 * paginated on the website — a shopper with more than fifty open quotes is
 * not a page-two problem, and the list is a follow-up tool, not a report. The
 * shopper app pages it by `after`, a condition on `createdAt` and `_id` (the
 * order it is sorted in).
 */
export async function fetchCustomerQuotes(
  userId: string,
  limit = 50,
  options: { after?: Record<string, unknown> } = {},
): Promise<QuoteRequestRow[]> {
  await connectDB();

  // The offer's fields one by one, so who on the store's team sent it
  // (`offer.offeredBy`) stays off the shopper's page.
  const items = await QuoteRequest.find(
    options.after ? { $and: [{ userId }, options.after] } : { userId },
  )
    .select(
      "productId productName productSlug variantId variantName quantity name email phone company message status offer.unitPrice offer.quantity offer.note offer.expiresAt offer.offeredAt offer.withdrawnAt orderId createdAt updatedAt",
    )
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();

  const offerStates = await resolveOfferStates(
    items as unknown as Parameters<typeof resolveOfferStates>[0],
  );

  return serializeRows<QuoteRequestRow[]>(items).map((row) => {
    const offerState = offerStates.get(row._id) ?? "none";
    // A quote the merchant closed as lost is not for sale (loadShopperOffers
    // skips it), so an open-looking price on one reads as withdrawn here.
    return {
      ...row,
      offerState:
        row.status === "lost" && offerState === "live" ? "withdrawn" : offerState,
    };
  });
}
