import { Order, OrderComment } from "@/models";
import { withApi } from "@/lib/api/handler";
import { validateBody, isValidObjectId } from "@/lib/api/validate";
import { OrderCommentSchema } from "@/lib/validations";
import { createdResponse, notFoundResponse } from "@/lib/api/response";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";

/**
 * POST /api/admin/orders/[id]/comments
 *
 * Adds a staff comment to an order's timeline. Gated on EDIT_ORDERS the same
 * way `notes` is on the order PUT — a comment is the same class of write.
 *
 * No `demo` option: the default is what we want. A demo visitor may post and
 * edit comments (the site has to stay explorable) but not delete them.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "admin-or-staff",
    staffPermissions: [
      STAFF_PERMISSIONS.EDIT_ORDERS,
      STAFF_PERMISSIONS.MANAGE_ORDERS,
    ],
    rateLimit: { action: "admin:orders:comment", preset: "moderate" },
  },
  async ({ request, params, session, staff }) => {
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");

    const body = await validateBody(request, OrderCommentSchema);

    // Scope check before anything is written: a staff member restricted to a
    // vendor/location/region must not be able to attach a comment to — or
    // confirm the existence of — an order outside their scope. 404, not 403,
    // matching every other order sub-route.
    const order = await Order.findOne(
      mergeScopeFilter(
        { _id: params.id },
        buildStaffOrderScopeFilter(staff?.scope),
      ),
    )
      .select("_id")
      .lean();
    if (!order) return notFoundResponse("Order");

    // Author identity is denormalized so rendering the feed needs no populate
    // and a later rename or avatar change does not rewrite history.
    const comment = await OrderComment.create({
      orderId: order._id,
      authorId: session.user.id,
      authorName: session.user.name || session.user.email || "Staff",
      authorEmail: session.user.email,
      authorImage: session.user.image || undefined,
      body: body.body,
      // Snapshot of the author's vendor scope, so a vendor's employee never
      // reads the store's internal notes on a shared marketplace order.
      authorVendorIds: staff?.scope?.vendorIds ?? [],
    });

    return createdResponse({
      _id: String(comment._id),
      body: comment.body,
      authorName: comment.authorName,
      createdAt: comment.createdAt,
    });
  },
);
