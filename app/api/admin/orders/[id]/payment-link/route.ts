import { Order } from "@/models";
import { withApi } from "@/lib/api/handler";
import { isValidObjectId } from "@/lib/api/validate";
import { notFoundResponse, successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import {
  assertAdminOrStaffPermissions,
  assertVendorStaffMayChangeOrder,
} from "@/lib/access/staff-authz";
import {
  buildStaffOrderScopeFilter,
  mergeScopeFilter,
} from "@/lib/access/staff-scope";
import { sendOrderPaymentFailedEmail } from "@/lib/orders/order-payment-failed-email";
import { orderContactEmail } from "@/lib/orders/order-contact-email";
import {
  getOrderPayAmountDue,
  isOrderPayable,
  type PayableOrder,
} from "@/lib/payments/order-pay";

/**
 * POST /api/admin/orders/[id]/payment-link
 *
 * Send the shopper a "pay now" link for an order whose payment never arrived.
 *
 * The sweep sends one automatically when a gateway confirms nothing came, but
 * the merchant is the one who hears "I never got the email" — so this is the
 * same message, on request. It refuses on an order that owes nothing, because
 * asking a shopper who has paid for money again is the worst thing this button
 * could do.
 *
 * Deliberately no body: the link is derived from the order, not chosen, so
 * there is nothing here for a caller to steer.
 */
export const POST = withApi<{ id: string }>(
  {
    auth: "user",
    demo: "block-mutations",
    // Every call emails the customer, deliberately without the automatic
    // dedupe — so the only brake on a held-down button is this.
    rateLimit: { action: "admin:order-payment-link", preset: "moderate" },
  },
  async ({ params, session }) => {
    const access = await assertAdminOrStaffPermissions(
      session as unknown as { user: { id: string; role: string } },
      [STAFF_PERMISSIONS.EDIT_ORDERS, STAFF_PERMISSIONS.MANAGE_ORDERS],
    );
    if (!isValidObjectId(params.id)) return notFoundResponse("Order");

    const order = await Order.findOne(
      mergeScopeFilter(
        { _id: params.id },
        buildStaffOrderScopeFilter(access.staffScope),
      ),
    )
      .select(
        "status paymentStatus paymentMethod channel currency total preorderOutstandingAmount storeCredit customerId guestEmail customerLocale items.vendorId subOrders.vendorId",
      )
      .lean<
        | (PayableOrder & {
            guestEmail?: string;
            customerLocale?: string;
            items?: Array<{ vendorId?: unknown }>;
            subOrders?: Array<{ vendorId?: unknown }>;
          })
        | null
      >();
    if (!order) return notFoundResponse("Order");
    assertVendorStaffMayChangeOrder(access, order);

    if (!isOrderPayable(order) || getOrderPayAmountDue(order) <= 0) {
      throw new ValidationError(
        "This order has nothing left to pay, so there is no payment link to send.",
      );
    }
    if (!(await orderContactEmail(order))) {
      throw new ValidationError(
        "This order has no email address to send a payment link to.",
      );
    }

    const sent = await sendOrderPaymentFailedEmail({
      orderId: params.id,
      locale: order.customerLocale,
      // Asked for by a person: a customer who says the email never arrived is
      // exactly the case the automatic dedupe would refuse.
      dedupe: false,
    });
    if (!sent) {
      // The one honest failure worth surfacing: either email is not set up, or
      // this order has already had its link and the outbox refused a second.
      throw new ValidationError(
        "The payment link could not be sent. Check the store's email settings.",
      );
    }

    return successResponse(
      { sent: true },
      "Payment link sent to the customer",
    );
  },
);
