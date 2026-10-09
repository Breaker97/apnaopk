import type { POSCartItem, POSCustomer } from "@/components/pos/pos-types";
import type { POSDiscount } from "@/components/pos/discount-dialog";

/**
 * A parked ("held") POS sale. Persisted in localStorage so it survives serving
 * another customer, a page reload, or an accidental navigation — previously the
 * cart was simply cleared and the in-progress sale was lost with no way back.
 *
 * Scope is intentionally the browser/register: a held order is a physical
 * counter concept ("Table 5, back in a minute"), not shared server state.
 */
export interface HeldOrder {
  id: string;
  label: string;
  heldAt: string;
  cart: POSCartItem[];
  customer: POSCustomer | null;
  isWalkIn: boolean;
  orderNote: string;
  discount: POSDiscount | null;
}

const STORAGE_PREFIX = "pos:held-orders";
const MAX_HELD_ORDERS = 50;
// Bump when HeldOrder/POSCartItem shape changes incompatibly — stale persisted
// entries are dropped rather than resumed as malformed cart lines.
const SCHEMA_VERSION = 1;

/**
 * Holds are scoped to the POS location. Sharing one key across locations meant
 * a cashier at one counter saw — and could resume — sales parked at another,
 * restoring line items priced and stocked for a different store.
 */
export function heldOrdersScope(locationId?: string | null): string {
  return locationId ? `${STORAGE_PREFIX}:${locationId}` : STORAGE_PREFIX;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function getHeldOrders(scope: string = STORAGE_PREFIX): HeldOrder[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(scope);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed?.version !== SCHEMA_VERSION || !Array.isArray(parsed.orders)) {
      return [];
    }
    return parsed.orders.filter(
      (entry: unknown): entry is HeldOrder =>
        !!entry &&
        typeof (entry as HeldOrder).id === "string" &&
        Array.isArray((entry as HeldOrder).cart),
    );
  } catch {
    return [];
  }
}

/**
 * Throws when the sale could not be persisted. Callers clear the cart on the
 * strength of a successful hold, so swallowing a quota/private-mode failure
 * here destroyed the sale while telling the cashier it was safely parked.
 */
function writeHeldOrders(orders: HeldOrder[], scope: string): void {
  if (!isBrowser()) {
    throw new Error("Held orders are unavailable in this environment.");
  }
  window.localStorage.setItem(
    scope,
    JSON.stringify({
      version: SCHEMA_VERSION,
      orders: orders.slice(0, MAX_HELD_ORDERS),
    }),
  );
}

export function saveHeldOrder(
  order: Omit<HeldOrder, "id" | "heldAt">,
  scope: string = STORAGE_PREFIX,
): HeldOrder {
  const entry: HeldOrder = {
    ...order,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `held_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    heldAt: new Date().toISOString(),
  };
  // Newest first so the resume list shows the most recent hold on top.
  const next = [entry, ...getHeldOrders(scope)];
  if (next.length > MAX_HELD_ORDERS) {
    throw new Error(
      `This register already has ${MAX_HELD_ORDERS} held orders. Resume or delete one first.`,
    );
  }
  writeHeldOrders(next, scope);
  return entry;
}

/**
 * Reads the register's holds, adopting any parked under the pre-scoping key so
 * the move to per-location storage does not strand sales a cashier already
 * has on the counter.
 */
export function loadHeldOrders(scope: string = STORAGE_PREFIX): HeldOrder[] {
  const scoped = getHeldOrders(scope);
  if (!isBrowser() || scope === STORAGE_PREFIX || scoped.length > 0) {
    return scoped;
  }

  const legacy = getHeldOrders(STORAGE_PREFIX);
  if (legacy.length === 0) return scoped;

  try {
    writeHeldOrders(legacy, scope);
    window.localStorage.removeItem(STORAGE_PREFIX);
    return legacy;
  } catch (err) {
    console.error("Failed to migrate held POS orders to this register:", err);
    return scoped;
  }
}

export function removeHeldOrder(
  id: string,
  scope: string = STORAGE_PREFIX,
): HeldOrder[] {
  const next = getHeldOrders(scope).filter((order) => order.id !== id);
  try {
    writeHeldOrders(next, scope);
  } catch (err) {
    // A failed delete is recoverable (the entry simply stays), unlike a failed
    // hold — surface it in the console rather than blocking the register.
    console.error("Failed to remove held POS order:", err);
    return getHeldOrders(scope);
  }
  return next;
}
