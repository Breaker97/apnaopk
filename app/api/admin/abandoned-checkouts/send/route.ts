import { mongoose } from "@/lib/db";
import { AbandonedCheckout, Cart } from "@/models";
import { getSettings } from "@/models/settings.model";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import {
  sendAbandonedCheckoutRecoveryEmail,
  upsertAbandonedCheckoutSnapshot,
} from "@/lib/orders/abandoned-checkouts";
import { withApi } from "@/lib/api/handler";
import { z } from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

type CheckoutMailTarget = {
  _id: unknown;
  checkoutToken?: string;
  recoveryToken?: string;
  checkoutUrl?: string;
  customerLocale?: string;
  recoveryEmailStatus?: string;
  abandonedAt?: Date;
  emailSentAt?: Date;
  save: () => Promise<unknown>;
};

function compactQueries(queries: Array<Record<string, unknown>>) {
  return queries.filter(
    (query) => !Object.values(query).some((value) => value === undefined),
  );
}

async function findCheckoutMailTarget(checkoutId: string) {
  const objectId = mongoose.isValidObjectId(checkoutId)
    ? checkoutId
    : undefined;

  const snapshot = await AbandonedCheckout.findOne({
    $or: compactQueries([
      { _id: objectId },
      { cartId: objectId },
      { checkoutToken: checkoutId },
      { recoveryToken: checkoutId },
    ]),
  });

  if (snapshot) return { target: snapshot, source: "snapshot" as const };

  const cart = await Cart.findOne({
    $or: compactQueries([
      { _id: objectId },
      { checkoutToken: checkoutId },
      { recoveryToken: checkoutId },
    ]),
  });

  if (cart) return { target: cart, source: "cart" as const };

  return null;
}

const SendCheckoutRecoverySchema = z.object({
  checkoutId: z.string().max(64).optional(),
  locale: z.string().max(10).optional(),
});

export const POST = withApi(
  { auth: "admin" },
  async ({ request }) => {
    const body = await validateOptionalBody(request, SendCheckoutRecoverySchema);
    if (!body.checkoutId) throw new ValidationError("checkoutId is required");

    const resolved = await findCheckoutMailTarget(body.checkoutId);
    if (!resolved) return notFoundResponse("Checkout");

    const target = resolved.target as CheckoutMailTarget;
    const settings = await getSettings();
    const origin =
      request.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "http://localhost:3000";

    const sent = await sendAbandonedCheckoutRecoveryEmail({
      cart: target,
      settings,
      origin,
      locale: body.locale || target.customerLocale || "en",
    });

    if (resolved.source === "cart") {
      await upsertAbandonedCheckoutSnapshot(target, {
        abandonedAt: target.abandonedAt,
        status: "open",
      });
    } else if (target.checkoutToken || target.recoveryToken) {
      await Cart.findOneAndUpdate(
        {
          $or: compactQueries([
            { checkoutToken: target.checkoutToken },
            { recoveryToken: target.recoveryToken },
          ]),
        },
        {
          $set: {
            recoveryEmailStatus: target.recoveryEmailStatus,
            ...(sent ? { emailSentAt: target.emailSentAt || new Date() } : {}),
          },
        },
      ).catch(() => undefined);
    }

    return successResponse(
      {
        sent,
        checkoutUrl: target.checkoutUrl,
        recoveryEmailStatus: target.recoveryEmailStatus,
      },
      sent ? "Recovery email sent" : "Recovery email could not be sent",
    );
  },
);
