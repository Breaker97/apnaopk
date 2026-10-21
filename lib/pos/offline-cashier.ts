import "server-only";

import { Types } from "mongoose";
import { User } from "@/models";
import { canAccessPOS } from "@/lib/access/rbac";
import { resolveLocationScope } from "@/lib/inventory/inventory-location-scope";
import { USER_ACCOUNT_STATUS } from "@/config/app.config";

/**
 * Who rang up a replayed offline sale.
 *
 * The outbox survives a sign-out on purpose — the next person to open the
 * register sends the previous shift's takings — so the session replaying a sale
 * is often not the cashier who took it. Stamping the sale with the replaying
 * session named the wrong person under "Sold by" on every such order. The
 * terminal now queues the cashier's id alongside the sale, and that id is used
 * when it stands up.
 *
 * "Stands up": the account still exists, may use the register, and sells for
 * the same merchant as the session doing the replay. Anything else falls back
 * to the session user, never to a refusal — attribution is secondary to
 * recording a sale whose money is already in the drawer. Within those bounds a
 * cashier could name a colleague, which is the same trust the session already
 * carries when it names a counter.
 */
export async function resolveOfflineCashier(params: {
  cashierId?: string;
  sessionUserId: string;
  /** The merchant the replaying session sells for, from `resolveLocationScope`. */
  vendorScopeId: string | null | undefined;
}): Promise<string> {
  const { sessionUserId, vendorScopeId } = params;
  const cashierId = String(params.cashierId ?? "").trim();

  if (!cashierId || cashierId === sessionUserId) return sessionUserId;
  const cashier = await loadMerchantCashier(cashierId, vendorScopeId);
  return cashier ? cashier.id : sessionUserId;
}

export interface MerchantCashier {
  id: string;
  name?: string;
  email?: string;
  role?: string;
  roles?: string[];
}

/**
 * The account, when it is one of this merchant's cashiers: it exists, may use
 * the register, and sells for the same merchant (`vendorScopeId`, "" or null
 * for the store's own). Null otherwise. Shared by the offline replay above and
 * the cashier switch (lib/pos/operator.ts) — one answer to "who may stand at
 * this till".
 */
export async function loadMerchantCashier(
  userId: string,
  vendorScopeId: string | null | undefined,
  options: {
    /**
     * Refuse a deactivated account. The switch asks it; a replay does not —
     * the sale was rung up before the account was switched off, by them.
     */
    requireActive?: boolean;
  } = {},
): Promise<MerchantCashier | null> {
  if (!Types.ObjectId.isValid(userId)) return null;
  const cashier = await User.findById(userId)
    .select("name email role roles status")
    .lean<{ name?: string; email?: string; role?: string; roles?: string[]; status?: string } | null>();
  if (!cashier) return null;
  if (options.requireActive && cashier.status && cashier.status !== USER_ACCOUNT_STATUS.ACTIVE) return null;

  const user = { id: userId, role: cashier.role, roles: cashier.roles };
  if (!(await canAccessPOS(user))) return null;

  try {
    const scope = await resolveLocationScope(user, "write");
    if (String(scope.vendorId ?? "") !== String(vendorScopeId ?? "")) return null;
  } catch {
    // No scope to sell in (a vendor whose approval lapsed, a staff seat with
    // nothing assigned): not this merchant's cashier any more.
    return null;
  }
  return { id: userId, name: cashier.name, email: cashier.email, role: cashier.role, roles: cashier.roles };
}
