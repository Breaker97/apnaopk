import { BoostCampaign, BoostPosition, BoostSlotDay } from "@/models";
import { NON_TERMINAL_BOOST_CAMPAIGN_STATUSES } from "@/models/boostCampaign.model";
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
    // the ladder is archive + create, not an edit. `currency` is never taken
    // from the client — it follows the store default, and a price edit
    // restamps it below.
    delete update.position;
    delete update.currency;
    delete update.createdBy;

    if (typeof update.pricePerDay === "number") {
      const currency = (settings.general?.defaultCurrency || "USD").toUpperCase();
      const pricePerDay = quantizeToCurrency(update.pricePerDay, currency);
      if (pricePerDay <= 0) {
        throw new ValidationError({
          pricePerDay: [
            `Price per day must be at least ${currencyMinimumPrice(currency)} ${currency}`,
          ],
        });
      }
      update.pricePerDay = pricePerDay;
      // Re-pricing RE-DENOMINATES. A rung left over from a previous store
      // currency is refused at checkout ("ask the marketplace to re-price it"),
      // and stripping `currency` from every edit made that instruction
      // impossible to carry out: the price changed, the stale code stayed, and
      // the rung was unsellable forever with no screen able to fix it. The new
      // figure is typed in today's currency, so it is stamped with today's.
      // Days already sold are unaffected — their terms are frozen in each
      // campaign's positionSnapshot.
      update.currency = currency;
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
 * Refuses on booked inventory FIRST: a live-campaign check alone would happily
 * delete a rung whose days are all sold three weeks out. It is not sufficient
 * on its own, though — a paused booking holds no future rows at all — so a
 * non-terminal campaign pointing at the rung refuses too.
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

    // Booked days are not the whole dependency. A PAUSED booking has already
    // handed its future days back — that is what pausing does — so it holds no
    // BoostSlotDay row while still pointing at this rung, and resuming re-books
    // at `positionSnapshot.position`. Delete the rung and someone recreates the
    // number at another price, and that resume lands on a rung its vendor never
    // bought. A pending checkout is the same story from the other end.
    const claimed = await BoostCampaign.exists({
      positionId: before._id,
      status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
    });
    if (claimed) {
      throw new ValidationError(
        "A paused, scheduled or unpaid booking still holds this position. Archive it instead of deleting.",
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
