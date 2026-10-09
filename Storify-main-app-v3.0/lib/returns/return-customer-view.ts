/**
 * A return as the shopper who asked for it may see it.
 *
 * The customer routes sent the whole document: the store's receiving note,
 * the seller's note, who overrode the fault finding and why, who recorded the
 * refund as paid and with what bank reference, whose cash the refund comes out
 * of. None of it is the shopper's to read, so the view is an allowlist — a
 * field added to the model later stays private until someone decides it is
 * not.
 */

type CustomerReturnSource = {
  _id?: unknown;
  returnNumber?: string;
  orderId?: unknown;
  orderNumber?: string;
  status?: string;
  refundStatus?: string;
  reason?: string;
  customerNote?: string;
  rejectionReason?: string;
  items?: Array<{
    orderItemIndex?: number;
    name?: string;
    sku?: string;
    image?: string;
    quantityRequested?: number;
    quantityApproved?: number;
    quantityReceived?: number;
    unitPrice?: number;
  }> | null;
  estimatedRefund?: unknown;
  actualRefund?: {
    amount?: number;
    settledAt?: unknown;
    storeCredit?: number;
    exchange?: number;
  } | null;
  /** The exchange order the return became (R7). */
  exchange?: { orderId?: unknown; orderNumber?: string; undoneAt?: unknown } | null;
  refundDestination?: {
    method?: string;
    provider?: string;
    accountName?: string;
    accountNumber?: string;
    note?: string;
  } | null;
  shipment?: {
    carrier?: string;
    trackingNumber?: string;
    labelUrl?: string;
    labelFileKey?: string;
    trackingAddedBy?: string;
    shippedAt?: unknown;
  } | null;
  returnMethod?: string | null;
  returnTo?: { name?: string | null; address?: string | null } | null;
  returnInstructions?: string | null;
  requestedAt?: unknown;
  approvedAt?: unknown;
  rejectedAt?: unknown;
  receivedAt?: unknown;
  refundedAt?: unknown;
  closedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

/**
 * The last four characters of an account number, and nothing before them —
 * or nothing at all for a number so short that four would be all of it, as
 * `describeRefundDestination` masks it.
 */
function lastFour(value: string | undefined): string | undefined {
  const text = String(value || "").trim();
  if (!text) return undefined;
  return text.length > 4 ? `••••${text.slice(-4)}` : "••••";
}

export function toCustomerReturn(doc: CustomerReturnSource | null | undefined) {
  if (!doc) return doc;
  return {
    _id: doc._id,
    returnNumber: doc.returnNumber,
    orderId: doc.orderId,
    orderNumber: doc.orderNumber,
    status: doc.status,
    refundStatus: doc.refundStatus,
    reason: doc.reason,
    customerNote: doc.customerNote,
    // Why the store said no — the one staff note that is the shopper's.
    rejectionReason: doc.rejectionReason,
    items: (doc.items || []).map((item) => ({
      orderItemIndex: item.orderItemIndex,
      name: item.name,
      sku: item.sku,
      image: item.image,
      quantityRequested: item.quantityRequested,
      quantityApproved: item.quantityApproved,
      unitPrice: item.unitPrice,
    })),
    estimatedRefund: doc.estimatedRefund,
    // What has actually been paid back, and when it reached them.
    actualRefund: doc.actualRefund
      ? {
          amount: doc.actualRefund.amount,
          settledAt: doc.actualRefund.settledAt,
          // The part given as store credit rather than sent back (R8).
          ...(Number(doc.actualRefund.storeCredit || 0) > 0
            ? { storeCredit: doc.actualRefund.storeCredit }
            : {}),
          // The part that paid for their exchange order instead (R7).
          ...(Number(doc.actualRefund.exchange || 0) > 0
            ? { exchange: doc.actualRefund.exchange }
            : {}),
        }
      : undefined,
    // What they are getting instead of the money, while it stands (R7).
    ...(doc.exchange?.orderId && !doc.exchange.undoneAt
      ? {
          exchange: {
            orderId: String(doc.exchange.orderId),
            orderNumber: doc.exchange.orderNumber,
          },
        }
      : {}),
    // Their own details, with the account number cut to what the page shows.
    refundDestination: doc.refundDestination
      ? {
          method: doc.refundDestination.method,
          provider: doc.refundDestination.provider,
          accountName: doc.refundDestination.accountName,
          accountNumber: lastFour(doc.refundDestination.accountNumber),
        }
      : undefined,
    shipment: doc.shipment
      ? {
          carrier: doc.shipment.carrier,
          trackingNumber: doc.shipment.trackingNumber,
          trackingAddedBy: doc.shipment.trackingAddedBy,
          shippedAt: doc.shipment.shippedAt,
          // A link the store gave, and whether there is an uploaded file to
          // fetch through the shopper's own label route — never its key.
          labelUrl: doc.shipment.labelUrl || undefined,
          hasLabelFile: Boolean(doc.shipment.labelFileKey),
        }
      : undefined,
    // How the parcel comes back, where to, and what to do — the store's
    // answer when it approved the return.
    returnMethod: doc.returnMethod || undefined,
    returnTo: doc.returnTo
      ? { name: doc.returnTo.name || undefined, address: doc.returnTo.address || undefined }
      : undefined,
    returnInstructions: doc.returnInstructions || undefined,
    requestedAt: doc.requestedAt,
    approvedAt: doc.approvedAt,
    rejectedAt: doc.rejectedAt,
    receivedAt: doc.receivedAt,
    refundedAt: doc.refundedAt,
    closedAt: doc.closedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
