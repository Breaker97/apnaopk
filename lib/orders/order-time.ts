import { format } from "date-fns";

/**
 * The time an order was placed, "10:35 AM", for the time line under the date in
 * the admin and vendor order lists.
 *
 * The order details pages print `createdAt` as "MMMM d, yyyy, h:mm a" with this
 * same date-fns call, so this is the time half of that line: same field, same
 * formatter, same clock — a list and the order it links to cannot disagree.
 * Null for a missing or unreadable timestamp rather than a throw, which would
 * take the whole table down with one bad row.
 *
 * Client-side only in practice: it reads the viewer's time zone, like the
 * details pages do.
 */
export function getOrderTimeLabel(createdAt?: string | null) {
  if (!createdAt) return null;
  const placedAt = new Date(createdAt);
  return Number.isNaN(placedAt.getTime()) ? null : format(placedAt, "h:mm a");
}
