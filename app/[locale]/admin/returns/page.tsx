import { setRequestLocale } from "next-intl/server";
import { ReturnsDataTable } from "@/components/admin/returns-data-table";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminReturnsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  await requireAdminOrStaffPageAccess({
    locale,
    required: [STAFF_PERMISSIONS.VIEW_ORDERS],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Returns and refunds
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review customer return requests, approve received items, and issue
          refunds through the original payment method when available.
        </p>
      </div>
      <ReturnsDataTable locale={locale} />
    </div>
  );
}
