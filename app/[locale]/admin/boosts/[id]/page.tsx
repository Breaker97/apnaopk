import { notFound } from "next/navigation";
import mongoose, { type Types } from "mongoose";
import { Rocket } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { BoostCampaign, BoostSlotDay, PlatformPayment } from "@/models";
import { getSettings } from "@/models/settings.model";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { BoostPerformanceContent } from "@/components/vendor/boost-performance-content";
import {
  BoostCampaignAdminActions,
  BoostCampaignAdminPanel,
  type BoostPaymentAttemptRow,
} from "@/components/admin/boost-campaign-admin-panel";
import { getBoostCampaignStats } from "@/lib/boosts/boost-metrics";
import type { BoostCampaignListRow } from "@/lib/boosts/boost-campaign-list";
import { PLATFORM_PAYMENT_KIND } from "@/config/app.config";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

/**
 * One booking, for the marketplace side.
 *
 * The delivery record itself is the vendor's screen, imported whole: when a
 * vendor asks why a day was credited, the admin has to be looking at the same
 * days, marked the same way. What this page adds is the half the vendor never
 * sees — what is owed, which attempts paid, and the verbs that change any of
 * it. Until now none of that existed anywhere: the endpoint behind it was
 * written and wired to nothing.
 */
export default async function AdminBoostCampaignPage({ params }: PageProps) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale });
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  await connectDB();
  const settings = await getSettings();
  const boostingEnabled = Boolean(
    settings.multiVendorMode?.enabled && settings.boosting?.enabled,
  );

  const tSafe = (key: string, fallback: string) => {
    try {
      const value = t(key);
      return value === key ? fallback : value;
    } catch {
      return fallback;
    }
  };

  if (!boostingEnabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="space-y-2 py-10">
            <Rocket className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {tSafe("boosts.disabled.title", "Product boosting is off")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {tSafe(
                "boosts.disabled.campaigns",
                "Enable boosting in Settings → Product Boosting to sell sponsored placements to vendors.",
              )}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!mongoose.isValidObjectId(id)) notFound();

  const raw = await BoostCampaign.findById(id)
    .populate("productId", "name slug images")
    .populate("vendorId", "storeName")
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
          releasedDays?: number;
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
          vendorId?: { _id: unknown; storeName?: string } | null;
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
    vendor: raw.vendorId
      ? {
          _id: String(raw.vendorId._id),
          storeName: raw.vendorId.storeName || "",
        }
      : null,
  };

  // Which days actually rendered, and what paid for them. The same two reads
  // the vendor's own screen makes, plus the attempt history — including the
  // attempts that never granted anything, which are exactly the ones a
  // support question is about.
  const [stats, bookedDays, attempts] = await Promise.all([
    getBoostCampaignStats(String(raw._id), 90),
    BoostSlotDay.find({ campaignId: raw._id as Types.ObjectId })
      .sort({ day: 1 })
      .select("day")
      .lean<Array<{ day: string }>>(),
    PlatformPayment.find({
      kind: PLATFORM_PAYMENT_KIND.BOOST,
      campaignId: raw._id as Types.ObjectId,
    })
      .sort({ createdAt: -1 })
      .select("provider status amount refundedAmount currency reference note paidAt createdAt")
      .lean<
        Array<{
          _id: unknown;
          provider?: string;
          status?: string;
          amount?: number;
          refundedAmount?: number;
          currency?: string;
          reference?: string;
          note?: string | null;
          paidAt?: Date | null;
          createdAt: Date;
        }>
      >(),
  ]);

  const attemptRows: BoostPaymentAttemptRow[] = attempts.map((row) => ({
    _id: String(row._id),
    provider: row.provider || "—",
    status: row.status || "pending",
    amount: row.amount ?? 0,
    refundedAmount: row.refundedAmount ?? 0,
    currency: row.currency || campaign.currency,
    reference: row.reference || "",
    note: row.note || null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));

  const unservedDays = raw.unservedDays ?? [];

  return (
    <BoostPerformanceContent
      locale={locale}
      campaign={campaign}
      stats={stats}
      bookedDays={bookedDays.map((row) => row.day)}
      unservedDays={unservedDays}
      backHref={`/${locale}/admin/boosts`}
      backLabel={tSafe("boosts.admin.title", "Boost campaigns")}
      headerAside={<BoostCampaignAdminActions campaign={campaign} />}
    >
      <BoostCampaignAdminPanel
        campaign={campaign}
        attempts={attemptRows}
        vendorHref={
          campaign.vendor
            ? `/${locale}/admin/vendors/${campaign.vendor._id}`
            : null
        }
        releasedDays={raw.releasedDays ?? 0}
        unservedShare={unservedDays.reduce(
          (sum, row) => sum + (row.share ?? 0),
          0,
        )}
      />
    </BoostPerformanceContent>
  );
}
