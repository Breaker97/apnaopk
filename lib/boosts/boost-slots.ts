/**
 * Boost slot-day reservation primitives.
 *
 * Inventory is a row, never a flag: a day is sold iff a BoostSlotDay exists for
 * {position, day}. No status, boolean or timestamp is ever consulted to answer
 * "is this slot free". There are no multi-document transactions here — runtime
 * code in this repo uses none — so every mechanism below is either a unique
 * index or a single-document CAS.
 */

import { Types } from "mongoose";
import { BOOST_CAMPAIGN_STATUS } from "@/config/app.config";
import { ConflictError, ValidationError } from "@/lib/api/errors";
import { addDays, enumerateDays, isValidDay, utcDay } from "@/lib/boosts/boost-days";
import { BoostCampaign, BoostSlotDay } from "@/models";

/** Hard ceiling regardless of caller. The invariant lives with the inventory. */
const MAX_BOOKING_DAYS = 365;

/**
 * A booking collided with inventory someone else holds.
 *
 * Two unique indexes can fire, and the caller must be able to tell them apart:
 * `conflictDays` means the rung is sold on those days, `productConflictDays`
 * means this product is already placed on those days at some other rung. The
 * purchase dialog repaints different cells for each.
 */
export class BoostSlotConflictError extends ConflictError {
  constructor(
    public readonly position: number,
    /** Days another booking holds at this position. */
    public readonly conflictDays: string[],
    /** Days this PRODUCT is already placed on, at any position. */
    public readonly productConflictDays: string[] = [],
  ) {
    super(
      productConflictDays.length
        ? `This product is already scheduled to appear on ${productConflictDays.join(", ")}. Pick different dates.`
        : `Position ${position} is already booked on ${conflictDays.join(", ")}. Pick different dates or another position.`,
    );
    this.name = "BoostSlotConflictError";
    this.details = { position, conflictDays, productConflictDays };
  }
}

type SlotDoc = {
  position: number;
  day: string;
  campaignId: Types.ObjectId;
  vendorId: Types.ObjectId;
  productId: Types.ObjectId;
  positionId: Types.ObjectId;
  reservationToken: Types.ObjectId;
};

type BookSlotDaysInput = {
  campaignId: Types.ObjectId;
  vendorId: Types.ObjectId;
  productId: Types.ObjectId;
  positionId: Types.ObjectId;
  position: number;
  days: string[];
  reservationToken: Types.ObjectId;
};

/** True for a bare duplicate-key error and for an unordered bulk write that collected them. */
function isDuplicateKeyError(error: unknown): boolean {
  const e = error as { code?: number; writeErrors?: Array<{ code?: number }> };
  return (
    e?.code === 11000 || Boolean(e?.writeErrors?.some((w) => w?.code === 11000))
  );
}

/**
 * Which of `days` a DIFFERENT campaign holds, split by the unique index each
 * collision belongs to. Pure query — the caller decides whether that is fatal.
 *
 * Rows owned by this campaign are excluded by construction. That exclusion is
 * the whole mechanism by which "already held" stays distinguishable from
 * "taken"; without it, two concurrent calls on one campaign would each report
 * the other as a resale and refuse a booking that was satisfiable.
 */
async function findForeignConflicts(input: {
  campaignId: Types.ObjectId;
  position: number;
  productId: Types.ObjectId;
  days: string[];
}): Promise<{ byPosition: string[]; byProduct: string[] }> {
  const foreign = await BoostSlotDay.find({
    day: { $in: input.days },
    campaignId: { $ne: input.campaignId },
    $or: [{ position: input.position }, { productId: input.productId }],
  })
    .select("position day productId")
    .lean<Array<{ position: number; day: string; productId: unknown }>>();

  return {
    byPosition: foreign
      .filter((r) => r.position === input.position)
      .map((r) => r.day)
      .sort(),
    byProduct: foreign
      .filter(
        (r) =>
          r.position !== input.position &&
          String(r.productId) === String(input.productId),
      )
      .map((r) => r.day)
      .sort(),
  };
}

/**
 * Insert `days` at `position` for one campaign, under one reservation token.
 *
 * `ordered: false` so the driver attempts every document and reports EVERY
 * duplicate in `writeErrors[]` — that is what lets the conflict name all the
 * taken days rather than only the first.
 *
 * **Classify before compensating.** A duplicate against a row this SAME
 * campaign already owns is not a conflict — it is inventory we hold — and
 * deleting the partial insert in that case throws away rows the caller is about
 * to depend on. Only a genuinely foreign owner triggers the compensating
 * delete, and that delete is scoped to {campaignId, reservationToken}: the
 * campaign row is reused across retries, so scoping by campaignId alone would
 * let two concurrent requests on one campaign destroy each other's rows.
 *
 * **A raw driver error never escapes.** handleApiError's duplicate branch would
 * render it as "A record with this position already exists" with no day list,
 * and the purchase dialog has nothing to repaint from. Every contention outcome
 * leaves here as a BoostSlotConflictError carrying the days.
 * @public — reached by tests through a dynamic import, which knip cannot follow.
 */
