"use client";

import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useSuspenseResource } from "@/hooks/use-suspense-resource";
import { formatCurrency } from "@/lib/intl/money";
import { resolveCurrency } from "@/lib/intl/currencies";

type Balance = {
  currency: string;
  balance: number;
  nextExpiry: { amount: number; expiresAt: string } | null;
};

type HistoryRow = {
  _id: string;
  type: "issue" | "redeem" | "expire";
  amount: number;
  currency: string;
  status?: "held" | "spent" | "released";
  source: string;
  expiresAt?: string | null;
  note?: string;
  createdAt: string;
};

function money(amount: number, currencyCode: string) {
  const currency = resolveCurrency(String(currencyCode || "").toUpperCase() || "USD");
  return formatCurrency(Number(amount || 0), currency.code, currency.locale);
}

/**
 * The shopper's store credit (R8): what they can spend, currency by currency,
 * the part that expires next, and one quiet list of what added to it or took
 * from it.
 *
 * Suspends until the first answer — render it inside `<ClientSuspense>`. A
 * failed read shows the empty state, as it always has.
 */
export function CustomerStoreCredit() {
  const t = useTranslations();
  const tr = useFallbackTranslator(t);
  const locale = useLocale();
  const { data } = useSuspenseResource<{
    balances?: Balance[];
    history?: HistoryRow[];
  }>("/api/user/store-credit");
  const balances = data?.balances ?? [];
  const history = data?.history ?? [];

  const date = (value: string) =>
    new Date(value).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const describe = (row: HistoryRow) => {
    if (row.type === "expire") return tr("account.storeCreditExpired", "Expired");
    if (row.type === "redeem") {
      return row.status === "held"
        ? tr("account.storeCreditHeld", "Held for an order being paid")
        : tr("account.storeCreditSpent", "Spent on an order");
    }
    if (row.source === "return_refund") return tr("account.storeCreditFromReturn", "Refund for a return");
    if (row.source === "order_refund") return tr("account.storeCreditFromRefund", "Refund");
    if (row.source === "order_refund_restore") {
      return tr("account.storeCreditRestored", "Given back from a refunded order");
    }
    return tr("account.storeCreditFromStore", "From the store");
  };

  return (
    <div className="space-y-6">
      {balances.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {tr("account.storeCreditEmpty", "You have no store credit.")}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {balances.map((entry) => (
            <Card key={entry.currency}>
              <CardContent className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  {tr("account.storeCreditBalance", "Available")}
                </p>
                <p className="text-2xl font-semibold">{money(entry.balance, entry.currency)}</p>
                {entry.nextExpiry ? (
                  <p className="text-sm text-muted-foreground">
                    {tr("account.storeCreditExpires", "{amount} expires {date}", {
                      amount: money(entry.nextExpiry.amount, entry.currency),
                      date: date(entry.nextExpiry.expiresAt),
                    })}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {history.length > 0 ? (
        <Card className="gap-0 overflow-hidden py-0">
          <CardContent className="divide-y p-0">
            {history.map((row) => {
              const incoming = row.type === "issue";
              return (
                <div
                  key={row._id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate">{describe(row)}</p>
                    <p className="text-xs text-muted-foreground">{date(row.createdAt)}</p>
                  </div>
                  <span
                    className={`shrink-0 font-medium ${incoming ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                  >
                    {incoming ? "+" : "−"}
                    {money(row.amount, row.currency)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
