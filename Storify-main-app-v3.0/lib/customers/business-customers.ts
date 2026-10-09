import { Types } from "mongoose";
import { isCustomerAccount, NON_CUSTOMER_ACCOUNT_FILTER } from "@/lib/access/customer-account";
import { fetchNonCustomerUserIds } from "@/lib/customers/customer-list";
import { connectDB } from "@/lib/db";
import { COLLECTED_ORDER_MATCH } from "@/lib/orders/order-payment-status";
import { isPosWalkIn } from "@/lib/orders/pos-walk-in";
import { escapeRegExp } from "@/lib/strings";
import { Conversation, CustomerProfile, Order, User } from "@/models";
import { CustomerNote, type ICustomerNote } from "@/models/customer-note.model";

/**
 * The customers an operator works with from the business app, and the
 * business's own notes about them (contracts/mobile/biz/v1/customers.ts).
 *
 * Who a customer is follows the website's Customers pages, which are built on
 * the store's customer records (`CustomerProfile`): a shopper account, or a
 * guest the store keeps a record for (one per checkout email: every guest
 * order makes it, lib/orders/persist-order.ts). Whose customers they are
 * follows what the operator can see, as filters the business API builds from
 * the workspace (`CustomerReach`):
 *
 * - the store's administrators and its staff limited to nothing: every one;
 * - everyone else (a seller, their staff, staff limited to some sellers,
 *   locations or regions): the customers of the orders they see, as the
 *   website's vendor list and its scoped staff list choose them, and the
 *   signed-in customers who wrote to them when they may read the inbox. A
 *   guest's conversation never makes them a customer: its email is typed, not
 *   proven, and anybody could type another shopper's.
 *
 * Their figures count the orders the operator sees and nothing else: a seller
 * never learns what a customer bought from another seller.
 */

/** What an operator can see, as the queries that select it. */
export interface CustomerReach {
  /** Every customer of the store: administrators, and staff limited to nothing. */
  everyone: boolean;
  /** The orders the operator sees: their customers are theirs, and their figures count these. */
  orders: Record<string, unknown>;
  /** The conversations they see, when they may read the inbox; null when they may not. */
  conversations: Record<string, unknown> | null;
  /** In a seller's workspace, the seller: what a customer spent is what their items came to. */
  sellerId: string | null;
}

/** A customer, behind the id the API hands out. */
export type CustomerRef = { kind: "account"; userId: string } | { kind: "guest"; profileId: string };

const GUEST_PREFIX = "guest:";
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** The id the API hands out: an account's own, or `guest:` and the guest's customer record. */
export function customerIdOf(ref: CustomerRef): string {
  return ref.kind === "account" ? ref.userId : `${GUEST_PREFIX}${ref.profileId}`;
}

/** What an id names; null for one this API never gave out. */
export function parseCustomerId(id: string): CustomerRef | null {
  if (id.startsWith(GUEST_PREFIX)) {
    const profileId = id.slice(GUEST_PREFIX.length);
    return OBJECT_ID.test(profileId) ? { kind: "guest", profileId } : null;
  }
  return OBJECT_ID.test(id) ? { kind: "account", userId: id } : null;
}

type RawAddress = Record<string, unknown>;

type UserRow = {
  _id: Types.ObjectId;
  name?: string;
  email?: string;
  phone?: string;
  image?: string;
  addresses?: RawAddress[];
  emailVerified?: boolean;
  role?: string;
  roles?: string[];
};

type ProfileRow = {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  isGuest?: boolean;
  name?: string;
  email?: string;
  phone?: string;
  shippingAddress?: RawAddress;
};

