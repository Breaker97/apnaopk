import { Layers } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { Vendor, VendorPlan, VendorSubscription } from "@/models";
import { getSettings } from "@/models/settings.model";
import { Card, CardContent } from "@/components/ui/card";
import { VendorPlansContent } from "@/components/admin/vendor-plans/vendor-plans-content";
import type { AdminVendorPlan } from "@/components/admin/vendor-plans/types";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@/config/app.config";
import {
  packsFromPlanCapabilities,
  type VendorPlanCapabilityInput,
} from "@/config/permissions.config";
import { getExternalVendorFilter } from "@/lib/vendors/multi-vendor";
import { DEFAULT_VENDOR_COMMISSION_RATE } from "@/lib/orders/order-settings";

interface PageProps {
  params: Promise<{ locale: string }>;
}

type CountRow = { _id: unknown; count: number };

function countsById(rows: CountRow[]): Map<string, number> {
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export default async function AdminVendorPlansPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminPageAccess(locale);

  await connectDB();
  const settings = await getSettings();
  const plansEnabled = Boolean(
    settings.multiVendorMode?.enabled && settings.vendorConfig?.plansEnabled,
  );

  if (!plansEnabled) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="w-full max-w-md text-center">
          <CardContent className="space-y-2 py-10">
            <Layers className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">Subscription plans are off</h2>
            <p className="text-sm text-muted-foreground">
              Enable subscription plans in Vendor Configuration to manage plans.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Vendor plan catalogs are small, so fetch all (no pagination), in the order
  // vendors see them.
  const raw = await VendorPlan.find()
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();
  const planIds = raw.map((p) => p._id);

  // Who is on each plan: the same two things the plan DELETE refuses on, so
  // the menu can say why before the admin clicks. The house store is no one's
  // customer and sells commission-free, so it is not a commission-only vendor.
  const [vendorRows, subscriptionRows, commissionOnlyVendors] = await Promise.all([
    Vendor.aggregate<CountRow>([
      { $match: { planId: { $in: planIds } } },
      { $group: { _id: "$planId", count: { $sum: 1 } } },
    ]),
    VendorSubscription.aggregate<CountRow>([
      {
        $match: {
          planId: { $in: planIds },
          status: { $in: ACTIVE_SUBSCRIPTION_STATUSES },
        },
      },
      { $group: { _id: "$planId", count: { $sum: 1 } } },
    ]),
    Vendor.countDocuments({ ...getExternalVendorFilter(), planId: null }),
  ]);
  const vendorCounts = countsById(vendorRows);
  const subscriptionCounts = countsById(subscriptionRows);

  const storeCurrency = settings.general?.defaultCurrency || "USD";
  const configuredDefaultId = settings.vendorConfig?.defaultPlanId || null;

  const plans: AdminVendorPlan[] = raw.map((p) => {
    const id = String(p._id);
    const price = p.price ?? 0;
    const paid = p.billingInterval !== "none" && price > 0;
    return {
      id,
      name: p.name,
      description: p.description || undefined,
      price,
      currency: String(p.stripePriceCurrency || storeCurrency).toUpperCase(),
      billingInterval: p.billingInterval,
      commissionRate: p.commissionRate ?? 0,
      trialDays: p.trialDays ?? 0,
      features: Array.isArray(p.features) ? p.features : [],
      limits: {
        products: p.limits?.products ?? null,
        staff: p.limits?.staff ?? null,
      },
      packs: packsFromPlanCapabilities(
        p.capabilities as VendorPlanCapabilityInput | null | undefined,
      ),
      isDefault: Boolean(p.isDefault),
      status: p.status,
      stripeMissing:
        paid &&
        p.status === "active" &&
        !(p.stripePriceId && p.stripePriceActive),
      vendorCount: vendorCounts.get(id) ?? 0,
      activeSubscriptionCount: subscriptionCounts.get(id) ?? 0,
      configuredDefault: configuredDefaultId === id,
    };
  });

  return (
    <VendorPlansContent
      locale={locale}
      plans={plans}
      commissionOnly={{
        vendorCount: commissionOnlyVendors,
        rate:
          settings.orders?.commission?.vendorRate ??
          DEFAULT_VENDOR_COMMISSION_RATE,
      }}
    />
  );
}
