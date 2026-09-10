import { pathToFileURL } from "node:url";
import { Types } from "mongoose";
import { connectDB, mongoose } from "@/lib/db";
import { CustomerProfile, Order, PaymentTransaction, User } from "@/models";
import { USER_ROLES } from "@/config/app.config";
import { computeLoyaltyTier, computePointsFromOrder } from "@/lib/customers/customer";

export type LoyaltyBackfillOptions = {
  apply: boolean;
  all?: boolean;
  email?: string;
};

/**
 * Users processed per round trip. Bounds peak memory and the size of the `$in`
 * lists and bulk writes below, so `--all` stays usable on a real store rather
 * than only on a seeded demo database.
 */
const USER_CHUNK_SIZE = 500;

/**
 * Only real customers. `User` holds admins, vendors and staff too, and the
 * admin customer list is an aggregation over `CustomerProfile` with no role
 * filter of its own (`lib/customers/customer-list.ts`) — so upserting a profile for
 * every user would file the whole staff directory under Customers.
 */
export const BACKFILL_CUSTOMER_FILTER = {
  // `as const` per element, not on the whole literal: Mongoose's filter type
  // rejects a readonly `$or` tuple.
  $or: [
    { role: USER_ROLES.CUSTOMER } as const,
    { roles: USER_ROLES.CUSTOMER } as const,
  ],
};

export function parseBackfillArgs(args: string[]): LoyaltyBackfillOptions {
  let apply = false;
  let all = false;
  let email: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--all") {
      all = true;
    } else if (arg === "--email") {
      const value = args[index + 1]?.trim().toLowerCase();
      if (!value) throw new Error("--email requires an email address");
      email = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (all && email) throw new Error("Use either --email <address> or --all");
  if (apply && !all && !email) {
    throw new Error("Use --email <address> or --all with --apply");
  }

  return {
    apply,
    ...(all ? { all: true } : {}),
    ...(email ? { email } : {}),
  };
}

type BackfillOrder = {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  total?: number;
  paymentStatus?: string;
  refundedTotal?: number;
  loyalty?: {
    pointsAwarded?: number;
    pointsReversed?: number;
    awardedAt?: Date;
    lastReversedAt?: Date;
  };
};

type RefundTotal = {
  _id: Types.ObjectId;
  total: number;
};

function loyaltyStateForOrder(
  order: BackfillOrder,
  refundedFromTransactions: number,
) {
  const pointsAwarded = computePointsFromOrder(Number(order.total || 0));
  const recordedRefund = Number(order.refundedTotal);
  const refundedTotal =
    Number.isFinite(recordedRefund) && recordedRefund >= 0
      ? recordedRefund
      : order.paymentStatus === "refunded"
        ? Number(order.total || 0)
        : refundedFromTransactions;
  const pointsReversed = Math.min(
    pointsAwarded,
    computePointsFromOrder(refundedTotal),
  );

  return { pointsAwarded, pointsReversed };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function runBackfill(options: LoyaltyBackfillOptions) {
  if (!options.all && !options.email) {
    return {
      mode: options.apply ? "apply" : "dry-run",
      users: 0,
      orders: 0,
      writes: 0,
      plannedWrites: 0,
      profilesCreated: 0,
    };
  }

  await connectDB();

  const userFilter = options.email
    ? { ...BACKFILL_CUSTOMER_FILTER, email: options.email }
    : BACKFILL_CUSTOMER_FILTER;

  const users = await User.find(userFilter)
    .select("_id email")
    .lean<Array<{ _id: Types.ObjectId; email: string }>>();

  let orderCount = 0;
  let writes = 0;
  let profilesCreated = 0;

  for (const userChunk of chunk(users, USER_CHUNK_SIZE)) {
    const customerIds = userChunk.map((user) => user._id);
    const orders = await Order.find({
      customerId: { $in: customerIds },
      paymentStatus: { $in: ["paid", "partially_refunded", "refunded"] },
    })
      .select("_id customerId total paymentStatus refundedTotal loyalty")
      .lean<BackfillOrder[]>();
    orderCount += orders.length;

    const orderIds = orders.map((order) => order._id);
    const refunds = orderIds.length
      ? await PaymentTransaction.aggregate<RefundTotal>([
          {
            $match: {
              orderId: { $in: orderIds },
              type: "refund",
              status: "succeeded",
            },
          },
          { $group: { _id: "$orderId", total: { $sum: "$grossAmount" } } },
        ])
      : [];
    const refundsByOrder = new Map(
      refunds.map((refund) => [String(refund._id), Number(refund.total || 0)]),
    );

    const balanceByCustomer = new Map(
      userChunk.map((user) => [String(user._id), 0]),
    );
    const orderWrites = orders.map((order) => {
      const loyalty = loyaltyStateForOrder(
        order,
        refundsByOrder.get(String(order._id)) || 0,
      );
      const customerId = String(order.customerId);
      balanceByCustomer.set(
        customerId,
        (balanceByCustomer.get(customerId) || 0) +
          loyalty.pointsAwarded -
          loyalty.pointsReversed,
      );

      return {
        updateOne: {
          filter: { _id: order._id },
          update: {
            $set: {
              loyalty: {
                ...loyalty,
                awardedAt: order.loyalty?.awardedAt || new Date(),
                ...(loyalty.pointsReversed > 0
                  ? {
                      lastReversedAt:
                        order.loyalty?.lastReversedAt || new Date(),
                    }
                  : {}),
              },
            },
          },
        },
      };
    });

    const profileWrites = userChunk.map((user) => {
      const points = Math.max(0, balanceByCustomer.get(String(user._id)) || 0);
      // Upsert only when there is a balance to record. A customer with no paid
      // orders and no profile needs neither — the model already defaults to
      // zero points and Bronze — and creating one here would invent a customer
      // record out of a user who never bought anything. An EXISTING profile is
      // still corrected to zero, which is what clears a seeded balance.
      if (points > 0) profilesCreated += 1;
      return {
        updateOne: {
          filter: { userId: user._id },
          update: {
            $set: {
              loyaltyPoints: points,
              lifetimePoints: points,
              loyaltyTier: computeLoyaltyTier(points),
            },
          },
          upsert: points > 0,
        },
      };
    });

    writes += orderWrites.length + profileWrites.length;

    if (options.apply) {
      if (orderWrites.length > 0) await Order.bulkWrite(orderWrites);
      if (profileWrites.length > 0) await CustomerProfile.bulkWrite(profileWrites);
    }
  }

  return {
    mode: options.apply ? "apply" : "dry-run",
    users: users.length,
    orders: orderCount,
    writes: options.apply ? writes : 0,
    plannedWrites: writes,
    profilesCreated,
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseBackfillArgs(args);
  const report = await runBackfill(options);
  console.log(
    `Loyalty backfill ${report.mode}: ${report.users} customers, ${report.orders} paid/refunded orders, ${report.plannedWrites} planned writes.`,
  );
  return report;
}

function isEntrypoint() {
  const invokedPath = process.argv[1];
  return Boolean(invokedPath) && pathToFileURL(invokedPath).href === import.meta.url;
}

if (isEntrypoint()) {
  main()
    .catch((error) => {
      console.error("Loyalty backfill failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
