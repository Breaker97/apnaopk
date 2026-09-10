import { z } from "zod";
import { ObjectIdSchema } from "@/lib/validations";
import { Types } from "mongoose";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import {
  BOOST_CAMPAIGN_STATUS,
  BOOST_CANCEL_REASON,
  BOOST_HOLD_MAX_MINUTES,
  BOOST_HOLD_MIN_MINUTES,
  BOOST_MAX_OPEN_HOLDS,
  BOOST_MAX_POSITIONS,
  BOOST_POSITION_STATUS,
  PLATFORM_PAYMENT_KIND,
  PLATFORM_PAYMENT_STATUS,
  PLATFORM_PAYMENT_GATEWAYS
} from "@/config/app.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import {
  NotFoundError,
  ValidationError,
} from "@/lib/api/errors";
import { successResponse } from "@/lib/api/response";
import { validateBody } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { appUrlForRequest } from "@/lib/app-url";
import {
  BoostCampaign,
  BoostPosition,
  PlatformPayment,
  Product,
} from "@/models";
import {
  assertBoostingEnabled,
  assertProductIsBoostable,
  cancelBoostCampaign,
} from "@/lib/boosts/boosts";
import {
  addDays,
  BOOST_DAY_PATTERN,
  dayEndExclusiveUtc,
  dayStartUtc,
  daysBetweenInclusive,
  isValidDay,
  utcDay,
} from "@/lib/boosts/boost-days";
import {
  releaseReservationIfUnpaid,
  reserveBoostSlotRange,
} from "@/lib/boosts/boost-slots";
import {
  currencyMinimumPrice,
  currencyPriceScale,
  quantizeToCurrency,
} from "@/lib/intl/money";
import { buildBoostCheckoutMetadata } from "@/lib/boosts/boost-checkout-binding";
import {
  createPlatformPaymentAttempt,
  initiatePlatformPayment,
  resolvePlatformPaymentMethods,
} from "@/lib/payments/platform-payments";
import { assertStorefrontWriteAllowed } from "@/lib/maintenance";

const BoostCheckoutSchema = z.object({
  productId: ObjectIdSchema,
  /** Ladder rung number, not the admin row id — the rung IS the inventory key. */
  position: z.number().int().min(1).max(BOOST_MAX_POSITIONS),
  startDay: z.string().regex(BOOST_DAY_PATTERN),
  endDay: z.string().regex(BOOST_DAY_PATTERN),
  paymentMethod: z.enum(PLATFORM_PAYMENT_GATEWAYS),
  locale: z.string().min(2).max(12).optional(),
  iotecChannel: z.enum(["mobile_money", "card"]).optional(),
  iotecPhone: z.string().max(30).optional(),
  mtnMomoPhone: z.string().max(30).optional(),
});

/**
 * POST /api/vendor/boosts/checkout
 * Buy a boost for one product through any enabled gateway. Creates the
 * pending campaign, holds its days as BoostSlotDay rows (a duplicate key there
 * is the 409 that names the taken days), records one PlatformPayment attempt,
 * and starts the gateway flow.
 */
