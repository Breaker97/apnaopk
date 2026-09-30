import { Order } from "@/models";
import { ORDER_STATUS } from "@/config/app.config";
import {
  PREORDER_ITEM_STATUS,
  PURCHASE_TYPE,
  getPreorderSettings,
  type PreorderSettingsShape,
} from "@/lib/orders/preorders";
import { DISPATCHED_ORDER_STATUSES } from "@/lib/orders/order-status-workflow";
import { notifyPreorderCustomerUpdate } from "@/lib/notifications/notifications";

/**
 * Carry a product's pushed-back release date to the orders already waiting on it.
 *
 * Every order line keeps the date it was sold with, and the order waits for its
 * latest line: the reminders, the expiry clock and the auto-release all count
 * from it. Moving the date on the product only changed what NEW shoppers were
 * promised — the orders already placed kept the old one, so with auto-release
 * on the store asked for the balance, and charged the saved card, on a date
 * for goods that were not coming until a month later, and nobody was told.
 *
 * A later date on the product is treated as the delay it is: the lines move,
 * the order waits for its latest line, a reservation still waiting becomes
 * `delayed`, and the shopper gets the delay notice with its offer to cancel.
 * Only orders still waiting on their goods are touched — once the balance has
 * been asked for, or the order released, the goods are in and the product's
 * date no longer describes them. An EARLIER date moves nothing: the promise
 * the shopper holds is still kept, and bringing an order forward is the
 * store's call, made from the pre-order screen.
 */

type ProductShape = Parameters<typeof getPreorderSettings>[0] & {
  name?: string;
  title?: string;
};

type WaitingOrder = {
  _id: unknown;
  orderNumber: string;
  customerId?: unknown;
  guestEmail?: string;
  status?: string;
  preorderStatus?: string;
  preorderReleaseDate?: Date;
  preorderOriginalReleaseDate?: Date;
  items?: Array<OrderLine>;
  subOrders?: Array<{ items?: Array<OrderLine> }>;
};

type OrderLine = {
  productId?: unknown;
  variantId?: unknown;
  purchaseType?: string;
  preorderReleaseDate?: Date;
};

const WAITING = [PREORDER_ITEM_STATUS.RESERVED, PREORDER_ITEM_STATUS.DELAYED];

function time(value: unknown): number | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  const ms = date.getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function dateOf(settings: PreorderSettingsShape | undefined): number | undefined {
  return settings?.enabled ? time(settings.releaseDate) : undefined;
}

/**
 * The date each line of this product should now carry, or undefined to leave
 * it. Pure, so the rule can be read — and tested — without a database.
 */
export function pushedBackLineDate(params: {
  before: ProductShape;
  after: ProductShape;
  line: OrderLine;
}): Date | undefined {
  const variantId = params.line.variantId ? String(params.line.variantId) : undefined;
  const was = dateOf(getPreorderSettings(params.before, variantId));
  const now = dateOf(getPreorderSettings(params.after, variantId));
  // Only a change the store actually made to this line's settings.
  if (now === undefined || was === now) return undefined;
  const held = time(params.line.preorderReleaseDate);
  if (held !== undefined && now <= held) return undefined;
  return new Date(now);
}

function anyReleaseDateChanged(before: ProductShape, after: ProductShape): boolean {
  if (dateOf(before.preorder) !== dateOf(after.preorder)) return true;
  const was = new Map(
    (before.variants || []).map((variant) => [String(variant._id), dateOf(variant.preorder)]),
  );
  return (after.variants || []).some(
    (variant) => was.get(String(variant._id)) !== dateOf(variant.preorder),
  );
}

