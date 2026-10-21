import "server-only";
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { Product } from "@/models/product.model";
import { Order } from "@/models/order.model";
import { LedgerEntry, LEDGER_SOURCE_KIND } from "@/models/ledger-entry.model";
import { ReturnRequest } from "@/models/return-request.model";
import { CheckoutAttempt } from "@/models/checkout-attempt.model";
import { Transfer } from "@/models/transfer.model";
import { FinanceOperation } from "@/models/finance-operation.model";
import { InventoryReservation } from "@/models/inventory-reservation.model";
import { InventorySaleAllocation } from "@/models/inventory-allocation.model";
import { getSettings } from "@/models/settings.model";
import { getDefaultVendorIds } from "@/lib/finance/post-events";
import { getTransactionSupport } from "@/lib/db-transaction";
import { financeQuery, financeSession, financeTransaction } from "@/lib/finance/transaction";
import { finishFinanceOperation, runFinanceOperation } from "@/lib/finance/operations";
import { LEDGER_ACCOUNT, LEDGER_BOOK } from "@/lib/finance/accounts";
import type { LedgerPosting } from "@/lib/finance/ledger";
import { soldBranchLocationId } from "@/lib/orders/order-inventory";
import { financialStockRows, physicalFinancialProduct, type FinancialProduct } from "./finance-catalog";
import { inventoryCost, inventoryLedgerEffect, inventoryLineValue, inventoryMoney, openingInventoryPostings } from "./finance-rules";
import { runInventoryMutation } from "./finance-service";
import { inventoryPositionKey } from "./finance-position";

/**
 * Inventory cutover — spec §11, "Package F".
 *
 * Moves a store's existing (legacy) own-store stock onto synchronized
 * inventory accounting, once, so the Inventory and ledger book value and the
 * Finance "Stock on hand" read the same figure from then on.
 *
 * For each legacy physical product, inside ONE transaction that re-reads it:
 * - an opening position per SKU × location, valued at its fixed cost and booked
 *   Dr Inventory / Cr Opening inventory equity (no cash, no Net);
 * - unpaid open order lines are stamped as synchronized and their units held
 *   as reserved, so payment, cancellation and shipping take the new path;
 * - sold lines whose cost of goods the legacy path already booked are adopted
 *   as sale allocations (generation 0), so a later restock reverses that cost
 *   exactly once — the legacy restock posting skips adopted lines;
 * - the product is flagged generation 1 with its book currency.
 * Then, per owner, one correction offsets what the legacy paths left in the
 * Inventory account (e.g. cost of goods taken out for stock that was never
 * put in), so the ledger equals the opening snapshot.
 *
 * Sold lines with no recorded cost are left alone: nothing left the ledger for
 * them, so a later restock re-enters the units at today's cost against opening
 * equity (see `captureFinancialRestock`).
 *
 * Nothing is guessed: costs come from the catalogue, sale costs from the
 * ledger, and anything that cannot be classified is a blocker that stops the
 * apply until a person resolves it.
 */

export type CutoverIssue = { code: string; message: string; productId?: string; orderId?: string; orderNumber?: string };

export interface CutoverRow {
  variantId: string | null;
  locationId: string | null;
  sku: string;
  variantName: string | null;
  available: number;
  reserved: number;
  cost: number | null;
  value: number;
  oversold: number;
}

export interface CutoverLine {
  orderId: string;
  orderNumber?: string;
  subOrderId: string;
  subIndex: number;
  /** Index in the sub-order's items. */
  itemIndex: number;
  /** Index in the order's own `items`, when the line is found there. */
  orderItemIndex: number | null;
  variantId: string | null;
  locationId: string | null;
  quantity: number;
  /** The `inventoryLineId` an order created today would carry. */
  lineId: string;
}

export interface ProductCutover {
  productId: string;
  ownerId: string;
  name: string;
  currency: string;
  rows: CutoverRow[];
  /** Unpaid lines holding stock: stamped, and their units reserved. */
  reserve: Array<CutoverLine & { fillCost: number | null }>;
  /** Unpaid lines holding no stock yet: stamped only. */
  stamp: Array<CutoverLine & { fillCost: number | null }>;
  /** Sold lines with booked cost of goods: adopted as allocations. */
  adopt: Array<CutoverLine & { unitCost: number; costOfGoods: number; restored: number; cycle: number }>;
  /** Units left on the legacy path, by why. */
  legacy: { soldUncosted: number; unpaidUncosted: number; otherCurrency: number };
  blockers: CutoverIssue[];
  warnings: CutoverIssue[];
}

export interface CutoverResidual {
  ownerId: string;
  /** Effect of the legacy entries on the Inventory account. */
  legacyEffect: number;
  /** Corrections already posted by earlier runs. */
  previousCorrections: number;
  /** What this run posts: −(legacy + previous). */
  amount: number;
  entryKeys: string[];
}

