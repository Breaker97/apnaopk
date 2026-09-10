import { z } from "zod";
import { Types } from "mongoose";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import {
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { validateQuery } from "@/lib/api/validate";
import { ObjectIdSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";
import { BoostSlotDay, Product } from "@/models";
import { assertBoostingEnabled, releaseLapsedBoostHolds } from "@/lib/boosts/boosts";
import { addDays, BOOST_DAY_PATTERN, utcDay } from "@/lib/boosts/boost-days";

const AvailabilityQuerySchema = z.object({
  from: z.string().regex(BOOST_DAY_PATTERN),
  to: z.string().regex(BOOST_DAY_PATTERN),
  productId: ObjectIdSchema.optional(),
});

/**
 * GET /api/vendor/boosts/availability?from=&to=&productId=
 *
 * Which days of the ladder are sold, and which of them are the caller's own.
 * The calendar in the purchase dialog is painted from this and nothing else.
 *
 * Carries ONLY what moves — days, and the server's clock. Every static field
 * (prices, labels, reach, depths, horizon, hold length) lives in `/catalog`,
 * because this endpoint is refetched on open, on focus and again immediately
 * before submit.
 *
 * DELIBERATELY UNCACHED. Availability is money-bearing and changes on every
 * purchase; a 60-second window hands two vendors the same free day and
 * manufactures the exact 409 this endpoint exists to prevent. The cost is one
 * indexed range scan on {day: 1, position: 1}.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const user = session.user;
  await assertVendorPermission(
    user,
    VENDOR_PERMISSIONS.VIEW_BOOSTS,
    "You do not have permission to view boosts",
  );

  await rateLimitByUser(
    request,
    session.user.id,
    "vendor:boosts:availability",
    "lenient",
    session.user.role,
  );

  const settings = await assertBoostingEnabled();
  const vendor = await requireApprovedVendorByUserId(session.user.id);
  const query = validateQuery(request, AvailabilityQuerySchema);

  const today = utcDay();
  const horizonDays = settings.boosting?.bookingHorizonDays ?? 60;
  // The client's clock is never trusted: a vendor whose machine is a day ahead
  // would otherwise be shown yesterday as bookable and refused at checkout.
  const from = query.from < today ? today : query.from;
  const horizonEnd = addDays(today, horizonDays);
  const to = query.to > horizonEnd ? horizonEnd : query.to;
  if (to < from) {
    throw new ValidationError("The end date cannot precede the start date");
  }

  // A lapsed hold must not read as sold on a store whose cron never runs.
  // Bounded and detached: each release fires vendor notifications and a
  // storefront revalidation, and the vendor is waiting on this response.
  void releaseLapsedBoostHolds(new Date(), 20).catch(() => undefined);

  // Ownership-checked, not merely echoed. `productBookedDays` is a per-product
  // schedule; answering it for someone else's product would expose exactly the
  // competitor detail `takenDays` is anonymised to withhold.
  let productId: Types.ObjectId | null = null;
  if (query.productId) {
    const owned = await Product.exists({
      _id: query.productId,
      vendorId: vendor._id,
    });
    if (!owned) throw new NotFoundError("Product");
    productId = new Types.ObjectId(query.productId);
  }

  const rows = await BoostSlotDay.find({ day: { $gte: from, $lte: to } })
    .select("position day vendorId productId")
    .lean<
      Array<{
        position: number;
        day: string;
        vendorId: unknown;
        productId: unknown;
      }>
    >();

  const byPosition = new Map<
    number,
    { takenDays: string[]; ownDays: string[] }
  >();
  const productBookedDays: string[] = [];
  const vendorId = String(vendor._id);

  for (const row of rows) {
    let entry = byPosition.get(row.position);
    if (!entry) {
      entry = { takenDays: [], ownDays: [] };
      byPosition.set(row.position, entry);
    }
    // takenDays deliberately carries no holder identity — publishing it would
    // hand a competitor's media plan to anyone with a vendor account. The admin
    // twin returns the same shape WITH identity, which support needs.
    entry.takenDays.push(row.day);
    if (String(row.vendorId) === vendorId) entry.ownDays.push(row.day);
    // Every day this product already holds at ANY rung. The {productId, day}
    // unique index would refuse these at submit; returning them lets the
    // calendar grey them out instead of letting the vendor discover it on the
    // way back from a gateway.
    if (productId && String(row.productId) === String(productId)) {
      productBookedDays.push(row.day);
    }
  }

  return successResponse({
    from,
    to,
    today,
    positions: [...byPosition.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([position, days]) => ({
        position,
        takenDays: days.takenDays.sort(),
        ownDays: days.ownDays.sort(),
      })),
    ...(productId ? { productBookedDays: productBookedDays.sort() } : {}),
  });
});
