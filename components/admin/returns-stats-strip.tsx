import { HandCoins, Inbox, RotateCcw, Truck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { fetchReturnStats } from "@/lib/returns/return-stats";
import { getStoreMoneyFormatter } from "@/lib/intl/server-currency";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

interface ReturnsStatsStripProps {
  locale: string;
  staffScope?: StaffAccessScope | null;
  /** Set on the vendor page: only that seller's returns are counted. */
  vendorId?: string;
}

/**
 * The four counts above the admin and vendor Returns tables. A server
 * component with its own query, so each page drops it in a `<Suspense>` and
 * the table does not wait on it — the Orders page's arrangement.
 */
export async function ReturnsStatsStrip({
  locale,
  staffScope,
  vendorId,
}: ReturnsStatsStripProps) {
  const [t, stats, money] = await Promise.all([
    getTranslations("admin.returnsPage.stats"),
    fetchReturnStats({ staffScope, vendorId }),
    getStoreMoneyFormatter(),
  ]);

  const count = (value: number) => new Intl.NumberFormat(locale).format(value);

  const items: AdminStatsStripItem[] = [
    {
      title: t("needsReview.title"),
      value: count(stats.needsReview),
      description: t("needsReview.description"),
      icon: <Inbox className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: t("onTheWayBack.title"),
      value: count(stats.onTheWayBack),
      description: t("onTheWayBack.description"),
      icon: <Truck className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("refundDue.title"),
      value: count(stats.refundDue),
      // The stuck ones only when there are any; otherwise the normal case.
      description:
        stats.refundProblems > 0
          ? t("refundDue.problems", { count: count(stats.refundProblems) })
          : t("refundDue.description"),
      icon: <HandCoins className="h-5 w-5" />,
      iconClassName:
        stats.refundProblems > 0
          ? "text-rose-700 bg-rose-100"
          : "text-orange-700 bg-orange-100",
    },
    {
      title: t("refunded.title"),
      value: count(stats.refundedCount),
      description: t("refunded.description", {
        value: money(stats.refundedAmount),
      }),
      icon: <RotateCcw className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
  ];

  return <AdminStatsStrip items={items} />;
}
