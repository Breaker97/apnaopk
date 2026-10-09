import { Clock3, MessageCircleQuestion, ShoppingBag, Tag } from "lucide-react";
import { getTranslations } from "next-intl/server";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import {
  fetchAdminQuoteStats,
  fetchVendorQuoteStats,
} from "@/lib/quotes/quotes";
import { getStoreMoneyFormatter } from "@/lib/intl/server-currency";
import type { StaffAccessScope } from "@/lib/access/staff-scope";

interface QuotesStatsStripProps {
  locale: string;
  staffScope?: StaffAccessScope | null;
  /** Counts this vendor's quotes only — the vendor's Quotes page. */
  vendorId?: string;
}

/**
 * The four counts above the Quotes table, one per question a merchant opens
 * the page with: who is waiting on me, what is waiting on the customer, what
 * lapsed and needs a nudge, and what turned into orders. A server component
 * with its own query, so the page drops it in a `<Suspense>` and the table
 * does not wait on it — the Orders page's arrangement.
 */
export async function QuotesStatsStrip({
  locale,
  staffScope,
  vendorId,
}: QuotesStatsStripProps) {
  const [t, stats, money] = await Promise.all([
    getTranslations("admin.quotesPage.stats"),
    vendorId ? fetchVendorQuoteStats(vendorId) : fetchAdminQuoteStats(staffScope),
    getStoreMoneyFormatter(),
  ]);

  const count = (value: number) => new Intl.NumberFormat(locale).format(value);

  const items: AdminStatsStripItem[] = [
    {
      title: t("needsReply.title"),
      value: count(stats.needsReply),
      description: t("needsReply.description"),
      icon: <MessageCircleQuestion className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: t("offersOpen.title"),
      value: count(stats.offersOpen),
      description: t("offersOpen.description", {
        value: money(stats.offersOpenValue),
      }),
      icon: <Tag className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: t("expired.title"),
      value: count(stats.expired),
      description: t("expired.description"),
      icon: <Clock3 className="h-5 w-5" />,
      iconClassName: "text-rose-700 bg-rose-100",
    },
    {
      title: t("ordered.title"),
      value: count(stats.ordered),
      description: t("ordered.description", {
        value: money(stats.orderedValue),
      }),
      icon: <ShoppingBag className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
  ];

  return <AdminStatsStrip items={items} />;
}
