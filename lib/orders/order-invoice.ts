import { addDays, format } from "date-fns";
import { DEFAULT_CURRENCY, DEFAULT_STORE_NAME } from "@/config/branding.config";
import { generateInvoicePdf } from "@/lib/orders/invoice-pdf";
import type { InvoiceData, InvoiceItem } from "@/lib/orders/invoice-pdf";
import type { ISettingsData } from "@/models/settings.model";
import type { Address, IOrder, OrderItem } from "@/types";

type InvoiceCustomer = {
  name?: string;
  email?: string;
};

export type OrderInvoiceSource = Omit<IOrder, "customerId"> & {
  customerId?: InvoiceCustomer | unknown;
};

function mapOrderPaymentStatusToInvoiceStatus(
  status: string,
): InvoiceData["status"] {
  switch (status) {
    case "paid":
      return "Paid";
    case "refunded":
    case "partially_refunded":
      return "Cancelled";
    default:
      return "Pending";
  }
}

function buildOrderInvoiceData(
  order: OrderInvoiceSource,
  settings: Pick<ISettingsData, "general">,
  customerName?: string,
  customerEmail?: string,
): InvoiceData {
  const currency = settings.general?.defaultCurrency || DEFAULT_CURRENCY;
  const storeName = settings.general?.storeName || DEFAULT_STORE_NAME;
  const storeEmail = settings.general?.storeEmail || "";
  const storePhone = settings.general?.storePhone || "";
  const storeAddress = settings.general?.storeAddress || "";
  const logoUrl = settings.general?.logoUrl || "";
  const createdAt = new Date(order.createdAt);
  const dueDate = addDays(createdAt, 30);
  const customer = getInvoiceCustomer(order.customerId);
  const shipping = order.shippingAddress;

  const items: InvoiceItem[] = order.items.map((item: OrderItem) => ({
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.price,
    total: item.price * item.quantity,
  }));

  return {
    invoiceNumber: order.orderNumber,
    status: mapOrderPaymentStatusToInvoiceStatus(order.paymentStatus),
    dateCreated: format(createdAt, "dd MMM yyyy"),
    dueDate: format(dueDate, "dd MMM yyyy"),
    from: {
      name: storeName,
      street: storeAddress,
      city: "",
      postalCode: "",
      country: "",
      phone: storePhone,
      email: storeEmail || undefined,
    },
    to: buildInvoiceAddress(
      shipping,
      customerName || customer?.name || shipping.fullName || "Customer",
      customerEmail || customer?.email,
    ),
    items,
    subtotal: order.subtotal,
    shipping: order.shippingCost,
    discount: order.discount,
    tax: order.tax,
    total: order.total,
    currency,
    supportEmail: storeEmail || undefined,
    logoUrl: logoUrl || undefined,
    storeName,
  };
}

/**
 * Renders an order's invoice. Every invoice route and the confirmation email
 * build the document here; `customerName` / `customerEmail` let a caller that
 * knows better (a signed-in session, a guest's address) override what the
 * populated customer carries.
 */
export async function generateOrderInvoicePdf(
  order: OrderInvoiceSource,
  settings: Pick<ISettingsData, "general">,
  customerName?: string,
  customerEmail?: string,
) {
  return generateInvoicePdf(
    buildOrderInvoiceData(order, settings, customerName, customerEmail),
  );
}

function buildInvoiceAddress(
  address: Address,
  name: string,
  email?: string,
): InvoiceData["to"] {
  return {
    name,
    street: address.street,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
    phone: address.phone,
    email,
  };
}

function getInvoiceCustomer(value: unknown): InvoiceCustomer | null {
  if (!value || typeof value !== "object") return null;
  const customer = value as InvoiceCustomer;
  return {
    name: typeof customer.name === "string" ? customer.name : undefined,
    email: typeof customer.email === "string" ? customer.email : undefined,
  };
}
