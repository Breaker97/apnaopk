/**
 * When an offline sale was actually taken.
 *
 * A replayed sale used to be dated at the moment it reached the server: an
 * afternoon outage synced at closing put every sale at closing time, and an
 * outage across midnight put them on the next day's reports, ledger and all.
 * The terminal now sends the time it queued the sale as `soldAt`, and the
 * order's `createdAt` and `paidAt` are set from it.
 *
 * Client-supplied, so bounded rather than trusted outright. The same session
 * already creates orders and moves stock, so the risk is not a new capability
 * but a nonsense date: a device clock years out, or a crafted body. A sale
 * cannot be from the future beyond ordinary clock skew, and cannot be older
 * than a register could plausibly have held it — a queue survives a browser
 * being closed, but not a month. Outside the window the arrival time is used,
 * as before.
 *
 * No imports: the route uses it and so could a test, without the models.
 */

/** How far ahead of the server's clock a sale time may sit. */
export const OFFLINE_SOLD_AT_MAX_SKEW_MS = 5 * 60 * 1000;
/** How old a queued sale may be before its time is no longer believed. */
export const OFFLINE_SOLD_AT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function resolveOfflineSoldAt(
  value: unknown,
  now: Date = new Date(),
): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  const soldAt = new Date(value);
  const time = soldAt.getTime();
  if (!Number.isFinite(time)) return undefined;

  const delta = now.getTime() - time;
  if (delta < -OFFLINE_SOLD_AT_MAX_SKEW_MS) return undefined;
  if (delta > OFFLINE_SOLD_AT_MAX_AGE_MS) return undefined;

  return soldAt;
}
