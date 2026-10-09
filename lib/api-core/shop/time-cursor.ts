import { mongoose } from "@/lib/db";
import { MobileApiError } from "@/lib/api-core/errors";

/**
 * The cursor of a newest-first list (orders, notifications): the last row's
 * `createdAt` and id. Paging by position would shift by one whenever a row is
 * added while the shopper scrolls; this continues exactly after the row they
 * last saw, on the `{ …, createdAt: -1 }` index the list already sorts by.
 * Sort such a list by `{ createdAt: -1, _id: -1 }`.
 */
export function encodeTimeCursor(row: { createdAt?: Date | string | null; _id: unknown }): string {
  return Buffer.from(`${new Date(row.createdAt ?? 0).getTime()}:${String(row._id)}`).toString("base64url");
}

/**
 * The time and id a cursor carries, for a list ordered some other way than
 * newest-first by `createdAt`; a cursor this API never gave out is a 400.
 */
export function readTimeCursor(cursor: string): { time: Date; id: mongoose.Types.ObjectId } {
  const [time, id] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
  const at = new Date(Number(time));
  if (!/^\d+$/.test(time ?? "") || Number.isNaN(at.getTime()) || !mongoose.isValidObjectId(id)) {
    throw new MobileApiError(400, "VALIDATION_ERROR", "The cursor is not one this list gave out.", {
      errors: { cursor: ["Send back the nextCursor of the previous page."] },
    });
  }
  return { time: at, id: new mongoose.Types.ObjectId(id) };
}

/** The MongoDB condition for "after this cursor"; a cursor this API never gave out is a 400. */
export function afterTimeCursor(cursor: string): Record<string, unknown> {
  const { time: createdAt, id: _id } = readTimeCursor(cursor);
  return { $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: _id } }] };
}
