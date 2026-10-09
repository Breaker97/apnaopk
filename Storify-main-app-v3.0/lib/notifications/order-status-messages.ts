/**
 * What an order-status notification tells the shopper: the same words in the
 * bell, the generic email and the text (`notifyOrderStatus` in
 * lib/notifications/notifications.ts). Settings → SMS previews the delivered
 * one, the longest, so a merchant sees what a link costs.
 */
export function orderStatusMessage(status: string, orderNumber: string): string {
  switch (status) {
    case "pending":
      return `Your order #${orderNumber} is now pending.`;
    case "processing":
      return `Your order #${orderNumber} is now processing.`;
    case "shipped":
      return `Your order #${orderNumber} has been shipped.`;
    // The link opens the order page, where each delivered item can be rated.
    case "delivered":
      return `Your order #${orderNumber} has been delivered. How was it? Rate your items to help other shoppers.`;
    case "cancelled":
      return `Your order #${orderNumber} has been cancelled.`;
    default:
      return `Order #${orderNumber} status: ${status}`;
  }
}
