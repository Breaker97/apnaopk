import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { requireAdminPageAccess } from "@/lib/access/admin-page-guard";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ReceivablesTable } from "@/components/admin/finance/receivables-table";
import { formatCurrency } from "@/lib/intl/money";
import { getVendorLedgerBalances } from "@/lib/finance/reports";

interface PageProps {
  params: Promise<{ locale: string }>;
}

/**
 * Who owes whom, per vendor.
 *
 * The two directions are shown together because they offset. A vendor who
 * delivers with their own fleet takes the cash and owes commission; the same
 * vendor may also have gateway-settled orders the platform is holding money
 * for. Paying out the gross while chasing the commission separately is how a
 * marketplace ends up lending to its own sellers, so the settlement figure is
 * the net and it is the column that reads first.
 *
 * Marketplace-only by construction: there are no vendors to owe anything on a
 * single-vendor store, so the screen redirects rather than rendering an empty
 * table of concepts that do not apply.
 */
export default async function AdminReceivablesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPageAccess(locale);

  await connectDB();
  const settings = await getSettings();
  if (!settings.multiVendorMode?.enabled) {
    redirect(`/${locale}/admin/finance`);
  }

  const balances = await getVendorLedgerBalances();
  const t = await getTranslations({ locale });
  const label = (key: string, fallback: string) =>
    t.has(key) ? t(key) : fallback;

  // A liability cannot be negative: it says the platform handed over more than
  // it ever owed. Cheap to spot here — the balances are already loaded.
  const overpaid = balances.filter((row) => row.payable < 0);

  const totals = balances.reduce<
    Record<string, { payable: number; receivable: number }>
  >((acc, row) => {
    const bucket = acc[row.currency] || { payable: 0, receivable: 0 };
    // Rounded as it accumulates: these are already-rounded balances, and adding
    // enough of them in binary floating point drifts into the third decimal —
    // which then prints as a stat card that disagrees with its own column.
    bucket.payable = Math.round((bucket.payable + row.payable) * 100) / 100;
    bucket.receivable =
      Math.round((bucket.receivable + row.receivable) * 100) / 100;
    acc[row.currency] = bucket;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {label("finance.receivables.title", "Owed to and from vendors")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {label(
            "finance.receivables.subtitle",
            "Money held on a vendor's behalf, against commission they owe on sales they collected themselves.",
          )}
        </p>
      </div>

      {/*
        One settlement, not three stat cards per currency.

        Held less commission IS the net, and a grid of tiles hid that: six
        identical cards for a store trading in two currencies, none of them
        saying which figure came out of which.
      */}
      <div className="space-y-4">
        {Object.entries(totals).map(([currency, sums]) => (
          <Card key={currency} className="gap-0 py-6">
            <CardContent className="flex flex-wrap items-stretch gap-x-8 gap-y-6 px-6">
              <SettlementFigure
                label={label(
                  "finance.receivables.heldForVendors",
                  "You are holding for vendors",
                )}
                value={formatCurrency(sums.payable, currency)}
                hint={label(
                  "finance.overview.owedToVendorsHint",
                  "Held on their behalf until a payout clears",
                )}
              />
              <Operator symbol="−" />
              <SettlementFigure
                label={label(
                  "finance.receivables.commissionTheyOwe",
                  "Commission they owe you",
                )}
                value={formatCurrency(sums.receivable, currency)}
                hint={label(
                  "finance.overview.owedByVendorsHint",
                  "On sales the vendor collected themselves",
                )}
                tone="amber"
              />
              <Operator symbol="=" />
              <SettlementFigure
                label={label(
                  "finance.receivables.netToSettle",
                  "Net still to settle",
                )}
                value={formatCurrency(sums.payable - sums.receivable, currency)}
                hint={label(
                  "finance.receivables.netHint",
                  "Leaves the business when the next payouts run",
                )}
                divided
              />
              {Object.keys(totals).length > 1 ? (
                <span className="self-start rounded-full border bg-muted/50 px-2.5 py-0.5 text-xs font-medium">
                  {currency}
                </span>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {/*
        A vendor the platform owes a NEGATIVE amount has been paid more than
        was ever collected on their behalf. The table below prints it in the
        same weight as every healthy balance, under a heading that calls it
        money held for them — so without this the one row that means something
        went wrong is the one row that reads like all the others.
      */}
      {overpaid.length > 0 ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="text-sm font-semibold text-destructive">
            {label(
              "finance.receivables.overpaidTitle",
              "Paid out more than was ever held",
            )}
          </p>
          <ul className="mt-2 space-y-1">
            {overpaid.map((row) => (
              <li
                key={`${row.vendorId}-${row.currency}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"
              >
                <span>{row.storeName || row.vendorId}</span>
                <span className="font-semibold tabular-nums text-destructive">
                  {formatCurrency(row.payable, row.currency)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {label(
              "finance.receivables.overpaidHint",
              "A payout settled a sale whose money the vendor had collected themselves. New payouts can no longer do this; the balance already recorded is cleared with an adjustment on the Finance overview.",
            )}
          </p>
        </div>
      ) : null}

      <ReceivablesTable
        rows={balances}
        showCurrency={Object.keys(totals).length > 1}
        locale={locale}
      />

      <p className="text-xs text-muted-foreground">
        {label(
          "finance.receivables.collectNote",
          "Collecting commission in the app comes next; today these balances are the record a payout or an invoice is settled against.",
        )}
      </p>
    </div>
  );
}

/** One figure of the settlement line, with the sentence that names it. */
function SettlementFigure({
  label,
  value,
  hint,
  tone,
  divided,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "amber";
  divided?: boolean;
}) {
  return (
    <div
      className={cn("min-w-[13rem] flex-1", divided && "lg:border-s lg:ps-8")}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 text-[28px] font-semibold leading-8 tracking-tight tabular-nums",
          tone === "amber" && "text-amber-700 dark:text-amber-400",
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function Operator({ symbol }: { symbol: string }) {
  return (
    <span
      aria-hidden
      className="hidden items-center text-2xl text-muted-foreground/40 lg:flex"
    >
      {symbol}
    </span>
  );
}
