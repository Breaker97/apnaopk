import "server-only";

import { Types } from "mongoose";
import { User } from "@/models";
import type { IPosRegisterSession } from "@/models/pos-register-session.model";
import type { RegisterSessionTotals } from "@/lib/pos/register-session";

/** A register session as the till shows it, with people named. */
export async function registerSessionView(
  session: IPosRegisterSession,
  totals: RegisterSessionTotals | null,
) {
  const ids = [
    session.openedBy,
    session.closedBy,
    ...session.cashEvents.map((event) => event.by),
  ].filter((id): id is string => Boolean(id) && Types.ObjectId.isValid(String(id)));
  const users = ids.length
    ? await User.find({ _id: { $in: [...new Set(ids)] } })
        .select("name")
        .lean<Array<{ _id: unknown; name?: string }>>()
    : [];
  const name = (id?: string) => users.find((user) => String(user._id) === id)?.name || undefined;
  return {
    _id: String(session._id),
    number: session.number,
    status: session.status,
    terminalId: session.terminalId,
    locationId: session.locationId || undefined,
    currency: session.currency,
    openedAt: new Date(session.openedAt).toISOString(),
    openedBy: name(session.openedBy),
    openingFloat: session.openingFloat,
    cashEvents: session.cashEvents.map((event) => ({
      kind: event.kind,
      amount: event.amount,
      reason: event.reason,
      at: new Date(event.at).toISOString(),
      by: name(event.by),
      returnNumber: event.returnNumber,
    })),
    closedAt: session.closedAt ? new Date(session.closedAt).toISOString() : undefined,
    closedBy: name(session.closedBy),
    closing: session.closing ?? undefined,
    totals: totals ?? undefined,
  };
}

export type RegisterSessionView = Awaited<ReturnType<typeof registerSessionView>>;
