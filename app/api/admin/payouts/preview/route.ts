import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import { connectDB } from "@/lib/db";
import { getSettings, Vendor } from "@/models";
import { getExternalVendorFilter } from "@/lib/vendors/multi-vendor";
import { countSellerConfirmedDeliveries, quotePayout } from "@/lib/finance/payout-service";

export const GET = withApi(
  { auth: "admin", rateLimit: { action: "admin:payouts:preview", preset: "lenient" } },
  async ({ request }) => {
    const query = new URL(request.url).searchParams;
    await connectDB();
    const vendorId = query.get("vendorId") || "";
    if (!/^[a-f0-9]{24}$/i.test(vendorId)) throw new ValidationError("Valid vendorId is required");
    if (!(await getSettings()).multiVendorMode?.enabled) throw new ValidationError("Vendor not found");
    const vendor = await Vendor.findOne({ ...getExternalVendorFilter(), _id: vendorId })
      .select("storeName status bankDetails")
      .lean<{ storeName?: string; status?: string; bankDetails?: Record<string, string | undefined> | null } | null>();
    if (!vendor) throw new ValidationError("Vendor not found");
    const quote = await quotePayout({ vendorId, currency: query.get("currency") || undefined, periodStart: query.get("periodStart") || undefined, periodEnd: query.get("periodEnd") || undefined });
    // Who the money goes to, and where: the admin sends it by hand.
    const sellerConfirmed = await countSellerConfirmedDeliveries(vendorId, quote.allocations.map((allocation) => allocation.orderId));
    return successResponse({
      ...quote,
      vendor: { storeName: vendor.storeName, status: vendor.status, bankDetails: vendor.bankDetails ?? null },
      sellerConfirmedCount: sellerConfirmed,
    });
  },
);
