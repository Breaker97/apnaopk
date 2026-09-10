import { ValidationError } from "@/lib/api/errors";

export const VENDOR_APPLICATION_CHECKOUT_KIND =
  "vendor_application_subscription";

interface CheckoutSubscriptionRow {
  id: string;
  applicationId: string | null;
}

interface VendorCheckoutSubscriptionBindingLookup {
  findByLocalSubscriptionId(
    localSubscriptionId: string,
  ): Promise<CheckoutSubscriptionRow | null>;
  findEstablishedBindings(
    checkoutSessionId: string,
    providerSubscriptionId: string | null,
    limit: number,
  ): Promise<CheckoutSubscriptionRow[]>;
  findIncompleteByApplicationId(
    applicationId: string,
    limit: number,
  ): Promise<CheckoutSubscriptionRow[]>;
}

export async function resolveVendorCheckoutSubscriptionBinding(
  input: {
    applicationId: string;
    localSubscriptionId: string | null;
    checkoutSessionId: string;
    providerSubscriptionId: string | null;
  },
  lookup: VendorCheckoutSubscriptionBindingLookup,
): Promise<CheckoutSubscriptionRow> {
  if (input.localSubscriptionId) {
    const local = await lookup.findByLocalSubscriptionId(
      input.localSubscriptionId,
    );
    return selectVendorCheckoutSubscription(
      local ? [local] : [],
      input.applicationId,
    );
  }

  const established = await lookup.findEstablishedBindings(
    input.checkoutSessionId,
    input.providerSubscriptionId,
    2,
  );
  if (established.length > 0) {
    return selectVendorCheckoutSubscription(
      established,
      input.applicationId,
    );
  }
  return selectVendorCheckoutSubscription(
    await lookup.findIncompleteByApplicationId(input.applicationId, 2),
    input.applicationId,
  );
}

interface ReusableVendorCheckoutSession {
  status: string | null;
  url: string | null;
  metadata?: Record<string, string> | null;
}

interface VendorCheckoutClaimState {
  applicationStatus: string | null;
  applicationPaymentStatus: string | null;
  applicationCheckoutSessionId: string | null;
  subscriptionStatus: string | null;
  subscriptionOccupiesActiveSlot: boolean;
  subscriptionCheckoutSessionId: string | null;
}

interface VendorCheckoutClaimInput {
  applicationId: string;
  vendorId: string;
  subscriptionId: string;
  expectedApplicationPaymentStatus: string;
  expectedApplicationCheckoutSessionId: string | null;
  expectedSubscriptionCheckoutSessionId: string | null;
  checkoutSessionId: string;
  applicationPatch: Record<string, unknown>;
  subscriptionPatch: Record<string, unknown>;
  subscriptionRollbackPatch: Record<string, unknown>;
}

interface VendorCheckoutUpdateResult {
  modifiedCount?: number;
}

