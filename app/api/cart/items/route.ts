import { cartResponse, withLineFacts } from "@/lib/cart/cart-response";
import { cartSessionCookie } from "@/lib/cart/cart-session-cookie";
import {
  addCartLine,
  readLineFacts,
  resolveCartIdentity,
} from "@/lib/cart/cart-service";
import { cartLineKey } from "@/lib/cart/cart-products";
import { createdResponse, notFoundResponse } from "@/lib/api/response";
import {
  SHOPPING_ADDRESS_ALLOWANCE,
  rateLimitBySession,
  rateLimitByUser,
} from "@/lib/api/rate-limit-middleware";
import { validateBody } from "@/lib/api/validate";
import { CartAddByIdSchema } from "@/lib/validations";
import { withApi } from "@/lib/api/handler";

export const POST = withApi(
  { auth: "optional" },
  async ({ request, session }) => {
    const userId = session?.user?.id;
    let sessionId = request.cookies.get("cart_session")?.value;

    if (userId) {
      await rateLimitByUser(
        request,
        userId,
        "cart:addItem",
        "moderate",
        session?.user?.role
      );
    } else if (sessionId) {
      await rateLimitBySession(
        request,
        sessionId,
        "cart:addItem",
        "moderate",
        SHOPPING_ADDRESS_ALLOWANCE,
      );
    } else {
      // Create a guest session id before rate limiting to avoid shared
      // "ip:unknown" buckets in local/proxied environments.
      sessionId = crypto.randomUUID();
      await rateLimitBySession(
        request,
        sessionId,
        "cart:addItem",
        "moderate",
        SHOPPING_ADDRESS_ALLOWANCE,
      );
    }

    const line = await validateBody(request, CartAddByIdSchema);
    const added = await addCartLine(resolveCartIdentity({ userId, sessionId })!, line);
    if (added.status === "product-not-found") return notFoundResponse("Product");
    if (added.status === "variant-not-found") return notFoundResponse("Variant");
    if (added.status !== "saved") return notFoundResponse("Cart");
    const { cart } = added;

    // Seller identity on every line, not just the one just added.
    //
    // Without it the client had to carry vendors over from the lines already on
    // screen — which by construction cannot know the product being added, so a
    // second item from the SAME store arrived vendorless, landed in the
    // "unknown seller" bucket, and flipped the cart and drawer into grouped
    // mode under a bogus "Sold by Another seller" header until the background
    // refresh landed. One indexed lookup here removes that whole class of
    // flicker and makes this response shape-compatible with `GET /api/cart`.
    //
    // With the shopper's live offers, or the read would call every quoted line
    // invisible — including the one just added — and the response would tell
    // the cart to drop it again.
    const savedItems = cart.toObject().items as Array<Record<string, unknown>>;
    const { facts } = await readLineFacts(savedItems, userId);

    const response = createdResponse({
      ...cartResponse(cart),
      items: savedItems.map((item) => withLineFacts(item, facts.get(cartLineKey(item)))),
    });
    if (!userId && sessionId) {
      response.headers.set(
        "Set-Cookie",
        cartSessionCookie(request, sessionId),
      );
    }

    return response;
  },
);
