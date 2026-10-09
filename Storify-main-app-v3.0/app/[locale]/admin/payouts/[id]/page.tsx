import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { AdminPayoutDetails } from "@/components/admin/payouts/admin-payout-details";
import { isMultiVendorEnabled } from "@/lib/vendors/multi-vendor";

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function AdminPayoutDetailsPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);
  if (!(await isMultiVendorEnabled())) notFound();

  return <AdminPayoutDetails locale={locale} payoutId={id} />;
}