export async function bookBoostSlotDays(
  input: BookSlotDaysInput,
): Promise<void> {
  if (input.days.length === 0) return;
  if (input.days.length > MAX_BOOKING_DAYS) {
    throw new ValidationError(
      `A booking cannot exceed ${MAX_BOOKING_DAYS} days`,
    );
  }
  // Validate here, not only at the route. Mongoose does NOT throw on a failed
  // schema `match` under `{ordered: false}` unless `throwOnValidationError` is
  // passed — it drops the invalid documents and RESOLVES. A malformed day would
  // otherwise book a shorter range than the vendor is charged for, silently.
  for (const day of input.days) {
    if (!isValidDay(day)) throw new ValidationError(`Invalid boost day: ${day}`);
  }

  const docs: SlotDoc[] = input.days.map((day) => ({
    position: input.position,
    day,
    campaignId: input.campaignId,
    vendorId: input.vendorId,
    productId: input.productId,
    positionId: input.positionId,
    reservationToken: input.reservationToken,
  }));

  const compensate = () =>
    BoostSlotDay.deleteMany({
      campaignId: input.campaignId,
      reservationToken: input.reservationToken,
      day: { $in: input.days },
    }).catch(() => undefined);

  try {
    await BoostSlotDay.insertMany(docs, { ordered: false });
    return;
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      await compensate(); // not contention — a real fault
      throw error;
    }

    const foreign = await findForeignConflicts(input);
    if (foreign.byPosition.length > 0 || foreign.byProduct.length > 0) {
      await compensate();
      throw new BoostSlotConflictError(
        input.position,
        foreign.byPosition,
        foreign.byProduct,
      );
    }

    // No foreign owner: every collision was our own row — a retry, a second
    // concurrent request on the same campaign, or a fulfilment re-asserting a
    // hold it already holds. Confirm the campaign now owns the whole range at
    // this position and succeed WITHOUT compensating.
    const owned = new Set(
      (
        await BoostSlotDay.find({
          campaignId: input.campaignId,
          position: input.position,
          day: { $in: input.days },
        })
          .select("day")
          .lean<Array<{ day: string }>>()
      ).map((r) => r.day),
    );
    const missing = input.days.filter((day) => !owned.has(day));
    if (missing.length === 0) return;

    // Neither foreign nor ours: the colliding row was released between the
    // insert and this re-read. Report it as contention rather than leaving a
    // half-booked range.
    await compensate();
    throw new BoostSlotConflictError(input.position, missing.sort(), []);
  }
}

/**
 * Move a campaign's hold onto `position` x [startDay..endDay].
 *
 * Adds only days it does not already hold and drops only days it no longer
 * needs, so a retry that merely extends the range never releases a held day
 * back to the market.
 *
 * A position CHANGE over an overlapping range must delete this campaign's own
 * rows for the affected days BEFORE inserting — the {productId, day} unique
 * index means the new rung's row would otherwise collide with the campaign's
 * own old rung. The optimistic pre-check keeps that from costing the vendor a
 * hold in the common case: if a competitor already owns any of the target days,
 * the conflict is raised while our rows are still intact.
 */
export async function reserveBoostSlotRange(input: {
  campaignId: Types.ObjectId;
  vendorId: Types.ObjectId;
  productId: Types.ObjectId;
  positionId: Types.ObjectId;
  position: number;
  startDay: string;
  endDay: string;
  reservationToken: Types.ObjectId;
}): Promise<{ days: string[]; booked: string[] }> {
  if (!isValidDay(input.startDay) || !isValidDay(input.endDay)) {
    throw new ValidationError("Invalid boost date range");
  }
  const wanted = enumerateDays(input.startDay, input.endDay);
  if (wanted.length === 0 || wanted.length > MAX_BOOKING_DAYS) {
    throw new ValidationError("Invalid boost date range");
  }
  const wantedSet = new Set(wanted);

  const held = await BoostSlotDay.find({ campaignId: input.campaignId })
    .select("_id position day")
    .lean<Array<{ _id: Types.ObjectId; position: number; day: string }>>();

  const keep = new Set(
    held
      .filter((r) => r.position === input.position && wantedSet.has(r.day))
      .map((r) => r.day),
  );
  const toBook = wanted.filter((d) => !keep.has(d));
  // Own rows blocking the insert: right day, wrong rung.
  const blockingIds = held
    .filter((r) => r.position !== input.position && wantedSet.has(r.day))
    .map((r) => r._id);
  // Own rows simply no longer wanted.
  const surplusIds = held.filter((r) => !wantedSet.has(r.day)).map((r) => r._id);

  if (toBook.length > 0) {
    // Optimistic pre-check, while our own rows are still intact: if a
    // competitor already owns any target day, fail here rather than after the
    // blocking-row delete below has given up a hold we cannot get back.
    const foreign = await findForeignConflicts({ ...input, days: toBook });
    if (foreign.byPosition.length > 0 || foreign.byProduct.length > 0) {
      throw new BoostSlotConflictError(
        input.position,
        foreign.byPosition,
        foreign.byProduct,
      );
    }
  }

  if (blockingIds.length > 0) {
    await BoostSlotDay.deleteMany({
      _id: { $in: blockingIds },
      campaignId: input.campaignId,
    });
  }

  await bookBoostSlotDays({ ...input, days: toBook });

  // Only after a successful insert: days the campaign no longer wants.
  if (surplusIds.length > 0) {
    await BoostSlotDay.deleteMany({
      _id: { $in: surplusIds },
      campaignId: input.campaignId,
    });
  }
  return { days: wanted, booked: toBook };
}

