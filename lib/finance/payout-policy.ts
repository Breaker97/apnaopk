/** Shared validation and transition policy; contains no server dependencies. */
export const PAYOUT_ACCOUNTS = ["bank", "cash", "gateway"] as const;
export const PAYOUT_REFERENCE_MAX = 120;
export const PAYOUT_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["pending", "processing", "paid", "cancelled"],
  processing: ["processing", "paid", "failed", "cancelled"],
  paid: ["paid", "failed"], failed: ["failed"], cancelled: ["cancelled"],
};

/** What identifies one change to a payout, so a retry of it can be recognised. */
export const payoutUpdateAction = (id: string) => `payout:update:${id}`;
export const payoutUpdateFingerprint = (input: { status?: string; note?: string; paidFrom?: string; paymentReference?: string; reversedAt?: string; expectedVersion: number }) =>
  ({ status: input.status, note: input.note, paidFrom: input.paidFrom, paymentReference: input.paymentReference, reversedAt: input.reversedAt, version: input.expectedVersion });
