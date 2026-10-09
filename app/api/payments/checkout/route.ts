import { withRequestScope } from "@/lib/api/request-scope";
import { appUrlForRequest } from "@/lib/app-url";
import { after, NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Cart, Order } from "@/models";
import { assertShopperSession } from "@/lib/checkout/shopper-account";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { buildRazorpayCallbackUrl } from "@/lib/payments/razorpay-callback";
import { currencyMinorUnitExponent } from "@/lib/intl/money";
import {
  getOrderPreorderLines,
  markOrderPreorderReserved,
  PURCHASE_TYPE,
  releasePreorderQuantity,
  reservePreorderQuantity,
} from "@/lib/orders/preorders";
import { encodeEligibleProductIds } from "@/lib/orders/coupon-line-split";
import { releaseCouponUse, takeCouponUse } from "@/lib/catalog/coupons";
import { buildShippingMetadata } from "@/lib/checkout/checkout-shipping";
import { checkoutCartFingerprint } from "@/lib/checkout/checkout-cart-fingerprint";
import { handleApiError, ValidationError } from "@/lib/api/errors";
import { retireCartCheckoutAttempts } from "@/lib/checkout/checkout-attempts";
import { auth } from "@/lib/auth/auth";
import { headers } from "next/headers";
import { PAYMENT_STATUS } from "@/config/app.config";
import {
  SHOPPING_ADDRESS_ALLOWANCE,
  rateLimitByIP,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import { CheckoutSchema } from "@/lib/validations";
import {
  resolveGuestStripeCustomerId,
  resolveStripeCustomerId,
} from "@/lib/payments/stripe-customer";
import { PREORDER_CARD_SETUP_KIND } from "@/lib/payments/preorder-mandate";
import { notifyOrderCreatedParticipants } from "@/lib/notifications/notifications";
import { retireRefusedGatewayOrder } from "@/lib/orders/refused-gateway-order";
import { reserveAsyncPushInventory } from "@/lib/orders/async-push-inventory";
import { isAttemptGateway } from "@/lib/payments/attempt-gateways";
import { storeCurrencyCode } from "@/lib/payments/gateway-currencies";
import { recordAttemptGatewayRefs } from "@/lib/checkout/checkout-attempt-store";
import { getClientIP } from "@/lib/api/rate-limit-middleware";
import { prepareCheckout } from "@/lib/checkout/prepare-checkout";
import { placeCodOrder } from "@/lib/checkout/place-cod-order";
import { startIotecPayment } from "@/lib/checkout/gateway-start/iotec";
import { startMtnMomoPayment } from "@/lib/checkout/gateway-start/mtn-momo";
import { customerActor } from "@/lib/orders/audit-order";
import {
  claimCartForOrder,
  createOrder,
  type CheckoutCartItem,
} from "@/lib/checkout/checkout-order-document";
import {
  openGatewayAttempt,
  orderDocumentParams,
} from "@/lib/checkout/gateway-start/attempt";
import { startOrangeMoneyCheckout } from "@/lib/checkout/gateway-start/orange-money";
import { startPayPalCheckout } from "@/lib/checkout/gateway-start/paypal";
import { startPaystackCheckout } from "@/lib/checkout/gateway-start/paystack";
import { startPesapalCheckout } from "@/lib/checkout/gateway-start/pesapal";
import { startRazorpayCheckout } from "@/lib/checkout/gateway-start/razorpay";

/**
 * POST /api/payments/checkout
 * Create checkout payment session/order
 */
export async function POST(request: NextRequest) {
  // One read of the store's settings for the whole checkout — see
  // lib/api/request-scope.ts. This route never writes them.
  return withRequestScope(() => placeCheckout(request));
}

async function placeCheckout(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const cartSessionId = request.cookies?.get("cart_session")?.value;

    if (session?.user?.id) {
      await rateLimitByUser(
        request,
        session.user.id,
        "payments:checkout",
        "strict",
        session.user.role
      );
    } else if (cartSessionId) {
      await rateLimitBySession(
        request,
        cartSessionId,
        "payments:checkout",
        "strict",
        SHOPPING_ADDRESS_ALLOWANCE,
      );
    } else {
      await rateLimitByIP(request, "strict");
    }
    // An admin, team member or seller places no storefront order; refused
    // before the cart is read. See lib/checkout/shopper-account.ts.
    assertShopperSession(session);

    await connectDB();

    const body = await validateBody(request, CheckoutSchema);
    const { paymentMethod, setupIntentId, iotecChannel, iotecPhone, mtnMomoPhone } = body;

    // Who is buying, from which cart, at what price, delivered how — and the
    // writes every way of paying shares. See lib/checkout/prepare-checkout.ts.
    const draft = await prepareCheckout(
      body,
      {
        user: session?.user
          ? {
              id: session.user.id,
              email: session.user.email,
              name: session.user.name,
              phone: (session.user as { phone?: string | null }).phone,
            }
          : null,
        cartSessionId,
        clientIp: getClientIP(request),
        origin: appUrlForRequest(request),
      },
      { mode: "place" },
    );
    const {
      settings,
      cart,
      items,
      customerEmail,
      customerId,
      guestEmail,
      isMultiVendorEnabled,
      orderSettings,
      hasPreorder,
      digitalOnly,
      normalizedShippingAddress,
      normalizedBillingAddress,
      checkoutDetails,
      subtotal,
      discount,
      tax,
      total,
      shippingCost,
      dutyAmount,
      selectedShippingMethod,
      vendorShippingCosts,
      customsEstimate,
      shippingResolution,
      pickupFulfillment,
      appliedCoupon,
      couponVendorShares,
      couponShippingShares,
      couponEligibleProductIds,
      paymentDueNow,
      preorderMandateText,
      activeLocale,
      origin,
      checkoutUrl,
      checkoutCouponHoldKey,
      orderStoreCredit,
    } = draft;

    const paymentSettings = settings.payment || {};
    const stripeSettings = paymentSettings.stripe;

    // Cash on delivery — see lib/checkout/place-cod-order.ts.
    if (paymentMethod === "cod") {
      const { data } = await placeCodOrder(draft, {
        audit: customerActor(request, session),
      });
      return NextResponse.json({ success: true, data });
    }


    if (hasPreorder && paymentDueNow <= 0) {
      // Nothing was charged, so nothing proves a card was collected except the
      // SetupIntent the client just confirmed — and its id arrives in the
      // request, where anyone could put any id on the account. Read it back
      // from Stripe and believe only what Stripe says: our own metadata names
      // the shopper it was set up for, and it has to name this one.
      let preorderSavedPaymentMethodId: string | undefined;
      let preorderStripeCustomerId: string | undefined;
      if (setupIntentId) {
        const setupSecretKey = resolveStripeCredentials(stripeSettings).secretKey;
        if (!isStripeSecretKeyConfigured(setupSecretKey)) {
          throw new ValidationError("Card payments are not configured");
        }
        const setupIntent = await getStripeForSecretKey(
          setupSecretKey,
        ).setupIntents.retrieve(setupIntentId);
        const setupMetadata = setupIntent.metadata || {};
        if (
          setupMetadata.kind !== PREORDER_CARD_SETUP_KIND ||
          String(setupMetadata.userId || "") !== String(customerId) ||
          setupIntent.status !== "succeeded"
        ) {
          throw new ValidationError({
            setupIntentId: ["This card setup does not belong to this order"],
          });
        }
        const method = setupIntent.payment_method;
        preorderSavedPaymentMethodId =
          typeof method === "string" ? method : method?.id;
        // The Customer the card was saved against, read off the setup rather
        // than recomputed. For a guest it exists nowhere else: it was minted
        // for this cart, and the order is the only thing that will remember it.
        const setupCustomer = setupIntent.customer;
        preorderStripeCustomerId =
          typeof setupCustomer === "string" ? setupCustomer : setupCustomer?.id;
      }
      if (preorderMandateText && !preorderSavedPaymentMethodId) {
        // The shopper authorised a card being kept and none was: the order is
        // still good — they will be asked for the balance the way they always
        // were — but the authorisation bought nothing, which is worth saying.
        console.error(
          "Pay-later pre-order accepted the card mandate without a saved card",
        );
      }
      // One order per cart: a double-submit created two orders from the same
      // cart and reserved its places twice — see `claimCartForOrder`.
      const releaseCartClaim = await claimCartForOrder(cart._id);

      const preorderLines = getOrderPreorderLines(items);
      // Nothing is captured later that would count the coupon, so its use is
      // taken with the order, as cash on delivery's is; cancelling or expiring
      // the pre-order gives it back.
      if (appliedCoupon) {
        try {
          await takeCouponUse({
            couponId: appliedCoupon.couponId,
            holdKey: checkoutCouponHoldKey,
          });
        } catch (err) {
          await releaseCartClaim();
          throw err;
        }
      }
      const giveBackCouponUse = () =>
        appliedCoupon
          ? releaseCouponUse(appliedCoupon.couponId).catch((err) =>
              console.error("Failed to give back a pay-later coupon use:", err),
            )
          : Promise.resolve();
      try {
        await reservePreorderQuantity(preorderLines);
      } catch (err) {
        await giveBackCouponUse();
        await releaseCartClaim();
        throw err;
      }
      let order: Awaited<ReturnType<typeof createOrder>>;
      try {
        order = await createOrder({
          ...checkoutDetails,
          storeCredit: orderStoreCredit,
          customerId,
          guestEmail,
          items,
          shippingAddress: normalizedShippingAddress,
        digitalOnly,
          billingAddress: normalizedBillingAddress,
          paymentMethod: "pay_later",
          couponUseTaken: Boolean(appliedCoupon),
          preorderMandateText: preorderMandateText || undefined,
          preorderSavedPaymentMethodId,
          stripeCustomerId: preorderStripeCustomerId,
          shippingMethod: selectedShippingMethod,
          customs: customsEstimate,
          vendorShippingCosts,
          fulfillment: pickupFulfillment,
          paymentStatus: PAYMENT_STATUS.PENDING,
          subtotal,
          discount,
          shippingCost,
          tax,
          total,
          coupon: appliedCoupon
            ? {
                code: appliedCoupon.code,
                type: appliedCoupon.type,
                value: appliedCoupon.value,
                couponId: appliedCoupon.couponId,
                vendorShares: couponVendorShares,
                eligibleProductIds: couponEligibleProductIds,
                shippingShares: couponShippingShares,
                fundedBy: appliedCoupon.fundedBy,
              }
            : undefined,
          isMultiVendorEnabled,
          orderPrefix: orderSettings.prefix,
          currency: settings.general?.defaultCurrency || "USD",
        });
      } catch (err) {
        await releasePreorderQuantity(preorderLines).catch(() => undefined);
        await giveBackCouponUse();
        await releaseCartClaim();
        throw err;
      }
      await markOrderPreorderReserved(String(order._id)).catch((err) =>
        console.error("Failed to mark pay-later preorder reserved:", err),
      );
      // Emptied and released together: the empty cart is what refuses a late
      // duplicate from here on.
      await Cart.findByIdAndUpdate(cart._id, {
        $set: { items: [] },
        $unset: { checkoutClaimedAt: "" },
      });
      // Any redirect-gateway attempt from this cart will never be paid now.
      await retireCartCheckoutAttempts(cart._id, order._id).catch((err) =>
        console.error("Failed to retire the cart's gateway attempts:", err),
      );
      after(async () => {
        await notifyOrderCreatedParticipants(order).catch((err) =>
          console.error(
            "Failed to create pay-later preorder notifications:",
            err,
          ),
        );
      });
      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "pay_later",
          redirectUrl: `${checkoutUrl("/checkout/success")}?order=${order.orderNumber}`,
        },
      });
    }


    // The order a gateway's start or the hosted card writes, and where the
    // request came from for the checkout attempt that may stand in for it —
    // see lib/checkout/gateway-start/attempt.ts.
    const baseOrderDocumentParams = orderDocumentParams(draft);
    const startRequest = {
      clientIp: getClientIP(request),
      userAgent: request.headers.get("user-agent") || undefined,
    };

    // Store credit covers all of it (R8): there is nothing to ask a gateway
    // for. The order is written paid and settled the way a captured payment
    // is — stock taken, coupon used, cart closed, the shopper told — and the
    // credit's hold is spent with it.
    if (paymentMethod === "store_credit") {
      if (!orderStoreCredit) {
        throw new ValidationError({
          paymentMethod: ["You have no store credit to pay with. Choose another way to pay."],
        });
      }
      // One order per cart — see `claimCartForOrder`. Released once settled:
      // by then the cart is closed, which refuses a late duplicate.
      const releaseCartClaim = await claimCartForOrder(cart._id);
      let settled: { ok: boolean };
      let order: Awaited<ReturnType<typeof createOrder>>;
      try {
        order = await createOrder({
          ...baseOrderDocumentParams,
          paymentMethod: "store_credit",
          paymentStatus: PAYMENT_STATUS.PAID,
          paidAt: new Date(),
        });
        const [{ settleCapturedOrder }, { customerActor }] = await Promise.all([
          import("@/lib/payments/finalize-order"),
          import("@/lib/orders/audit-order"),
        ]);
        settled = await settleCapturedOrder({
          order: order as unknown as Parameters<typeof settleCapturedOrder>[0]["order"],
          provider: { label: "Store credit", recoveryGateway: "store_credit" },
          paymentId: orderStoreCredit.holdKey,
          auditTransactionId: null,
          recordPlacement: true,
          settings,
          actor: customerActor(request, session),
          cart: { cartId: cart._id },
          recoveryMessage: "Paid with store credit",
          customerEmail,
        });
      } finally {
        await releaseCartClaim();
      }
      if (!settled.ok) {
        // Called off with the credit given back — see `settleCapturedOrder`.
        throw new ValidationError({
          stock: [
            "Some items in your cart sold out just now. Your store credit has been given back.",
          ],
        });
      }
      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "store_credit",
          redirectUrl: `${origin}/${activeLocale}/checkout/success?order=${order.orderNumber}`,
        },
      });
    }

    // PayPal — see lib/checkout/gateway-start/paypal.ts.
    if (paymentMethod === "paypal") {
      const start = await startPayPalCheckout(draft, {
        returnUrl: `${checkoutUrl("/checkout/success")}`,
        cancelUrl: `${checkoutUrl("/checkout")}?canceled=true`,
        request: startRequest,
      });
      return NextResponse.json({
        success: true,
        data: {
          orderId: start.record.id,
          orderNumber: start.record.orderNumber,
          paymentMethod: "paypal",
          paypalOrderId: start.paypalOrderId,
          url: start.approvalUrl,
          ...(start.resumed ? { resumed: true } : {}),
        },
      });
    }

    // Razorpay — see lib/checkout/gateway-start/razorpay.ts.
    if (paymentMethod === "razorpay") {
      const start = await startRazorpayCheckout(draft, { request: startRequest });
      return NextResponse.json({
        success: true,
        data: {
          orderId: start.record.id,
          orderNumber: start.record.orderNumber,
          paymentMethod: "razorpay",
          keyId: start.keyId,
          razorpayOrderId: start.razorpayOrderId,
          amount: start.amount,
          currency: start.currency,
          name: settings.general?.storeName || "Store",
          description: `Order ${start.record.orderNumber}`,
          // A failed payment lands on the same page, which shows the failure
          // instead of verifying.
          callbackUrl: buildRazorpayCallbackUrl({
            successUrl: `${checkoutUrl("/checkout/success")}`,
            failureUrl: `${checkoutUrl("/checkout/success")}`,
          }),
          ...(start.resumed ? { resumed: true } : {}),
        },
      });
    }

    // Paystack — see lib/checkout/gateway-start/paystack.ts.
    if (paymentMethod === "paystack") {
      const start = await startPaystackCheckout(draft, {
        callbackUrl: (reference) =>
          `${checkoutUrl("/checkout/success")}?paystack_reference=${encodeURIComponent(reference)}`,
        request: startRequest,
      });
      return NextResponse.json({
        success: true,
        data: {
          orderId: start.record.id,
          orderNumber: start.record.orderNumber,
          paymentMethod: "paystack",
          paystackReference: start.reference,
          ...(start.accessCode !== undefined ? { accessCode: start.accessCode } : {}),
          url: start.authorizationUrl,
          ...(start.resumed ? { resumed: true } : {}),
        },
      });
    }

    // Pesapal — see lib/checkout/gateway-start/pesapal.ts.
    if (paymentMethod === "pesapal") {
      const start = await startPesapalCheckout(draft, {
        callbackUrl: (merchantReference) =>
          `${checkoutUrl("/checkout/success")}?pesapal_reference=${encodeURIComponent(merchantReference)}`,
        cancellationUrl: `${checkoutUrl("/checkout")}?canceled=true`,
        request: startRequest,
      });
      return NextResponse.json({
        success: true,
        data: {
          orderId: start.record.id,
          orderNumber: start.record.orderNumber,
          paymentMethod: "pesapal",
          pesapalOrderTrackingId: start.orderTrackingId,
          pesapalMerchantReference: start.merchantReference,
          url: start.redirectUrl,
          ...(start.resumed ? { resumed: true } : {}),
        },
      });
    }

    // ioTec — see lib/checkout/gateway-start/iotec.ts.
    if (paymentMethod === "iotec") {
      const isCard = iotecChannel === "card";
      const { order, externalId, transactionId, cardRedirectUrl } =
        await startIotecPayment(draft, {
          channel: iotecChannel,
          phone: iotecPhone,
          cardReturnUrl: (reference) =>
            `${checkoutUrl("/checkout/success")}?iotec_external_id=${encodeURIComponent(reference)}`,
        });
      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "iotec",
          iotecTransactionId: transactionId,
          iotecExternalId: externalId,
          ...(isCard
            ? { url: cardRedirectUrl }
            : // No redirect: the payer approves the charge on their phone; the
              // client polls /api/payments/iotec/verify until it resolves.
              { requiresPolling: true }),
        },
      });
    }

    // Orange Money — see lib/checkout/gateway-start/orange-money.ts.
    if (paymentMethod === "orange_money") {
      const start = await startOrangeMoneyCheckout(draft, {
        returnUrl: (orangeMoneyOrderId) =>
          `${checkoutUrl("/checkout/success")}?orange_money_order_id=${encodeURIComponent(orangeMoneyOrderId)}`,
        cancelUrl: `${checkoutUrl("/checkout")}?canceled=true`,
      });
      return NextResponse.json({
        success: true,
        data: {
          orderId: start.record.id,
          orderNumber: start.record.orderNumber,
          paymentMethod: "orange_money",
          orangeMoneyOrderId: start.orangeMoneyOrderId,
          url: start.paymentUrl,
        },
      });
    }

    // MTN MoMo — see lib/checkout/gateway-start/mtn-momo.ts.
    if (paymentMethod === "mtn_momo") {
      const { order, referenceId } = await startMtnMomoPayment(draft, {
        phone: mtnMomoPhone,
      });
      return NextResponse.json({
        success: true,
        data: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentMethod: "mtn_momo",
          mtnMomoReferenceId: referenceId,
          // No redirect: the payer approves the PIN prompt on their phone; the
          // client polls /api/payments/mtn-momo/verify until it resolves.
          requiresPolling: true,
        },
      });
    }

    if (paymentMethod !== "card") {
      throw new ValidationError("Unsupported payment method");
    }

    if (discount > 0) {
      throw new ValidationError(
        "Discounted card checkout is handled via Payment Intent flow",
      );
    }

    if (!stripeSettings?.enabled)
      throw new ValidationError("Stripe is disabled");
    const stripeSecretKey = resolveStripeCredentials(stripeSettings).secretKey;
    if (!isStripeSecretKeyConfigured(stripeSecretKey)) {
      throw new ValidationError(
        "Stripe is enabled but not configured. Please add Stripe Secret Key in Admin → Settings → Payments.",
      );
    }

    // Create Stripe line items
    const checkoutCurrency = (
      settings.general?.defaultCurrency || "USD"
    ).toLowerCase();
    const lineItems = items
      .map((item: CheckoutCartItem) => {
        const isDeposit =
          item.purchaseType === PURCHASE_TYPE.PREORDER &&
          typeof item.preorderDepositAmount === "number";
        const lineDueNow = isDeposit
          ? Number(item.preorderDepositAmount)
          : item.price * item.quantity;
        if (lineDueNow <= 0) return null;
        // A deposit is a whole-line figure. Split per unit and multiplied back
        // it lost cents: 10.00 over 3 units was charged 3.33 × 3 = 9.99. So it
        // goes to Stripe as one line of the whole amount.
        return {
          price_data: {
            currency: checkoutCurrency,
            product_data: {
              name: isDeposit
                ? `${item.productId.name} × ${item.quantity} (deposit)`
                : item.productId.name,
              images: item.productId.images?.slice(0, 1) || [],
            },
            unit_amount: toStripeAmount(
              isDeposit ? lineDueNow : lineDueNow / item.quantity,
              checkoutCurrency,
            ),
          },
          quantity: isDeposit ? 1 : item.quantity,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    // Add shipping if applicable
    if (shippingCost > 0) {
      lineItems.push({
        price_data: {
          currency: checkoutCurrency,
          product_data: {
            name: "Shipping",
            images: [],
          },
          unit_amount: toStripeAmount(shippingCost, checkoutCurrency),
        },
        quantity: 1,
      });
    }

    // Add tax
    if (tax > 0) {
      lineItems.push({
        price_data: {
          currency: checkoutCurrency,
          product_data: {
            name: "Tax",
            images: [],
          },
          unit_amount: toStripeAmount(tax, checkoutCurrency),
        },
        quantity: 1,
      });
    }

    // Add estimated import duties (DDP) so the charged amount matches `total`.
    if (dutyAmount > 0) {
      lineItems.push({
        price_data: {
          currency: checkoutCurrency,
          product_data: {
            name: "Estimated duties",
            images: [],
          },
          unit_amount: toStripeAmount(dutyAmount, checkoutCurrency),
        },
        quantity: 1,
      });
    }

    // Same reason as the PaymentIntent path: a pre-order that will be asked for
    // its balance later needs the deposit to have belonged to a Customer — a
    // guest's minted for this cart, since they have no account to keep one on.
    const stripeCustomerId =
      // The account's own Customer only for its signed-in owner: a guest
      // checkout filed under an account by its email is still a stranger to
      // the cards saved on it.
      (session?.user?.id
        ? await resolveStripeCustomerId({
            secretKey: stripeSecretKey,
            userId: session.user.id,
            email: customerEmail,
            name: session.user.name,
          })
        : undefined) ||
      (!session?.user?.id && preorderMandateText
        ? await resolveGuestStripeCustomerId({
            secretKey: stripeSecretKey,
            cartId: String(cart._id),
            email: customerEmail,
          })
        : undefined);

    // Create Stripe checkout session
    const checkoutSession = await getStripeForSecretKey(
      stripeSecretKey,
    ).checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      // Keep the card for the balance, on the same terms as the embedded card
      // flow: only where the shopper authorised it and there is a Customer for
      // Stripe to attach it to.
      ...(preorderMandateText && stripeCustomerId
        ? {
            payment_intent_data: {
              setup_future_usage: "off_session" as const,
            },
          }
        : {}),
      metadata: {
        // Carried on the session because that is what the order builder reads
        // when the hosted page is the one that took the money.
        preorderMandate: preorderMandateText,
        userId: customerId,
        cartId: String(cart._id),
        shippingAddress: JSON.stringify(normalizedShippingAddress),
        billingAddress: JSON.stringify(normalizedBillingAddress),
        customerEmail: customerEmail || "",
        subtotal: String(subtotal),
        tax: String(tax),
        discount: String(discount),
        total: String(total),
        // Taken after the re-priced lines were written back to the cart, which
        // is what the order builder will read and compare this against.
        cartFingerprint: checkoutCartFingerprint(items),
        couponCode: appliedCoupon?.code || "",
        couponType: appliedCoupon?.type || "",
        couponValue: appliedCoupon ? String(appliedCoupon.value) : "",
        couponId: appliedCoupon?.couponId || "",
        couponFundedBy: appliedCoupon?.fundedBy || "",
        couponVendorShares: couponVendorShares
          ? JSON.stringify(couponVendorShares)
          : "",
        couponEligibleProducts: encodeEligibleProductIds(couponEligibleProductIds),
        couponShippingShares: couponShippingShares
          ? JSON.stringify(couponShippingShares)
          : "",
        ...(shippingResolution
          ? buildShippingMetadata(shippingResolution)
          : {
              shipping: "0",
              shippingMethod: JSON.stringify(selectedShippingMethod),
              customsDuty: "0",
              customs: JSON.stringify(customsEstimate),
              vendorShipping: "",
            }),
        pickupFulfillment: pickupFulfillment
          ? JSON.stringify(pickupFulfillment)
          : "",
      },
      // A Session takes one or the other, never both. The Customer is the more
      // useful of the two when we have it: the hosted page still prefills the
      // address from it, and the payment lands on a person the later balance
      // charge can be made against.
      ...(stripeCustomerId
        ? { customer: stripeCustomerId }
        : { customer_email: customerEmail }),
      success_url: `${checkoutUrl("/checkout/success")}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${checkoutUrl("/checkout")}?canceled=true`,
    });

    // The hosted page's own attempt, on the same terms as the embedded card
    // form's: Stripe still writes no order until the money is captured, and
    // this row is what a refused card leaves behind.
    if (isAttemptGateway(settings, "card")) {
      const attempt = await openGatewayAttempt(draft, "card", startRequest).catch((err) => {
        console.error("Failed to open a checkout attempt for Stripe:", err);
        return null;
      });
      if (attempt) {
        await recordAttemptGatewayRefs(attempt._id, {
          stripeSessionId: checkoutSession.id,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        sessionId: checkoutSession.id,
        url: checkoutSession.url,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