interface VendorCheckoutClaimDependencies {
  updateSubscription(
    filter: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<VendorCheckoutUpdateResult>;
  updateApplication(
    filter: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<VendorCheckoutUpdateResult>;
  rollbackSubscription(
    filter: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<VendorCheckoutUpdateResult>;
  readCurrentState(): Promise<VendorCheckoutClaimState>;
}

interface VendorCheckoutClaimResult {
  claimed: boolean;
  state: VendorCheckoutClaimState;
}

interface VendorCheckoutSessionExpiryClient {
  retrieve(sessionId: string): Promise<{ status: string | null }>;
  expire(sessionId: string): Promise<unknown>;
}

export async function expireSupersededVendorCheckoutSession(
  client: VendorCheckoutSessionExpiryClient,
  sessionId: string,
): Promise<boolean> {
  const session = await client.retrieve(sessionId);
  if (session.status !== "open") return false;
  await client.expire(sessionId);
  return true;
}

export async function claimVendorCheckoutSession(
  input: VendorCheckoutClaimInput,
  dependencies: VendorCheckoutClaimDependencies,
): Promise<VendorCheckoutClaimResult> {
  const subscriptionClaim = await dependencies.updateSubscription(
    {
      _id: input.subscriptionId,
      vendorId: input.vendorId,
      applicationId: input.applicationId,
      provider: "stripe",
      status: "incomplete",
      occupiesActiveSlot: false,
      paymentProviderRef: null,
      stripeCheckoutSessionId:
        input.expectedSubscriptionCheckoutSessionId,
    },
    input.subscriptionPatch,
  );
  if ((subscriptionClaim.modifiedCount ?? 0) !== 1) {
    return {
      claimed: false,
      state: await dependencies.readCurrentState(),
    };
  }

  const applicationClaim = await dependencies.updateApplication(
    {
      _id: input.applicationId,
      vendorId: input.vendorId,
      status: "approved",
      paymentStatus: input.expectedApplicationPaymentStatus,
      stripeCheckoutSessionId:
        input.expectedApplicationCheckoutSessionId,
    },
    input.applicationPatch,
  );
  if ((applicationClaim.modifiedCount ?? 0) !== 1) {
    await dependencies.rollbackSubscription(
      {
        _id: input.subscriptionId,
        applicationId: input.applicationId,
        status: "incomplete",
        occupiesActiveSlot: false,
        paymentProviderRef: null,
        stripeCheckoutSessionId: input.checkoutSessionId,
      },
      input.subscriptionRollbackPatch,
    );
    return {
      claimed: false,
      state: await dependencies.readCurrentState(),
    };
  }

  return {
    claimed: true,
    state: await dependencies.readCurrentState(),
  };
}

export function decideVendorCheckoutClaimDisposition(
  result: VendorCheckoutClaimResult,
  checkoutSessionId: string,
): "dashboard" | "new_session" | "current_session" | "conflict" {
  const state = result.state;
  if (
    state.applicationPaymentStatus === "paid" ||
    state.subscriptionOccupiesActiveSlot ||
    ["active", "trialing", "past_due"].includes(
      state.subscriptionStatus || "",
    )
  ) {
    return "dashboard";
  }
  if (
    result.claimed &&
    state.applicationCheckoutSessionId === checkoutSessionId &&
    state.subscriptionCheckoutSessionId === checkoutSessionId
  ) {
    return "new_session";
  }
  if (
    state.applicationCheckoutSessionId &&
    state.applicationCheckoutSessionId ===
      state.subscriptionCheckoutSessionId
  ) {
    return "current_session";
  }
  return "conflict";
}

export function selectVendorCheckoutSubscription(
  rows: CheckoutSubscriptionRow[],
  applicationId: string,
): CheckoutSubscriptionRow {
  const matches = rows.filter((row) => row.applicationId === applicationId);
  if (matches.length === 0) {
    throw new ValidationError("Vendor subscription billing record is missing");
  }
  if (matches.length > 1) {
    throw new ValidationError(
      "Multiple incomplete vendor subscription billing records were found",
    );
  }
  return matches[0];
}

export function buildVendorCheckoutMetadata(input: {
  applicationId: string;
  vendorId: string;
  userId: string;
  planId: string;
  subscriptionId: string;
}): Record<string, string> {
  return {
    kind: VENDOR_APPLICATION_CHECKOUT_KIND,
    applicationId: input.applicationId,
    vendorId: input.vendorId,
    userId: input.userId,
    planId: input.planId,
    localSubscriptionId: input.subscriptionId,
  };
}

export function reusableVendorCheckoutSessionUrl(
  session: ReusableVendorCheckoutSession,
  applicationId: string,
  localSubscriptionId: string,
): string | null {
  return session.status === "open" &&
    session.url &&
    session.metadata?.applicationId === applicationId &&
    session.metadata.localSubscriptionId === localSubscriptionId
    ? session.url
    : null;
}
