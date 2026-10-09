import { ORDER_STATUS } from "@/config/app.config";

/**
 * Which consignments a pre-order's balance request is about, and whether a
 * request still describes the order — pure, so the coordinator, the charge
 * guard, the screens and the migration report all read the same answer.
 *
 * Deliberately free of server imports: the pre-order tables read it too.
 */

/** Balance requests that are still live: announced, payable, or stuck on a person. */
export const ACTIVE_COLLECTION_STATES = [
  "notice_pending",
  "awaiting_payment",
  "attention",
] as const;

const PREORDER = "preorder";

type ScopeItem = {
  purchaseType?: string;
  quantity?: number;
  preorderOutstandingAmount?: number | null;
};

export type ScopeSubOrder = {
  _id?: unknown;
  vendorId?: unknown;
  status?: string;
  items?: ScopeItem[] | null;
  preorderReadiness?: { declaredAt?: Date | string | null } | null;
  preorderAllocation?: { state?: string } | null;
};

export type CollectionCycleShape = {
  cycleId?: string | null;
  state?: string | null;
  scopeSubOrderIds?: unknown[] | null;
  amount?: number | null;
  currency?: string | null;
  readinessRevision?: number | null;
};

const id = (value: unknown) =>
  String((value as { _id?: unknown } | null)?._id ?? value ?? "");

export function hasPreorderLines(sub: ScopeSubOrder): boolean {
  return (sub.items || []).some(
    (item) => item?.purchaseType === PREORDER && Number(item.quantity ?? 1) > 0,
  );
}

/**
 * The live, unreleased pre-order consignments: still `preordered` and holding
 * pre-order lines. A cancelled one is owed nothing and blocks nothing; one
 * already released (or shipped) is past the pre-order and is never moved
 * again by a balance request — which is what keeps a partly fulfilled legacy
 * order from being treated as a fresh batch.
 */
export function collectionScope<T extends ScopeSubOrder>(order: {
  subOrders?: T[] | null;
}): T[] {
  return (order.subOrders || []).filter(
    (sub) => sub?.status === ORDER_STATUS.PREORDERED && hasPreorderLines(sub),
  );
}

export function isConsignmentReady(sub: ScopeSubOrder): boolean {
  return Boolean(sub.preorderReadiness?.declaredAt);
}

export function isActiveCollection(
  cycle: CollectionCycleShape | null | undefined,
): cycle is CollectionCycleShape & { cycleId: string } {
  return Boolean(
    cycle?.cycleId &&
      (ACTIVE_COLLECTION_STATES as readonly string[]).includes(String(cycle.state || "")),
  );
}

/**
 * Where an order's consignments stand, as one party may be told it.
 *
 * `vendorId` narrows `own*` to that seller; everyone else is only a count —
 * a vendor learns that others are still waiting, never who they are or what
 * they hold.
 */
export function readinessSummary(
  order: { subOrders?: ScopeSubOrder[] | null },
  vendorId?: string,
): {
  scopeCount: number;
  readyCount: number;
  waitingCount: number;
  ownInScope: boolean;
  ownReady: boolean;
  /** Consignments other than this vendor's still waiting on their goods. */
  othersWaiting: number;
} {
  const scope = collectionScope(order);
  const ready = scope.filter(isConsignmentReady);
  const own = vendorId ? scope.filter((sub) => id(sub.vendorId) === vendorId) : [];
  return {
    scopeCount: scope.length,
    readyCount: ready.length,
    waitingCount: scope.length - ready.length,
    ownInScope: own.length > 0,
    ownReady: own.length > 0 && own.every(isConsignmentReady),
    othersWaiting: scope.filter(
      (sub) => (!vendorId || id(sub.vendorId) !== vendorId) && !isConsignmentReady(sub),
    ).length,
  };
}

export type CycleMismatch =
  | "scope_changed"
  | "amount_changed"
  | "currency_changed"
  | "readiness_changed";

/**
 * Whether a balance request still describes the order: the same live scope,
 * the same amount in the same currency, the same readiness. Anything else and
 * it can no longer authorise a charge — the coordinator replaces it with a new
 * one (and a new notice), the charge guard refuses it.
 */
export function cycleMismatch(
  order: {
    subOrders?: ScopeSubOrder[] | null;
    preorderReadinessRevision?: number | null;
    currency?: string | null;
  },
  cycle: CollectionCycleShape,
  balanceDue: number,
  currency: string,
): CycleMismatch | null {
  const scope = collectionScope(order).map((sub) => id(sub._id)).sort();
  const covered = (cycle.scopeSubOrderIds || []).map(id).sort();
  if (scope.length !== covered.length || scope.some((value, index) => value !== covered[index])) {
    return "scope_changed";
  }
  if (Math.round(Number(cycle.amount || 0) * 100) !== Math.round(balanceDue * 100)) {
    return "amount_changed";
  }
  if (String(cycle.currency || "").toUpperCase() !== currency.toUpperCase()) {
    return "currency_changed";
  }
  if (Number(cycle.readinessRevision || 0) !== Number(order.preorderReadinessRevision || 0)) {
    return "readiness_changed";
  }
  return null;
}

/**
 * When a saved card may first be charged for the open balance request — the
 * moment the advance notice window ends — or null when no automatic charge is
 * scheduled (no saved card, the notice not delivered yet or undeliverable,
 * the request paid or withdrawn). The daily job may charge later, never
 * earlier, so screens say "on or after".
 */
export function preorderAutoChargeAt(order: {
  preorderCollection?: {
    state?: string | null;
    autoCharge?: boolean | null;
    chargeNotBefore?: Date | string | null;
  } | null;
}): Date | null {
  const cycle = order.preorderCollection;
  if (!cycle || cycle.state !== "awaiting_payment" || !cycle.autoCharge) return null;
  if (!cycle.chargeNotBefore) return null;
  const at = new Date(cycle.chargeNotBefore);
  return Number.isNaN(at.getTime()) ? null : at;
}
