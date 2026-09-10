import type { Types } from "mongoose";
import { Order } from "@/models";
import { connectDB } from "@/lib/db";
import { PAYMENT_STATUS } from "@/config/app.config";

/**
 * Orders attributed to one staff member.
 *
 * `Order.staffId` is stamped by the POS and by admin-created online orders, and
 * `{ channel, staffId, createdAt }` is already indexed — so "what has this
 * person rung up?" is a query, not a new collection.
 */

interface StaffOrderRow {
  _id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  channel?: string;
  total: number;
  customerName?: string;
  createdAt: string;
}

interface StaffOrderStats {
  orderCount: number;
  posOrderCount: number;
  onlineOrderCount: number;
  /** Money actually collected — cancelled and unpaid orders are excluded. */
  totalSales: number;
  lastOrderAt: string | null;
}

interface StaffOrdersParams {
  staffId: string;
  page?: number;
  limit?: number;
  /** "all" | "pos" | "online" */
  channel?: string;
  /** Vendor area: only orders this vendor has a line in. */
  vendorId?: Types.ObjectId | string;
}

const PAID_STATUSES: string[] = [
  PAYMENT_STATUS.PAID,
  PAYMENT_STATUS.PARTIALLY_PAID,
  PAYMENT_STATUS.PARTIALLY_REFUNDED,
];

function buildFilter({
  staffId,
  channel,
  vendorId,
}: Pick<StaffOrdersParams, "staffId" | "channel" | "vendorId">) {
  const filter: Record<string, unknown> = { staffId: String(staffId) };

  if (channel === "pos" || channel === "online") {
    filter.channel = channel;
  }

  if (vendorId) {
    // A vendor reaches an order through either shape: split orders carry
    // sub-orders, single-vendor carts only tag the line items.
    filter.$or = [
      { "subOrders.vendorId": vendorId },
      { "items.vendorId": vendorId },
    ];
  }

  return filter;
}

type PopulatedCustomer = { name?: string; email?: string } | null;

export async function fetchStaffOrderStats(
  params: Pick<StaffOrdersParams, "staffId" | "vendorId">,
): Promise<StaffOrderStats> {
  await connectDB();

  const [row] = await Order.aggregate<{
    orderCount: number;
    posOrderCount: number;
    onlineOrderCount: number;
    totalSales: number;
    lastOrderAt: Date | null;
  }>([
    { $match: buildFilter({ ...params, channel: "all" }) },
    {
      $group: {
        _id: null,
        orderCount: { $sum: 1 },
        posOrderCount: {
          $sum: { $cond: [{ $eq: ["$channel", "pos"] }, 1, 0] },
        },
        onlineOrderCount: {
          $sum: { $cond: [{ $eq: ["$channel", "pos"] }, 0, 1] },
        },
        totalSales: {
          $sum: {
            $cond: [{ $in: ["$paymentStatus", PAID_STATUSES] }, "$total", 0],
          },
        },
        lastOrderAt: { $max: "$createdAt" },
      },
    },
  ]);

  return {
    orderCount: row?.orderCount ?? 0,
    posOrderCount: row?.posOrderCount ?? 0,
    onlineOrderCount: row?.onlineOrderCount ?? 0,
    totalSales: row?.totalSales ?? 0,
    lastOrderAt: row?.lastOrderAt ? new Date(row.lastOrderAt).toISOString() : null,
  };
}

export async function fetchStaffOrders(params: StaffOrdersParams): Promise<{
  data: StaffOrderRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}> {
  await connectDB();

  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(50, Math.max(1, params.limit ?? 10));
  const filter = buildFilter(params);

  const [rows, total] = await Promise.all([
    Order.find(filter)
      .select("orderNumber status paymentStatus channel total createdAt customerId guestEmail")
      // Guest checkouts point `customerId` at a cart, so this populate simply
      // resolves to null there and the row falls back to the guest email.
      .populate("customerId", "name email")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  const data: StaffOrderRow[] = rows.map((row) => {
    const customer = row.customerId as unknown as PopulatedCustomer;
    return {
      _id: String(row._id),
      orderNumber: String(row.orderNumber ?? ""),
      status: String(row.status ?? ""),
      paymentStatus: String(row.paymentStatus ?? ""),
      channel: row.channel,
      total: Number(row.total ?? 0),
      customerName:
        customer?.name || customer?.email || row.guestEmail || undefined,
      createdAt: new Date(row.createdAt).toISOString(),
    };
  });

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
