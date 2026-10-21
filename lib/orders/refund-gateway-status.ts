/**
 * What a gateway's refund status says about the money: sent, on its way, or not.
 *
 * Each gateway words it differently, and a refund can be accepted long before
 * the money lands — Razorpay and Paystack answer "pending" for days. The words
 * that mean the refund is DONE are the only ones that settle anything; every
 * other word a gateway can give a refund that was not refused is "still on its
 * way". Written once here, because the refund routes, the mobile refund and the
 * webhook that closes a pending refund must all agree on it.
 */

/** Per provider, the statuses that mean the refund has been sent, and those that mean it never will be. */
export const GATEWAY_REFUND_VOCABULARY: Readonly<
  Record<string, { succeeded: readonly string[]; failed: readonly string[] }>
> = {
  stripe: { succeeded: ["succeeded"], failed: ["failed", "canceled"] },
  paypal: { succeeded: ["completed"], failed: ["failed", "cancelled"] },
  razorpay: { succeeded: ["processed"], failed: ["failed"] },
  paystack: { succeeded: ["processed"], failed: ["failed"] },
};

const vocabularyOf = (provider: unknown) => {
  const key = String(provider || "").toLowerCase();
  return Object.hasOwn(GATEWAY_REFUND_VOCABULARY, key) ? GATEWAY_REFUND_VOCABULARY[key] : undefined;
};

/** Whether this provider's status says the refund has been sent. */
export function gatewayRefundSettled(provider: unknown, status: unknown): boolean {
  const vocabulary = vocabularyOf(provider);
  return Boolean(vocabulary?.succeeded.includes(String(status || "").toLowerCase()));
}

/**
 * Whether a refund the gateway accepted is still on its way.
 *
 * Judged on every refund it raised when the answer names them (a pre-order's
 * deposit and balance are two), else on the one status it gave. A provider
 * this does not know, or an answer with no status at all, is not called
 * pending: nothing says it is, and a refund held "processing" with nothing to
 * ever settle it is worse than one called done.
 */
export function gatewayRefundPending(result: {
  provider?: string;
  status?: string;
  refundReports?: ReadonlyArray<{ provider?: string; status?: string }> | null;
}): boolean {
  const reports = result.refundReports || [];
  if (reports.length > 0) {
    return reports.some(
      (report) =>
        Boolean(vocabularyOf(report.provider ?? result.provider)) &&
        !gatewayRefundSettled(report.provider ?? result.provider, report.status),
    );
  }
  if (!vocabularyOf(result.provider) || !String(result.status || "").trim()) return false;
  return !gatewayRefundSettled(result.provider, result.status);
}

/**
 * Every gateway refund a recorded refund row stands for: its own id and the
 * extra ones a refund over two charges carries.
 *
 * A row recorded by hand carries the CHARGE's id as its external id, having no
 * refund id of its own until the gateway's report pairs one with it. A charge
 * never fails, so counted as a leg it made every such row look half-standing.
 */
export function refundRowLegIds(row: {
  externalId?: unknown;
  metadata?: { gatewayRefundIds?: unknown; chargeExternalId?: unknown } | null;
}): string[] {
  const extra = Array.isArray(row.metadata?.gatewayRefundIds)
    ? (row.metadata?.gatewayRefundIds as unknown[]).map(String)
    : [];
  const own =
    row.externalId &&
    String(row.externalId) !== String(row.metadata?.chargeExternalId || "")
      ? [String(row.externalId)]
      : [];
  return [...new Set([...own, ...extra])];
}
