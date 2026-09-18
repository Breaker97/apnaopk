import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import { ValidationError } from "@/lib/api/errors";
import type { AuditContext } from "@/lib/audit";
import { areCountryValuesEquivalent } from "@/lib/intl/country-availability";
import { auditOrderAddressChanged } from "@/lib/orders/audit-order";

/**
 * A shopper changing where a pre-order ships, before it ships.
 *
 * A pre-order waits weeks or months, and people move in that time. Until this
 * the only way to change the address was to ask the store — and a guest, whose
 * order no account can open, had not even that.
 *
 * **What may change, and what may not.** Everything that decides the delivery
 * point — name, street, city, postal code, phone — may change. The country and
 * the region may not, because the shipping zone was matched on exactly those
 * two (`zoneSpecificity` in `lib/shipping/shipping.ts`), and so was the tax and
 * any import duty. Moving either would mean the shopper had paid for a
 * different journey than the one they now want; re-pricing that months later
 * is a new sale, not an edit. So both are taken from the order as stored and
 * never from the request, whatever the request says.
 *
 * **When.** Only while the whole order is still waiting: the order is
 * `preordered` and every live consignment is too. Once one is released a label
 * may already be bought against the old address, and a silent edit there sends
 * the shopper's goods to the wrong door. Pickup and digital orders have no
 * delivery address to change. All of that is re-checked inside the write, so a
 * release that lands mid-request wins.
 *
 * **Who.** The caller proves it and scopes the filter — the signed-in owner, or
 * a holder of the pre-order's manage link. Every change is audited and
 * announced to the order's own email, which is what makes the link safe to
 * hand out: a leaked link that redirects a parcel is seen at once by the person
 * it belongs to.
 */

export type PreorderAddressInput = {
  fullName: string;
  firstName?: string;
  lastName?: string;
  street: string;
  apartment?: string;
  city: string;
  postalCode: string;
  phone?: string;
  /** Checked against the order, never written — see the module note. */
  country?: string;
  /** Checked against the order, never written — see the module note. */
  state?: string;
};

type StoredAddress = {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  street?: string;
  apartment?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
};

type AddressableOrder = {
  _id: unknown;
  orderNumber: string;
  customerId?: unknown;
  guestEmail?: string;
  status?: string;
  digitalOnly?: boolean;
  preorderReleaseDate?: Date;
  shippingAddress?: StoredAddress;
  subOrders?: Array<{
    status?: string;
    fulfillment?: { method?: string } | null;
  }> | null;
};

/** Region names compared the way zone matching compares them. */
function sameRegion(left?: string, right?: string) {
  return (
    String(left || "").trim().toLowerCase() ===
    String(right || "").trim().toLowerCase()
  );
}

/** Why this order's address cannot change now, or null when it can. */
export function preorderAddressChangeBlocker(
  order: AddressableOrder,
): string | null {
  if (order.status === ORDER_STATUS.CANCELLED) {
    return "This pre-order has been cancelled";
  }
  if (order.digitalOnly) {
    return "This order has nothing to ship";
  }
  const live = (order.subOrders || []).filter(
    (sub) => sub?.status !== ORDER_STATUS.CANCELLED,
  );
  if (live.some((sub) => sub?.fulfillment?.method === "pickup")) {
    return "This order is collected in store, so it has no delivery address";
  }
  if (
    order.status !== ORDER_STATUS.PREORDERED ||
    live.some((sub) => sub?.status !== ORDER_STATUS.PREORDERED)
  ) {
    return "Part of this order has already been released for shipping, so its address can no longer change";
  }
  return null;
}

export async function changePreorderShippingAddress(params: {
  /** Scoped by the caller to whoever proved they may do this. */
  orderFilter: Record<string, unknown>;
  address: PreorderAddressInput;
  auditContext: AuditContext;
  by: "customer" | "link";
}) {
  const order = (await Order.findOne({
    ...params.orderFilter,
    hasPreorder: true,
  }).lean()) as AddressableOrder | null;
  if (!order) return null;

  const blocker = preorderAddressChangeBlocker(order);
  if (blocker) throw new ValidationError(blocker);

  const current = order.shippingAddress || {};
  if (
    params.address.country !== undefined &&
    !areCountryValuesEquivalent(current.country || "", params.address.country)
  ) {
    throw new ValidationError({
      country: [
        "The country can't change on a pre-order — shipping, tax and duties were charged for the original one",
      ],
    });
  }
  // A blank region is no attempt to move it — checkout's schema fills an
  // omitted one in as "" — and what is written is the stored one either way.
  if (
    String(params.address.state || "").trim() &&
    !sameRegion(current.state, params.address.state)
  ) {
    throw new ValidationError({
      state: [
        "The region can't change on a pre-order — shipping was priced for the original one",
      ],
    });
  }

  const nextAddress: StoredAddress = {
    fullName: params.address.fullName,
    firstName: params.address.firstName || undefined,
    lastName: params.address.lastName || undefined,
    street: params.address.street,
    apartment: params.address.apartment || undefined,
    city: params.address.city,
    postalCode: params.address.postalCode,
    phone: params.address.phone || current.phone,
    // From the order, never from the request — see the module note.
    state: current.state,
    country: current.country,
  };

  // Every rule the pre-check read, again, inside the write: a consignment
  // released between the two must stop this, not be overwritten by it.
  const updated = await Order.findOneAndUpdate(
    {
      ...params.orderFilter,
      hasPreorder: true,
      status: ORDER_STATUS.PREORDERED,
      digitalOnly: { $ne: true },
      subOrders: {
        $not: {
          $elemMatch: {
            status: {
              $nin: [ORDER_STATUS.PREORDERED, ORDER_STATUS.CANCELLED],
            },
          },
        },
      },
      "subOrders.fulfillment.method": { $ne: "pickup" },
    },
    { $set: { shippingAddress: nextAddress } },
    { returnDocument: "after", runValidators: true },
  );
  if (!updated) {
    throw new ValidationError(
      "This pre-order changed while you were editing it, and its address can no longer be updated",
    );
  }

  await auditOrderAddressChanged(params.auditContext, updated, {
    before: current as Record<string, unknown>,
    after: nextAddress as Record<string, unknown>,
    by: params.by,
  });

  const { notifyPreorderCustomerUpdate } = await import(
    "@/lib/notifications/notifications"
  );
  await notifyPreorderCustomerUpdate(
    String(order.customerId || ""),
    order.orderNumber,
    "address_changed",
    String(order._id),
    {
      releaseDate: order.preorderReleaseDate,
      addressSummary: [nextAddress.street, nextAddress.city, nextAddress.postalCode]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(", "),
      guestEmail: order.guestEmail,
    },
  ).catch((err) =>
    console.error("Failed to announce a pre-order address change:", err),
  );

  return { order: updated };
}
