import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/intl/money";
import type { VendorBalance } from "@/lib/vendors/vendor-balance";

/**
 * What is behind "held for you".
 *
 * That one figure carried everything at once: sales ready for the next payout,
 * sales still inside the store's return window, a pre-order reserve, and — when
 * a shopper returned goods after the seller had been paid for them — a debt
 * that quietly took the number down or past zero. A seller could only ask.
 *
 * Each line says what it is and, where there is one, when it ends.
 */
export function VendorBalanceCard({
  balance,
  locale,
  labels,
}: {
  balance: VendorBalance;
  locale: string;
  labels: {
    title: string;
    ready: string;
    readyHint: string;
    belowMinimum: string;
    held: string;
    heldHint: string;
    reserve: string;
    reserveHint: string;
    reserveUndated: string;
    owedBack: string;
    owedBackHint: string;
  };
}) {
  const money = (value: number) => formatCurrency(value, balance.currency);
  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(value),
    );

  const rows: Array<{ id: string; label: string; hint: string; value: string; tone?: "owed" }> = [
    {
      id: "ready",
      label: labels.ready,
      hint:
        balance.minWithdrawal > 0 && balance.readyToPay < balance.minWithdrawal
          ? labels.belowMinimum.replace("{amount}", money(balance.minWithdrawal))
          : labels.readyHint.replace("{count}", String(balance.orderCount)),
      value: money(balance.readyToPay),
    },
  ];

  if (balance.heldInReturnWindow.amount > 0) {
    rows.push({
      id: "held",
      label: labels.held,
      hint: labels.heldHint.replace(
        "{days}",
        String(balance.heldInReturnWindow.windowDays),
      ),
      value: money(balance.heldInReturnWindow.amount),
    });
  }

  if (balance.reserveHeld.amount > 0) {
    rows.push({
      id: "reserve",
      label: labels.reserve,
      hint: balance.reserveHeld.releaseAt
        ? labels.reserveHint.replace("{date}", date(balance.reserveHeld.releaseAt))
        : labels.reserveUndated,
      value: money(balance.reserveHeld.amount),
    });
  }

  if (balance.owedBack > 0) {
    rows.push({
      id: "owed-back",
      label: labels.owedBack,
      hint: labels.owedBackHint,
      value: `− ${money(balance.owedBack)}`,
      tone: "owed",
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{labels.title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <dl className="divide-y">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3"
            >
              <div className="min-w-0">
                <dt className="text-sm font-medium">{row.label}</dt>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.hint}</p>
              </div>
              <dd
                className={`text-sm font-semibold tabular-nums ${
                  row.tone === "owed" ? "text-destructive" : ""
                }`}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
