import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import { connectDB } from "@/lib/db";
import { Cart } from "@/models";
import { getSettings } from "@/models/settings.model";
import { checkoutCreditAvailable } from "@/lib/store-credit/store-credit";

/**
 * What the signed-in shopper's store credit can pay at this checkout (R8), in
 * the store's currency: their balance, plus what an earlier try at the same
 * checkout is holding — see `checkoutCreditAvailable`. Nothing for a guest.
 */
export const GET = withApi(
  { auth: "user", rateLimit: { action: "checkout:store-credit", preset: "lenient" } },
  async ({ session }) => {
    await connectDB();
    const settings = await getSettings();
    const currency = String(settings.general?.defaultCurrency || "USD").toUpperCase();
    const cart = await Cart.findOne({ userId: session.user.id })
      .select("_id")
      .lean<{ _id: unknown } | null>();
    const available = cart
      ? await checkoutCreditAvailable({
          customerId: session.user.id,
          currency,
          cartId: String(cart._id),
        })
      : 0;
    return successResponse({ currency, available });
  },
);