/** Full release — an unpaid hold, or a hard teardown. */
export function releaseAllBoostSlotDays(campaignId: Types.ObjectId) {
  return BoostSlotDay.deleteMany({ campaignId });
}

/**
 * Release exactly the rows one attempt inserted — but only while the campaign
 * is still an unpaid hold.
 *
 * The status guard is load-bearing, not defensive. A concurrent fulfilment
 * ADOPTS these exact rows: it CASes the campaign live and then re-asserts the
 * reservation, whose diff finds the days already held and inserts nothing. An
 * unguarded delete here would therefore strip a live, paid campaign of its
 * inventory and put the rung back on sale while the ad still renders, producing
 * a double-sell nothing would notice.
 *
 * The remaining window is self-healing by construction: fulfilment CASes BEFORE
 * it re-asserts, so a delete that slips through is repaired by the re-assert
 * that follows it.
 */
export async function releaseReservationIfUnpaid(
  campaignId: Types.ObjectId,
  reservationToken: Types.ObjectId,
): Promise<number> {
  const stillHeld = await BoostCampaign.exists({
    _id: campaignId,
    status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
  });
  if (!stillHeld) return 0;
  const result = await BoostSlotDay.deleteMany({
    campaignId,
    reservationToken,
  });
  return result.deletedCount ?? 0;
}

/**
 * Release from `fromDay` forward, keeping past rows as the delivery record.
 * Returns the days released — that IS the proration basis, measured rather than
 * derived from a clock.
 *
 * Callers pass TOMORROW, never today: a day already served is consumed, and
 * re-selling today's rung would put two products in one visual slot on one
 * calendar day.
 */
export async function releaseBoostSlotDaysFrom(
  campaignId: Types.ObjectId,
  fromDay: string,
): Promise<string[]> {
  const rows = await BoostSlotDay.find({ campaignId, day: { $gte: fromDay } })
    .select("day")
    .lean<Array<{ day: string }>>();
  if (rows.length === 0) return [];
  await BoostSlotDay.deleteMany({ campaignId, day: { $gte: fromDay } });
  return rows.map((r) => r.day).sort();
}

/**
 * Delete slot-days whose campaign is terminal, gone, or no longer claims them.
 *
 * Any leak here is unrecoverable by hand — a blocked rung with no UI that can
 * see it — so this is the backstop for every release path.
 *
 * The third case is what makes truncation crash-safe. `truncateBoostCampaign`
 * shrinks the campaign's window BEFORE it deletes the rows, because the reverse
 * order would let a paid ad keep rendering on days already resold. That leaves
 * a window where rows outlive the window that justified them, and this reclaims
 * them: a row is an orphan when `day > campaign.endDay`.
 *
 * STRICTLY future days. Today's row is not an orphan even when its campaign is
 * terminal: a paid cancel, pause or expiry deliberately keeps it, because it is
 * the delivery record and because re-selling a rung that already rendered today
 * is a double-sell.
 */
export async function sweepOrphanSlotDays(
  now = new Date(),
  limit = 500,
): Promise<number> {
  const orphaned = await BoostSlotDay.aggregate<{ _id: Types.ObjectId }>([
    { $match: { day: { $gte: addDays(utcDay(now), 1) } } },
    {
      $lookup: {
        from: "boostcampaigns",
        localField: "campaignId",
        foreignField: "_id",
        as: "campaign",
        pipeline: [{ $project: { status: 1, endDay: 1 } }],
      },
    },
    {
      $match: {
        $or: [
          { campaign: { $size: 0 } },
          {
            "campaign.status": {
              $in: [
                BOOST_CAMPAIGN_STATUS.CANCELED,
                BOOST_CAMPAIGN_STATUS.EXPIRED,
              ],
            },
          },
          // Stranded past a truncation: the campaign no longer claims this day.
          // "YYYY-MM-DD" is lexicographically ordered, so a string comparison
          // is the date comparison.
          {
            $expr: {
              $gt: ["$day", { $ifNull: [{ $first: "$campaign.endDay" }, "$day"] }],
            },
          },
        ],
      },
    },
    { $project: { _id: 1 } },
    { $limit: limit },
  ]);

  if (orphaned.length === 0) return 0;
  await BoostSlotDay.deleteMany({
    _id: { $in: orphaned.map((r) => r._id) },
  });
  console.warn(`Released ${orphaned.length} orphaned boost slot-day(s)`);
  return orphaned.length;
}
