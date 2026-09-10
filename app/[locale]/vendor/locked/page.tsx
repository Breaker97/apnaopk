import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { VendorAccessRequest, VendorPlan } from "@/models";
import { getSettings } from "@/models/settings.model";
import { VENDOR_ACCESS_REQUEST_STATUS } from "@/models/vendorAccessRequest.model";
import { VENDOR_PACK_LABELS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import {
  parseAccessLayer,
  parseVendorPack,
  plansInForce,
} from "@/lib/vendors/vendor-permissions";
import { VendorAccessGate } from "@/components/vendor/vendor-access-gate";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export const metadata: Metadata = {
  title: "Access locked",
  robots: { index: false, follow: false },
};

/**
 * The gate every permission miss lands on, replacing `/forbidden` for vendors.
 *
 * The guard puts the denying layer and the pack in the query rather than
 * re-deriving them here, so this page never disagrees with the decision that
 * sent the vendor to it. It still resolves access itself for the *display*
 * details (plan name, whether plans are even sold, an existing request).
 */
export default async function VendorLockedPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  // No `required`: this page is what a denial redirects TO, so asking the guard
  // for a permission here would bounce the vendor straight back out.
  const access = await requireVendorAreaAccess({ locale });

  const pack = parseVendorPack(
    Array.isArray(query.pack) ? query.pack[0] : query.pack,
  );
  const layer = parseAccessLayer(
    Array.isArray(query.layer) ? query.layer[0] : query.layer,
  );

  // A bare /vendor/locked with no pack has nothing to explain.
  if (!pack) {
    redirect(`/${locale}/vendor/dashboard`);
  }

  await connectDB();
  const settings = await getSettings();

  const [plan, pending] = await Promise.all([
    access.vendor.planId
      ? VendorPlan.findById(access.vendor.planId)
          .select("name")
          .lean<{ name?: string } | null>()
      : Promise.resolve(null),
    access.vendor._id
      ? VendorAccessRequest.findOne({
          vendorId: access.vendor._id,
          pack,
          status: VENDOR_ACCESS_REQUEST_STATUS.PENDING,
        })
          .select("requestedAt duration")
          .lean<{
            _id: unknown;
            requestedAt?: Date;
            duration?: string;
          } | null>()
      : Promise.resolve(null),
  ]);

  return (
    <div className="py-6">
      <VendorAccessGate
        locale={locale}
        layer={layer}
        pack={pack}
        packLabel={VENDOR_PACK_LABELS[pack]}
        planName={plan?.name ?? null}
        plansAvailable={plansInForce(settings)}
        paymentDueAt={
          access.paymentApplication?.paymentDueAt?.toISOString() ?? null
        }
        pendingRequest={
          pending
            ? {
                id: String(pending._id),
                requestedAt:
                  pending.requestedAt?.toISOString() ?? new Date().toISOString(),
                duration: pending.duration ?? "30d",
              }
            : null
        }
      />
    </div>
  );
}
