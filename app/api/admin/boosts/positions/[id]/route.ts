import { BoostPosition, BoostSlotDay } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { validatePartialBody, isValidObjectId } from "@/lib/api/validate";
import { UpdateBoostPositionSchema } from "@/lib/validations";
import { auditDelete, auditUpdate, createAuditContext } from "@/lib/audit";
import { assertBoostingEnabled } from "@/lib/boosts/boosts";
import { utcDay } from "@/lib/boosts/boost-days";
import { currencyMinimumPrice, quantizeToCurrency } from "@/lib/intl/money";

type RouteParams = { id: string };

/**
 * PUT /api/admin/boosts/positions/[id]
 * Re-pricing never touches sold days — their terms are frozen in the
 * campaign's positionSnapshot at purchase time.
 */
export const PUT = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:boostPositions:update", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, params, session }) => {
    const settings = await assertBoostingEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Position");

    const body = await validatePartialBody(request, UpdateBoostPositionSchema);
    const update = body as Record<string, unknown>;
    // `position` is the visual slot a vendor bought; renumbering it after the
    // fact relocates every booked day and reprices a delivered good. Reordering
    // the ladder is archive + create, not an edit. `currency` follows the store
    // default and provenance is server-managed.
    delete update.position;
    delete update.currency;
    delete update.createdBy;

    if (typeof update.pricePerDay === "number") {
      const currency = settings.general?.defaultCurrency || "USD";
      const pricePerDay = quantizeToCurrency(update.pricePerDay, currency);
      if (pricePerDay <= 0) {
        throw new ValidationError({
          pricePerDay: [
            `Price per day must be at least ${currencyMinimumPrice(currency)} ${currency}`,
          ],
        });
      }
      update.pricePerDay = pricePerDay;
    }

    const before = await BoostPosition.findById(id).lean();
    if (!before) return notFoundResponse("Position");

    const position = await BoostPosition.findByIdAndUpdate(
      id,
      { $set: update },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!position) return notFoundResponse("Position");

    const auditContext = createAuditContext(request, session);
    await auditUpdate(
      auditContext,
      "boostPosition",
      id,
      before as unknown as Record<string, unknown>,
      position as unknown as Record<string, unknown>,
    );

    return successResponse(position);
  },
);

/**
 * DELETE /api/admin/boosts/positions/[id]
 *
 * Refuses on booked inventory rather than on campaign status. That is strictly
 * stronger: a live-campaign check would happily delete a rung whose days are
 * all sold three weeks out. It is also sufficient — every non-terminal campaign
 * holds a BoostSlotDay row for each remaining day of its range, so "no future
 * rows" means "nothing is depending on this rung".
 *
 * Deleting is the only way to reclaim a rung number, because `position` is
 * unique across all statuses. Archiving takes a rung off sale and keeps it.
 */
export const DELETE = withApi<RouteParams>(
  {
    auth: "admin",
    rateLimit: { action: "admin:boostPositions:delete", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, params, session }) => {
    await assertBoostingEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Position");

    const before = await BoostPosition.findById(id).lean();
    if (!before) return notFoundResponse("Position");

    const booked = await BoostSlotDay.exists({
      position: before.position,
      day: { $gte: utcDay() },
    });
    if (booked) {
      throw new ValidationError(
        "This position has bookings from today onward. Archive it instead of deleting.",
      );
    }

    const position = await BoostPosition.findByIdAndDelete(id);
    if (!position) return notFoundResponse("Position");

    const auditContext = createAuditContext(request, session);
    await auditDelete(
      auditContext,
      "boostPosition",
      id,
      before as unknown as Record<string, unknown>,
    );

    return successResponse({ message: "Position deleted" });
  },
);
