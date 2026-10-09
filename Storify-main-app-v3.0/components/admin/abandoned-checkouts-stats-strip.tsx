import {
  MailCheck,
  RotateCcw,
  ShoppingCart,
  TimerReset,
  WalletCards,
} from "lucide-react";
import {
  AdminStatsStrip,
  type AdminStatsStripItem,
} from "@/components/admin/admin-stats-strip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStoreMoneyFormatter } from "@/lib/intl/server-currency";
import {
  fetchAbandonedCheckoutStats,
  fetchVendorAbandonedCheckoutStats,
} from "@/lib/orders/abandoned-checkout-stats";
import type { AbandonedCheckoutViewer } from "@/lib/orders/abandoned-checkout-list";

/**
 * The figures above an Abandoned checkouts table. Server components with their
 * own queries, so a page drops them in a `<Suspense>` and the table does not
 * wait on them — the Orders page's arrangement.
 */

/**
 * The store's figures, or a staff member's over their scope: the five the
 * admin page has always shown.
 */
export async function AbandonedCheckoutStatsStrip({
  locale,
  viewer,
}: {
  locale: string;
  viewer?: AbandonedCheckoutViewer;
}) {
  const [stats, formatMoney] = await Promise.all([
    fetchAbandonedCheckoutStats(viewer),
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

/**
 * A vendor's figures, over its own lines only, and the products of its that
 * shoppers leave behind most — the part a vendor can do something about.
 * There is no "emails sent": the recovery emails are the store's.
 */
export async function VendorAbandonedCheckoutStatsStrip({
  locale,
  vendorId,
}: {
  locale: string;
  vendorId: string;
}) {
  const [stats, formatMoney] = await Promise.all([
    fetchVendorAbandonedCheckoutStats(vendorId),
    getStoreMoneyFormatter(),
  ]);
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);

  const items: AdminStatsStripItem[] = [
    {
      title: "Abandoned",
      value: count(stats.total),
      description: "Checkouts left with your products",
      icon: <ShoppingCart className="h-5 w-5" />,
      iconClassName: "text-amber-700 bg-amber-100",
    },
    {
      title: "Open",
      value: count(stats.open),
      description: "The store may still win these back",
      icon: <TimerReset className="h-5 w-5" />,
      iconClassName: "text-orange-700 bg-orange-100",
    },
    {
      title: "Recovered",
      value: count(stats.recovered),
      description: "The shopper came back and bought",
      icon: <RotateCcw className="h-5 w-5" />,
      iconClassName: "text-green-700 bg-green-100",
    },
    {
      title: "Potential revenue",
      value: formatMoney(stats.potentialRevenue),
      description: "Your products in open checkouts",
      icon: <WalletCards className="h-5 w-5" />,
      iconClassName: "text-cyan-700 bg-cyan-100",
    },
  ];

  return (
    <div className="space-y-4">
      <AdminStatsStrip items={items} />
      {stats.topProducts.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Most often left behind
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {stats.topProducts.map((product) => (
                <li
                  key={product.productId ?? product.name}
                  className="flex items-center justify-between gap-4 py-2"
                >
                  <span className="min-w-0 truncate font-medium">{product.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {count(product.checkouts)}{" "}
                    {product.checkouts === 1 ? "checkout" : "checkouts"} ·{" "}
                    {formatMoney(product.value)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
