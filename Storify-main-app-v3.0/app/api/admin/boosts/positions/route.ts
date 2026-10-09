import { BoostPosition } from "@/models";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { ConflictError, ValidationError } from "@/lib/api/errors";
import { validateBody } from "@/lib/api/validate";
import { CreateBoostPositionSchema } from "@/lib/validations";
import { auditCreate, createAuditContext } from "@/lib/audit";
import { assertBoostingEnabled } from "@/lib/boosts/boosts";
import {
  getPositionVisibility,
  isPositionUnreachable,
} from "@/lib/boosts/boost-placement-depths";
import { getSponsoredPlacementDepths } from "@/lib/boosts/sponsored-products";
import { currencyMinimumPrice, quantizeToCurrency } from "@/lib/intl/money";

/**
 * GET /api/admin/boosts/positions
 * The whole ladder, in rung order. Not paginated: the ladder is bounded by
 * BOOST_MAX_POSITIONS and the screen renders it as one ordered list — paging a
 * ladder would hide exactly the gaps the admin needs to see.
 *
 * Each rung carries whether it is sellable, on the same two tests the vendor
 * catalogue applies: a rung deeper than every placement renders nowhere, and a
 * rung priced in a currency the store no longer uses is refused at checkout.
 * The admin booking form has no other way to know either, and booking a rung
 * that shows on no page is the worst failure this model allows.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:boostPositions:list", preset: "lenient" },
  },
  async () => {
    const settings = await assertBoostingEnabled();
    const [positions, depths] = await Promise.all([
      BoostPosition.find().sort({ position: 1 }).lean(),
      getSponsoredPlacementDepths(),
    ]);
    const currency = (settings.general?.defaultCurrency || "USD").toUpperCase();
    const placements = settings.boosting?.placements;

    return successResponse({
      currency,
      depths,
      // Which surfaces run sponsored slots at all. The booking form only calls
      // out a surface a rung misses when that surface is switched on.
      placementsEnabled: {
        home: placements?.home !== false,
        listing: placements?.listing !== false,
        productPage: placements?.productPage !== false,
      },
      // The booking rules travel with the ladder so the admin form can obey the
      // same two limits vendor checkout enforces instead of a number baked into
      // the dialog.
      bookingHorizonDays: settings.boosting?.bookingHorizonDays ?? 60,
      maxBookingDays: settings.boosting?.maxBookingDays ?? 60,
      positions: positions.map((row) => ({
        ...row,
        _id: String(row._id),
        unreachable: isPositionUnreachable(row.position, depths),
        reach: getPositionVisibility(row.position, depths),
        stale: Boolean(row.currency && row.currency.toUpperCase() !== currency),
      })),
    });
  },
);

/**
 * POST /api/admin/boosts/positions
 * Create a rung. Priced per day in the store's default currency; the currency
 * is frozen onto each campaign at purchase time.
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:boostPositions:create", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, session }) => {
    const settings = await assertBoostingEnabled();
    const body = await validateBody(request, CreateBoostPositionSchema);
    const currency = settings.general?.defaultCurrency || "USD";

    // Store only what the currency can represent. A fractional price in a
    // zero-decimal currency (JPY, UGX) is invisible in the admin UI — Intl
    // rounds it away — but the gateway would charge the rounded amount and the
    // finalizer would then reject its own successful charge as a mismatch.
    const pricePerDay = quantizeToCurrency(body.pricePerDay, currency);
    // The zod floor is currency-blind, so a sub-minor-unit price in a
    // zero-decimal currency rounds to 0 here. Say so, rather than letting the
    // model's min validator surface as a 500. A rung priced at 0 would render
    // in the ladder and then be unbuyable — checkout refuses any total below
    // the currency minimum.
    if (pricePerDay <= 0) {
      throw new ValidationError({
        pricePerDay: [
          `Price per day must be at least ${currencyMinimumPrice(currency)} ${currency}`,
        ],
      });
    }

    let position;
    try {
      position = await BoostPosition.create({
        position: body.position,
        label: body.label.trim(),
        description: body.description || undefined,
        pricePerDay,
        currency,
        status: body.status ?? "active",
        createdBy: session.user.id,
      });
    } catch (error) {
      // `position` is unique across ALL statuses — an archived rung keeps its
      // number reserved, because days already sold reference the number.
      if ((error as { code?: number })?.code === 11000) {
        throw new ConflictError(
          `Position ${body.position} already exists. Delete or renumber it first.`,
        );
      }
      throw error;
    }

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "boostPosition",
      String(position._id),
      position.toObject() as unknown as Record<string, unknown>,
    );

    return successResponse(position, "Position created", 201);
  },
);
