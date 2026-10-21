"use client";

import { useState, type ComponentType } from "react";
import {
  AlertTriangle,
  Boxes,
  Clock3,
  Coins,
  Link2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Label, Money, Position, Report } from "./shared";

type Issue = Report["issues"][number];
type Source = Report["saleCoverage"]["sources"][number];
type Tone = "red" | "amber" | "gray";

const TONES: Record<Tone, string> = {
  red: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  amber:
    "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  gray: "bg-muted text-muted-foreground",
};

type Item = {
  id: string;
  tone: Tone;
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  /** One button; rows with several things to act on open a list instead. */
  action?: { label: string; onClick: () => void; busy?: boolean };
  chip?: string;
  details?: Array<{
    id: string;
    title: string;
    body?: string;
    action?: { label: string; onClick: () => void; busy?: boolean };
  }>;
};

/**
 * What needs doing, and nothing else. Each row is a problem with a way to act
 * on it; a store whose stock and ledger agree sees no list at all, rather than
 * a wall of zeros saying so.
 */
export function InventoryAttentionList({
  report,
  currency,
  allowFinance,
  allowAdjust,
  repairing,
  onRetry,
  onSetCost,
  onShowMissingCost,
  onLinkSource,
  label,
  money,
}: {
  report: Report;
  currency: string;
  allowFinance: boolean;
  allowAdjust: boolean;
  /** The operation being retried, if any. */
  repairing: string;
  onRetry: (issues: Issue[]) => void;
  onSetCost: (position: Position) => void;
  onShowMissingCost: () => void;
  onLinkSource: (source: Source) => void;
  label: Label;
  money: Money;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const conflicts = report.issues.filter((issue) => issue.state === "conflict");
  const pending = report.issues.filter((issue) => issue.state !== "conflict");
  const uncostedPositions = report.positions.filter(
    (position) => position.missingCostQuantity > 0,
  );
  const sources = report.saleCoverage.sources;
  const issueDetail = (issue: Issue, index: number) => ({
    id: issue.operationId,
    title: label("recordedChange", "Recorded change {number}", {
      number: index + 1,
    }),
    body: [issue.operationId, issue.error].filter(Boolean).join(" · "),
  });

  const items: Item[] = [];
  if (report.legacyProducts > 0)
    items.push({
      id: "legacy",
      tone: "amber",
      icon: Boxes,
      title: label(
        "attentionLegacyTitle",
        "Opening stock for {count} products hasn’t been moved in yet",
        { count: report.legacyProducts },
      ),
      body: label(
        "attentionLegacyBody",
        "Their stock is still in the old records, so it isn’t valued here, and the ledger can’t match until it is.",
      ),
      chip: label("attentionLegacyChip", "Comes with the balance migration"),
    });
  if (conflicts.length > 0)
    items.push({
      id: "conflicts",
      tone: "red",
      icon: AlertTriangle,
      title: label(
        "attentionConflictTitle",
        "{count} stock changes couldn’t reach the ledger",
        { count: conflicts.length },
      ),
      body: label(
        "attentionConflictBody",
        "Their ledger entries don’t match what was recorded, so they need a bookkeeping review.",
      ),
      action: {
        label: label("review", "Review"),
        onClick: () => setOpen((id) => (id === "conflicts" ? null : "conflicts")),
      },
      details: conflicts.map(issueDetail),
    });
  if (pending.length > 0)
    items.push({
      id: "pending",
      tone: "amber",
      icon: Clock3,
      title: label(
        "attentionPendingTitle",
        "{count} stock changes are waiting to reach the ledger",
        { count: pending.length },
      ),
      body: label(
        "attentionPendingBody",
        "They’re saved in stock; their ledger entries didn’t finish. Retrying is safe.",
      ),
      action: allowFinance
        ? {
            label: label("retry", "Retry"),
            busy: Boolean(repairing),
            onClick: () => onRetry(pending),
          }
        : undefined,
    });
  if (report.missingCostQuantity > 0) {
    const only = uncostedPositions.length === 1 ? uncostedPositions[0] : null;
    items.push({
      id: "missing-cost",
      tone: "amber",
      icon: Coins,
      title: label("attentionNoCostTitle", "{count} units have no cost", {
        count: report.missingCostQuantity,
      }),
      body: only
        ? label(
            "attentionNoCostOne",
            "{product} at {location} counts as {zero} until you set a cost.",
            {
              product: only.productName,
              location: only.locationName ?? label("unassigned", "Unassigned location"),
              zero: money(0, currency),
            },
          )
        : label(
            "attentionNoCostBody",
            "Stock with no cost counts as {zero} until you set one.",
            { zero: money(0, currency) },
          ),
      action:
        only && allowFinance
          ? { label: label("setCost", "Set cost"), onClick: () => onSetCost(only) }
          : uncostedPositions.length > 1
            ? { label: label("showThem", "Show them"), onClick: onShowMissingCost }
            : undefined,
    });
  }
  if (sources.length > 0)
    items.push({
      id: "sources",
      tone: "gray",
      icon: Link2,
      title: label(
        "attentionSourcesTitle",
        "{count} digital sales need their cost",
        { count: sources.length },
      ),
      body: label(
        "attentionSourcesBody",
        "Link the expense that paid for them, so their cost of goods is right.",
      ),
      action: allowFinance
        ? sources.length === 1
          ? {
              label: label("linkExpense", "Link expense"),
              onClick: () => onLinkSource(sources[0]),
            }
          : {
              label: label("linkExpense", "Link expense"),
              onClick: () => setOpen((id) => (id === "sources" ? null : "sources")),
            }
        : undefined,
      details:
        sources.length > 1
          ? sources.map((source) => ({
              id: `${source.orderId}:${source.lineId}`,
              title: source.productName,
              body: label("sourceLine", "{count} units · estimated {estimate}", {
                count: source.quantity,
                estimate:
                  source.estimate == null
                    ? label("missingCost", "Cost missing")
                    : money(source.estimate, source.currency),
              }),
              action: allowFinance
                ? {
                    label: label("linkExpense", "Link expense"),
                    onClick: () => onLinkSource(source),
                  }
                : undefined,
            }))
          : undefined,
    });
  if (report.deferredCostQuantity > 0)
    items.push({
      id: "deferred",
      tone: "gray",
      icon: Clock3,
      title: label(
        "attentionDeferredTitle",
        "{count} sold units are waiting for their stock",
        { count: report.deferredCostQuantity },
      ),
      body: label(
        "attentionDeferredBody",
        "They were sold before the stock was received. Their cost posts once it arrives.",
      ),
    });
  if (report.saleCoverage.currencyIssueQuantity > 0)
    items.push({
      id: "fx",
      tone: "amber",
      icon: Coins,
      title: label(
        "attentionFxTitle",
        "{count} sold units need an exchange rate",
        { count: report.saleCoverage.currencyIssueQuantity },
      ),
      body: label(
        "attentionFxBody",
        "Their cost is in another currency, so it can’t post until the rate is recorded.",
      ),
    });
  if (report.negativeAvailableQuantity > 0)
    items.push({
      id: "oversold",
      tone: "red",
      icon: AlertTriangle,
      title: label("attentionOversoldTitle", "{count} units are oversold", {
        count: report.negativeAvailableQuantity,
      }),
      body: allowAdjust
        ? label(
            "attentionOversoldBody",
            "More was sold than was in stock. Count the stock and adjust it to correct this.",
          )
        : label(
            "attentionOversoldBodyReadOnly",
            "More was sold than was in stock. Someone who can adjust stock needs to count it.",
          ),
    });

  if (items.length === 0) return null;

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-xs">
      <div className="flex items-center gap-2 px-6 pb-3 pt-5">
        <h2 className="text-base font-semibold">
          {label("needsAttention", "Needs attention")}
        </h2>
        <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
          {items.length}
        </span>
      </div>
      <ul>
        {items.map((item) => {
          const Icon = item.icon;
          const expanded = open === item.id && item.details?.length;
          return (
            <li key={item.id} className="border-t border-border/60">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-3.5">
                <span
                  className={cn(
                    "inline-flex size-9 shrink-0 items-center justify-center rounded-[10px]",
                    TONES[item.tone],
                  )}
                >
                  <Icon aria-hidden="true" className="size-[18px]" />
                </span>
                <div className="min-w-0 flex-[1_1_20rem]">
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {item.body}
                  </p>
                </div>
                {item.action ? (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={item.details ? Boolean(expanded) : undefined}
                    disabled={item.action.busy}
                    onClick={item.action.onClick}
                  >
                    {item.action.busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : null}
                    {item.action.label}
                  </Button>
                ) : null}
                {item.chip ? (
                  <span className="inline-flex h-7 items-center whitespace-nowrap rounded-full bg-muted px-3 text-xs font-medium text-muted-foreground">
                    {item.chip}
                  </span>
                ) : null}
              </div>
              {expanded ? (
                <ul className="mx-6 mb-3.5 divide-y rounded-xl border bg-muted/20">
                  {item.details!.map((detail) => (
                    <li
                      key={detail.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium">{detail.title}</p>
                        {detail.body ? (
                          <p className="mt-0.5 break-all text-xs text-muted-foreground">
                            {detail.body}
                          </p>
                        ) : null}
                      </div>
                      {detail.action ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
                          onClick={detail.action.onClick}
                        >
                          {detail.action.label}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
