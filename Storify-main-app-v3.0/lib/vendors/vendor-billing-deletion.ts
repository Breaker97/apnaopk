import { ValidationError } from "@/lib/api/errors";
import { isTerminalStripeSubscriptionStatus } from "@/lib/vendors/vendor-billing-state";
import {
  VENDOR_APPLICATION_PAYMENT_STATUS,
  VENDOR_APPLICATION_STATUS,
  VENDOR_SUBSCRIPTION_STATUS,
} from "@/config/app.config";

interface VendorBillingDeletionState {
  provider?: string | null;
  providerSubscriptionId?: string | null;
  providerStatus?: string | null;
}

export function assertVendorBillingTerminalForDeletion(
  state: VendorBillingDeletionState,
): void {
  if (state.provider !== "stripe" || !state.providerSubscriptionId) return;
  if (
    state.providerStatus &&
    isTerminalStripeSubscriptionStatus(state.providerStatus)
  ) {
    return;
  }
  throw new ValidationError(
    "Cancel the Stripe subscription and wait for a terminal provider state before deleting this vendor",
  );
}

export const VENDOR_DELETED_REASON = "Vendor deleted";

interface VendorBillingRetirementDependencies {
  retireSubscriptions(patch: Record<string, unknown>): Promise<number>;
  retireApplications(patch: Record<string, unknown>): Promise<number>;
}

interface VendorBillingRetirementSummary {
  subscriptions: number;
  applications: number;
}

/**
 * Retire a deleted vendor's billing rows.
 *
 * The rows are kept, not dropped: `VendorSubscriptionPayment` is the financial
 * record and its parents give it meaning, so deleting them would strip the audit
 * trail. What must not survive is the vendor's ACTIVE billing state — above all
 * `occupiesActiveSlot`, whose partial unique index enforces "one live
 * subscription per vendor". Left set, an orphan keeps counting in plan reporting
 * and can be re-adopted if the same user applies again.
 *
 * Deletion is already blocked while Stripe is live
 * (`assertVendorBillingTerminalForDeletion`), so this never abandons a
 * subscription that is still billing.
 */
export async function retireVendorBillingRecords(
  dependencies: VendorBillingRetirementDependencies,
): Promise<VendorBillingRetirementSummary> {
  const [subscriptions, applications] = await Promise.all([
    dependencies.retireSubscriptions({
      status: VENDOR_SUBSCRIPTION_STATUS.CANCELLED,
      occupiesActiveSlot: false,
      pendingPlanId: null,
      pendingPlanSnapshot: null,
      pendingCommissionRateSnapshot: null,
      pendingChangeType: null,
      pendingChangeStatus: null,
      nextRetryAt: null,
      lastReconcileError: VENDOR_DELETED_REASON,
    }),
    dependencies.retireApplications({
      status: VENDOR_APPLICATION_STATUS.REJECTED,
      paymentStatus: VENDOR_APPLICATION_PAYMENT_STATUS.EXPIRED,
      lastError: VENDOR_DELETED_REASON,
    }),
  ]);
  return { subscriptions, applications };
}
