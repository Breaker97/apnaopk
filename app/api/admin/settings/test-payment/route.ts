/**
 * POST /api/admin/settings/test-payment
 * Test Stripe/PayPal/Razorpay/Paystack credentials (admin only)
 */

import { NextResponse } from "next/server";
import { getSettings } from "@/models/settings.model";
import { getStripeForSecretKey } from "@/lib/payments/stripe";
import { getPayPalAccessToken } from "@/lib/payments/paypal";
import {
  getRazorpayCredentials,
  testRazorpayCredentials,
} from "@/lib/payments/razorpay";
import {
  getPaystackCredentials,
  testPaystackCredentials,
} from "@/lib/payments/paystack";
import {
  getPesapalCredentials,
  requestPesapalToken,
} from "@/lib/payments/pesapal";
import { getIotecCredentials, requestIotecToken } from "@/lib/payments/iotec";
import {
  getOrangeMoneyCredentials,
  requestOrangeMoneyToken,
} from "@/lib/payments/orange-money";
import {
  getMtnMomoAccountBalance,
  getMtnMomoCredentials,
  requestMtnMomoToken,
} from "@/lib/payments/mtn-momo";
import {
  resolveIotecCredentials,
  resolveMtnMomoCredentials,
  resolveOrangeMoneyCredentials,
  resolvePayPalCredentials,
  resolvePesapalCredentials,
  resolveStripeCredentials,
} from "@/lib/settings/credentials";
import { z } from "zod";
import { withApi } from "@/lib/api/handler";

const TestProviderSchema = z.object({ provider: z.string().max(40).optional() });

export const POST = withApi(
  {
    auth: "admin",
    demo: "block-mutations",
    // Every test reaches an outside service (or sends real mail), so it is
    // throttled like test-carrier rather than left to the admin's patience.
    rateLimit: { action: "admin:settings:test-payment", preset: "strict" },
  },
  async ({ request }) => {
    try {
      const settings = await getSettings();

      const body = TestProviderSchema.parse(await request.json().catch(() => ({})));
      const provider = body?.provider;

      if (provider === "stripe") {
        const secretKey = resolveStripeCredentials(
          settings.payment?.stripe,
        ).secretKey;
        if (!secretKey) {
          return NextResponse.json(
            { success: false, message: "Stripe secret key is missing" },
            { status: 400 },
          );
        }

        await getStripeForSecretKey(secretKey).accounts.retrieve();

        return NextResponse.json({ success: true, message: "Stripe is connected" });
      }

      if (provider === "paypal") {
        const { clientId, clientSecret, mode } = resolvePayPalCredentials(
          settings.payment?.paypal,
        );

        if (!clientId || !clientSecret) {
          return NextResponse.json(
            { success: false, message: "PayPal credentials are missing" },
            { status: 400 },
          );
        }

        await getPayPalAccessToken({
          clientId,
          clientSecret,
          mode,
        });

        return NextResponse.json({ success: true, message: "PayPal is connected" });
      }

      if (provider === "razorpay") {
        const razorpay = settings.payment?.razorpay;
        const creds = getRazorpayCredentials({
          keyId: razorpay?.keyId,
          keySecret: razorpay?.keySecret,
        });

        await testRazorpayCredentials(creds);

        return NextResponse.json({
          success: true,
          message: "Razorpay is connected",
        });
      }

      if (provider === "paystack") {
        const paystack = settings.payment?.paystack;
        const creds = getPaystackCredentials({
          publicKey: paystack?.publicKey,
          secretKey: paystack?.secretKey,
        });

        await testPaystackCredentials(creds);

        return NextResponse.json({
          success: true,
          message: "Paystack is connected",
        });
      }

      if (provider === "pesapal") {
        const resolved = resolvePesapalCredentials(settings.payment?.pesapal);
        const creds = getPesapalCredentials(resolved);
        await requestPesapalToken(creds);

        return NextResponse.json({
          success: true,
          message: `Pesapal ${creds.mode} is connected`,
        });
      }

      if (provider === "iotec") {
        const resolved = resolveIotecCredentials(settings.payment?.iotec);
        const creds = getIotecCredentials(resolved);
        await requestIotecToken(creds);

        return NextResponse.json({
          success: true,
          message: `ioTec Pay ${creds.mode} is connected`,
        });
      }

      if (provider === "orange_money") {
        const resolved = resolveOrangeMoneyCredentials(
          settings.payment?.orange_money,
        );
        const creds = getOrangeMoneyCredentials(resolved);
        await requestOrangeMoneyToken(creds);

        return NextResponse.json({
          success: true,
          message: `Orange Money ${creds.mode} is connected`,
        });
      }

      if (provider === "mtn_momo") {
        const resolved = resolveMtnMomoCredentials(settings.payment?.mtn_momo);
        const creds = getMtnMomoCredentials(resolved);
        // The token is the check: it is the one call that exercises all three
        // credentials, and a failure here is unambiguous.
        await requestMtnMomoToken(creds, { forceRefresh: true });

        // The balance additionally proves the target environment is one this
        // account may use — but MTN's sandbox answers it with
        // INTERNAL_PROCESSING_ERROR even for perfectly valid credentials, so a
        // failure here is reported as a caveat rather than as a failed test.
        let balanceNote = "";
        try {
          const balance = await getMtnMomoAccountBalance({ creds });
          if (balance.availableBalance) {
            balanceNote = ` — balance ${balance.availableBalance} ${balance.currency || ""}`.trimEnd();
          }
        } catch {
          balanceNote = " (balance unavailable — expected in sandbox)";
        }

        return NextResponse.json({
          success: true,
          message: `MTN MoMo ${creds.mode} is connected${balanceNote}`,
        });
      }

      return NextResponse.json(
        { success: false, message: "Invalid provider" },
        { status: 400 },
      );
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          message:
            error instanceof Error && error.message
              ? error.message
              : "Failed to test payment",
        },
        { status: 500 },
      );
    }
  },
);
