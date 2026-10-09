import { Types } from "mongoose";
import type { OrderAddress } from "@/contracts/mobile/biz/v1/orders";
import type { OrderContactRequest, OrderCustomerSelector, OrderCustomerSelectorQuery, OrderCustomerSelectors } from "@/contracts/mobile/biz/v1/order-creation";
import { User } from "@/models/user.model";
import { Order } from "@/models/order.model";
import { CustomerProfile } from "@/models/customer-profile.model";
import { USER_ROLES } from "@/config/app.config";
import { assertCapability } from "@/lib/api-core/biz/access";
import { customerDirectoryIsGlobal, customerOrderScopeFilter } from "@/lib/api-core/biz/scope";
import { pageFromCursor, nextPageCursor } from "@/lib/api-core/shop/page-cursor";
import { connectDB } from "@/lib/db";
import { escapeRegExp } from "@/lib/strings";
import { creationRefusal, type CreationContext, type CreationSession } from "./policy";

type ContactRow = {
  _id?: unknown; id?: string; kind?: "account" | "guest"; name?: string; email?: string; phone?: string;
  addresses?: object[]; shippingAddress?: object;
  customerId?: unknown; guestEmail?: string;
};
function addressDto(address: object): OrderAddress {
  const fields = address as Record<string, unknown>;
  const text = (key: string) => typeof fields[key] === "string" ? fields[key] as string : undefined;
  return { name: text("fullName") || text("name") || [text("firstName"), text("lastName")].filter(Boolean).join(" "),
    street: text("street"), apartment: text("apartment"), city: text("city"), state: text("state"),
    postalCode: text("postalCode"), country: text("country"), phone: text("phone") };
}
function selector(row: ContactRow): OrderCustomerSelector {
  return { id: row.id || String(row._id), kind: row.kind || "account", name: row.name || "",
    ...(row.email ? { email: row.email } : {}), ...(row.phone ? { phone: row.phone } : {}),
    addresses: (row.addresses || (row.shippingAddress ? [row.shippingAddress] : [])).map(addressDto) };
}
const visibleOrders = (context: CreationContext, filter: Record<string, unknown>) => ({ $and: [filter, customerOrderScopeFilter(context.scope)] });

/** Scoped selectors derive contact fields ONLY from visible order snapshots. */
export async function listCreationCustomers(context: CreationContext, query: OrderCustomerSelectorQuery): Promise<OrderCustomerSelectors> {
  assertCapability(context.workspace, "VIEW_ORDER_CUSTOMERS");
  await connectDB();
  const page = pageFromCursor(query.cursor); const limit = query.limit ?? 20;
  const search = query.search ? { $or: ["name", "email", "phone"].map((key) => ({ [key]: { $regex: escapeRegExp(query.search!), $options: "i" } })) } : {};
  const identity = { $project: { _id: 0, id: { $toString: "$_id" }, kind: { $literal: "account" }, name: 1, email: 1, phone: 1, addresses: 1 } };
  let rows: ContactRow[];
  if (customerDirectoryIsGlobal(context.scope)) {
    rows = await User.aggregate<ContactRow>([
      { $match: { role: USER_ROLES.CUSTOMER, status: { $nin: ["inactive", "banned"] } } }, identity,
      { $unionWith: { coll: CustomerProfile.collection.name, pipeline: [
        { $match: { isGuest: true, email: { $type: "string" } } },
        { $project: { _id: 0, id: { $concat: ["guest:", { $toString: "$_id" }] }, kind: { $literal: "guest" }, name: 1, email: 1, phone: 1,
          addresses: { $cond: [{ $ifNull: ["$shippingAddress", false] }, ["$shippingAddress"], []] } } },
      ] } }, { $match: search }, { $sort: { id: 1 } }, { $skip: (page - 1) * limit }, { $limit: limit + 1 },
    ]);
  } else {
    rows = await Order.aggregate<ContactRow>([
      { $match: customerOrderScopeFilter(context.scope) }, { $sort: { createdAt: -1, _id: -1 } },
      { $group: { _id: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ["$guestEmail", ""] } }, 0] }, "$guestEmail", { $toString: "$customerId" }] },
        orderId: { $first: "$_id" }, customerId: { $first: "$customerId" }, guestEmail: { $first: "$guestEmail" }, shippingAddress: { $first: "$shippingAddress" } } },
      { $lookup: { from: User.collection.name, localField: "customerId", foreignField: "_id", as: "account",
        pipeline: [{ $match: { role: USER_ROLES.CUSTOMER, status: { $nin: ["inactive", "banned"] } } }, { $project: { name: 1, email: 1, phone: 1 } }] } },
      { $set: { account: { $first: "$account" } } },
      { $match: { $or: [{ "account._id": { $exists: true } }, { guestEmail: { $type: "string", $ne: "" } }] } },
      { $project: { _id: 0,
        id: { $cond: ["$guestEmail", { $concat: ["order:", { $toString: "$orderId" }] }, { $toString: "$customerId" }] },
        kind: { $cond: ["$guestEmail", "guest", "account"] },
        name: { $ifNull: ["$shippingAddress.fullName", "$account.name"] }, email: { $ifNull: ["$guestEmail", "$account.email"] },
        phone: { $ifNull: ["$shippingAddress.phone", "$account.phone"] }, addresses: ["$shippingAddress"] } },
      { $match: search }, { $sort: { id: 1 } }, { $skip: (page - 1) * limit }, { $limit: limit + 1 },
    ]);
  }
  return { items: rows.slice(0, limit).map(selector), nextCursor: rows.length > limit ? nextPageCursor(page, page + 1) : null };
}

