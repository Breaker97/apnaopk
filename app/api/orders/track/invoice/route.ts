import { connectDB } from "@/lib/db";
import { Order } from "@/models";
import { getSettingsLean } from "@/models/settings.model";
import { ValidationError } from "@/lib/api/errors";
import { rateLimitByIP } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { validateOptionalBody } from "@/lib/api/validate";
import { TrackOrderBodySchema } from "@/lib/validations";
import { generateOrderInvoicePdf } from "@/lib/orders/order-invoice";
import type { IOrder } from "@/types";

type InvoiceCustomer = {
  name?: string;
  email?: string;
  phone?: string;
};


function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}


function getCustomerName(
  order: Pick<IOrder, "shippingAddress"> & { customerId?: InvoiceCustomer },
) {
  const shipping = order.shippingAddress;
  const addressName =
    shipping.fullName ||
    [shipping.firstName, shipping.lastName].filter(Boolean).join(" ");
  return addressName || order.customerId?.name || "Customer";
}


export const POST = withApi(
  {},
  async ({ request }) => {
    // Public, unauthenticated endpoint guarded only by email/phone match.
    // Throttle by IP to prevent brute-forcing contact details / PDF scraping.
    await rateLimitByIP(request, "strict");

    const body = await validateOptionalBody(request, TrackOrderBodySchema);
    const orderNumber = normalizeText(body.orderNumber || body.orderId);
    const identifier = normalizeText(body.identifier);

    if (!orderNumber || !identifier) {
      throw new ValidationError("Order number and email or phone are required");
    }

    await connectDB();

    // Exact uppercase match seeks the unique orderNumber index (numbers are
    // generated uppercase); the case-insensitive regex scanned it instead.
    const order = await Order.findOne({
      orderNumber: orderNumber.trim().toUpperCase(),
    })
      .populate("customerId", "name email phone")
      .lean<(IOrder & { customerId?: InvoiceCustomer }) | null>();

    if (!order) {
      return new Response("Order not found", { status: 404 });
    }

    const identifierLower = identifier.toLowerCase();
    const identifierPhone = normalizePhone(identifier);
    // Guest orders populate no customer (customerId points at the guest's
    // cart), so their checkout email lives on the order itself.
    const emailMatches = [order.customerId?.email, order.guestEmail]
      .filter(Boolean)
      .some((email) => email!.toLowerCase() === identifierLower);
    const phoneMatches = [
      order.customerId?.phone,
      order.contactPhone,
      order.shippingAddress.phone,
    ]
      .filter(Boolean)
      .map((phone) => normalizePhone(phone!))
      .some((phone) => phone === identifierPhone);

    if (!emailMatches && !phoneMatches) {
      return new Response("Order not found", { status: 404 });
    }

    const settings = await getSettingsLean();
    const pdfBuffer = await generateOrderInvoicePdf(
      order,
      settings,
      getCustomerName(order),
      order.customerId?.email || order.guestEmail,
    );

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="invoice-${order.orderNumber}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  },
);