export async function propagateProductReleaseDate(params: {
  productId: string;
  before: ProductShape;
  after: ProductShape;
}): Promise<{ moved: number }> {
  // Most saves move no date at all; they should not cost an order query.
  if (!anyReleaseDateChanged(params.before, params.after)) return { moved: 0 };

  const orders = await Order.find({
    hasPreorder: true,
    status: { $nin: [ORDER_STATUS.CANCELLED, ...DISPATCHED_ORDER_STATUSES] },
    preorderStatus: { $in: WAITING },
    items: {
      $elemMatch: { productId: params.productId, purchaseType: PURCHASE_TYPE.PREORDER },
    },
  })
    .select(
      "_id orderNumber customerId guestEmail status preorderStatus preorderReleaseDate preorderOriginalReleaseDate items.productId items.variantId items.purchaseType items.preorderReleaseDate subOrders.items.productId subOrders.items.variantId subOrders.items.purchaseType subOrders.items.preorderReleaseDate",
    )
    .limit(1000)
    .lean<WaitingOrder[]>();

  const productName = params.after.name || params.after.title;
  let moved = 0;

  for (const order of orders) {
    const set: Record<string, unknown> = {};
    const lineDate = (line: OrderLine) =>
      String(line.productId) === params.productId &&
      line.purchaseType === PURCHASE_TYPE.PREORDER
        ? pushedBackLineDate({ before: params.before, after: params.after, line })
        : undefined;

    let latest = 0;
    (order.items || []).forEach((line, index) => {
      const next = lineDate(line);
      if (next) {
        set[`items.${index}.preorderReleaseDate`] = next;
        set[`items.${index}.preorderStatus`] = PREORDER_ITEM_STATUS.DELAYED;
      }
      if (line.purchaseType === PURCHASE_TYPE.PREORDER) {
        latest = Math.max(latest, next?.getTime() ?? time(line.preorderReleaseDate) ?? 0);
      }
    });
    if (Object.keys(set).length === 0) continue;
    (order.subOrders || []).forEach((sub, subIndex) => {
      (sub.items || []).forEach((line, index) => {
        const next = lineDate(line);
        if (!next) return;
        set[`subOrders.${subIndex}.items.${index}.preorderReleaseDate`] = next;
        set[`subOrders.${subIndex}.items.${index}.preorderStatus`] =
          PREORDER_ITEM_STATUS.DELAYED;
      });
    });

    const previous = order.preorderReleaseDate;
    const orderDate = latest > 0 ? new Date(latest) : undefined;
    const orderMoved =
      orderDate !== undefined && orderDate.getTime() !== time(previous);

    const written = await Order.updateOne(
      // Only over the stage it was read in: a balance asked for, or a release,
      // landing meanwhile means the goods are in and this date is stale.
      {
        _id: order._id,
        status: order.status,
        preorderStatus: order.preorderStatus,
      },
      {
        $set: {
          ...set,
          preorderStatus: PREORDER_ITEM_STATUS.DELAYED,
          ...(orderMoved
            ? {
                preorderReleaseDate: orderDate,
                preorderOriginalReleaseDate:
                  order.preorderOriginalReleaseDate || previous || orderDate,
                preorderReleaseDateUpdatedAt: new Date(),
                preorderCustomerNotifiedAt: new Date(),
              }
            : {}),
        },
        // A new date is a new promise — see the delay actions.
        ...(orderMoved ? { $unset: { preorderBalanceRemindersSent: "" } } : {}),
      },
    ).catch((err) => {
      console.error(
        `Failed to move the release date of pre-order ${order.orderNumber}:`,
        err,
      );
      return null;
    });
    if (!written?.modifiedCount) continue;
    moved += 1;

    // The shopper hears only when the date THEY wait for moved; a line that
    // moved but still lands before another seller's goods changes nothing
    // for them.
    if (!orderMoved) continue;
    await notifyPreorderCustomerUpdate(
      String(order.customerId || ""),
      order.orderNumber,
      "delayed",
      String(order._id),
      {
        releaseDate: orderDate,
        previousReleaseDate: previous,
        reason: productName
          ? `The expected date for ${productName} has moved.`
          : undefined,
        guestEmail: order.guestEmail,
      },
    ).catch((err) =>
      console.error(
        `Failed to tell a shopper pre-order ${order.orderNumber} moved:`,
        err,
      ),
    );
  }

  return { moved };
}
