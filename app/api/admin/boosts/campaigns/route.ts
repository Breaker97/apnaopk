import { z } from "zod";
import { Types } from "mongoose";
import {
  BOOST_DAY_PATTERN,
  dayEndExclusiveUtc,
  dayStartUtc,
  daysBetweenInclusive,
  isValidDay,
  utcDay,
} from "@/lib/boosts/boost-days";
import { reserveBoostSlotRange } from "@/lib/boosts/boost-slots";
import { currencyPriceScale, quantizeToCurrency } from "@/lib/intl/money";
import {
  BOOST_CAMPAIGN_STATUS,
  BOOST_CANCEL_REASON,
  BOOST_HOLD_MIN_MINUTES,
  BOOST_MAX_POSITIONS,
  BOOST_POSITION_STATUS,
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_PROVIDER,
  PLATFORM_PAYMENT_STATUS,
} from "@/config/app.config";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { paginatedResponse, successResponse } from "@/lib/api/response";
import { validateBody, validateQuery } from "@/lib/api/validate";
import { AdminListQuerySchema, ObjectIdSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";
import { auditCreate, createAuditContext } from "@/lib/audit";
import { BoostCampaign, BoostPosition, Product, Vendor } from "@/models";
import {
  assertBoostingEnabled,
  assertProductIsBoostable,
  cancelBoostCampaign,
} from "@/lib/boosts/boosts";
import { fetchBoostCampaignList } from "@/lib/boosts/boost-campaign-list";
import {
  createPlatformPaymentAttempt,
  finalizePlatformPayment,
} from "@/lib/payments/platform-payments";
import { PlatformPayment } from "@/models";

const ManualCampaignSchema = z.object({
  vendorId: ObjectIdSchema,
  productId: ObjectIdSchema,
  position: z.number().int().min(1).max(BOOST_MAX_POSITIONS),
  startDay: z.string().regex(BOOST_DAY_PATTERN),
  endDay: z.string().regex(BOOST_DAY_PATTERN),
  /**
   * Discount for a comped placement. Bounded server-side to
   * [0, pricePerDay x days] — an admin may discount a booking, never inflate
   * one. 0 is allowed: MANUAL never reaches a gateway, so the currency-minimum
   * floor that governs vendor checkout does not apply here.
   */
  amountOverride: z.number().min(0).optional(),
});

/**
 * GET /api/admin/boosts/campaigns
 * All boost campaigns across vendors.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:boostCampaigns:list", preset: "lenient" },
  },
  async ({ request }) => {
    await assertBoostingEnabled();
    const { page, limit, search, status } = validateQuery(
      request,
      AdminListQuerySchema,
    );
    const list = await fetchBoostCampaignList({ page, limit, search, status });
    return paginatedResponse(list.items, page, limit, list.total);
  },
);

/**
 * POST /api/admin/boosts/campaigns
 * Manual (offline-payment) boost: the admin creating it IS the payment
 * verification, so the campaign activates immediately with a paid manual
 * PlatformPayment behind it.
 */
export const POST = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:boostCampaigns:create", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, session }) => {
    const settings = await assertBoostingEnabled();
    const body = await validateBody(request, ManualCampaignSchema);

    const [vendor, positionDoc, product] = await Promise.all([
      Vendor.findById(body.vendorId).select("userId storeName storeActive").lean<{
        _id: unknown;
        userId?: string;
        storeName?: string;
        storeActive?: boolean;
      } | null>(),
      BoostPosition.findOne({
        position: body.position,
        status: BOOST_POSITION_STATUS.ACTIVE,
      }).lean(),
      Product.findOne({ _id: body.productId, vendorId: body.vendorId })
        .select("name status publishing.onlineStore")
        .lean<{
          _id: unknown;
          name?: string;
          status?: string;
          publishing?: { onlineStore?: boolean } | null;
        } | null>(),
    ]);
    if (!vendor) throw new NotFoundError("Vendor");
    if (!positionDoc) throw new NotFoundError("Boost position");
    if (!product) throw new NotFoundError("Product");
    assertProductIsBoostable(product);
    // Same rule as the vendor checkout: the sponsored pool requires the store
    // to be live, so a lapsed-plan vendor (storeActive false, status still
    // "approved") would get a placement that renders nowhere.
    if (vendor.storeActive === false) {
      throw new ValidationError(
        "This vendor's store is inactive, so a boost would not be shown. Reactivate the store first.",
      );
    }

    const currency = (settings.general?.defaultCurrency || "USD").toUpperCase();
    if (positionDoc.currency && positionDoc.currency.toUpperCase() !== currency) {
      throw new ValidationError(
        "This position was priced in a different currency. Re-price it first.",
      );
    }

    const today = utcDay();
    if (!isValidDay(body.startDay) || !isValidDay(body.endDay)) {
      throw new ValidationError("Pick a valid date range");
    }
    if (body.endDay < body.startDay) {
      throw new ValidationError("The end date cannot precede the start date");
    }
    if (body.startDay < today) {
      throw new ValidationError("Bookings cannot start in the past");
    }
    const billedDays = daysBetweenInclusive(body.startDay, body.endDay);

    const scale = currencyPriceScale(currency);
    const factor = 10 ** scale;
    const perDayMinor = Math.round(
      quantizeToCurrency(positionDoc.pricePerDay, currency) * factor,
    );
    const listAmount = (perDayMinor * billedDays) / factor;
    // Discount only, never a markup — and the snapshot still records the list
    // price, so the occupancy strip's revenue stays honest about what was
    // given away.
    const amount =
      body.amountOverride === undefined
        ? listAmount
        : Math.min(
            quantizeToCurrency(body.amountOverride, currency),
            listAmount,
          );

    const productId = new Types.ObjectId(body.productId);
    const vendorObjectId = new Types.ObjectId(body.vendorId);

    // The admin path deliberately does NOT reuse an open vendor checkout: doing
    // so would rewrite the terms of a booking behind a live gateway session.
    const openHold = await BoostCampaign.exists({
      productId,
      vendorId: vendorObjectId,
      status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
      holdExpiresAt: { $gt: new Date() },
    });
    if (openHold) {
      throw new ValidationError(
        "This vendor has an open checkout for this product. Wait for it to lapse or cancel it first.",
      );
    }

    const campaign = await BoostCampaign.create({
      vendorId: vendorObjectId,
      userId: vendor.userId || session.user.id,
      productId,
      positionId: positionDoc._id,
      positionSnapshot: {
        position: positionDoc.position,
        label: positionDoc.label,
        pricePerDay: perDayMinor / factor,
        currency,
      },
      startDay: body.startDay,
      endDay: body.endDay,
      billedDays,
      startsAt: dayStartUtc(body.startDay),
      endsAt: dayEndExclusiveUtc(body.endDay),
      status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
      amount,
      currency,
      // A hold stamp even though nothing here waits on a gateway. The row is
      // born PENDING_PAYMENT, and releaseLapsedBoostHolds filters on
      // `holdExpiresAt: {$lte: now}` — a null never matches that, so a campaign
      // this request fails to finish would hold its slot-days permanently, with
      // no UI able to see them and the orphan sweep skipping it because the
      // campaign is not terminal.
      holdExpiresAt: new Date(Date.now() + BOOST_HOLD_MIN_MINUTES * 60 * 1000),
      createdBy: session.user.id,
    });

    // Hold the days before recording the payment. A 409 here means someone
    // already owns them; nothing has been charged.
    const reservationToken = new Types.ObjectId();
    try {
      await reserveBoostSlotRange({
        campaignId: campaign._id as Types.ObjectId,
        vendorId: vendorObjectId,
        productId,
        positionId: positionDoc._id as Types.ObjectId,
        position: positionDoc.position,
        startDay: body.startDay,
        endDay: body.endDay,
        reservationToken,
      });
    } catch (error) {
      await BoostCampaign.deleteOne({ _id: campaign._id });
      throw error;
    }

    // Same discipline as the reservation above: anything that throws past this
    // point gives the days back rather than stranding them behind a campaign
    // stuck in PENDING_PAYMENT. The hold stamp is the backstop for a hard crash;
    // this is the one that runs.
    try {
      const payment = await createPlatformPaymentAttempt({
        kind: PLATFORM_PAYMENT_KIND.BOOST,
        campaignId: String(campaign._id),
        vendorId: body.vendorId,
        userId: vendor.userId || session.user.id,
        provider: PLATFORM_PAYMENT_PROVIDER.MANUAL,
        amount,
        currency,
        boostTerms: {
          position: positionDoc.position,
          startDay: body.startDay,
          endDay: body.endDay,
        },
      });
      await finalizePlatformPayment(payment, {});

      const activated = await PlatformPayment.findById(payment._id)
        .select("status")
        .lean<{ status?: string } | null>();
      if (activated?.status !== PLATFORM_PAYMENT_STATUS.PAID) {
        throw new ValidationError("Failed to record the manual boost payment");
      }
    } catch (error) {
      await cancelBoostCampaign(
        String(campaign._id),
        BOOST_CANCEL_REASON.CHECKOUT_ABANDONED,
        { onlyIfUnpaid: true },
      ).catch(() => undefined);
      throw error;
    }

    const auditContext = createAuditContext(request, session);
    await auditCreate(
      auditContext,
      "boostCampaign",
      String(campaign._id),
      campaign.toObject() as unknown as Record<string, unknown>,
    );

    const fresh = await BoostCampaign.findById(campaign._id).lean();
    return successResponse(fresh, "Boost created and activated", 201);
  },
);
