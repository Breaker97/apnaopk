import { notFound, redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { BoostCampaign, BoostSlotDay } from "@/models";
import { getSettings } from "@/models/settings.model";
import { BoostPerformanceContent } from "@/components/vendor/boost-performance-content";
import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { requireVendorAreaAccess } from "@/lib/access/vendor-area-guard";
import { primaryDenial, vendorLockedPath } from "@/lib/vendors/vendor-permissions";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { getBoostCampaignStats } from "@/lib/boosts/boost-metrics";
import type { BoostCampaignListRow } from "@/lib/boosts/boost-campaign-list";
import mongoose, { type Types } from "mongoose";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function VendorBoostPerformancePage({
  params,
}: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const access = await requireVendorAreaAccess({ locale });

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled || !settings.boosting?.enabled) {
    redirect(`/${locale}/vendor/dashboard`);
  }

  // Same reasoning as the boosts list page: reuse the guard's resolution and
  // send a denial to the gate that names the layer.
  if (!access.access?.has(VENDOR_PERMISSIONS.VIEW_BOOSTS)) {
    redirect(
      vendorLockedPath(
        locale,
        primaryDenial(access.access!, [VENDOR_PERMISSIONS.VIEW_BOOSTS]),
      ),
    );
  }

  if (!mongoose.isValidObjectId(id)) notFound();
  const vendor = await requireApprovedVendorByUserId(access.session.user.id);

  const raw = await BoostCampaign.findOne({ _id: id, vendorId: vendor._id })
    .populate("productId", "name slug images")
    .lean<
      | (Record<string, unknown> & {
          _id: unknown;
          status: string;
          startsAt?: Date | null;
          endsAt?: Date | null;
          startDay?: string;
          endDay?: string;
          billedDays?: number;
          provider?: string | null;
          amount: number;
          currency: string;
          paidAt?: Date | null;
          cancelReason?: string | null;
          refundableAmount?: number;
          unservedDays?: Array<{ day: string; share: number }>;
          totalImpressions?: number;
          totalClicks?: number;
          createdAt: Date;
          positionSnapshot?: {
            position: number;
            label: string;
            pricePerDay: number;
            currency: string;
          } | null;
          productId?: {
            _id: unknown;
            name?: string;
            slug?: string;
            images?: string[];
          } | null;
        })
      | null
    >();
  if (!raw) notFound();

  const campaign: BoostCampaignListRow = {
    _id: String(raw._id),
    status: raw.status,
    startsAt: raw.startsAt ? raw.startsAt.toISOString() : null,
    endsAt: raw.endsAt ? raw.endsAt.toISOString() : null,
    startDay: raw.startDay ?? "",
    endDay: raw.endDay ?? "",
    billedDays: raw.billedDays ?? 0,
    provider: raw.provider ?? null,
    amount: raw.amount,
    currency: raw.currency,
    paidAt: raw.paidAt ? raw.paidAt.toISOString() : null,
    cancelReason: raw.cancelReason ?? null,
    refundableAmount: raw.refundableAmount ?? 0,
    totalImpressions: raw.totalImpressions ?? 0,
    totalClicks: raw.totalClicks ?? 0,
    createdAt: raw.createdAt.toISOString(),
    positionSnapshot: raw.positionSnapshot ?? {
      position: 0,
      label: "",
      pricePerDay: 0,
      currency: raw.currency,
    },
    product: raw.productId
      ? {
          _id: String(raw.productId._id),
          name: raw.productId.name || "",
          slug: raw.productId.slug || "",
          image: raw.productId.images?.[0] || null,
        }
      : null,
    vendor: null,
  };

  // Which days actually rendered. The strip needs the campaign's own booked
  // rows, not the whole rung: this is the surface where a vendor points at a
  // day and the marketplace has to point at the same day.
  const [stats, bookedDays] = await Promise.all([
    getBoostCampaignStats(String(raw._id), 90),
    BoostSlotDay.find({ campaignId: raw._id as Types.ObjectId })
      .sort({ day: 1 })
      .select("day")
      .lean<Array<{ day: string }>>(),
  ]);

  return (
    <BoostPerformanceContent
      locale={locale}
      campaign={campaign}
      stats={stats}
      bookedDays={bookedDays.map((row) => row.day)}
      unservedDays={raw.unservedDays ?? []}
    />
  );
}