export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "vendor:boosts:checkout", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ request, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.MANAGE_BOOSTS,
      "You do not have permission to purchase boosts",
    );

    const body = await validateBody(request, BoostCheckoutSchema);
    const settings = await assertBoostingEnabled();
    assertStorefrontWriteAllowed(
      settings.maintenance,
      settings.general?.storeName,
    );
    const vendor = await requireApprovedVendorByUserId(session.user.id);

    const availableMethods = resolvePlatformPaymentMethods(
      settings,
      settings.boosting?.paymentMethods,
    );
    if (!availableMethods.includes(body.paymentMethod)) {
      throw new ValidationError(
        "This payment method is not available for boosts",
      );
    }

    const [positionDoc, product] = await Promise.all([
      BoostPosition.findOne({
        position: body.position,
        status: BOOST_POSITION_STATUS.ACTIVE,
      }).lean(),
      Product.findOne({
        _id: body.productId,
        vendorId: vendor._id,
      })
        .select("name status publishing.onlineStore")
        .lean<{
          _id: unknown;
          name?: string;
          status?: string;
          publishing?: { onlineStore?: boolean } | null;
        } | null>(),
    ]);
    if (!positionDoc) throw new NotFoundError("Boost position");
    if (!product) throw new NotFoundError("Product");
    assertProductIsBoostable(product);
    // The ladder pool also requires the vendor's store to be live. A lapsed paid
    // plan sets storeActive false while leaving status "approved", so this is
    // not implied by requireApprovedVendorByUserId — without it the vendor pays
    // in full for a placement that renders nowhere.
    if (vendor.storeActive === false) {
      throw new ValidationError(
        "Your store is currently inactive, so a boost would not be shown. Reactivate your store first.",
      );
    }

    const currency = (settings.general?.defaultCurrency || "USD").toUpperCase();
    // A rung priced in a currency the store no longer uses cannot be charged
    // without silently reinterpreting the number.
    if (positionDoc.currency && positionDoc.currency.toUpperCase() !== currency) {
      throw new ValidationError(
        "This position was priced in a different currency. Ask the marketplace to re-price it.",
      );
    }

    // ---- the range. The server's clock decides "today"; the client's does not.
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
    const horizonDays = settings.boosting?.bookingHorizonDays ?? 60;
    const maxBookingDays = settings.boosting?.maxBookingDays ?? 60;
    const billedDays = daysBetweenInclusive(body.startDay, body.endDay);
    if (billedDays > maxBookingDays) {
      throw new ValidationError(
        `A booking cannot exceed ${maxBookingDays} days`,
      );
    }
    if (body.endDay > addDays(today, horizonDays)) {
      throw new ValidationError(`Bookings open ${horizonDays} days ahead`);
    }

    // ---- the money. Integer arithmetic in the currency's own storage scale:
    // pricePerDay x days is the first multiplication to touch this path, and
    // 1.5 x 3 in a zero-decimal currency produces 4.5 — which the gateway's
    // integer check and the finalizer's cross-check both reject, refusing a
    // charge the store itself constructed.
    const scale = currencyPriceScale(currency);
    const factor = 10 ** scale;
    const perDayMinor = Math.round(
      quantizeToCurrency(positionDoc.pricePerDay, currency) * factor,
    );
    const pricePerDay = perDayMinor / factor;
    const amount = (perDayMinor * billedDays) / factor;
    if (amount < currencyMinimumPrice(currency)) {
      throw new ValidationError(
        `The total is below the minimum ${currencyMinimumPrice(currency)} ${currency} a charge can express`,
      );
    }

    // ---- one open checkout per (vendor, product), and at most a few per vendor.
    // There is deliberately no separate "reserve" endpoint: that would be a
    // second way to hold premium inventory with no payment intent behind it.
    const productId = new Types.ObjectId(body.productId);
    let campaign = await BoostCampaign.findOne({
      productId,
      vendorId: vendor._id,
      status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
    });
    if (!campaign) {
      const openHolds = await BoostCampaign.countDocuments({
        vendorId: vendor._id,
        status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
        holdExpiresAt: { $gt: new Date() },
      });
      if (openHolds >= BOOST_MAX_OPEN_HOLDS) {
        // Machine-readable, because the dialog has a translated message for
        // this and matching on the English sentence would break the moment
        // either side is reworded.
        const error = new ValidationError(
          `You already have ${BOOST_MAX_OPEN_HOLDS} checkouts open. Finish or cancel one first.`,
        );
        error.details = {
          reason: "too_many_holds",
          limit: BOOST_MAX_OPEN_HOLDS,
        };
        throw error;
      }
    }

    const holdMinutes = Math.min(
      BOOST_HOLD_MAX_MINUTES,
      Math.max(
        BOOST_HOLD_MIN_MINUTES,
        settings.boosting?.holdMinutes ?? 45,
      ),
    );
    const holdExpiresAt = new Date(Date.now() + holdMinutes * 60 * 1000);

    const terms = {
      positionId: positionDoc._id as Types.ObjectId,
      positionSnapshot: {
        position: positionDoc.position,
        label: positionDoc.label,
        pricePerDay,
        currency,
      },
      startDay: body.startDay,
      endDay: body.endDay,
      billedDays,
      startsAt: dayStartUtc(body.startDay),
      endsAt: dayEndExclusiveUtc(body.endDay),
      amount,
      currency,
      holdExpiresAt,
    };

    if (!campaign) {
      campaign = await BoostCampaign.create({
        vendorId: vendor._id,
        userId: session.user.id,
        productId,
        status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT,
        createdBy: session.user.id,
        ...terms,
      });
    }

    // Hold the days BEFORE the gateway is contacted. A duplicate key here is a
    // 409 naming the taken days, not a double-sell — and no payment attempt is
    // created on that path.
    const reservationToken = new Types.ObjectId();
    await reserveBoostSlotRange({
      campaignId: campaign._id as Types.ObjectId,
      vendorId: vendor._id as Types.ObjectId,
      productId,
      positionId: positionDoc._id as Types.ObjectId,
      position: positionDoc.position,
      startDay: body.startDay,
      endDay: body.endDay,
      reservationToken,
    });

    // Arm the terms with a CAS. Without it a webhook that fulfilled the campaign
    // between the findOne above and this write would silently rewrite the terms
    // of a paid boost.
    const armed = await BoostCampaign.findOneAndUpdate(
      { _id: campaign._id, status: BOOST_CAMPAIGN_STATUS.PENDING_PAYMENT },
      { $set: terms },
      { new: true },
    );
    if (!armed) {
      await releaseReservationIfUnpaid(
        campaign._id as Types.ObjectId,
        reservationToken,
      );
      throw new ValidationError(
        "This checkout is no longer open. Start a new one.",
      );
    }
    campaign = armed;

    const payment = await createPlatformPaymentAttempt({
      kind: PLATFORM_PAYMENT_KIND.BOOST,
      campaignId: String(campaign._id),
      vendorId: String(vendor._id),
      userId: session.user.id,
      provider: body.paymentMethod,
      amount,
      currency,
      // Amount alone cannot identify a booking — Position 1 x 7d and Position 5
      // x 35d can price identically — so fulfilment compares these too.
      boostTerms: {
        position: positionDoc.position,
        startDay: body.startDay,
        endDay: body.endDay,
      },
    });

    const locale = body.locale || "en";
    const origin = appUrlForRequest(request);
    const returnBase = `${origin}/${locale}/vendor/boosts?boost_payment=${String(payment._id)}`;

    try {
      const initiation = await initiatePlatformPayment({
        payment,
        settings,
        successUrl: returnBase,
        cancelUrl: `${returnBase}&canceled=true`,
        payer: {
          email: session.user.email || "",
          name: session.user.name || vendor.storeName,
          phone: body.iotecPhone || vendor.address?.phone,
          address: {
            country: vendor.address?.country,
            city: vendor.address?.city,
            street: vendor.address?.street,
            state: vendor.address?.state,
            postalCode: vendor.address?.postalCode,
          },
        },
        expiresAt: holdExpiresAt,
        description: `Boost position ${positionDoc.position} (${body.startDay} – ${body.endDay}): ${product.name || "product"}`,
        stripeMetadata: buildBoostCheckoutMetadata({
          paymentId: String(payment._id),
          campaignId: String(campaign._id),
          vendorId: String(vendor._id),
          userId: session.user.id,
          productId: String(product._id),
          positionId: String(positionDoc._id),
        }),
        iotecChannel: body.iotecChannel,
        iotecPhone: body.iotecPhone,
        mtnMomoPhone: body.mtnMomoPhone,
      });

      return successResponse({
        paymentId: String(payment._id),
        campaignId: String(campaign._id),
        provider: body.paymentMethod,
        ...initiation,
      });
    } catch (error) {
      // The gateway never took over — give the days back now rather than
      // leaving them held until the hold lapses.
      await PlatformPayment.updateOne(
        { _id: payment._id, status: PLATFORM_PAYMENT_STATUS.PENDING },
        {
          $set: {
            status: PLATFORM_PAYMENT_STATUS.FAILED,
            failedAt: new Date(),
            failureReason:
              error instanceof Error ? error.message : "Initiation failed",
          },
        },
      ).catch(() => undefined);
      // `onlyIfUnpaid`, like every other teardown here. Initiation can fail
      // locally — a timeout reading the response — after the gateway has already
      // created the transaction, and an unguarded cancel would then leave a paid
      // charge against a canceled campaign that no verify call can ever fulfil.
      await cancelBoostCampaign(
        String(campaign._id),
        BOOST_CANCEL_REASON.CHECKOUT_ABANDONED,
        { onlyIfUnpaid: true },
      ).catch(() => undefined);
      throw error;
    }
  },
);