/** Direct IDs obey exactly the same boundary as the selector. No directory fallback. */
export async function resolveCreationCustomer(context: CreationContext, contact: OrderContactRequest, session: CreationSession = null) {
  const guest = async (name: string | undefined, email: string, phone?: string) => {
    const normalized = email.trim().toLowerCase();
    if (await User.exists({ email: normalized, $or: [{ role: { $ne: USER_ROLES.CUSTOMER } }, { status: { $in: ["inactive", "banned"] } }] }).session(session)) {
      creationRefusal("CUSTOMER_NOT_ALLOWED", "This contact is not eligible for an order.", 403);
    }
    return { customerId: undefined, guestEmail: normalized, customer: { name, email: normalized, ...(phone ? { phone } : {}) } };
  };
  if (contact.kind === "guest") {
    return guest(contact.name, contact.email, contact.phone);
  }
  assertCapability(context.workspace, "VIEW_ORDER_CUSTOMERS");
  const global = customerDirectoryIsGlobal(context.scope);
  if (contact.id.startsWith("guest:") && global && Types.ObjectId.isValid(contact.id.slice(6))) {
    const row = await CustomerProfile.findOne({ _id: contact.id.slice(6), isGuest: true })
      .select("_id name email phone shippingAddress").session(session).lean<ContactRow | null>();
    if (row?.email) return guest(row.name, row.email, row.phone);
  } else if (contact.id.startsWith("order:") && Types.ObjectId.isValid(contact.id.slice(6))) {
    const row = await Order.findOne(visibleOrders(context, { _id: contact.id.slice(6), guestEmail: { $type: "string", $ne: "" } }))
      .select("customerId guestEmail shippingAddress").session(session).lean<ContactRow | null>();
    if (row?.guestEmail) return guest(addressDto(row.shippingAddress || {}).name, row.guestEmail, addressDto(row.shippingAddress || {}).phone);
  } else if (Types.ObjectId.isValid(contact.id)) {
    const row = await User.findOne({ _id: contact.id, role: USER_ROLES.CUSTOMER, status: { $nin: ["inactive", "banned"] } })
      .select("_id name email phone").session(session).lean<ContactRow | null>();
    const permitted = global || await Order.exists(visibleOrders(context, { customerId: contact.id })).session(session);
    if (row && permitted) return { customerId: String(row._id), guestEmail: undefined, customer: { name: row.name, email: row.email, phone: row.phone } };
  }
  creationRefusal("CUSTOMER_NOT_ALLOWED", "Customer not found in this workspace.", 403);
}

export function contactSelector(row: ContactRow): OrderCustomerSelector {
  return selector({ ...row, id: `guest:${row._id}`, kind: "guest" });
}

