import type { ReactNode } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { PayoutBreakdown } from "@/components/payouts/payout-breakdown";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/intl/money";
import type { VendorBalance } from "@/lib/vendors/vendor-balance";

/**
 * What a seller will be paid, and what is still on its way.
 *
 * That one "held for you" figure used to carry everything at once: sales ready
 * for the next payout, sales still inside the store's return window, a
 * pre-order reserve and — when a shopper returned goods after the seller had
 * been paid for them — a debt that quietly took the number down or past zero.
 *
 * The left half answers "when do I get paid, and how much": one figure, one
 * status, and only the exceptions (a commission still to settle, a debt) as
 * lines of their own. The right half answers "what is on its way", as the
 * stages a sale passes through before it is ready. Each stage appears only
 * where there is money in it, and nothing is said twice: what is ready is the
 * headline on the left, never a row on the right.
 */
export function VendorBalanceCard({
  balance,
  locale,
  labels,
}: {
  balance: VendorBalance;
  locale: string;
  labels: {
    nextPayout: string;
    ready: string;
    readyHint: string;
    nothingReady: string;
    tooManyOrders?: string;
    asOf?: string;
    belowMinimum: string;
    belowMinimumPill: string;
    paused: string;
    howCalculated: string;
    onItsWay: string;
    nothingOnWay: string;
    held: string;
    heldHint: string;
    reserve: string;
    reserveHint: string;
    reserveUndated: string;
    owedBack: string;
    owedBackHint: string;
    frozen?: string;
    notDelivered?: string;
    notDeliveredHint?: string;
    inPayout?: string;
    inPayoutHint?: string;
    awaitingBalance?: string;
    awaitingBalanceHint?: string;
    commissionLeft?: string;
    commissionLeftHint?: string;
  };
}) {
  const money = (value: number) => formatCurrency(value, balance.currency);
  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(value),
    );

  const frozen = Boolean(balance.frozen);
  const ready = balance.readyToPay;
  const minimum = balance.minWithdrawal;
  const belowMinimum = !frozen && minimum > 0 && ready < minimum;
  const net = frozen ? 0 : ready;

  // ── Left: the next payout ────────────────────────────────────────────────
  let pill: { text: string; tone: "positive" | "warning" | "neutral" };
  if (frozen) {
    pill = { text: labels.paused, tone: "warning" };
  } else if (belowMinimum) {
    pill = { text: labels.belowMinimumPill, tone: "neutral" };
  } else if (ready > 0) {
    pill = { text: labels.ready, tone: "positive" };
  } else {
    pill = { text: labels.nothingReady, tone: "neutral" };
  }

  let caption: string | null = null;
  if (frozen) {
    caption = null;
  } else if (balance.hasMore && labels.tooManyOrders) {
    caption = labels.tooManyOrders;
  } else if (belowMinimum) {
    caption = labels.belowMinimum.replace("{amount}", money(minimum));
  } else if (ready > 0) {
    caption = labels.readyHint.replace("{count}", String(balance.orderCount));
  }
  const showMeter = belowMinimum && !balance.hasMore;

  // The part of a debt the next payout already takes is inside the figure
  // above. Shown again as its own line it read as coming off twice; only what
  // is left after the next payout is a line of its own.
  const owedAfterNext = Math.max(
    0,
    balance.owedBack - Number(balance.breakdown?.recoveryDeducted || 0),
  );
  const commissionLeft = balance.commissionNotDeducted ?? 0;

  const notes: Array<{ id: string; title: string; hint: string; value: string }> = [];
  if (commissionLeft > 0 && labels.commissionLeft) {
    notes.push({
      id: "commission-left",
      title: labels.commissionLeft,
      hint: labels.commissionLeftHint || "",
      value: money(commissionLeft),
    });
  }
  if (owedAfterNext > 0) {
    notes.push({
      id: "owed-back",
      title: labels.owedBack,
      hint: labels.owedBackHint,
      value: money(owedAfterNext),
    });
  }

  // Only worth opening when something was added to or taken off the earnings.
  const breakdown = balance.breakdown;
  const hasAdjustments = Boolean(
    breakdown &&
      Object.entries(breakdown).some(
        ([key, value]) =>
          key !== "eligibleEarnings" &&
          key !== "netAmount" &&
          key !== "orderCount" &&
          Number(value) !== 0,
      ),
  );

  // ── Right: on its way ────────────────────────────────────────────────────
  // In the order a sale travels: out for delivery, waiting out the return
  // window, held as a reserve, then in a payout being prepared.
  const stages: Array<{
    id: string;
    label: string;
    hint: string;
    amount: number;
    swatch: string;
  }> = [];
  if (balance.notDelivered && balance.notDelivered.amount > 0 && labels.notDelivered) {
    stages.push({
      id: "not-delivered",
      label: labels.notDelivered,
      hint: (labels.notDeliveredHint || "").replace(
        "{count}",
        String(balance.notDelivered.orderCount),
      ),
      amount: balance.notDelivered.amount,
      swatch: "bg-primary/25",
    });
  }
  if (balance.heldInReturnWindow.amount > 0) {
    stages.push({
      id: "held",
      label: labels.held,
      hint: labels.heldHint.replace(
        "{days}",
        String(balance.heldInReturnWindow.windowDays),
      ),
      amount: balance.heldInReturnWindow.amount,
      swatch: "bg-primary/50",
    });
  }
  if (balance.reserveHeld.amount > 0) {
    stages.push({
      id: "reserve",
      label: labels.reserve,
      hint: balance.reserveHeld.releaseAt
        ? labels.reserveHint.replace("{date}", date(balance.reserveHeld.releaseAt))
        : labels.reserveUndated,
      amount: balance.reserveHeld.amount,
      swatch: "bg-primary/75",
    });
  }
  if (balance.inPayout && balance.inPayout.amount > 0 && labels.inPayout) {
    stages.push({
      id: "in-payout",
      label: labels.inPayout,
      hint: (labels.inPayoutHint || "").replace(
        "{numbers}",
        balance.inPayout.payoutNumbers.join(", "),
      ),
      amount: balance.inPayout.amount,
      swatch: "bg-primary",
    });
  }
  const onItsWay = stages.reduce((sum, stage) => sum + stage.amount, 0);
  const awaitingCount = balance.awaitingPreorderBalance?.orderCount ?? 0;

  return (
    <Card className="grid gap-0 overflow-hidden py-0 lg:grid-cols-[5fr_6.5fr]">
      <section className="min-w-0 space-y-5 p-5 sm:p-7">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {labels.nextPayout}
          </p>
          <p
            className={cn(
              "mt-1.5 text-4xl font-semibold leading-none tracking-tight tabular-nums sm:text-[44px]",
              (frozen || net === 0) && "text-muted-foreground/70",
            )}
          >
            {money(net)}
          </p>
        </div>

        <div className="space-y-3">
          <StatusPill tone={pill.tone}>{pill.text}</StatusPill>
          {showMeter ? (
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={minimum}
              aria-valuenow={Math.max(0, ready)}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full min-w-1 rounded-full bg-primary"
                style={{ width: `${Math.min(100, Math.max(0, (ready / minimum) * 100))}%` }}
              />
            </div>
          ) : null}
          {caption ? (
            <p className="text-xs text-muted-foreground">{caption}</p>
          ) : null}
        </div>

        {frozen && labels.frozen ? (
          <Note>
            <span>{labels.frozen}</span>
          </Note>
        ) : null}

        {notes.map((note) => (
          <Note key={note.id}>
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{note.title}</span>
              {note.hint ? (
                <span className="mt-0.5 block text-xs opacity-80">{note.hint}</span>
              ) : null}
            </span>
            <span className="font-semibold tabular-nums">{note.value}</span>
          </Note>
        ))}

        {breakdown && hasAdjustments ? (
          <details className="text-sm">
            <summary className="cursor-pointer list-none text-xs font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
              {labels.howCalculated}
            </summary>
            <div className="mt-3">
              <PayoutBreakdown breakdown={breakdown} currency={balance.currency} />
            </div>
          </details>
        ) : null}

        {labels.asOf ? (
          <p className="text-[11px] text-muted-foreground/80">{labels.asOf}</p>
        ) : null}
      </section>

      <section className="min-w-0 border-t p-5 sm:p-7 lg:border-t-0 lg:border-l">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">{labels.onItsWay}</h2>
          {stages.length > 0 ? (
            <span className="text-sm font-semibold tabular-nums">
              {money(onItsWay)}
            </span>
          ) : null}
        </div>

        {stages.length > 0 ? (
          <>
            <div className="mt-4 flex h-2.5 gap-[3px]" aria-hidden="true">
              {stages.map((stage) => (
                <span
                  key={stage.id}
                  className={cn("h-full rounded-full", stage.swatch)}
                  style={{ flex: stage.amount }}
                />
              ))}
            </div>
            <ul className="mt-2 divide-y">
              {stages.map((stage) => (
                <li
                  key={stage.id}
                  className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-3 py-3.5"
                >
                  <span className={cn("size-2.5 rounded-full", stage.swatch)} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{stage.label}</span>
                    {stage.hint ? (
                      <span className="mt-px block text-xs text-muted-foreground">
                        {stage.hint}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {money(stage.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{labels.nothingOnWay}</p>
        )}

        {awaitingCount > 0 && labels.awaitingBalance ? (
          <p
            className={cn(
              "flex items-start gap-2 text-xs text-muted-foreground",
              stages.length > 0 ? "mt-1 border-t pt-3.5" : "mt-5",
            )}
          >
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <span className="block font-medium text-foreground">
                {labels.awaitingBalance} · {awaitingCount}
              </span>
              {labels.awaitingBalanceHint}
            </span>
          </p>
        ) : null}
      </section>
    </Card>
  );
}

function StatusPill({
  tone,
  children,
}: {
  tone: "positive" | "warning" | "neutral";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "positive" && "bg-status-positive text-status-on-positive",
        tone === "warning" && "bg-status-warning text-status-on-warning",
        tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-status-warning px-3.5 py-3 text-sm text-status-on-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {children}
    </div>
  );
}
