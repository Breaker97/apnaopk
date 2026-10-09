import { DEFAULT_CURRENCY } from "@/config/branding.config";
import { LIST_DEFAULT_LIMIT } from "@/contracts/mobile/biz/v1/common";
import {
  CustomerDetail,
  CustomerList,
  CustomerListQuery,
  CustomerNote,
  CustomerNoteList,
  CustomerNoteRequest,
  CustomerNotesQuery,
} from "@/contracts/mobile/biz/v1/customers";
import { assertCapability, BIZ_ACCESS } from "@/lib/api-core/biz/access";
import type { BizWorkspaceGrant } from "@/lib/api-core/biz/actor";
import { MobileApiError } from "@/lib/api-core/errors";
import { defineBizRoute } from "@/lib/api-core/registry";
import { nextPageCursor, pageFromCursor } from "@/lib/api-core/shop/page-cursor";
import { encodeTimeCursor, readTimeCursor } from "@/lib/api-core/shop/time-cursor";
import {
  customerFigures,
  listBusinessCustomers,
  readCustomerNotes,
  writeCustomerNote,
} from "@/lib/customers/business-customers";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import { toCustomerDetail, toCustomerListItem, toCustomerNote } from "./dto";
import { customerReachOf, noteBusinessOf, requireCustomer } from "./reach";

/**
 * Customers (contracts/mobile/biz/v1/customers.ts): the list, one customer,
 * and the business's notes about them. Who the operator's customers are, and
 * what their figures count, is the customer service's
 * (lib/customers/business-customers.ts), from the operator's reach (./reach.ts).
 */

/**
 * GET /customers: the operator's customers, newest first, by name, email or
 * phone. Paged by position (the website's lists page by number); the ETag is
 * the page's own.
 */
export const customerListRoute = defineBizRoute({
  id: "customers.list",
  method: "GET",
  path: "/customers",
  auth: "user",
  ...BIZ_ACCESS.VIEW_ORDER_CUSTOMERS,
  cache: { kind: "private" },
  etag: true,
  rateLimit: { bucket: "biz:customers:read", preset: "lenient" },
  input: CustomerListQuery,
  output: CustomerList,
  handler: async ({ input, session, workspace, scope }) => {
    const page = pageFromCursor(input.cursor);
    const limit = input.limit ?? LIST_DEFAULT_LIMIT;
    const { customers, more } = await listBusinessCustomers(customerReachOf({ session, workspace, scope }), {
      search: input.search,
      page,
      limit,
    });
    return {
      items: customers.map(toCustomerListItem),
      nextCursor: more ? nextPageCursor(page, page + 1) : null,
    };
  },
});

/**
 * GET /customers/{id}: one of the operator's customers (404 otherwise), with
 * their figures from the orders the operator sees.
 */
export const customerDetailRoute = defineBizRoute({
  id: "customers.detail",
  method: "GET",
  path: "/customers/{id}",
  auth: "user",
  ...BIZ_ACCESS.VIEW_ORDER_CUSTOMERS,
  cache: { kind: "private" },
  etag: true,
  rateLimit: { bucket: "biz:customers:read", preset: "lenient" },
  output: CustomerDetail,
  handler: async ({ params, session, workspace, scope }) => {
    const { customer, reach } = await requireCustomer(params.id, { session, workspace, scope });
    const figures = await customerFigures(customer, reach);
    // Every order keeps the currency it was charged in; only one from before
    // that was stored needs the store's.
    const storeCurrency = figures.spent.every((row) => row.currency) ? DEFAULT_CURRENCY : await getStoreCurrency();
    return toCustomerDetail(customer, figures, { everyone: reach.everyone, storeCurrency });
  },
});

/** The author's part in the store, as a note records it. */
function roleOf(workspace: BizWorkspaceGrant): "admin" | "staff" | "vendor" {
  if (workspace.kind === "admin") return "admin";
  return workspace.kind === "staff" ? "staff" : "vendor";
}

/**
 * GET /customers/{id}/notes: the business's notes about one of the operator's
 * customers, newest first. The store's team read the store's; a seller and
 * their staff the seller's. Notes need seeing the customer too.
 */
export const customerNotesRoute = defineBizRoute({
  id: "customers.notes.list",
  method: "GET",
  path: "/customers/{id}/notes",
  auth: "user",
  ...BIZ_ACCESS.MANAGE_CUSTOMER_NOTES,
  cache: { kind: "private" },
  etag: true,
  rateLimit: { bucket: "biz:customers:read", preset: "lenient" },
  input: CustomerNotesQuery,
  output: CustomerNoteList,
  handler: async ({ input, params, session, workspace, scope }) => {
    assertCapability(workspace, "VIEW_ORDER_CUSTOMERS");
    const { customer } = await requireCustomer(params.id, { session, workspace, scope });
    const before = input.cursor ? readTimeCursor(input.cursor) : undefined;
    const { notes, more } = await readCustomerNotes({
      business: noteBusinessOf(workspace),
      customer,
      before,
      limit: input.limit ?? LIST_DEFAULT_LIMIT,
    });
    const last = notes[notes.length - 1];
    return {
      items: notes.map(toCustomerNote),
      nextCursor: more && last ? encodeTimeCursor(last as { createdAt: Date; _id: unknown }) : null,
    };
  },
});

/**
 * POST /customers/{id}/notes: a note by the operator, under their business.
 * Once per tap: the pipeline replays a retried key's answer, and the key is
 * kept on the note, so a retry past the stored answer, or two that race,
 * still write one. The customer's own record is never touched.
 */
export const customerNoteCreateRoute = defineBizRoute({
  id: "customers.notes.create",
  method: "POST",
  path: "/customers/{id}/notes",
  auth: "user",
  ...BIZ_ACCESS.MANAGE_CUSTOMER_NOTES,
  cache: { kind: "private" },
  status: 201,
  rateLimit: { bucket: "biz:customers:notes", preset: "moderate" },
  demo: "default",
  idempotency: "required",
  input: CustomerNoteRequest,
  output: CustomerNote,
  handler: async ({ input, params, session, workspace, scope, client }) => {
    assertCapability(workspace, "VIEW_ORDER_CUSTOMERS");
    const { customer } = await requireCustomer(params.id, { session, workspace, scope });
    const { note, reused } = await writeCustomerNote({
      business: noteBusinessOf(workspace),
      customer,
      body: input.body,
      author: { id: session.user.id, name: session.user.name || session.user.email, role: roleOf(workspace) },
      clientKey: client.idempotencyKey,
    });
    if (reused) {
      throw new MobileApiError(
        422,
        "IDEMPOTENCY_KEY_REUSED",
        "This key already wrote another note. Keep the original request or use a new key.",
      );
    }
    return toCustomerNote(note);
  },
});
