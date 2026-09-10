import {
  VENDOR_APPLICATION_STATUS,
  VENDOR_STATUS,
} from "@/config/app.config";

export const VENDOR_SETUP_ACCESS_COOKIE = "vendor_payment_setup_access";

export type VendorPaymentAccessMode =
  | "approved"
  | "setup"
  | "payment_only"
  | "inactive";

interface VendorPaymentAccessInput {
  vendorStatus?: string | null;
  applicationStatus?: string | null;
  paymentDueAt?: Date | string | null;
}

export function resolveVendorPaymentAccess(
  input: VendorPaymentAccessInput,
  now = new Date(),
): VendorPaymentAccessMode {
  if (input.vendorStatus === VENDOR_STATUS.APPROVED) {
    return "approved";
  }
  if (input.vendorStatus !== VENDOR_STATUS.PAYMENT_REQUIRED) {
    return "inactive";
  }
  if (input.applicationStatus !== VENDOR_APPLICATION_STATUS.APPROVED) {
    return "payment_only";
  }
  if (
    input.paymentDueAt &&
    new Date(input.paymentDueAt).getTime() > now.getTime()
  ) {
    return "setup";
  }
  return "payment_only";
}

export function remainingSetupAccessSeconds(
  paymentDueAt: Date | string,
  now = new Date(),
) {
  return Math.max(
    0,
    Math.floor(
      (new Date(paymentDueAt).getTime() - now.getTime()) / 1000,
    ),
  );
}
