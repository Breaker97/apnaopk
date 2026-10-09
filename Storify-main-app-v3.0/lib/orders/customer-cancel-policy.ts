import { ORDER_STATUS } from "@/config/app.config";

/**
 * When a shopper may still call off their own order: the rule the order page
 * offers the button by, and the one the mobile API answers `canCancel` with.
 *
 * Free of `server-only` and of any import beyond the config enums, because the
 * account order page (a client component) reads it as much as the server does.
 * The cascade itself is `cancelOrderForCustomer` (customer-cancel.ts), which
 * starts only from these statuses.
 */

/**
 * The statuses a shopper's cancellation may start from. `preordered` belongs
 * here as much as `pending` does: a reservation waiting months for a release
 * date is the state a shopper is most likely to want out of, and nothing has
 * shipped by definition.
 */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly string[] = [
  ORDER_STATUS.PENDING,
  ORDER_STATUS.PREORDERED,
];

/** Consignment states past the point of stopping. */
export const DISPATCHED_STATUSES: readonly string[] = [
  ORDER_STATUS.SHIPPED,
  ORDER_STATUS.DELIVERED,
];

/**
 * Whether the whole order can still be stopped. On a split order where one
 * seller has already handed goods to a courier, cancelling would take only the
 * rest: a partial outcome behind a button labelled "Cancel order", which is not
 * a thing to spring on someone.
 */
export function isCancellableByCustomer(order: {
  status?: string | null;
  subOrders?: ReadonlyArray<{ status?: string | null }> | null;
}): boolean {
  return (
    CUSTOMER_CANCELLABLE_STATUSES.includes(String(order.status ?? "")) &&
    !(order.subOrders ?? []).some((consignment) =>
      DISPATCHED_STATUSES.includes(String(consignment.status ?? "")),
    )
  );
}
