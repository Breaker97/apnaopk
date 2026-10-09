/**
 * Which email a vendor's approval sends.
 *
 * - A paid application whose first payment is still owed: the
 *   payment-required email.
 * - An owner with no password — an imported store, or one an admin made by
 *   hand — cannot act on "you're approved, sign in". Their one email is the
 *   invitation to set a password, worded as the approval. Using it proves the
 *   address, so no separate verification email goes with it.
 * - Everyone else: the approval email.
 */
export type VendorApprovalEmail = "payment-required" | "set-password" | "approved";

export function vendorApprovalEmail(input: {
  paymentRequired: boolean;
  ownerHasPassword: boolean;
}): VendorApprovalEmail {
  if (input.paymentRequired) return "payment-required";
  return input.ownerHasPassword ? "approved" : "set-password";
}
