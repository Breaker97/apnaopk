import "server-only";

import { InventoryLocation } from "@/models/inventory-location.model";
import { Vendor } from "@/models/vendor.model";
import type { ISettingsData as ISettings } from "@/models/settings.model";
import { ValidationError } from "@/lib/api/errors";
import { sendEmailWithOutcome, isEmailDeliveryConfigured } from "@/lib/email/email";
import { posReceiptTemplate, type PosReceiptEmailData } from "@/lib/email/email-templates";
import { sendSms, isSmsDeliveryConfigured } from "@/lib/sms/sms";
import { buildNotificationSmsBody, smsStoreName } from "@/lib/sms/sms-text";
import { formatCurrency } from "@/lib/intl/money";
import { normalizePOSPhone } from "@/lib/pos/pos-customers";
import { vendorReceiptIdentity } from "@/lib/pos/build-pos-settings";
import { posPaymentLabel } from "@/lib/pos/payment";
import { isPosWalkIn, posWalkInName } from "@/lib/orders/pos-walk-in";
import type { OrderInvoiceSource } from "@/lib/orders/order-invoice";

/**
 * Sending a counter sale's receipt by email or text.
 *
 * The cashier asks for it from the "Sale complete" screen, or again later from
 * the sale. The email carries the receipt itself and the invoice PDF; the text
 * carries the receipt number and total, which is what a shopper needs to bring
 * back for a return.
 */

export type POSReceiptChannel = "email" | "sms";

/** Which ways this store can send a receipt at all. */
export function posReceiptChannels(settings: Pick<ISettings, "email" | "sms">) {
  return {
    email: isEmailDeliveryConfigured(settings),
    sms: isSmsDeliveryConfigured(settings),
  };
}

type ReceiptOrder = OrderInvoiceSource & {
  posTenders?: Array<{ method: string; amount: number; change?: number }>;
  posBalanceDue?: number;
  posLocationId?: unknown;
  guestEmail?: string;
  contactPhone?: string;
  posCustomerName?: string;
};

/** Who the receipt goes to unless the cashier types someone else. */
export function defaultReceiptRecipients(order: ReceiptOrder): { email?: string; phone?: string } {
  const walkIn = isPosWalkIn(order);
  const customer =
    !walkIn && order.customerId && typeof order.customerId === "object"
      ? (order.customerId as { email?: string; phone?: string })
      : null;
  return {
    email: customer?.email || order.guestEmail || undefined,
    phone: order.contactPhone || customer?.phone || undefined,
  };
}

/** The tenders a sale was paid with, as the receipt prints them. */
export function receiptPayments(order: ReceiptOrder) {
  const tenders = Array.isArray(order.posTenders) ? order.posTenders : [];
  if (tenders.length > 0) {
    return {
      payments: tenders.map((tender) => ({
        label: posPaymentLabel(tender.method),
        amount: Number(tender.amount || 0),
      })),
      change: tenders.reduce((sum, tender) => sum + Number(tender.change || 0), 0),
    };
  }
  const paid = Math.max(0, Number(order.total || 0) - Number(order.posBalanceDue || 0));
  return {
    payments: [{ label: posPaymentLabel(order.paymentMethod), amount: paid }],
    change: 0,
  };
}

async function receiptIdentity(order: ReceiptOrder, settings: ISettings) {
  const vendorIds = [
    ...new Set((order.subOrders || []).map((sub) => String(sub.vendorId ?? "")).filter(Boolean)),
  ];
  if (vendorIds.length === 1) {
    const vendor = await Vendor.findById(vendorIds[0])
      .select("storeName address storeVisibility isDefault")
      .lean<Parameters<typeof vendorReceiptIdentity>[0] & { isDefault?: boolean } | null>();
    if (vendor && !vendor.isDefault) return vendorReceiptIdentity(vendor);
  }
  return {
    storeName: settings.general?.storeName,
    storeAddress: settings.general?.storeAddress,
    storePhone: settings.general?.storePhone,
  };
}

async function counterName(order: ReceiptOrder): Promise<string | undefined> {
  if (!order.posLocationId) return undefined;
  const location = await InventoryLocation.findById(order.posLocationId)
    .select("name")
    .lean<{ name?: string } | null>()
    .catch(() => null);
  return location?.name || undefined;
}

