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
import { OrderTimelineSkeleton } from "@/components/admin/order-details/order-details-skeleton";
import { OrderShipmentsCard } from "@/components/shipping/order-shipments-card";
import { getSettings } from "@/models/settings.model";
import {
  resolveReturnPolicy,
  unrefundableDeliveryFor,
} from "@/lib/returns/return-policy";
import { isFreeShippingCouponType } from "@/lib/catalog/discounts";
import { ORDER_STATUS } from "@/config/app.config";

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
  const ratedShipping = Math.max(0, Number(order.shippingCost || 0));
  const unrefundableDelivery = unrefundableDeliveryFor({
    policy: resolveReturnPolicy(await getSettings()),
    // Shipped counts, not only delivered: the label was bought and the
    // courier took the parcel days before the shopper signs for it.
    dispatched:
      order.status === ORDER_STATUS.SHIPPED ||
      order.status === ORDER_STATUS.DELIVERED,
    chargedShipping: isFreeShippingCouponType(order.coupon?.type)
      ? Math.max(0, ratedShipping - Math.max(0, Number(order.discount || 0)))
      : ratedShipping,
  });

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
