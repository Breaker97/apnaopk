/** Shared validation and transition policy; contains no server dependencies. */
export const PAYOUT_ACCOUNTS = ["bank", "cash", "gateway"] as const;
export const PAYOUT_REFERENCE_MAX = 120;
export const PAYOUT_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["pending", "processing", "paid", "cancelled"],
  processing: ["processing", "paid", "failed", "cancelled"],
  paid: ["paid", "failed"], failed: ["failed"], cancelled: ["cancelled"],
};
