import type {
  CustomerDetail,
  CustomerListItem,
  CustomerNote,
} from "@/contracts/mobile/biz/v1/customers";
import type { OrderAddress } from "@/contracts/mobile/biz/v1/orders";
import { toAddress } from "@/lib/api-core/biz/orders/dto";
import { absoluteUrl } from "@/lib/api-core/shop/absolute-url";
import { toMoney } from "@/lib/api-core/shop/money";
import type {
  BusinessCustomer,
  BusinessCustomerRow,
  CustomerFigures,
} from "@/lib/customers/business-customers";
import type { ICustomerNote } from "@/models/customer-note.model";

/** A currency as `toMoney` takes it. */
type MoneyCurrency = Parameters<typeof toMoney>[1];

/** An address as the order screens show it; none without a street. */
function addressOf(raw: unknown): OrderAddress | undefined {
  return raw && typeof raw === "object" ? toAddress(raw as Parameters<typeof toAddress>[0]) : undefined;
}

function contact(customer: Pick<BusinessCustomer, "email" | "phone" | "image">) {
  const imageUrl = absoluteUrl(customer.image);
  return {
    ...(customer.email ? { email: customer.email } : {}),
    ...(customer.phone ? { phone: customer.phone } : {}),
    ...(imageUrl ? { imageUrl } : {}),
  };
}

export function toCustomerListItem(row: BusinessCustomerRow): CustomerListItem {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    ...contact(row),
    orderCount: row.orderCount,
  };
}

/**
 * One customer. Addresses as the order builder's customer choice offers them:
 * the store's record for an operator who sees every customer, the latest order
 * they can see for everyone else.
 */
export function toCustomerDetail(
  customer: BusinessCustomer,
  figures: CustomerFigures,
  context: { everyone: boolean; storeCurrency: MoneyCurrency },
): CustomerDetail {
  const raw = context.everyone ? customer.savedAddresses : figures.latestAddress ? [figures.latestAddress] : [];
  return {
    id: customer.id,
    kind: customer.kind,
    name: customer.name,
    ...contact(customer),
    addresses: raw.flatMap((address) => {
      const mapped = addressOf(address);
      return mapped ? [mapped] : [];
    }),
    summary: {
      orderCount: figures.orderCount,
      totalSpent: figures.spent.map((row) => toMoney(row.amount, row.currency ?? context.storeCurrency)),
      ...(figures.firstOrderAt ? { firstOrderAt: figures.firstOrderAt.toISOString() } : {}),
      ...(figures.lastOrderAt ? { lastOrderAt: figures.lastOrderAt.toISOString() } : {}),
    },
  };
}

const ROLES = new Set(["admin", "staff", "vendor"]);

export function toCustomerNote(note: ICustomerNote & { _id?: unknown }): CustomerNote {
  const role = note.authorRole && ROLES.has(note.authorRole) ? (note.authorRole as "admin" | "staff" | "vendor") : undefined;
  return {
    id: String(note._id),
    body: note.body,
    createdAt: new Date(note.createdAt).toISOString(),
    author: { name: note.authorName, ...(role ? { role } : {}) },
  };
}
