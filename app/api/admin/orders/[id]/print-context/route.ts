import { Order } from "@/models";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertAdminOrStaffPermissions } from "@/lib/access/staff-authz";
import { buildStaffOrderScopeFilter, mergeScopeFilter } from "@/lib/access/staff-scope";
import { buildOrderContext, selectConsignments } from "@/lib/invoice-templates/context";
import { designUsesInternalNote } from "@/lib/invoice-templates/fields";
import { PLATFORM_OWNER } from "@/lib/invoice-templates/owner";
import { resolveDefault } from "@/lib/invoice-templates/service";
import { parseCategory, parseLocale } from "@/lib/invoice-templates/print-context-query";
import type { IOrder } from "@/types";

/**
 * GET /api/admin/orders/[id]/print-context?category=&consignmentId=&locale=
 *
 * What a template print needs for one order (docs/INVOICE_TEMPLATE_BUILDER.md
 * §4.9): the platform's default template for the category, or null when the
 * category still prints the legacy way (D-02), and the whitelisted render
 * context (§4.7.1).
 *
 * Admins and staff with order view. The staff scope is applied to the order
 * query as every order route applies it, and then again to the context:
 * **a staff member scoped to some vendors gets only their consignments**, not
 * the whole order the invoice route hands them. A consignment outside the
 * scope, or one that does not exist, is a 404.
 *
 * The staff-only internal note (§4.14) is in the context only when the
 * default template prints it, or when the caller asks with `internalNote=1`
 * (the editor's preview of a design that prints it). Either way only admins
 * and staff get it, and they already read the order's notes on its page.
 *
 * Reads only (§4.1): the context is built from the order and never writes.
 */
export const GET = withApi<{ id: string }>({ auth: "user" }, async ({ request, params, session }) => {
  const access = await assertAdminOrStaffPermissions(
    session as unknown as { user: { id: string; role: string } },
    [STAFF_PERMISSIONS.VIEW_ORDERS],
  );

  const query = new URL(request.url).searchParams;
  const category = parseCategory(query.get("category"));
  const consignmentId = query.get("consignmentId");
  const requestedLocale = parseLocale(query.get("locale"));
  if (!isValidObjectId(params.id)) return notFoundResponse("Order");
  if (consignmentId && !isValidObjectId(consignmentId)) return notFoundResponse("Consignment");

  const order = await Order.findOne(
    mergeScopeFilter({ _id: params.id }, buildStaffOrderScopeFilter(access.staffScope)),
  ).lean<IOrder>();
  if (!order) return notFoundResponse("Order");

  const consignmentIds = selectConsignments(order, {
    consignmentId,
    vendorIds: access.staffScope?.vendorIds ?? [],
  });
  if (consignmentIds === null) return notFoundResponse("Consignment");

  const template = await resolveDefault(PLATFORM_OWNER, category);
  const context = await buildOrderContext(order, {
    category,
    owner: PLATFORM_OWNER,
    consignmentIds,
    locale: requestedLocale ?? template?.locale ?? "en",
    internalNote: designUsesInternalNote(template) || query.get("internalNote") === "1",
  });
  return successResponse({ template, context });
});