/** One customer, as far as this service tells them apart. */
export interface BusinessCustomer {
  ref: CustomerRef;
  id: string;
  kind: "account" | "guest";
  name: string;
  email?: string;
  phone?: string;
  /** An account holder's own picture, as stored. */
  image?: string;
  /** The store's record of where they have things delivered: an account's address book, a guest's last address. */
  savedAddresses: RawAddress[];
  /** Their orders, as an Order filter. */
  orderFilter: Record<string, unknown>;
  /** Their conversations, as a Conversation filter. */
  conversationFilter: Record<string, unknown>;
  /** Notes are written under the first key and read under every one. */
  noteKeys: string[];
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

function accountCustomer(user: UserRow): BusinessCustomer {
  const userId = String(user._id);
  const email = text(user.email)?.toLowerCase();
  return {
    ref: { kind: "account", userId },
    id: userId,
    kind: "account",
    name: text(user.name) ?? email ?? "",
    email,
    phone: text(user.phone),
    image: text(user.image),
    savedAddresses: user.addresses ?? [],
    orderFilter: { customerId: new Types.ObjectId(userId) },
    conversationFilter: { customerUserId: new Types.ObjectId(userId) },
    // A guest who proves their email on an account takes their orders with
    // them (claimGuestCustomerData); their notes come along the same way.
    noteKeys: [`user:${userId}`, ...(email && user.emailVerified ? [`email:${email}`] : [])],
  };
}

function guestCustomer(profile: ProfileRow & { email: string }): BusinessCustomer {
  const email = profile.email.toLowerCase();
  const profileId = String(profile._id);
  return {
    ref: { kind: "guest", profileId },
    id: customerIdOf({ kind: "guest", profileId }),
    kind: "guest",
    name: text(profile.name) ?? email,
    email,
    phone: text(profile.phone),
    savedAddresses: profile.shippingAddress ? [profile.shippingAddress] : [],
    orderFilter: { guestEmail: email },
    // A guest who signed in later writes as their account.
    conversationFilter: { customerUserId: { $exists: false }, "contact.email": email },
    noteKeys: [`email:${email}`],
  };
}

const USER_FIELDS = "name email phone image addresses emailVerified role roles";

/** The customer an id names, whoever may see them; null when there is none. */
async function loadCustomer(ref: CustomerRef): Promise<BusinessCustomer | null> {
  if (ref.kind === "account") {
    const user = await User.findOne({ _id: ref.userId }).select(USER_FIELDS).lean<UserRow | null>();
    return user && isCustomerAccount(user) ? accountCustomer(user) : null;
  }
  const profile = await CustomerProfile.findOne({ _id: ref.profileId, isGuest: true })
    .select("name email phone shippingAddress")
    .lean<ProfileRow | null>();
  const email = text(profile?.email);
  return profile && email ? guestCustomer({ ...profile, email }) : null;
}

/** Whether the customer is among the operator's: see the file's comment. */
async function isInReach(customer: BusinessCustomer, reach: CustomerReach): Promise<boolean> {
  if (reach.everyone) return true;
  if (await Order.exists({ $and: [reach.orders, customer.orderFilter] })) return true;
  if (customer.kind !== "account" || !reach.conversations) return false;
  return Boolean(await Conversation.exists({ $and: [reach.conversations, customer.conversationFilter] }));
}

/**
 * The customer an id names, when they are among the operator's; null
 * otherwise, never telling a customer out of reach from one who does not
 * exist.
 */
export async function findBusinessCustomer(id: string, reach: CustomerReach): Promise<BusinessCustomer | null> {
  const ref = parseCustomerId(id);
  if (!ref) return null;
  await connectDB();
  const customer = await loadCustomer(ref);
  return customer && (await isInReach(customer, reach)) ? customer : null;
}

/** At most this many accounts are matched for one search of the whole store, as the order list does. */
const SEARCH_ACCOUNT_LIMIT = 200;

/** One row of the customer list. */
export interface BusinessCustomerRow {
  id: string;
  kind: "account" | "guest";
  name: string;
  email?: string;
  phone?: string;
  image?: string;
  orderCount: number;
}

const countKey = (kind: "account" | "guest", value: string) => `${kind}:${value}`;

/** How many of each customer's orders the operator sees, by `countKey`. */
async function orderCountsOf(customers: BusinessCustomer[], reach: CustomerReach): Promise<Map<string, number>> {
  const userIds = customers.flatMap((c) => (c.ref.kind === "account" ? [new Types.ObjectId(c.ref.userId)] : []));
  const emails = customers.flatMap((c) => (c.kind === "guest" && c.email ? [c.email] : []));
  type Count = { _id: unknown; count: number };
  const [accounts, guests] = await Promise.all([
    userIds.length
      ? Order.aggregate<Count>([
          { $match: { $and: [reach.orders, { customerId: { $in: userIds } }] } },
          { $group: { _id: "$customerId", count: { $sum: 1 } } },
        ])
      : [],
    emails.length
      ? Order.aggregate<Count>([
          { $match: { $and: [reach.orders, { guestEmail: { $in: emails } }] } },
          { $group: { _id: "$guestEmail", count: { $sum: 1 } } },
        ])
      : [],
  ]);
  return new Map([
    ...accounts.map((row) => [countKey("account", String(row._id)), row.count] as const),
    ...guests.map((row) => [countKey("guest", String(row._id)), row.count] as const),
  ]);
}

/**
 * The operator's customers, newest customer first (when the store first kept
 * their record), a page at a time, found by part of a name, email or phone.
 * `more` says whether another page follows.
 */
export async function listBusinessCustomers(
  reach: CustomerReach,
  options: { search?: string; page: number; limit: number },
): Promise<{ customers: BusinessCustomerRow[]; more: boolean }> {
  await connectDB();
  const nonCustomerIds = await fetchNonCustomerUserIds();
  const conditions: Record<string, unknown>[] = [
    // The admins, sellers and staff who keep a customer record from before
    // their role, as the website's list leaves them out.
    { userId: { $nin: nonCustomerIds } },
    { $or: [{ userId: { $type: "objectId" } }, { isGuest: true, email: { $type: "string" } }] },
  ];

  let members: Types.ObjectId[] | null = null;
  if (!reach.everyone) {
    const [buyers, guestEmails, writers] = await Promise.all([
      Order.distinct("customerId", reach.orders) as Promise<Types.ObjectId[]>,
      Order.distinct("guestEmail", {
        $and: [reach.orders, { guestEmail: { $type: "string", $ne: "" } }],
      }) as Promise<string[]>,
      reach.conversations
        ? (Conversation.distinct("customerUserId", {
            $and: [reach.conversations, { customerUserId: { $type: "objectId" } }],
          }) as Promise<Types.ObjectId[]>)
        : Promise.resolve([] as Types.ObjectId[]),
    ]);
    // A guest order's `customerId` may be the guest's cart: it matches no
    // account's record, so it falls away here.
    members = [...buyers, ...writers].filter(Boolean);
    if (members.length === 0 && guestEmails.length === 0) return { customers: [], more: false };
    conditions.push({
      $or: [{ userId: { $in: members } }, { isGuest: true, email: { $in: guestEmails } }],
    });
  }

  const term = options.search?.trim();
  if (term) {
    const pattern = new RegExp(escapeRegExp(term), "i");
    const identity = { $or: [{ name: pattern }, { email: pattern }, { phone: pattern }] };
    // Among the operator's own customers when they have a set; across the
    // store, the first accounts that match (as GET /orders searches).
    const accounts = await User.find(
      members ? { $and: [{ _id: { $in: members } }, identity] } : { $and: [identity, { $nor: [NON_CUSTOMER_ACCOUNT_FILTER] }] },
    )
      .select("_id")
      .limit(members ? members.length : SEARCH_ACCOUNT_LIMIT)
      .lean<Array<{ _id: Types.ObjectId }>>();
    conditions.push({
      $or: [{ userId: { $in: accounts.map((account) => account._id) } }, { $and: [{ isGuest: true }, identity] }],
    });
  }

  const profiles = await CustomerProfile.find({ $and: conditions })
    .sort({ createdAt: -1, _id: -1 })
    .skip((options.page - 1) * options.limit)
    .limit(options.limit + 1)
    .select("userId isGuest name email phone")
    .lean<ProfileRow[]>();
  const page = profiles.slice(0, options.limit);

  const accountIds = page.flatMap((profile) => (profile.userId ? [profile.userId] : []));
  const users = accountIds.length
    ? await User.find({ _id: { $in: accountIds } })
        .select(USER_FIELDS)
        .lean<UserRow[]>()
    : [];
  const usersById = new Map(users.map((user) => [String(user._id), user]));

  const customers = page.flatMap((profile): BusinessCustomer[] => {
    if (profile.userId) {
      // A record whose account is gone, or now runs the store, is nobody's customer.
      const user = usersById.get(String(profile.userId));
      return user && isCustomerAccount(user) ? [accountCustomer(user)] : [];
    }
    const email = text(profile.email);
    return email ? [guestCustomer({ ...profile, email })] : [];
  });
  const counts = await orderCountsOf(customers, reach);

  return {
    customers: customers.map((customer) => ({
      id: customer.id,
      kind: customer.kind,
      name: customer.name,
      ...(customer.email ? { email: customer.email } : {}),
      ...(customer.phone ? { phone: customer.phone } : {}),
      ...(customer.image ? { image: customer.image } : {}),
      orderCount:
        counts.get(
          customer.ref.kind === "account"
            ? countKey("account", customer.ref.userId)
            : countKey("guest", customer.email ?? ""),
        ) ?? 0,
    })),
    more: profiles.length > options.limit,
  };
}

/** What a customer spent in one currency (null: an order from before currencies were kept). */
export interface SpentInCurrency {
  currency: string | null;
  amount: number;
}

/** A customer's figures, from the orders the operator sees. */
export interface CustomerFigures {
  orderCount: number;
  firstOrderAt?: Date;
  lastOrderAt?: Date;
  /** Largest first. */
  spent: SpentInCurrency[];
  /** Where their latest such order went (for an operator who does not see the store's records). */
  latestAddress?: RawAddress;
}

/**
 * The customer's figures. Spent is what the website's customer pages count
 * (COLLECTED_ORDER_MATCH: paid, part-paid or refunded, or delivered; never
 * cancelled), by currency; in a seller's workspace, what the seller's items
 * came to (their consignments' item subtotal, the vendor customer list's
 * figure), a consignment cancelled on its own left out.
 */
export async function customerFigures(customer: BusinessCustomer, reach: CustomerReach): Promise<CustomerFigures> {
  await connectDB();
  const theirs = { $and: [reach.orders, customer.orderFilter] };
  const paid = { $and: [theirs, COLLECTED_ORDER_MATCH] };
  type Totals = { count: number; first?: Date; last?: Date };
  type Spent = { _id: string | null; amount: number };
  const [totals, spent, latest] = await Promise.all([
    Order.aggregate<Totals>([
      { $match: theirs },
      { $group: { _id: null, count: { $sum: 1 }, first: { $min: "$createdAt" }, last: { $max: "$createdAt" } } },
    ]),
    Order.aggregate<Spent>(
      reach.sellerId
        ? [
            { $match: paid },
            { $unwind: "$subOrders" },
            {
              $match: {
                "subOrders.vendorId": new Types.ObjectId(reach.sellerId),
                "subOrders.status": { $ne: "cancelled" },
              },
            },
            { $group: { _id: "$currency", amount: { $sum: "$subOrders.subtotal" } } },
          ]
        : [{ $match: paid }, { $group: { _id: "$currency", amount: { $sum: "$total" } } }],
    ),
    reach.everyone
      ? Promise.resolve(null)
      : Order.findOne(theirs)
          .sort({ createdAt: -1, _id: -1 })
          .select("shippingAddress")
          .lean<{ shippingAddress?: RawAddress } | null>(),
  ]);
  const total = totals[0];
  return {
    orderCount: total?.count ?? 0,
    ...(total?.first ? { firstOrderAt: new Date(total.first) } : {}),
    ...(total?.last ? { lastOrderAt: new Date(total.last) } : {}),
    spent: spent
      .filter((row) => Number(row.amount) > 0)
      .map((row) => ({ currency: text(row._id) ?? null, amount: Number(row.amount) }))
      .sort((a, b) => b.amount - a.amount || String(a.currency).localeCompare(String(b.currency))),
    ...(latest?.shippingAddress ? { latestAddress: latest.shippingAddress } : {}),
  };
}

/**
 * Who an order's customer is, for the order's screens: its account, or the
 * guest record of its email. Nobody for a walk-in sale, or an order whose
 * buyer is no shopper (an account that runs the store).
 */
export async function customerIdOfOrder(order: {
  customerId?: unknown;
  guestEmail?: unknown;
  channel?: string | null;
  staffId?: unknown;
}): Promise<string | undefined> {
  if (isPosWalkIn(order)) return undefined;
  await connectDB();
  const raw = order.customerId as { _id?: unknown } | string | null | undefined;
  const userId = raw && typeof raw === "object" && "_id" in raw ? String(raw._id) : raw ? String(raw) : "";
  if (OBJECT_ID.test(userId)) {
    const user = await User.findOne({ _id: userId }).select("role roles").lean<UserRow | null>();
    if (user && isCustomerAccount(user)) return userId;
  }
  const email = text(order.guestEmail)?.toLowerCase();
  if (!email) return undefined;
  const profile = await CustomerProfile.findOne({ isGuest: true, email }).select("_id").lean<{ _id: unknown } | null>();
  return profile ? customerIdOf({ kind: "guest", profileId: String(profile._id) }) : undefined;
}

/**
 * Who each conversation of a page is with, by conversation id, among the
 * operator's customers: a signed-in writer's account (the operator sees the
 * conversation, so they are theirs), or the guest record of the contact's
 * email when that guest is the operator's customer by an order.
 */
export async function customerIdsOfConversations(
  conversations: ReadonlyArray<{ id: string; customerUserId?: string; email?: string }>,
  reach: CustomerReach,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const guests = new Map<string, string[]>();
  for (const conversation of conversations) {
    if (conversation.customerUserId && OBJECT_ID.test(conversation.customerUserId)) {
      ids.set(conversation.id, conversation.customerUserId);
      continue;
    }
    const email = text(conversation.email)?.toLowerCase();
    if (email) guests.set(email, [...(guests.get(email) ?? []), conversation.id]);
  }
  if (guests.size === 0) return ids;

  await connectDB();
  const emails = [...guests.keys()];
  const [profiles, buyers] = await Promise.all([
    CustomerProfile.find({ isGuest: true, email: { $in: emails } })
      .select("_id email")
      .lean<Array<{ _id: unknown; email?: string }>>(),
    reach.everyone
      ? Promise.resolve(emails)
      : (Order.distinct("guestEmail", { $and: [reach.orders, { guestEmail: { $in: emails } }] }) as Promise<string[]>),
  ]);
  const inReach = new Set(buyers.map((email) => String(email).toLowerCase()));
  for (const profile of profiles) {
    const email = text(profile.email)?.toLowerCase();
    if (!email || !inReach.has(email)) continue;
    for (const conversationId of guests.get(email) ?? []) {
      ids.set(conversationId, customerIdOf({ kind: "guest", profileId: String(profile._id) }));
    }
  }
  return ids;
}

/**
 * A customer's orders or conversations, as a filter for the lists that take
 * `customerId`: the lists keep their own scope, so this only narrows them.
 * Null for an id that names nobody: the list is then empty.
 */
export async function customerListFilter(
  id: string,
  list: "orders" | "conversations",
): Promise<Record<string, unknown> | null> {
  const ref = parseCustomerId(id);
  if (!ref) return null;
  if (ref.kind === "account") {
    const userId = new Types.ObjectId(ref.userId);
    return list === "orders" ? { customerId: userId } : { customerUserId: userId };
  }
  await connectDB();
  const customer = await loadCustomer(ref);
  if (!customer) return null;
  return list === "orders" ? customer.orderFilter : customer.conversationFilter;
}

/** The business a note belongs to: the store's team, or one seller's. */
export type NoteBusiness = "platform" | { vendorId: string };

const businessScopeOf = (business: NoteBusiness) =>
  business === "platform" ? "platform" : business.vendorId;

/** A note's position in its list: when, and its id. */
export interface NoteCursor {
  time: Date;
  id: Types.ObjectId;
}

/** The business's notes about a customer, newest first. */
export async function readCustomerNotes(params: {
  business: NoteBusiness;
  customer: BusinessCustomer;
  before?: NoteCursor;
  limit: number;
}): Promise<{ notes: ICustomerNote[]; more: boolean }> {
  await connectDB();
  const conditions: Record<string, unknown>[] = [
    { businessScope: businessScopeOf(params.business), customerKey: { $in: params.customer.noteKeys } },
  ];
  if (params.before) {
    const { time, id } = params.before;
    conditions.push({ $or: [{ createdAt: { $lt: time } }, { createdAt: time, _id: { $lt: id } }] });
  }
  const rows = await CustomerNote.find({ $and: conditions })
    .sort({ createdAt: -1, _id: -1 })
    .limit(params.limit + 1)
    .lean<ICustomerNote[]>();
  return { notes: rows.slice(0, params.limit), more: rows.length > params.limit };
}

const isDuplicateKey = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;

/**
 * A new note by the operator, under the business they work for. `clientKey`
 * is the tap's Idempotency-Key: the same tap answers the note it wrote, even
 * once the pipeline's stored answer has expired or when two retries race.
 * `reused`: the key already wrote a different note (another customer, another
 * text), which is not this tap's to answer.
 */
export async function writeCustomerNote(params: {
  business: NoteBusiness;
  customer: BusinessCustomer;
  body: string;
  author: { id: string; name: string; role?: "admin" | "staff" | "vendor" };
  clientKey?: string;
}): Promise<{ note: ICustomerNote; reused: boolean }> {
  await connectDB();
  const authorId = new Types.ObjectId(params.author.id);
  const businessScope = businessScopeOf(params.business);
  const body = params.body.trim();
  const previous = async () =>
    params.clientKey
      ? CustomerNote.findOne({ authorId, clientKey: params.clientKey }).lean<ICustomerNote | null>()
      : null;
  const answer = (note: ICustomerNote) => ({
    note,
    reused:
      note.businessScope !== businessScope ||
      !params.customer.noteKeys.includes(note.customerKey) ||
      note.body !== body,
  });
  const replay = await previous();
  if (replay) return answer(replay);
  try {
    const created = await CustomerNote.create({
      businessScope,
      customerKey: params.customer.noteKeys[0],
      body,
      authorId,
      authorName: params.author.name.trim().slice(0, 120),
      ...(params.author.role ? { authorRole: params.author.role } : {}),
      ...(params.clientKey ? { clientKey: params.clientKey } : {}),
    });
    return { note: created.toObject() as ICustomerNote, reused: false };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const raced = await previous();
    if (raced) return answer(raced);
    throw error;
  }
}
