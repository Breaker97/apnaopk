import "server-only";

import { cookies } from "next/headers";
import type { ISettingsData as ISettings } from "@/models/settings.model";
import { canApplyPosDiscount } from "@/lib/access/rbac";
import { posReceiptChannels } from "@/lib/pos/pos-receipt-delivery";
import { resolvePosOperator } from "@/lib/pos/operator";

/**
 * What one register seat may do, beside the store-wide POS settings.
 *
 * `buildPOSSettings` is the store's answer and is shared by every till; these
 * depend on who is working it, or on server-only facts (whether email is set
 * up) the browser cannot read. The three POS pages (admin, vendor, staff) all
 * spread this, so a new per-seat value is added here once rather than three
 * times.
 *
 * "Who is working it" is the colleague switched in with their PIN when there
 * is one (lib/pos/operator.ts), so a reload keeps the till theirs.
 */
export async function posSeatSettings(
  user: { id: string; role?: string | null; roles?: string[] | null; name?: string | null },
  settings: Pick<ISettings, "email" | "sms">,
) {
  const operator = await resolvePosOperator(
    { id: user.id, role: user.role ?? null, roles: user.roles ?? null, name: user.name ?? null },
    await cookies(),
  );
  return {
    canApplyDiscounts: await canApplyPosDiscount({
      id: operator.id,
      role: operator.role ?? undefined,
      roles: (operator.roles ?? undefined) as string[] | undefined,
    }),
    receiptChannels: posReceiptChannels(settings),
    cashierId: operator.id,
    cashierName: operator.name ?? undefined,
    cashierSwitched: operator.id !== user.id,
  };
}
