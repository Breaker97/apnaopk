import { audit, type AuditContext } from "@/lib/audit";

/**
 * Changes a person makes to a return's paperwork, recorded against the ORDER so
 * they land in that order's Timeline beside the return's own decisions
 * (`auditOrderReturn`) and refunds — which is where someone asking "what was
 * the shopper told to send back, and what are they getting instead" looks.
 *
 * Written in the voice of `lib/orders/audit-order.ts`: the summary is a whole
 * sentence, because the Timeline shows nothing else.
 */

interface ReturnRef {
  orderId: unknown;
  orderNumber?: string;
  returnNumber?: string;
}

function ref(returnRequest: ReturnRef) {
  return {
    resourceId: String(returnRequest.orderId),
    resourceName: returnRequest.orderNumber ? `Order #${returnRequest.orderNumber}` : undefined,
  };
}

const returnLabel = (returnRequest: ReturnRef) =>
  returnRequest.returnNumber ? `return ${returnRequest.returnNumber}` : "a return";

function money(amount: number, currency?: string) {
  const value = Number.isFinite(amount) ? amount : 0;
  return `${value.toFixed(2)}${currency ? ` ${currency.toUpperCase()}` : ""}`;
}

/** One line of the exchange order the return will become. */
interface ExchangeLine {
  name?: string;
  sku?: string;
  quantity?: number;
  unitPrice?: number;
}

export interface ExchangeState {
  items?: ExchangeLine[] | null;
  delivery?: number | null;
}

/** What is worth keeping of a line: not the image or the ids. */
function lineSnapshot(line: ExchangeLine) {
  return {
    name: line.name ?? null,
    sku: line.sku ?? null,
    quantity: Number(line.quantity ?? 0),
    unitPrice: Number(line.unitPrice ?? 0),
  };
}

function exchangeSnapshot(state: ExchangeState) {
  return {
    exchangeItems: (state.items ?? []).map(lineSnapshot),
    exchangeDelivery: Number(state.delivery ?? 0),
  };
}

/**
 * What the shopper is to be sent instead of their money, chosen or changed
 * before the return is processed. Says nothing when the choice is the one
 * already there.
 */
export function auditReturnExchangeItems(
  context: AuditContext,
  returnRequest: ReturnRef,
  details: { before: ExchangeState; after: ExchangeState; currency?: string },
) {
  const before = exchangeSnapshot(details.before);
  const after = exchangeSnapshot(details.after);
  const fields = (Object.keys(after) as Array<keyof typeof after>).filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
  if (fields.length === 0) return Promise.resolve(null);

  const label = returnLabel(returnRequest);
  const items = after.exchangeItems
    .map((line) => `${line.name ?? "Item"} × ${line.quantity}`)
    .join(", ");
  const delivery =
    after.exchangeDelivery > 0
      ? `, delivery ${money(after.exchangeDelivery, details.currency)}`
      : "";
  const summary =
    after.exchangeItems.length === 0
      ? `Exchange items removed from ${label}`
      : before.exchangeItems.length === 0
        ? `Exchange items set on ${label}: ${items}${delivery}`
        : `Exchange items changed on ${label} to ${items}${delivery}`;

  return audit(context, {
    action: "UPDATE",
    resource: "order",
    ...ref(returnRequest),
    changes: {
      before: Object.fromEntries(fields.map((field) => [field, before[field]])),
      after: Object.fromEntries(fields.map((field) => [field, after[field]])),
      fields,
      summary,
    },
    metadata: { returnNumber: returnRequest.returnNumber },
  });
}

/**
 * A label uploaded for the shopper to print, or one that replaced it. The file's
 * name and nothing of where it is kept: the label carries the shopper's name and
 * address, and its storage key opens it.
 */
export function auditReturnLabel(
  context: AuditContext,
  returnRequest: ReturnRef,
  details: { previousFileName?: string | null; fileName?: string | null },
) {
  const label = returnLabel(returnRequest);
  const replaced = Boolean(details.previousFileName);
  return audit(context, {
    action: "UPDATE",
    resource: "order",
    ...ref(returnRequest),
    changes: {
      before: replaced ? { returnLabel: details.previousFileName } : undefined,
      after: { returnLabel: details.fileName ?? null },
      fields: ["returnLabel"],
      summary: replaced
        ? `Label replaced on ${label}: ${details.previousFileName} → ${details.fileName ?? "a new file"}`
        : `Label uploaded on ${label}${details.fileName ? `: ${details.fileName}` : ""}`,
    },
    metadata: { returnNumber: returnRequest.returnNumber },
  });
}
