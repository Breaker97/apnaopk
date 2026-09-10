import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { createdResponse } from "@/lib/api/response";
import { NotFoundError, ValidationError } from "@/lib/api/errors";
import { Product, QuoteRequest } from "@/models";
import { isQuoteOnlyProduct } from "@/lib/products/quote-pricing";
import { notifyAdminsQuoteRequest } from "@/lib/notifications/notifications";
import { sendQuoteRequestEmails } from "@/lib/email/quote-emails";
import { PRODUCT_STATUS, USER_ROLES } from "@/config/app.config";

const QuoteRequestSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  quantity: z.number().int().min(1).max(1_000_000).default(1),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().max(40).optional().default(""),
  company: z.string().trim().max(100).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  /**
   * Honeypot. A real form leaves it empty because the field is hidden; a bot
   * fills every input it finds. Answered with the same success body as a real
   * submission so the bot learns nothing from the difference.
   */
  website: z.string().trim().max(200).optional().default(""),
});

type LeanQuoteProduct = {
  _id: unknown;
  name: string;
  slug?: string;
  status?: string;
  vendorId?: unknown;
  priceOnRequest?: boolean;
  variants?: { _id: { toString(): string }; name?: string }[];
};

/**
 * POST /api/quotes — a shopper asks what a "price on request" product costs.
 *
 * Public and unauthenticated on purpose: the whole point of the button is to
 * capture a lead from someone who has not signed up. `auth: "optional"` still
 * loads a session when there is one, so a signed-in shopper's request is
 * attributed to their account rather than arriving as an anonymous row.
 *
 * The route re-reads the product and refuses anything that is not actually
 * quote-only, so a hand-rolled POST cannot use this as a general contact form
 * against the whole catalogue.
 */
export const POST = withApi(
  {
    auth: "optional",
    rateLimit: { action: "quotes:create", preset: "strict" },
    // A quote request is shopper-owned data with no side effect on the store's
    // configuration, so a demo visitor may send one and see it land.
    demo: "allow",
  },
  async ({ request, session }) => {
    const body = await validateBody(request, QuoteRequestSchema);

    if (body.website) {
      // Bot. Accept silently — nothing is written.
      return createdResponse(
        { quoteId: null },
        "Thanks, your request has been sent.",
      );
    }

    const product = await Product.findById(body.productId)
      .select("name slug status vendorId priceOnRequest variants._id variants.name")
      .lean<LeanQuoteProduct>();

    if (!product || product.status !== PRODUCT_STATUS.ACTIVE) {
      throw new NotFoundError("Product");
    }
    if (!isQuoteOnlyProduct(product)) {
      throw new ValidationError("This product is not sold by quote");
    }

    const variant = body.variantId
      ? product.variants?.find((v) => v._id.toString() === body.variantId)
      : undefined;
    if (body.variantId && !variant) throw new NotFoundError("Variant");

    const quote = await QuoteRequest.create({
      productId: product._id,
      vendorId: product.vendorId,
      productName: product.name,
      productSlug: product.slug,
      variantId: variant?._id,
      variantName: variant?.name,
      quantity: body.quantity,
      name: body.name,
      email: body.email,
      phone: body.phone || undefined,
      company: body.company || undefined,
      message: body.message || undefined,
      userId:
        session?.user.role === USER_ROLES.CUSTOMER ? session.user.id : undefined,
      status: "new",
    });

    const quoteId = String(quote._id);

    // The lead is saved; everything after this is delivery. Failures are
    // logged inside the helpers rather than thrown, so a misconfigured SMTP
    // server can never turn a captured request into a 500 the shopper reads
    // as "it didn't send" — and then sends again.
    await Promise.allSettled([
      notifyAdminsQuoteRequest({
        quoteId,
        productName: product.name,
        customerName: body.name,
        quantity: body.quantity,
      }),
      sendQuoteRequestEmails({
        quoteId,
        productName: product.name,
        variantName: variant?.name,
        quantity: body.quantity,
        name: body.name,
        email: body.email,
        phone: body.phone,
        company: body.company,
        message: body.message,
      }),
    ]);

    return createdResponse(
      { quoteId },
      "Thanks, your request has been sent.",
    );
  },
);
