import "server-only";
import { Order } from "@/models/order.model";

type PayoutRow = Record<string, unknown> & { _id: unknown; vendorId?: unknown; orderIds?: unknown[]; allocations?: Array<Record<string, unknown>> };
type OwnConsignment = { vendorId?: unknown; subtotal?: number; vendorEarnings?: number; status?: string; paymentStatus?: string };
const publicFields = ["_id", "payoutNumber", "status", "currency", "grossSales", "commissionAmount", "shippingAmount", "netAmount", "adjustments", "commissionOffset", "commissionCredit", "overpaymentRecovered", "preorderReserveHeld", "preorderReserveReleased", "periodStart", "periodEnd", "periodBoundary", "createdAt", "paidAt", "reversedAt", "version", "breakdown", "calculatedAt", "calculationVersion"];

export function vendorPayoutDto(row: PayoutRow) {
  return { ...Object.fromEntries(publicFields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])),
    statusHistory: (row.statusHistory as Array<{ status: string; at: unknown }> | undefined)?.map((event) => ({ status: event.status, at: event.at })),
    legacyCalculation: !row.allocations,
  };
}

export async function payoutDetail(row: PayoutRow, admin = false) {
  let orders: Array<Record<string, unknown>>;
  if (row.allocations) orders = row.allocations.map((a) => ({ _id: a.orderId, orderNumber: a.orderNumber, createdAt: a.createdAt, vendorShare: a.vendorShare, vendorEarnings: a.vendorEarnings, total: a.vendorShare, commission: a.commission, shipping: a.shipping, currency: a.currency, status: a.status, paymentStatus: a.paymentStatus }));
  else {
    const vendorId = String((row.vendorId as { _id?: unknown })?._id ?? row.vendorId);
    const source = await Order.find({ _id: { $in: row.orderIds ?? [] }, "subOrders.vendorId": vendorId }).select("orderNumber createdAt subOrders").sort({ createdAt: -1, _id: -1 }).lean();
    orders = source.map((order) => {
      const own = order.subOrders.filter((sub: OwnConsignment) => String(sub.vendorId) === vendorId);
      const share = own.reduce((s: number, sub: OwnConsignment) => s + Number(sub.subtotal || 0), 0);
      return { _id: order._id, orderNumber: order.orderNumber, createdAt: order.createdAt, vendorShare: share, total: share, vendorEarnings: own.reduce((s: number, sub: OwnConsignment) => s + Number(sub.vendorEarnings || 0), 0), status: own[0]?.status, paymentStatus: own[0]?.paymentStatus, legacyCalculation: true };
    });
  }
  return { payout: admin ? { ...row, legacyCalculation: !row.allocations } : vendorPayoutDto(row), orders };
}
