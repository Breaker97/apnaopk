import { addDays, format } from "date-fns";
import { DEFAULT_CURRENCY, DEFAULT_STORE_NAME } from "@/config/branding.config";
import { PAYMENT_STATUS } from "@/config/app.config";
import { generateInvoicePdf } from "@/lib/orders/invoice-pdf";
import type { InvoiceData, InvoiceItem } from "@/lib/orders/invoice-pdf";
import {
  getPreorderBalanceDeadline,
  getPreorderBalanceDue,
  getPreorderCollectedAmount,
} from "@/lib/orders/order-payment-status";
import { resolvePreorderPolicy } from "@/lib/orders/preorder-gating";
import type { ISettingsData } from "@/models/settings.model";
import type { Address, IOrder, OrderItem } from "@/types";

type InvoiceCustomer = {
  name?: string;
  email?: string;
};

export type OrderInvoiceSource = Omit<IOrder, "customerId"> & {
  customerId?: InvoiceCustomer | unknown;
};

type InvoiceSettings = Partial<Pick<ISettingsData, "general" | "preorder">>;

function mapOrderPaymentStatusToInvoiceStatus(
  status: string,
): InvoiceData["status"] {
  switch (status) {
    case "paid":
      return "Paid";
    case "partially_paid":
      return "Partially paid";
    case "refunded":
    case "partially_refunded":
      return "Cancelled";
    default:
      return "Pending";
  }
}

/**
 * What a deposit or pay-later pre-order has paid and still owes.
 *
 * Such an order is not paid in one piece: checkout takes `total` less
 * `preorderOutstandingAmount` and the rest is asked for later. The invoice
 * printed only the total, so a shopper who had paid a deposit held a document
 * that read as the whole amount still owed — while the order page it was
 * downloaded from said "Paid so far" and "Balance due". The balance is the
 * figure that page shows, and the amount paid is what the refund flow would
 * send back — not `total - balance`, which on a cancelled order counts a
 * balance that never arrived as paid.
 *
 * Absent for every other order, and for a pre-order whose checkout payment has
 * not been captured yet: nothing has been paid there, and the total already
 * says what is owed.
 */
function buildPreorderPayment(
  order: OrderInvoiceSource,
): InvoiceData["payment"] {
  if (!(Number(order.preorderOutstandingAmount || 0) > 0)) return undefined;
  if (
    String(order.paymentStatus || PAYMENT_STATUS.PENDING) ===
    PAYMENT_STATUS.PENDING
  ) {
    return undefined;
  }
  const amountPaid = getPreorderCollectedAmount(order);
  return {
    amountPaid,
    amountRefunded: Math.min(
      Math.max(0, Number(order.refundedTotal || 0)),
      amountPaid,
    ),
    balanceDue: getPreorderBalanceDue(order),
  };
}

/** Exported for tests; callers render through `generateOrderInvoicePdf`. */
export function buildOrderInvoiceData(
  order: OrderInvoiceSource,
  settings: InvoiceSettings,
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
  const payment = buildPreorderPayment(order);
  // An open balance falls due when the pre-order policy says so — the date the
  // order page shows and the expiry job cancels on — not 30 days after
  // checkout. With no release date to count from there is no date to print,
  // and inventing one could tell the shopper they have longer than they do.
  const dueDate =
    payment && payment.balanceDue > 0
      ? getPreorderBalanceDeadline(
          order,
          resolvePreorderPolicy(settings.preorder).expiryGraceDays,
        )
      : addDays(createdAt, 30);
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
    dueDate: dueDate ? format(dueDate, "dd MMM yyyy") : undefined,
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
    payment,
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
  settings: InvoiceSettings,
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
