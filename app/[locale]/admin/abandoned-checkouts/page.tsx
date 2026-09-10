import "server-only";
import { Suspense } from "react";
import {
  MailCheck,
  RotateCcw,
  ShoppingCart,
  TimerReset,
  WalletCards,
} from "lucide-react";
import { AbandonedCheckout, Cart } from "@/models";
import { connectDB } from "@/lib/db";
import { setRequestLocale } from "next-intl/server";
import {
  AdminStatsStrip,
  AdminStatsStripSkeleton,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { AbandonedCheckoutsDataTable } from "@/components/admin/abandoned-checkouts-data-table";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { getCheckoutSubtotal } from "@/lib/orders/abandoned-checkouts";
import { getStoreMoneyFormatter } from "@/lib/intl/server-currency";
import { fetchAbandonedCheckoutList } from "@/lib/orders/abandoned-checkout-list";
import { serializeRows } from "@/lib/api/list-query";

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

interface AbandonedCheckoutStats {
  total: number;
  open: number;
  recovered: number;
  emailsSent: number;
  potentialRevenue: number;
}

const DEFAULT_PAGE_SIZE = 10;

export default async function AdminAbandonedCheckoutsPage({
  params,
  searchParams,
}: PageProps) {
  const { locale } = await params;
  const search = await searchParams;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  return (
    <div className="space-y-4">
      <Suspense fallback={<AdminStatsStripSkeleton items={5} />}>
        <AbandonedCheckoutStatsStrip locale={locale} />
      </Suspense>

      <Suspense
        fallback={
          <AdminListSkeleton
            stats={0}
            columns={6}
            tabs={3}
            thumbnail={false}
            headerActions={0}
          />
        }
      >
        <AbandonedCheckoutsTable locale={locale} searchParams={search} />
      </Suspense>
    </div>
  );
}

async function AbandonedCheckoutsTable({
  locale,
  searchParams,
}: {
  locale: string;
  searchParams: { [key: string]: string | string[] | undefined };
}) {
  // Rebuilt as URLSearchParams so the page reads the query string through the
  // very same parser the API route uses.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  if (!params.get("limit")) params.set("limit", String(DEFAULT_PAGE_SIZE));

  const list = await fetchAbandonedCheckoutList(params);

  return (
    <AbandonedCheckoutsDataTable
      locale={locale}
      data={serializeRows(list.items)}
      pagination={{
        page: list.page,
        limit: list.limit,
        total: list.total,
        totalPages: list.totalPages,
      }}
    />
  );
}

async function AbandonedCheckoutStatsStrip({ locale }: { locale: string }) {
  const [stats, formatMoney] = await Promise.all([
    getAbandonedCheckoutStats(),
    getStoreMoneyFormatter(),
  ]);

  const items: AdminStatsStripItem[] = [
    {
      title: "Abandoned",
      value: new Intl.NumberFormat(locale).format(stats.total),
      description: "Checkout drafts left before payment",
      icon: <ShoppingCart className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: "Open",
      value: new Intl.NumberFormat(locale).format(stats.open),
      description: "Still eligible for recovery",
      icon: <TimerReset className="h-5 w-5" />,
      iconClassName: "text-orange-700 bg-orange-100",
    },
    {
      title: "Recovered",
      value: new Intl.NumberFormat(locale).format(stats.recovered),
      description: "Returned and completed checkout",
      icon: <RotateCcw className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: "Emails sent",
      value: new Intl.NumberFormat(locale).format(stats.emailsSent),
      description: "Recovery emails delivered to SMTP",
      icon: <MailCheck className="h-5 w-5" />,
      iconClassName: "text-blue-700 bg-blue-100",
    },
    {
      title: "Potential revenue",
      value: formatMoney(stats.potentialRevenue),
      description: "Open abandoned checkout value",
      icon: <WalletCards className="h-5 w-5" />,
      iconClassName: "text-cyan-700 bg-cyan-100",
    },
  ];

  return <AdminStatsStrip items={items} />;
}

async function getAbandonedCheckoutStats(): Promise<AbandonedCheckoutStats> {
  await connectDB();

  const [snapshotDocs, cartDocs] = await Promise.all([
    AbandonedCheckout.find({
      status: { $in: ["open", "recovered"] },
      checkoutStartedAt: { $exists: true },
      abandonedAt: { $exists: true },
      "items.0": { $exists: true },
    })
      .select(
        "checkoutToken cartId recoveryStatus recoveryEmailStatus totalPrice subtotalPrice",
      )
      .lean(),
    Cart.find({
      status: { $in: ["abandoned", "recovered"] },
      "items.0": { $exists: true },
      $or: [
        { checkoutStartedAt: { $exists: true } },
        { abandonedAt: { $exists: true } },
      ],
    })
      .select(
        "checkoutToken recoveryStatus recoveryEmailStatus totalPrice subtotalPrice items",
      )
      .lean(),
  ]);

  const seen = new Set<string>();
  const rows = [
    ...snapshotDocs.map((checkout) => {
      const key = String(checkout.checkoutToken || checkout.cartId || checkout._id);
      seen.add(key);
      return {
        recoveryStatus: checkout.recoveryStatus,
        recoveryEmailStatus: checkout.recoveryEmailStatus,
        totalPrice: checkout.totalPrice ?? checkout.subtotalPrice ?? 0,
      };
    }),
    ...cartDocs
      .filter((cart) => !seen.has(String(cart.checkoutToken || cart._id)))
      .map((cart) => ({
        recoveryStatus: cart.recoveryStatus,
        recoveryEmailStatus: cart.recoveryEmailStatus,
        totalPrice:
          cart.totalPrice ?? cart.subtotalPrice ?? getCheckoutSubtotal(cart),
      })),
  ];

  const openRows = rows.filter((row) => row.recoveryStatus !== "recovered");

  return {
    total: rows.length,
    open: openRows.length,
    recovered: rows.filter((row) => row.recoveryStatus === "recovered").length,
    emailsSent: rows.filter((row) => row.recoveryEmailStatus === "sent").length,
    potentialRevenue: openRows.reduce(
      (sum, row) => sum + Number(row.totalPrice || 0),
      0,
    ),
  };
}
