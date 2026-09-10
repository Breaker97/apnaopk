import { z } from "zod";
import { successResponse } from "@/lib/api/response";
import { validateQuery } from "@/lib/api/validate";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { BoostSlotDay } from "@/models";
import { assertBoostingEnabled } from "@/lib/boosts/boosts";
import { addDays, BOOST_DAY_PATTERN, utcDay } from "@/lib/boosts/boost-days";

const AvailabilityQuerySchema = z.object({
  from: z.string().regex(BOOST_DAY_PATTERN),
  to: z.string().regex(BOOST_DAY_PATTERN),
});

/** A ladder booked solid 90 days out is still a bounded read: 50 x 90. */
const MAX_WINDOW_DAYS = 180;

/**
 * GET /api/admin/boosts/availability?from=&to=
 *
 * The vendor endpoint's twin, WITH holder identity. Support cannot answer
 * "who has Position 1 on the 14th" from the anonymised vendor payload, and the
 * admin manual-booking form needs to know which rung-days are free before it
 * writes one.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:boosts:availability", preset: "lenient" },
  },
  async ({ request }) => {
    await assertBoostingEnabled();
    const query = validateQuery(request, AvailabilityQuerySchema);

    const today = utcDay();
    const from = query.from < today ? today : query.from;
    const to = query.to > addDays(from, MAX_WINDOW_DAYS)
      ? addDays(from, MAX_WINDOW_DAYS)
      : query.to;
    if (to < from) {
      throw new ValidationError("The end date cannot precede the start date");
    }

    const rows = await BoostSlotDay.aggregate<{
      position: number;
      day: string;
      campaignId: unknown;
      productId: unknown;
      store: string;
      product: string;
    }>([
      { $match: { day: { $gte: from, $lte: to } } },
      {
        $lookup: {
          from: "vendors",
          localField: "vendorId",
          foreignField: "_id",
          as: "vendor",
          pipeline: [{ $project: { storeName: 1 } }],
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "productId",
          foreignField: "_id",
          as: "productDoc",
          pipeline: [{ $project: { name: 1 } }],
        },
      },
      {
        $project: {
          _id: 0,
          position: 1,
          day: 1,
          campaignId: 1,
          productId: 1,
          store: { $ifNull: [{ $first: "$vendor.storeName" }, ""] },
          product: { $ifNull: [{ $first: "$productDoc.name" }, ""] },
        },
      },
      { $sort: { position: 1, day: 1 } },
    ]);

    const byPosition = new Map<number, typeof rows>();
    for (const row of rows) {
      const entry = byPosition.get(row.position);
      if (entry) entry.push(row);
      else byPosition.set(row.position, [row]);
    }

    return successResponse({
      from,
      to,
      today,
      positions: [...byPosition.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([position, days]) => ({
          position,
          days: days.map((d) => ({
            day: d.day,
            campaignId: String(d.campaignId),
            productId: String(d.productId),
            store: d.store,
            product: d.product,
          })),
        })),
    });
  },
);
