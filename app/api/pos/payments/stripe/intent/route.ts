import { z } from "zod";
import { withApi } from "@/lib/api/handler";
import { validateBody } from "@/lib/api/validate";
import { successResponse } from "@/lib/api/response";
import { AuthorizationError, ValidationError } from "@/lib/api/errors";
import { Product, getSettingsLean } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { canAccessPOS } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import {
  getStripeForSecretKey,
  isStripeSecretKeyConfigured,
  toStripeAmount,
} from "@/lib/payments/stripe";
import { resolveStripeCredentials } from "@/lib/settings/credentials";
import { getEnabledPOSPaymentMethods } from "@/lib/pos/payment";
import { calculatePOSOrderTotals } from "@/lib/pos/order-totals";

const POSOrderItemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().optional(),
  name: z.string().min(1),
  sku: z.string().optional().default(""),
  price: z.number().nonnegative(),
  quantity: z.number().int().positive(),
  image: z.string().optional(),
  vendorId: z.string().min(1),
  lineTotal: z.number().optional(),
  lineDiscount: z
    .object({
      type: z.enum(["percent", "amount"]),
      value: z.number().nonnegative(),
      amount: z.number().nonnegative().optional(),
    })
    .optional(),
  lineNote: z.string().optional(),
});

const POSStripeIntentBodySchema = z.object({
  items: z.array(POSOrderItemSchema).min(1),
  customerId: z.string().optional(),
  posLocationId: z.string().optional(),
  discount: z
    .object({
      type: z.enum(["percent", "amount"]),
      value: z.number().nonnegative(),
      amount: z.number().nonnegative(),
      reason: z.string().optional(),
      note: z.string().optional(),
    })
    .optional(),
});

export const POST = withApi(
  {
    auth: "user",
    rateLimit: { action: "pos:stripe-intent", preset: "strict" },
  },
  async ({ request, session }) => {
    const role = session.user.role;
    if (
      role !== USER_ROLES.ADMIN &&
      role !== USER_ROLES.VENDOR &&
      !isStaffRole(role)
    ) {
      throw new AuthorizationError();
    }

    const settings = await getSettingsLean();
    if (!(await canAccessPOS(session.user))) {
      throw new AuthorizationError();
    }

    const body = await validateBody(request, POSStripeIntentBodySchema);
    let items = body.items;

    if (!getEnabledPOSPaymentMethods(settings.pos?.checkout?.paymentMethods).includes("card")) {
      throw new ValidationError("Card payment is not enabled for POS");
    }

    const productIds = Array.from(
      new Set(items.map((item) => item.productId).filter(Boolean)),
    );
    const catalogProducts = await Product.find({ _id: { $in: productIds } })
      .select("_id price vendorId variants")
      .lean();
    const productById = new Map(
      catalogProducts.map((product) => [String(product._id), product]),
    );

    let vendorScopeId: string | undefined;
    if (role === USER_ROLES.VENDOR) {
      const vendor = await requireApprovedVendorByUserId(session.user.id);
      vendorScopeId = vendor._id.toString();
      for (const productId of productIds) {
        const product = productById.get(productId);
        if (!product || String(product.vendorId) !== vendorScopeId) {
          throw new AuthorizationError(
            "Vendors can only sell their own products",
          );
        }
      }
    }

    // Resolve prices server-side so the PaymentIntent amount is anchored to the
    // real catalog, not to whatever the client posted.
    items = items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) {
        throw new ValidationError("A selected product no longer exists");
      }
      const variants = (product.variants || []) as Array<{
        _id: unknown;
        price?: number;
      }>;
      let price: number | undefined;
      if (item.variantId) {
        const variant = variants.find(
          (candidate) => String(candidate._id) === String(item.variantId),
        );
        if (!variant) {
          throw new ValidationError("A selected variant no longer exists");
        }
        price = variant.price;
      }
      if (typeof price !== "number") price = product.price;
      if (typeof price !== "number") {
        throw new ValidationError("A selected product has no price");
      }
      return {
        ...item,
        price,
        ...(vendorScopeId ? { vendorId: vendorScopeId } : {}),
      };
    });

    const stripeSettings = settings.payment?.stripe;
    if (!stripeSettings?.enabled) {
      throw new ValidationError("Stripe is disabled");
    }
    const stripeCredentials = resolveStripeCredentials(stripeSettings);
    if (!isStripeSecretKeyConfigured(stripeCredentials.secretKey)) {
      throw new ValidationError("Stripe is not configured");
    }

    const { total, subtotal, tax, totalDiscount } = calculatePOSOrderTotals({
      items,
      discount: body.discount,
      taxRate: settings.orders?.taxRate ?? 0,
    });
    if (total <= 0) {
      throw new ValidationError("Order total must be greater than zero");
    }

    const currency = (settings.general?.defaultCurrency || "USD").toLowerCase();
    const paymentIntent = await getStripeForSecretKey(
      stripeCredentials.secretKey,
    ).paymentIntents.create({
      amount: toStripeAmount(total, currency),
      currency,
      payment_method_types: ["card"],
      metadata: {
        channel: "pos",
        staffId: session.user.id,
        customerId: body.customerId || "",
        posLocationId: body.posLocationId || "",
        subtotal: String(subtotal),
        tax: String(tax),
        discount: String(totalDiscount),
        total: String(total),
      },
    });

    if (!paymentIntent.client_secret) {
      throw new ValidationError("Failed to initialize Stripe payment");
    }

    return successResponse({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
    });
  },
);
