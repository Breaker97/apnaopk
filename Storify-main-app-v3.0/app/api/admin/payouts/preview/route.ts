import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { connectDB } from "@/lib/db";
import { getSettings, Vendor } from "@/models";
import { getExternalVendorFilter } from "@/lib/vendors/multi-vendor";
import { quotePayout } from "@/lib/finance/payout-service";

export const GET = withApi(
  { auth: "admin", rateLimit: { action: "admin:payouts:preview", preset: "lenient" } },
  async ({ request }) => {
    const query = new URL(request.url).searchParams;
    await connectDB();
    const vendorId = query.get("vendorId") || "";
    if (!/^[a-f0-9]{24}$/i.test(vendorId)) throw new ValidationError("Valid vendorId is required");
    if (!(await getSettings()).multiVendorMode?.enabled || !await Vendor.exists({ ...getExternalVendorFilter(), _id: vendorId })) throw new ValidationError("Vendor not found");
    return successResponse(await quotePayout({ vendorId, currency: query.get("currency") || undefined, periodStart: query.get("periodStart") || undefined, periodEnd: query.get("periodEnd") || undefined }));
  },
);
