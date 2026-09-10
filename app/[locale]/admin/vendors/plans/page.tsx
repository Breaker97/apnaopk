import { Layers } from "lucide-react";
import { setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { VendorPlan } from "@/models";
import { getSettings } from "@/models/settings.model";
import { Card, CardContent } from "@/components/ui/card";
import {
  VendorPlansCards,
  type VendorPlanCard,
} from "@/components/admin/vendor-plans-cards";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
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

  // Vendor plan catalogs are small, so fetch all and render as cards (no
  // pagination). Sorted by sortOrder then newest, matching the admin list order.
  const raw = await VendorPlan.find()
    .sort({ sortOrder: 1, createdAt: -1 })
    .lean();

  const plans: VendorPlanCard[] = raw.map((p) => ({
    _id: String(p._id),
    name: p.name,
    slug: p.slug,
    description: p.description,
    price: p.price ?? 0,
    billingInterval: p.billingInterval,
    commissionRate: p.commissionRate ?? 0,
    trialDays: p.trialDays ?? 0,
    features: Array.isArray(p.features) ? p.features : [],
    limits: {
      products: p.limits?.products ?? null,
      staff: p.limits?.staff ?? null,
    },
    capabilities: { aiAuthoring: Boolean(p.capabilities?.aiAuthoring) },
    isDefault: Boolean(p.isDefault),
    status: p.status,
    stripePriceId: p.stripePriceId || null,
    stripePriceActive: Boolean(p.stripePriceActive),
  }));

  return <VendorPlansCards locale={locale} plans={plans} />;
}
