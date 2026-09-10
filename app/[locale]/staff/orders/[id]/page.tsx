import { Suspense } from "react";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { OrderHeader } from "@/components/admin/order-details/order-header";
import { OrderItems } from "@/components/admin/order-details/order-items";
import { OrderCustomer } from "@/components/admin/order-details/order-customer";
import { OrderTimeline } from "@/components/admin/order-details/order-timeline";
import { OrderTimelineSkeleton } from "@/components/admin/order-details/order-details-skeleton";
import { getOrderDetails, getOrderReturnRequests } from "@/lib/orders/order-details";
import { requireStaffAreaAccess } from "@/lib/access/staff-area-guard";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function StaffOrderDetailsPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await requireStaffAreaAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ORDERS],
  });
  // Mirrors PUT /api/admin/orders/[id]: editing needs EDIT/MANAGE, cancelling
  // needs DELETE/MANAGE. Treating DELETE as "can edit" (or EDIT as "can
  // cancel") only surfaces actions the API answers with a 403.
  const readOnly = !(
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_ORDERS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.EDIT_ORDERS)
  );
  const canCancel =
    access.staffPermissions.includes(STAFF_PERMISSIONS.MANAGE_ORDERS) ||
    access.staffPermissions.includes(STAFF_PERMISSIONS.DELETE_ORDERS);

  // Scoped to this staff member's vendors/locations/regions, the same way the
  // staff orders list is — otherwise any order is readable by id.
  const [order, returnRequests] = await Promise.all([
    getOrderDetails(id, access.staffScope),
    getOrderReturnRequests(id, access.staffScope),
  ]);

  if (!order) notFound();

  return (
    <div className="space-y-6">
      <OrderHeader
        key={String(order._id)}
        order={order}
        readOnly={readOnly}
        canCancel={canCancel}
        returnRequests={returnRequests}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <OrderItems order={order} />
          <Suspense fallback={<OrderTimelineSkeleton />}>
            <OrderTimeline
              orderId={String(order._id)}
              staffScope={access.staffScope}
              canComment={!readOnly}
              canModerate={canCancel}
              currentUserId={access.session?.user?.id}
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
