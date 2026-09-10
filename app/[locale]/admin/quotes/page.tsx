import { setRequestLocale } from "next-intl/server";
import { QuotesDataTable } from "@/components/admin/quotes-data-table";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminQuotesPage({ params }: PageProps) {
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
          Quote requests
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enquiries from products priced on request. Reply by email or phone,
          then move the request along so the queue reflects what is still open.
        </p>
      </div>
      <QuotesDataTable locale={locale} />
    </div>
  );
}