export async function buildPosReceiptEmailData(
  order: ReceiptOrder,
  settings: ISettings,
): Promise<PosReceiptEmailData> {
  const locale = settings.general?.defaultLanguage || "en";
  const identity = await receiptIdentity(order, settings);
  const { payments, change } = receiptPayments(order);
  const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();
  const customer =
    !isPosWalkIn(order) && order.customerId && typeof order.customerId === "object"
      ? (order.customerId as { name?: string })
      : null;
  return {
    orderNumber: order.orderNumber,
    dateText: new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(createdAt),
    storeName: identity.storeName || "",
    storeAddress: identity.storeAddress || undefined,
    storePhone: identity.storePhone || undefined,
    counterName: await counterName(order),
    customerName: posWalkInName(order) ?? customer?.name ?? undefined,
    lines: (order.items || []).map((item) => {
      const discount = Number(
        (item as { lineDiscount?: { amount?: number } }).lineDiscount?.amount || 0,
      );
      return {
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.price,
        discount,
        amount: Math.max(0, item.price * item.quantity - discount),
      };
    }),
    subtotal: Number(order.subtotal || 0),
    discount: Number(order.discount || 0),
    tax: Number(order.tax || 0),
    taxIncluded: Boolean((order as { taxIncluded?: boolean }).taxIncluded),
    total: Number(order.total || 0),
    payments,
    change,
    balanceDue: Number(order.posBalanceDue || 0) || undefined,
  };
}

/**
 * Send the receipt. Refuses up front what cannot work — a store with no
 * email or SMS set up, an address or number that is not one — so the cashier
 * hears it at the counter rather than discovering a failed job later.
 *
 * A second press within the same minute to the same address sends nothing
 * new (the outbox dedupes it): a double tap at a busy counter is not two
 * receipts.
 */
export async function sendPosReceipt(params: {
  order: ReceiptOrder;
  channel: POSReceiptChannel;
  to?: string;
  settings: ISettings;
  now?: Date;
}): Promise<{ to: string; status: "sent" | "queued" | "duplicate" }> {
  const { order, settings } = params;
  const defaults = defaultReceiptRecipients(order);
  const minute = Math.floor((params.now ?? new Date()).getTime() / 60_000);
  const currency = order.currency || settings.general?.defaultCurrency || "USD";
  const locale = settings.general?.defaultLanguage || "en";

  if (params.channel === "email") {
    if (!isEmailDeliveryConfigured(settings)) {
      throw new ValidationError("Email is not set up for this store");
    }
    const to = String(params.to || defaults.email || "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(to)) {
      throw new ValidationError("Enter an email address for the receipt");
    }
    const data = await buildPosReceiptEmailData(order, settings);
    const html = posReceiptTemplate(data, {
      currency,
      locale,
      storeName: data.storeName,
      logoUrl: settings.general?.logoUrl,
    });
    let attachments;
    try {
      const { generateOrderInvoicePdf } = await import("@/lib/orders/order-invoice");
      const pdf = await generateOrderInvoicePdf(order, settings);
      attachments = [
        { filename: `invoice-${order.orderNumber}.pdf`, content: pdf, contentType: "application/pdf" },
      ];
    } catch (error) {
      // The receipt is in the body; the PDF is a convenience.
      console.error("Failed to attach the invoice to a POS receipt:", error);
    }
    const outcome = await sendEmailWithOutcome({
      to,
      subject: `Your receipt from ${data.storeName || smsStoreName(settings.general?.storeName)} — ${order.orderNumber}`,
      html,
      settings,
      attachments,
      dedupeKey: `pos-receipt:${String(order._id)}:email:${to}:${minute}`,
    });
    // The outbox retries a first attempt that failed; the receipt is on its way.
    return { to, status: outcome.sent ? "sent" : "queued" };
  }

  if (!isSmsDeliveryConfigured(settings)) {
    throw new ValidationError("Text messages are not set up for this store");
  }
  const to = normalizePOSPhone(params.to || defaults.phone || "", settings);
  if (!to) throw new ValidationError("Enter a phone number for the receipt");
  const identity = await receiptIdentity(order, settings);
  const total = formatCurrency(Number(order.total || 0), currency, locale);
  const due = Number(order.posBalanceDue || 0);
  const message = due > 0
    ? `Thank you! Receipt ${order.orderNumber}, total ${total}, ${formatCurrency(due, currency, locale)} still to pay. Keep this number for returns.`
    : `Thank you! Receipt ${order.orderNumber}, total ${total}. Keep this number for returns.`;
  const result = await sendSms({
    to,
    body: buildNotificationSmsBody({ storeName: smsStoreName(identity.storeName), message }),
    category: "pos_receipt",
    dedupeKey: `pos-receipt:${String(order._id)}:sms:${to}:${minute}`,
    settings,
  });
  if (result.status === "failed") {
    throw new ValidationError(result.error || "The text could not be sent");
  }
  return { to, status: result.status === "duplicate" ? "duplicate" : result.status === "sent" ? "sent" : "queued" };
}