export interface CutoverPlan {
  currency: string;
  fingerprint: string;
  generatedAt: string;
  transactions: { supported: boolean; reason?: string };
  products: ProductCutover[];
  residuals: CutoverResidual[];
  blockers: CutoverIssue[];
  warnings: CutoverIssue[];
  totals: {
    products: number; positions: number; units: number; reservedUnits: number;
    missingCostUnits: number; bookValue: number; ledgerBefore: number; ledgerAfter: number;
    adoptedLines: number; stampedLines: number;
  };
}

type LeanItem = { productId?: unknown; variantId?: unknown; vendorId?: unknown; quantity?: number | null; cost?: number | null; name?: string; sku?: string; inventoryFinanceGeneration?: number; inventoryLineId?: string };
type LeanSub = { _id: unknown; vendorId?: unknown; status?: string; paymentStatus?: string; inventoryReserved?: boolean; preorderReserved?: boolean; inventoryFinanceCycle?: number; fulfillment?: unknown; items?: LeanItem[] };
export type CutoverOrder = { _id: unknown; orderNumber?: string; currency?: string; status?: string; paymentStatus?: string; channel?: string; posLocationId?: unknown; preorderOutstandingAmount?: number; items?: LeanItem[]; subOrders?: LeanSub[] };

const CLOSED_SUB = new Set(["cancelled", "expired"]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const id = (value: unknown) => (value == null ? null : String(value));

/** The `inventoryLineId` the order model stamps: vendor:product:variant:ordinal within one array. */
function lineIdFor(items: LeanItem[], index: number): string {
  const key = (item: LeanItem) => `${item.vendorId}:${item.productId}:${item.variantId ?? "main"}`;
  const target = key(items[index]!);
  let ordinal = 0;
  for (let i = 0; i < index; i++) if (key(items[i]!) === target) ordinal++;
  return `${target}:${ordinal}`;
}

/** The same line in the order's combined `items`, matched by key and ordinal. */
function orderItemIndexFor(order: CutoverOrder, sub: LeanSub, itemIndex: number): number | null {
  const items = order.items ?? [];
  const wanted = lineIdFor(sub.items ?? [], itemIndex);
  for (let i = 0; i < items.length; i++) if (lineIdFor(items, i) === wanted) return i;
  return null;
}

/**
 * Where a restore of this line would put its units back — the branch the
 * cancellation or return restock will credit, so a reservation held there can
 * be released by it. Mirrors `restoreInventory`'s choice.
 */
export function predictRestoreLocation(order: CutoverOrder, ownerId: string, locations: string[], dispatch: string[]): string | null {
  if (!locations.length) return null;
  if (order.channel === "pos" && order.posLocationId) {
    const pos = String(order.posLocationId);
    return locations.includes(pos) ? pos : locations[0]!;
  }
  const explicit = soldBranchLocationId(order as Parameters<typeof soldBranchLocationId>[0], ownerId);
  for (const candidate of [explicit, ...dispatch]) if (candidate && locations.includes(candidate)) return candidate;
  return locations[0]!;
}

/**
 * Plan one product. Pure: every database fact arrives as input, so the same
 * rules run in the audit and again inside the apply's transaction.
 */
export function planProductCutover(input: {
  product: FinancialProduct & { name?: string };
  currency: string;
  orders: CutoverOrder[];
  /** `${orderId}:${vendorId}` whose sale is booked (revenue posted). */
  recognized: ReadonlySet<string>;
  /** `${orderId}:${vendorId}` → cost of goods still standing in the ledger. */
  standingCogs: ReadonlyMap<string, number>;
  /** `${orderId}:${productId}:${variantId}` → units already restocked by returns. */
  restocked: ReadonlyMap<string, number>;
  dispatch: string[];
}): ProductCutover {
  const { product, currency } = input;
  const productId = String(product._id), ownerId = String(product.vendorId);
  const name = product.name ?? "Product";
  const blockers: CutoverIssue[] = [], warnings: CutoverIssue[] = [];
  const stockRows = financialStockRows(product);
  const seen = new Set<string>();
  for (const row of stockRows) {
    const key = `${row.variantId}:${row.locationId}`;
    if (seen.has(key)) blockers.push({ code: "DUPLICATE_LOCATION_ROW", productId, message: `${name} lists the same location twice for one SKU; merge the rows first.` });
    seen.add(key);
  }
  const rows: CutoverRow[] = stockRows.map((row) => ({
    variantId: row.variantId, locationId: row.locationId, sku: row.sku, variantName: row.variantName,
    available: Math.max(0, row.quantity), reserved: 0, cost: row.unitCost, value: 0, oversold: Math.max(0, -row.quantity),
  }));
  const reserve: ProductCutover["reserve"] = [], stamp: ProductCutover["stamp"] = [], adopt: ProductCutover["adopt"] = [];
  const legacy = { soldUncosted: 0, unpaidUncosted: 0, otherCurrency: 0 };

  for (const order of input.orders) {
    const orderId = String(order._id);
    for (const [subIndex, sub] of (order.subOrders ?? []).entries()) {
      if (String(sub.vendorId) !== ownerId || CLOSED_SUB.has(String(sub.status))) continue;
      const items = sub.items ?? [];
      const lines = items.map((item, itemIndex) => ({ item, itemIndex })).filter(({ item }) => String(item.productId) === productId && !item.inventoryFinanceGeneration);
      if (!lines.length) continue;
      const issue = { productId, orderId, orderNumber: order.orderNumber };
      if (order.status === "preordered" || sub.preorderReserved || Number(order.preorderOutstandingAmount ?? 0) > 0) {
        blockers.push({ ...issue, code: "OPEN_PREORDER", message: `${order.orderNumber ?? orderId} is an open pre-order for ${name}; finish or cancel it first.` });
        continue;
      }
      const saleKey = `${orderId}:${ownerId}`;
      const bookCurrency = (order.currency ?? currency) === currency;
      const recognized = input.recognized.has(saleKey);

      if (recognized) {
        // The legacy path booked cost of goods for every costed line of this
        // consignment at payment. Adopt them only when the ledger still holds
        // exactly what the lines say — anything else needs a person.
        const costed = items.filter((item) => !item.inventoryFinanceGeneration).map((item) => ({ item, cost: inventoryCost(item.cost) })).filter((row) => row.cost !== null);
        const expected = inventoryMoney(costed.reduce((sum, { item, cost }) => {
          const restocked = input.restocked.get(`${orderId}:${String(item.productId)}:${id(item.variantId) ?? ""}`) ?? 0;
          return sum + cost! * Math.max(0, Number(item.quantity ?? 0) - restocked);
        }, 0), currency);
        const standing = inventoryMoney(input.standingCogs.get(saleKey) ?? 0, currency);
        for (const { item, itemIndex } of lines) {
          const quantity = Math.max(0, Number(item.quantity ?? 0));
          const cost = inventoryCost(item.cost);
          if (!bookCurrency) { legacy.otherCurrency += quantity; continue; }
          if (cost === null) { legacy.soldUncosted += quantity; continue; }
          if (standing <= 0 || Math.abs(standing - expected) > 0.005) {
            blockers.push({ ...issue, code: "LEGACY_COGS_MISMATCH", message: `${order.orderNumber ?? orderId}: the ledger holds ${standing} of cost of goods for this sale but its lines say ${expected}; reconcile the ledger first.` });
            continue;
          }
          const variantId = id(item.variantId);
          const locations = rows.filter((r) => r.variantId === variantId).map((r) => r.locationId).filter((l): l is string => Boolean(l));
          adopt.push({
            orderId, orderNumber: order.orderNumber, subOrderId: String(sub._id), subIndex, itemIndex,
            orderItemIndex: orderItemIndexFor(order, sub, itemIndex), variantId,
            locationId: predictRestoreLocation(order, ownerId, locations, input.dispatch),
            quantity, lineId: `${String(sub._id)}:${itemIndex}`,
            unitCost: cost, costOfGoods: inventoryLineValue(quantity, cost, currency),
            restored: Math.min(quantity, input.restocked.get(`${orderId}:${productId}:${variantId ?? ""}`) ?? 0),
            cycle: sub.inventoryFinanceCycle ?? 0,
          });
        }
        continue;
      }

      // Not sold yet: from now on the new path owns payment, shipping and
      // cancellation — when it can. It needs the order in the book currency
      // and a cost for the units it will take out.
      for (const { item, itemIndex } of lines) {
        const quantity = Math.max(0, Number(item.quantity ?? 0));
        const variantId = id(item.variantId);
        const variantRows = rows.filter((r) => r.variantId === variantId);
        const rowCost = variantRows[0]?.cost ?? null;
        const snapshot = inventoryCost(item.cost);
        if (order.currency === currency && rowCost !== null) {
          const locations = variantRows.map((r) => r.locationId).filter((l): l is string => Boolean(l));
          const line = {
            orderId, orderNumber: order.orderNumber, subOrderId: String(sub._id), subIndex, itemIndex,
            orderItemIndex: orderItemIndexFor(order, sub, itemIndex), variantId,
            locationId: predictRestoreLocation(order, ownerId, locations, input.dispatch),
            quantity, lineId: lineIdFor(items, itemIndex),
            // The sale's cost is taken from the fixed cost of the units it holds
            // when the order recorded none; an existing snapshot is never changed.
            fillCost: snapshot === null ? rowCost : null,
          };
          if (sub.inventoryReserved) {
            reserve.push(line);
            const row = rows.find((r) => r.variantId === variantId && r.locationId === line.locationId) ?? variantRows[0];
            if (row) row.reserved += quantity;
          } else stamp.push(line);
        } else if (snapshot !== null && (order.currency ?? currency) === currency) {
          // The legacy payment would book this cost against the Inventory account.
          blockers.push({ ...issue, code: "UNPAID_COST_WITHOUT_PRODUCT_COST", message: `${order.orderNumber ?? orderId} is unpaid and carries a cost for ${name}, but ${order.currency ? "the product has no cost" : "the order has no currency"}; set it first.` });
        } else if (!bookCurrency) legacy.otherCurrency += quantity;
        else legacy.unpaidUncosted += quantity;
      }
    }
  }

  let missing = 0;
  for (const row of rows) {
    const owned = row.available + row.reserved;
    row.value = row.cost === null ? 0 : inventoryLineValue(owned, row.cost, currency);
    if (row.cost === null) missing += owned;
    if (row.oversold) warnings.push({ code: "OVERSOLD", productId, message: `${name}${row.sku ? ` (${row.sku})` : ""} is oversold by ${row.oversold}; those units carry no value.` });
  }
  if (missing) warnings.push({ code: "COST_MISSING", productId, message: `${missing} units of ${name} have no cost and open at no value.` });
  if (legacy.soldUncosted || legacy.unpaidUncosted) warnings.push({ code: "LEGACY_UNCOSTED_LINES", productId, message: `${legacy.soldUncosted + legacy.unpaidUncosted} order units of ${name} recorded no cost and stay on the legacy path.` });
  if (legacy.otherCurrency) warnings.push({ code: "OTHER_CURRENCY_LINES", productId, message: `${legacy.otherCurrency} order units of ${name} were sold in another currency and stay on the legacy path.` });

  return { productId, ownerId, name, currency, rows, reserve, stamp, adopt, legacy, blockers, warnings };
}

/** Everything a product's plan reads, with the enclosing transaction's snapshot when there is one. */
async function productInputs(productIds: Types.ObjectId[]) {
  // Only orders the cutover can act on: a sale not fully paid yet, or one that
  // recorded a cost. A paid sale with no cost has nothing in the ledger to
  // adopt, and on a store with years of history it is most of them.
  const orders = await financeQuery(Order.find({
    $and: [
      { $or: [{ "subOrders.items.productId": { $in: productIds } }, { "items.productId": { $in: productIds } }] },
      { $or: [
        { paymentStatus: { $nin: ["paid", "refunded", "partially_refunded"] } },
        { "subOrders.paymentStatus": { $in: ["pending", "partially_paid"] } },
        { "subOrders.items.cost": { $type: "number" } },
        { "items.cost": { $type: "number" } },
      ] },
    ],
  })
    .select("orderNumber currency status paymentStatus channel posLocationId preorderOutstandingAmount items subOrders._id subOrders.vendorId subOrders.status subOrders.paymentStatus subOrders.inventoryReserved subOrders.preorderReserved subOrders.inventoryFinanceCycle subOrders.fulfillment subOrders.items")).lean<CutoverOrder[]>();
  const orderIds = orders.map((o) => o._id);
  const [revenue, cogs, returns] = await Promise.all([
    financeQuery(LedgerEntry.aggregate<{ _id: { order: unknown; vendor: unknown } }>([
      { $match: { "source.kind": "order", "source.id": { $in: orderIds }, credit: LEDGER_ACCOUNT.PRODUCT_REVENUE } },
      { $group: { _id: { order: "$source.id", vendor: "$vendorId" } } },
    ])),
    financeQuery(LedgerEntry.aggregate<{ _id: { order: unknown; vendor: unknown }; balance: number }>([
      { $match: { "source.kind": "order", "source.id": { $in: orderIds }, $or: [{ debit: LEDGER_ACCOUNT.COST_OF_GOODS }, { credit: LEDGER_ACCOUNT.COST_OF_GOODS }] } },
      { $group: { _id: { order: "$source.id", vendor: "$vendorId" }, balance: { $sum: { $cond: [{ $eq: ["$debit", LEDGER_ACCOUNT.COST_OF_GOODS] }, "$amount", { $multiply: ["$amount", -1] }] } } } },
    ])),
    financeQuery(ReturnRequest.find({ orderId: { $in: orderIds }, "restockedLines.0": { $exists: true } }).select("orderId restockedLines")).lean<Array<{ orderId: unknown; restockedLines?: Array<{ productId?: unknown; variantId?: unknown; quantity?: number }> }>>(),
  ]);
  const recognized = new Set(revenue.map((r) => `${String(r._id.order)}:${String(r._id.vendor)}`));
  const standingCogs = new Map(cogs.map((r) => [`${String(r._id.order)}:${String(r._id.vendor)}`, r.balance]));
  const restocked = new Map<string, number>();
  for (const request of returns) for (const line of request.restockedLines ?? []) {
    const key = `${String(request.orderId)}:${String(line.productId)}:${id(line.variantId) ?? ""}`;
    restocked.set(key, (restocked.get(key) ?? 0) + Math.max(0, Number(line.quantity ?? 0)));
  }
  return { orders, recognized, standingCogs, restocked };
}

const dispatchCache = new Map<string, string[]>();
async function dispatchFor(ownerId: string) {
  if (!dispatchCache.has(ownerId)) {
    const { fulfillmentCandidatesForVendor } = await import("@/lib/locations/fulfillment-location");
    dispatchCache.set(ownerId, (await fulfillmentCandidatesForVendor(ownerId)).map((candidate) => candidate.id));
  }
  return dispatchCache.get(ownerId)!;
}

type CutoverProduct = FinancialProduct & { name?: string; inventoryFinanceGeneration?: number };
const PRODUCT_FIELDS = "name sku vendorId cost stock inventory shipping inventoryFinanceGeneration inventoryFinanceCurrency locationInventory variants._id variants.name variants.sku variants.cost variants.stock variants.locationInventory";

/** Legacy Inventory entries (not movements, funding or earlier corrections) per owner. */
async function residuals(currency: string, owners: string[]): Promise<{ residuals: CutoverResidual[]; funding: number; ledgerBefore: number }> {
  const entries = await financeQuery(LedgerEntry.find({ book: LEDGER_BOOK.OWN, currency, $or: [{ debit: LEDGER_ACCOUNT.INVENTORY }, { credit: LEDGER_ACCOUNT.INVENTORY }] })
    .select("key debit credit amount currency vendorId source.kind")).lean<Array<{ key: string; debit: string; credit: string; amount: number; currency: string; vendorId?: unknown; source: { kind: string } }>>();
  const ledgerBefore = inventoryLedgerEffect(entries as unknown as LedgerPosting[], currency);
  const funding = inventoryLedgerEffect(entries.filter((e) => e.source.kind === LEDGER_SOURCE_KIND.EXPENSE) as unknown as LedgerPosting[], currency);
  const byOwner = new Map<string, { legacy: typeof entries; previous: typeof entries }>();
  for (const entry of entries) {
    if (entry.source.kind === LEDGER_SOURCE_KIND.INVENTORY_MOVEMENT || entry.source.kind === LEDGER_SOURCE_KIND.EXPENSE) continue;
    const owner = entry.vendorId && owners.includes(String(entry.vendorId)) ? String(entry.vendorId) : owners[0]!;
    const bucket = byOwner.get(owner) ?? { legacy: [], previous: [] };
    (entry.source.kind === LEDGER_SOURCE_KIND.INVENTORY_RECONCILIATION ? bucket.previous : bucket.legacy).push(entry);
    byOwner.set(owner, bucket);
  }
  const list: CutoverResidual[] = [];
  for (const [ownerId, bucket] of byOwner) {
    const legacyEffect = inventoryLedgerEffect(bucket.legacy as unknown as LedgerPosting[], currency);
    const previousCorrections = inventoryLedgerEffect(bucket.previous as unknown as LedgerPosting[], currency);
    const amount = inventoryMoney(-(legacyEffect + previousCorrections), currency);
    list.push({ ownerId, legacyEffect, previousCorrections, amount: Object.is(amount, -0) ? 0 : amount, entryKeys: bucket.legacy.map((e) => e.key).sort() });
  }
  return { residuals: list, funding, ledgerBefore };
}

/**
 * Read-only: what an apply would do now. Writes nothing, so it is safe on a
 * live store — the plan it prints is the review step before `apply`.
 */
export async function auditInventoryCutover(options: { currency?: string } = {}): Promise<CutoverPlan> {
  const settings = await getSettings();
  const currency = (options.currency ?? settings.general?.defaultCurrency ?? "USD").toUpperCase();
  const owners = [...await getDefaultVendorIds()];
  const transactions = await getTransactionSupport();
  const blockers: CutoverIssue[] = [], warnings: CutoverIssue[] = [];
  if (!transactions.supported) blockers.push({ code: "TRANSACTIONS_UNAVAILABLE", message: `Synchronized inventory needs a MongoDB replica set: ${transactions.reason ?? "transactions are unavailable"}.` });

  const ownerIds = owners.map((o) => new Types.ObjectId(o));
  const legacy = await Product.find({ vendorId: { $in: ownerIds }, inventoryFinanceGeneration: { $exists: false } }).select(PRODUCT_FIELDS).lean<CutoverProduct[]>();
  const physical = legacy.filter((p) => physicalFinancialProduct(p));
  const nonphysical = legacy.filter((p) => !physicalFinancialProduct(p));
  for (const p of nonphysical) blockers.push({ code: "NONPHYSICAL_PRODUCT", productId: String(p._id), message: `${p.name ?? "A product"} is digital or untracked; this cutover does not move those yet.` });

  const ids = physical.map((p) => p._id as Types.ObjectId);
  const [inputs, pendingOps, holds, transfers, ledger] = await Promise.all([
    productInputs(ids),
    FinanceOperation.countDocuments({ state: { $in: ["pending", "conflict"] }, action: /^inventory:/ }),
    CheckoutAttempt.countDocuments({ "stockHold.heldAt": { $ne: null }, "stockHold.releasedAt": null, "stockHold.lines.productId": { $in: ids.map(String) } }),
    Transfer.countDocuments({ status: { $in: ["ready_to_ship", "in_transit"] }, "items.productId": { $in: ids.map(String) } }),
    residuals(currency, owners),
  ]);
  if (pendingOps) blockers.push({ code: "PENDING_INVENTORY_POSTINGS", message: `${pendingOps} inventory postings are pending or in conflict; finish them first.` });
  if (holds) blockers.push({ code: "CHECKOUT_HOLDS", message: `${holds} checkouts are holding stock right now; retry once they finish or expire.` });
  if (transfers) blockers.push({ code: "TRANSFERS_IN_PROGRESS", message: `${transfers} stock transfers are ready to ship or in transit; receive or cancel them first.` });
  if (Math.abs(ledger.funding) > 0.005) blockers.push({ code: "LEGACY_STOCK_FUNDING", message: `Stock purchases worth ${ledger.funding} ${currency} were recorded as expenses before the cutover; decide whether they paid for the opening stock before applying.` });

  const products: ProductCutover[] = [];
  for (const product of physical) {
    const relevant = inputs.orders.filter((o) => [...(o.subOrders ?? []).flatMap((s) => s.items ?? []), ...(o.items ?? [])].some((item) => String(item.productId) === String(product._id)));
    products.push(planProductCutover({ product, currency, orders: relevant, recognized: inputs.recognized, standingCogs: inputs.standingCogs, restocked: inputs.restocked, dispatch: await dispatchFor(String(product.vendorId)) }));
  }
  for (const p of products) { blockers.push(...p.blockers); warnings.push(...p.warnings); }

  const bookValue = inventoryMoney(products.reduce((sum, p) => sum + p.rows.reduce((s, r) => s + r.value, 0), 0), currency);
  const residualTotal = ledger.residuals.reduce((sum, r) => sum + r.amount, 0);
  const totals = {
    products: products.length,
    positions: products.reduce((sum, p) => sum + p.rows.length, 0),
    units: products.reduce((sum, p) => sum + p.rows.reduce((s, r) => s + r.available + r.reserved, 0), 0),
    reservedUnits: products.reduce((sum, p) => sum + p.rows.reduce((s, r) => s + r.reserved, 0), 0),
    missingCostUnits: products.reduce((sum, p) => sum + p.rows.reduce((s, r) => s + (r.cost === null ? r.available + r.reserved : 0), 0), 0),
    bookValue,
    ledgerBefore: ledger.ledgerBefore,
    ledgerAfter: inventoryMoney(ledger.ledgerBefore + bookValue + residualTotal, currency),
    adoptedLines: products.reduce((sum, p) => sum + p.adopt.length, 0),
    stampedLines: products.reduce((sum, p) => sum + p.reserve.length + p.stamp.length, 0),
  };
  const fingerprint = hash({ currency, products: products.map((p) => [p.productId, p.rows, p.reserve, p.stamp, p.adopt]), residuals: ledger.residuals, blockers: blockers.map((b) => b.code) });
  return { currency, fingerprint, generatedAt: new Date().toISOString(), transactions: { supported: transactions.supported, reason: transactions.reason }, products, residuals: ledger.residuals, blockers, warnings, totals };
}

export interface CutoverResult {
  migrated: Array<{ productId: string; name: string; positions: number; value: number }>;
  skipped: Array<{ productId: string; reason: string }>;
  residualOperations: string[];
  operations: { total: number; complete: number; pending: number };
}

/** Moves one product inside its own transaction, from a plan re-read under that transaction. */
async function migrateProduct(productId: Types.ObjectId, currency: string, actorId: string, operationIds: string[]): Promise<{ plan: ProductCutover } | { skipped: string }> {
  return financeTransaction("Inventory cutover", async () => {
    const product = await financeQuery(Product.findById(productId).select(PRODUCT_FIELDS)).lean<CutoverProduct | null>();
    if (!product) return { skipped: "product no longer exists" };
    if (product.inventoryFinanceGeneration) return { skipped: "already synchronized" };
    if (!physicalFinancialProduct(product)) return { skipped: "not a tracked physical product" };
    const inputs = await productInputs([productId]);
    const plan = planProductCutover({ product, currency, orders: inputs.orders, recognized: inputs.recognized, standingCogs: inputs.standingCogs, restocked: inputs.restocked, dispatch: await dispatchFor(String(product.vendorId)) });
    if (plan.blockers.length) throw new Error(`${plan.name}: ${plan.blockers.map((b) => b.message).join(" ")}`);
    const session = financeSession();

    // Flag first: the write makes any concurrent stock change on this product
    // conflict with this transaction instead of slipping past the snapshot.
    const flagged = await Product.collection.updateOne(
      { _id: productId, inventoryFinanceGeneration: { $exists: false } },
      { $set: { inventoryFinanceGeneration: 1, inventoryFinanceCurrency: currency } },
      { session },
    );
    if (flagged.modifiedCount !== 1) throw new Error(`${plan.name} changed during the cutover; run it again.`);

    const movementByPosition = new Map<string, string>();
    for (const row of plan.rows) {
      const scope = { ownerId: plan.ownerId, productId: plan.productId, variantId: row.variantId, locationId: row.locationId, currency };
      const owned = row.available + row.reserved;
      const op = await runInventoryMutation({
        scope, actorId, channel: "migration", reason: "historical_reconciliation",
        requestKey: `cutover:${plan.productId}:${row.variantId ?? "main"}:${row.locationId ?? "unassigned"}`,
        fingerprint: { owned, reserved: row.reserved, cost: row.cost }, expectedVersion: 0, allowInitialize: true,
        occurredAt: new Date(), generatedDate: true, productName: plan.name, variantName: row.variantName, sku: row.sku,
        note: "Opening balance from the inventory cutover", source: { kind: "inventory_cutover", id: plan.productId, reference: "Inventory cutover" },
        physicalQuantityDelta: 0, financialState: "owned_available",
        plan: (_, event) => ({
          change: {
            quantityDelta: owned, valueDelta: row.value,
            stateDeltas: { availableOwned: row.available, reservedUncosted: row.reserved },
            ...(row.cost !== null ? { newUnitCost: row.cost } : {}),
            missingCostQuantity: row.cost === null ? owned : 0,
          },
          postings: row.cost === null || owned === 0 ? [] : openingInventoryPostings(event, owned, row.cost),
        }),
      });
      operationIds.push(op.operationId);
      movementByPosition.set(inventoryPositionKey(scope), (op.data as { movementId: string }).movementId);
    }

    // Unpaid lines: stamped (both the consignment's line and the order's), the
    // missing cost snapshot filled, and held units reserved where a restore
    // would put them back.
    const stamps = new Map<string, Record<string, unknown>>();
    const set = (orderId: string, path: string, value: unknown) => {
      const fields = stamps.get(orderId) ?? {};
      fields[path] = value; stamps.set(orderId, fields);
    };
    for (const line of [...plan.reserve, ...plan.stamp]) {
      set(line.orderId, `subOrders.${line.subIndex}.items.${line.itemIndex}.inventoryFinanceGeneration`, 1);
      set(line.orderId, `subOrders.${line.subIndex}.items.${line.itemIndex}.inventoryLineId`, line.lineId);
      if (line.fillCost !== null) set(line.orderId, `subOrders.${line.subIndex}.items.${line.itemIndex}.cost`, line.fillCost);
      if (line.orderItemIndex !== null) {
        set(line.orderId, `items.${line.orderItemIndex}.inventoryFinanceGeneration`, 1);
        set(line.orderId, `items.${line.orderItemIndex}.inventoryLineId`, line.lineId);
        if (line.fillCost !== null) set(line.orderId, `items.${line.orderItemIndex}.cost`, line.fillCost);
      }
    }
    for (const [orderId, fields] of stamps) await Order.collection.updateOne({ _id: new Types.ObjectId(orderId) }, { $set: fields }, { session });
    if (plan.reserve.length) await InventoryReservation.create(plan.reserve.map((line) => {
      const positionKey = inventoryPositionKey({ ownerId: plan.ownerId, productId: plan.productId, variantId: line.variantId, locationId: line.locationId, currency });
      return { key: `cutover:${line.orderId}:${line.subOrderId}:${line.lineId}:${positionKey}`, sourceKind: "order", sourceId: line.orderId, productId: plan.productId, variantId: line.variantId, positionKey, quantity: line.quantity, requestedQuantity: line.quantity };
    }), { session, ordered: true });

    // Sold lines whose cost the legacy path booked: one allocation each, so a
    // restock reverses exactly that cost once.
    if (plan.adopt.length) await InventorySaleAllocation.create(plan.adopt.map((line) => {
      const positionKey = inventoryPositionKey({ ownerId: plan.ownerId, productId: plan.productId, variantId: line.variantId, locationId: line.locationId, currency });
      const movementId = new Types.ObjectId(movementByPosition.get(positionKey)!);
      return {
        key: `cutover:${line.orderId}:${line.subOrderId}:${line.lineId}:${positionKey}:${line.cycle}`,
        ownerId: plan.ownerId, orderId: line.orderId, subOrderId: line.subOrderId, lineId: line.lineId, cycle: line.cycle,
        productId: plan.productId, variantId: line.variantId, positionKey, currency,
        quantity: line.quantity, allocatedQuantity: line.quantity, costedQuantity: line.quantity, restoredQuantity: line.restored,
        unitCost: line.unitCost, carryingValueRemoved: line.costOfGoods, costOfGoods: line.costOfGoods,
        segments: [{ movementId, quantity: line.quantity, carryingValue: line.costOfGoods, costOfGoods: line.costOfGoods, restoredQuantity: line.restored }],
        generation: 0,
      };
    }), { session, ordered: true });
    return { plan };
  });
}

/** One correction per owner: what the legacy paths left in the Inventory account, offset. */
async function postResidual(residual: CutoverResidual, currency: string, actorId: string) {
  if (Math.abs(residual.amount) < 0.005) return null;
  const evidence = hash(residual.entryKeys);
  const key = `inventory-cutover:${residual.ownerId}:${currency}:${evidence}`.toLowerCase();
  const op = await runFinanceOperation({
    action: "inventory:cutover-correction", actorId, requestKey: `cutover-correction:${residual.ownerId}:${currency}:${evidence}`,
    fingerprint: { amount: residual.amount, entryKeys: residual.entryKeys },
    work: async () => ({
      result: { amount: residual.amount, entries: residual.entryKeys.length },
      vendorId: residual.ownerId,
      postings: [{
        date: new Date(), book: LEDGER_BOOK.OWN,
        debit: residual.amount > 0 ? LEDGER_ACCOUNT.INVENTORY : LEDGER_ACCOUNT.OPENING_INVENTORY_EQUITY,
        credit: residual.amount > 0 ? LEDGER_ACCOUNT.OPENING_INVENTORY_EQUITY : LEDGER_ACCOUNT.INVENTORY,
        amount: Math.abs(residual.amount), currency, vendorId: residual.ownerId, key,
        source: { kind: LEDGER_SOURCE_KIND.INVENTORY_RECONCILIATION, id: null, ref: "Inventory cutover" },
        note: `Offsets ${residual.entryKeys.length} inventory entries posted before the store's stock had opening balances`,
      }],
    }),
  });
  return op.operationId;
}

/**
 * Apply the cutover. Re-audits first and refuses on any blocker; then moves
 * each product in its own transaction (each re-plans from that transaction's
 * snapshot, so a sale between audit and apply is never lost), posts the
 * per-owner correction, and finishes every posting it created.
 */
export async function applyInventoryCutover(options: { actorId?: string; currency?: string; expectFingerprint?: string; onProgress?: (message: string) => void } = {}): Promise<CutoverResult & { plan: CutoverPlan }> {
  const actorId = options.actorId ?? "inventory-cutover";
  const plan = await auditInventoryCutover({ currency: options.currency });
  if (plan.blockers.length) throw Object.assign(new Error(`The cutover is blocked: ${plan.blockers.map((b) => b.message).join(" ")}`), { plan });
  if (options.expectFingerprint && options.expectFingerprint !== plan.fingerprint) throw Object.assign(new Error("The store changed since that audit; review a fresh audit before applying."), { plan });

  const migrated: CutoverResult["migrated"] = [], skipped: CutoverResult["skipped"] = [];
  const operationIds: string[] = [];
  for (const product of plan.products) {
    const outcome = await migrateProduct(new Types.ObjectId(product.productId), plan.currency, actorId, operationIds);
    if ("skipped" in outcome) { skipped.push({ productId: product.productId, reason: outcome.skipped }); continue; }
    migrated.push({ productId: product.productId, name: outcome.plan.name, positions: outcome.plan.rows.length, value: inventoryMoney(outcome.plan.rows.reduce((s, r) => s + r.value, 0), plan.currency) });
    options.onProgress?.(`${outcome.plan.name}: ${outcome.plan.rows.length} positions`);
  }

  // Re-read after every product moved: a legacy entry posted meanwhile is offset too.
  const { residuals: latest } = await residuals(plan.currency, [...await getDefaultVendorIds()]);
  const residualOperations: string[] = [];
  for (const residual of latest) {
    const opId = await postResidual(residual, plan.currency, actorId);
    if (opId) residualOperations.push(opId);
  }

  // Finish anything still pending (a post-commit effect that failed retries here).
  const all = [...operationIds, ...residualOperations];
  let complete = 0;
  for (const opId of all) if (await finishFinanceOperation(opId)) complete++;
  return { plan, migrated, skipped, residualOperations, operations: { total: all.length, complete, pending: all.length - complete } };
}
