import { Suspense } from "react";
import { setRequestLocale } from "next-intl/server";
import { AdminStatsStripSkeleton } from "@/components/admin/admin-stats-strip";
import { ReturnsDataTable } from "@/components/admin/returns-data-table";
import { ReturnsStatsStrip } from "@/components/admin/returns-stats-strip";
import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { requireAdminOrStaffPageAccess } from "@/lib/access/staff-page-guard";
import { canIssueRefunds } from "@/lib/access/rbac";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminReturnsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const { session, staffScope } = await requireAdminOrStaffPageAccess({
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
      <Suspense fallback={<AdminStatsStripSkeleton items={4} />}>
        <ReturnsStatsStrip locale={locale} staffScope={staffScope} />
      </Suspense>
      {/* Money moves on an admin's authority alone — staff were offered the
          refund actions and every one of them came back refused. */}
      <ReturnsDataTable canIssueRefunds={canIssueRefunds(session.user)} />
    </div>
  );
}
