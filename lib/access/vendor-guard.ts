import { VENDOR_STATUS } from "@/config/app.config";
import { AuthorizationError } from "@/lib/api/errors";
import { Vendor, VendorApplication } from "@/models";
import { resolveVendorPaymentAccess } from "@/lib/vendors/vendor-payment-access";
import {
  VENDOR_APPLICATION_LATEST_SORT,
  vendorApplicationLookupQuery,
} from "@/lib/vendors/vendor-application";

export async function requireApprovedVendorByUserId(
  userId: string,
  options: { allowPaymentRequiredSetup?: boolean } = {},
) {
  const vendor = await Vendor.findOne({ userId }).lean();
  if (!vendor) {
    throw new AuthorizationError("Vendor profile not found");
  }
  if (vendor.status === VENDOR_STATUS.APPROVED) {
    return vendor;
  }
  if (
    options.allowPaymentRequiredSetup &&
    vendor.status === VENDOR_STATUS.PAYMENT_REQUIRED
  ) {
    const application = await VendorApplication.findOne(
      vendorApplicationLookupQuery({ vendorId: vendor._id, userId }),
    )
      .sort(VENDOR_APPLICATION_LATEST_SORT)
      .select("status paymentDueAt")
      .lean<{ status?: string; paymentDueAt?: Date | null } | null>();
    const accessMode = resolveVendorPaymentAccess({
      vendorStatus: vendor.status,
      applicationStatus: application?.status,
      paymentDueAt: application?.paymentDueAt,
    });
    if (accessMode === "setup") {
      return vendor;
    }
    throw new AuthorizationError(
      "Vendor setup access has ended. Complete subscription payment to reactivate your dashboard.",
    );
  }
  throw new AuthorizationError(
    "Complete subscription payment before using this vendor feature",
  );
}
