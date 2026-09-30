import { randomUUID } from "node:crypto";
import { cartSessionCookie } from "@/lib/cart/cart-session-cookie";
import { Cart } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import * as z from "zod";
import { validateOptionalBody } from "@/lib/api/validate";

const RecoverCheckoutSchema = z.object({
  token: z.string().trim().max(200).optional(),
});

/**
 * How long a recovery link works for.
 *
 * The token in an abandoned-checkout email is a bearer credential: whoever
 * holds it is handed that cart's session cookie, and the cart carries the
 * shopper's email and address. It had no expiry at all — a link in a mailbox
 * from a year ago still opened the checkout. Fourteen days is well past any
 * recovery email's usefulness (the last one goes out within a day) and short
 * enough that a forwarded or leaked mail stops working.
 *
 * Measured from the cart's last activity, so a shopper who comes back and
 * keeps shopping keeps their link alive.
 */
const RECOVERY_LINK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const POST = withApi(
  {
    // Unauthenticated, and the answer tells the caller whether a token is
    // real. Tokens are long random strings, so this is not what stops
    // guessing — but a script that tries anyway should not get to make
    // thousands of database queries doing it.
    rateLimit: { action: "checkout:recover", preset: "strict" },
  },
  async ({ request }) => {
    const { token = "" } = await validateOptionalBody(
      request,
      RecoverCheckoutSchema,
    );
    if (!token) throw new ValidationError("Recovery token is required");

    const cart = await Cart.findOne({
      $or: [{ checkoutToken: token }, { recoveryToken: token }],
      "items.0": { $exists: true },
    });

    if (!cart) return notFoundResponse("Checkout");

    const lastActive = new Date(
      cart.lastActionAt || cart.updatedAt || cart.createdAt || 0,
    ).getTime();
    if (
      Number.isFinite(lastActive) &&
      Date.now() - lastActive > RECOVERY_LINK_MAX_AGE_MS
    ) {
      // Deliberately the same answer as an unknown token: a stale link should
      // not confirm that the cart, or the email address it was sent to, exists.
      return notFoundResponse("Checkout");
    }

    // Whoever opens the link gets a session of their own: a cookie issued for
    // this cart before — on another device, or copied from somewhere — stops
    // opening it. The token stays, because every email in the recovery
    // sequence carries the same link.
    if (cart.sessionId) cart.sessionId = randomUUID();
    if (cart.status !== "recovered") {
      cart.status = "active";
      cart.lastActionAt = new Date();
    }
    await cart.save();

    const totalItems = cart.items.reduce(
      (sum: number, item: { quantity: number }) => sum + item.quantity,
      0,
    );
    const subtotal = cart.items.reduce(
      (sum: number, item: { price: number; quantity: number }) =>
        sum + item.price * item.quantity,
      0,
    );

    const response = successResponse({
      cartId: String(cart._id),
      items: cart.items,
      totalItems,
      subtotal,
    });

    if (cart.sessionId) {
      response.headers.set("Set-Cookie", cartSessionCookie(request, cart.sessionId));
    }

    return response;
  },
);
