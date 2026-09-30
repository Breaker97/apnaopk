import { Suspense } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { getOrderDetails, getOrderReturnRequests } from "@/lib/orders/order-details";
import { OrderItems } from "@/components/admin/order-details/order-items";
import { OrderConsignments } from "@/components/admin/order-details/order-consignments";
import { OrderHeader } from "@/components/admin/order-details/order-header";
import { OrderCustomer } from "@/components/admin/order-details/order-customer";
import { OrderTimeline } from "@/components/admin/order-details/order-timeline";
import { OrderPaymentAttempts } from "@/components/admin/order-details/order-payment-attempts";
import { OrderTimelineSkeleton } from "@/components/admin/order-details/order-details-skeleton";
import { OrderShipmentsCard } from "@/components/shipping/order-shipments-card";
import { OrderAddressHoldBanner } from "@/components/orders/order-address-hold-banner";
import { getSettings } from "@/models/settings.model";
import {
  resolveOrderReturnPolicy,
  unrefundableDeliveryFor,
} from "@/lib/returns/return-policy";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import { getOrderRefundCeiling } from "@/lib/orders/preorder-cancel-refund";
import {
  refundedDeliveryTotal,
  refundedQuantitiesByIndex,
} from "@/lib/returns/return-plan";
import { ORDER_STATUS } from "@/config/app.config";
import { orderStoreCreditRefundProblem } from "@/lib/store-credit/refund-to-credit";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function OrderDetailsPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ORDERS],
  });
  const canEditOrder =
    !access?.staffPermissions ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.EDIT_ORDERS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_ORDERS);
  // Cancelling is gated on DELETE/MANAGE by PUT /api/admin/orders/[id], not on
  // EDIT. Mirroring that here keeps an edit-only staff member from being shown
  // a "Cancel order" action that can only ever come back 403.
  const canCancelOrder =
    !access?.staffPermissions ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.DELETE_ORDERS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_ORDERS);
  // Refunds and workflow overrides are both admin-only on the API side —
  // `PUT /api/admin/orders/[id]` refuses either for scoped staff whatever
  // order permissions they carry — so both read the same fact.
  const isFullAdmin = !access?.staffPermissions;

  // The header needs both, and neither depends on the other — issued together
  // they cost one round-trip instead of two. Both are scoped to what this
  // staff member is allowed to see, the same way the orders list is.
  const [order, returnRequests] = await Promise.all([
    getOrderDetails(id, access?.staffScope),
    getOrderReturnRequests(id, access?.staffScope),
  ]);

  if (!order) {
    notFound();
  }

  // Delivery the carrier has already been paid for. Worked out here rather
  // than in the header because it is a policy question, and the header is a
  // client component with no business reading settings.
  const settings = await getSettings();
  const ratedShipping = Math.max(0, Number(order.shippingCost || 0));
  const chargedShipping = isFreeShippingCouponType(order.coupon?.type)
    ? Math.max(0, ratedShipping - Math.max(0, Number(order.discount || 0)))
    : ratedShipping;
  const deliveryRefunded = await refundedDeliveryTotal(order._id);
  const unrefundableDelivery = unrefundableDeliveryFor({
    // The delivery rule this order was sold under, not today's.
    policy: resolveOrderReturnPolicy(order, settings),
    // Shipped counts, not only delivered: the label was bought and the
    // courier took the parcel days before the shopper signs for it.
    dispatched:
      order.status === ORDER_STATUS.SHIPPED ||
      order.status === ORDER_STATUS.DELIVERED,
    chargedShipping,
    // A delivery refunded once is not held back a second time — the server
    // reads it the same way.
    alreadyRefunded: deliveryRefunded,
  });
  // The delivery the shopper paid that no refund has handed back — what the
  // refund's delivery row can name, held back or not. The charge, not the
  // rate: a free-shipping coupon's delivery took no money to give back.
  const refundableDelivery = Math.max(0, chargedShipping - deliveryRefunded);
  // The most a refund can reach, which is less than the total when part of
  // the order was never paid for — the same figure the server caps at.
  const refundCeiling = getOrderRefundCeiling({
    ...order,
    currency: String(order.currency || settings.general?.defaultCurrency || "USD"),
  } as Parameters<typeof getOrderRefundCeiling>[0]);
  // Units already refunded line by line, so a Full refund does not name them
  // again — the server refuses a line refunded twice, and it used to.
  const refundedQuantities = Object.fromEntries(
    await refundedQuantitiesByIndex(order._id),
  ) as Record<number, number>;
  // Whether a refund here can go to the shopper as store credit (R8) — the
  // same question the refund itself asks.
  const storeCreditRefundBlocked = await orderStoreCreditRefundProblem(
    order as Parameters<typeof orderStoreCreditRefundProblem>[0],
  ).catch(() => "unknown");

  return (
    <div className="space-y-6">
      <OrderHeader
        // Remount per order so the header's return-request state cannot carry
        // over from the previously viewed order.
        key={String(order._id)}
        order={order}
        readOnly={!canEditOrder}
        canCancel={canCancelOrder}
        canRefund={isFullAdmin}
        canOverride={isFullAdmin}
        returnRequests={returnRequests}
        // Delivery on a delivered order went to the carrier the day the parcel
        // left, so it is not part of what a refund can reach. The server
        // refuses to hand it back without being told to explicitly; this is
        // what stops the Full button asking.
        unrefundableDelivery={unrefundableDelivery}
        refundableDelivery={refundableDelivery}
        refundCeiling={refundCeiling}
        refundedQuantities={refundedQuantities}
        canRefundToStoreCredit={!storeCreditRefundBlocked}
      />

      {/* Above everything else: while it is amber nothing on this order ships. */}
      <OrderAddressHoldBanner
        orderId={String(order._id)}
        orderNumber={order.orderNumber}
        address={order.shippingAddress}
        hold={order.addressHold}
        apiBase="/api/admin"
        readOnly={!canEditOrder}
        canCancel={canCancelOrder}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <OrderItems order={order} />
          {/* Split orders only: each seller's part, and cancelling one of them. */}
          <OrderConsignments
            order={order}
            canCancel={canCancelOrder && isFullAdmin}
            canOverride={isFullAdmin}
          />
          {/* Hidden for orders that never move: a digital-only order has
              nothing to put in a box, and a pickup order is collected. */}
          <OrderShipmentsCard
            apiBase="/api/admin"
            orderId={String(order._id)}
            orderNumber={order.orderNumber}
            readOnly={!canEditOrder}
            hidden={
              order.digitalOnly === true ||
              order.fulfillment?.method === "pickup"
            }
          />
          {/* Every payment tried for this order, the refused ones included —
              shown only when there is more to say than the badge above. */}
          <Suspense fallback={null}>
            <OrderPaymentAttempts
              orderId={String(order._id)}
              checkoutAttemptId={
                order.checkoutAttemptId ? String(order.checkoutAttemptId) : undefined
              }
            />
          </Suspense>
          {/* Streamed separately: the order itself never waits on the audit trail. */}
          <Suspense fallback={<OrderTimelineSkeleton />}>
            <OrderTimeline
              orderId={String(order._id)}
              staffScope={access?.staffScope}
              canComment={canEditOrder}
              canModerate={canCancelOrder}
              currentUserId={access?.session?.user?.id}
            />
          </Suspense>
        </div>

        <div className="lg:col-span-1">
          <OrderCustomer order={order} />
        </div>
      </div>
    </div>
  );
}
