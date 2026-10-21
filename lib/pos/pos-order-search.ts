import "server-only";

import { InventoryLocation, Order } from "@/models";
import { isValidObjectId, sanitizeSearchString } from "@/lib/api/validate";
import { posOrderScope } from "@/lib/pos/pos-order-access";
import { normalizePOSPhone, type POSPhoneSettings } from "@/lib/pos/pos-customers";
import { isPosWalkIn, posWalkInName } from "@/lib/orders/pos-walk-in";
import { storedSaleReceipt, type StoredPOSSale, type StoredSaleReceipt } from "@/lib/pos/receipt-payload";

/**
 * Finding a counter sale again: to collect a deposit's balance, take a
 * return against it, or send its receipt once more.
 *
 * By receipt number (the real one or the provisional one an offline sale was
 * printed with), by the customer's phone number, or — with nothing typed —
 * the latest sales at this counter. Only the register's own sales
 * (`posOrderScope`).
 */

const LIMIT = 20;

export interface POSSaleSummary {
  _id: string;
  orderNumber: string;
  localReceiptNumber?: string;
  createdAt: string;
  total: number;
  paymentStatus: string;
  status: string;
  balanceDue: number;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  items: Array<{ index: number; name: string; quantity: number; price: number; amount: number }>;
  tenders: Array<{ method: string; amount: number; kind?: string }>;
  refundedTotal: number;
  /**
   * What its receipt said, for printing it again (lib/pos/receipt-payload.ts),
   * with the counter it was rung up at.
   */
  receipt: StoredSaleReceipt & { locationName?: string };
}

export async function searchPOSSales(params: {
  user: { id: string; role?: string | null };
  search?: string;
  dueOnly?: boolean;
  locationId?: string;
  settings: POSPhoneSettings;
}): Promise<POSSaleSummary[]> {
  const { query } = await posOrderScope(params.user);
  const term = String(params.search || "").trim();
  const filters: Record<string, unknown>[] = [query];

  if (term) {
    const escaped = sanitizeSearchString(term);
    const phone = normalizePOSPhone(term, params.settings);
    filters.push({
      $or: [
        { orderNumber: { $regex: `^${escaped}`, $options: "i" } },
        { posLocalReceiptNumber: { $regex: `^${escaped}`, $options: "i" } },
        ...(phone ? [{ contactPhone: phone }] : []),
      ],
    });
  } else if (params.locationId) {
    filters.push({ posLocationId: params.locationId });
  }
  // Still owing: a deposit sale cancelled or refunded keeps its figure, but
  // there is nothing left to collect on it.
  if (params.dueOnly) filters.push({ posBalanceDue: { $gt: 0 }, paymentStatus: "partially_paid" });

  const rows = await Order.find({ $and: filters })
    .select(
      "orderNumber posLocalReceiptNumber createdAt subtotal discount tax total currency pricesIncludeTax taxExemption discountMeta posLocationId paymentStatus status posBalanceDue posTenders paymentMethod channel staffId customerId guestEmail contactPhone posCustomerName items.name items.quantity items.price items.lineDiscount items.taxRate refundedTotal",
    )
    .populate("customerId", "name email phone")
    .sort({ createdAt: -1 })
    .limit(LIMIT)
    .lean<Array<Record<string, unknown> & {
      _id: unknown;
      items?: Array<{ name: string; quantity: number; price: number; taxRate?: number; lineDiscount?: { type?: "percent" | "amount"; value?: number; amount?: number } }>;
      posTenders?: Array<{ method: string; amount: number; tendered?: number; change?: number; kind?: string }>;
      posLocationId?: string;
      customerId?: { name?: string; email?: string; phone?: string } | unknown;
    }>>();

  // Each sale's own counter, by name: one query for the page.
  const locationIds = [
    ...new Set(rows.map((row) => String(row.posLocationId ?? "")).filter((id) => isValidObjectId(id))),
  ];
  const locationNames = new Map(
    locationIds.length > 0
      ? (
          await InventoryLocation.find({ _id: { $in: locationIds } })
            .select("name")
            .lean<Array<{ _id: unknown; name?: string }>>()
        ).map((location) => [String(location._id), location.name])
      : [],
  );

  return rows.map((row) => {
    const walkIn = isPosWalkIn(row as never);
    const customer =
      !walkIn && row.customerId && typeof row.customerId === "object"
        ? (row.customerId as { name?: string; email?: string; phone?: string })
        : null;
    return {
      _id: String(row._id),
      orderNumber: String(row.orderNumber ?? ""),
      localReceiptNumber: (row.posLocalReceiptNumber as string) || undefined,
      createdAt: new Date(row.createdAt as Date).toISOString(),
      total: Number(row.total || 0),
      paymentStatus: String(row.paymentStatus || ""),
      status: String(row.status || ""),
      balanceDue: Number(row.posBalanceDue || 0),
      customerName: posWalkInName(row as never) ?? customer?.name ?? undefined,
      customerPhone: (row.contactPhone as string) || customer?.phone || undefined,
      customerEmail: customer?.email || (row.guestEmail as string) || undefined,
      items: (row.items ?? []).map((item, index) => {
        const discount = Number(item.lineDiscount?.amount || 0);
        return {
          index,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          amount: Math.max(0, item.price * item.quantity - discount),
        };
      }),
      tenders:
        row.posTenders && row.posTenders.length > 0
          ? row.posTenders.map((tender) => ({ method: tender.method, amount: tender.amount, kind: tender.kind }))
          : [{ method: String(row.paymentMethod || ""), amount: Number(row.total || 0) }],
      refundedTotal: Number(row.refundedTotal || 0),
      receipt: {
        ...storedSaleReceipt(row as StoredPOSSale),
        locationName: locationNames.get(String(row.posLocationId ?? "")) || undefined,
      },
    };
  });
}
