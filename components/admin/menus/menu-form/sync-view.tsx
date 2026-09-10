"use client";

import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MAX_MEGA_MENU_DEPTH } from "@/lib/site-config/menu-depth";
import type {
  CategoryMenuNode,
  PendingCategorySync,
} from "@/components/admin/menus/menu-form/helpers";

type RowState = "added" | "updated" | "removed" | "unchanged" | "skipped";

export type SyncLabels = {
  title: string;
  subtitle: string;
  source: string;
  sourceCount: (rows: number, skipped: number) => string;
  refresh: string;
  loading: string;
  empty: string;
  notMega: string;
  setMega: string;
  apply: string;
  discard: string;
  applyHint: string;
  keepsTitle: string;
  keeps: string[];
  roleRail: string;
  roleColumn: string;
  roleLink: string;
  roleSkipped: string;
  stateAdded: string;
  stateUpdated: string;
  stateRemoved: string;
  stateUnchanged: string;
  stateSkipped: string;
  removedTitle: (count: number) => string;
};

/**
 * Sync is where the menu learns its shape, so the screen is built to teach the
 * rule rather than hide it: every catalog row is stamped with the role it will
 * take, and rows past the third level are stamped as skipped instead of
 * quietly vanishing from the import.
 */
export function MegaSyncView({
  isMegaMenu,
  isSyncing,
  source,
  pendingSync,
  labels,
  onRefresh,
  onApply,
  onDiscard,
  onSetMegaLocation,
}: {
  isMegaMenu: boolean;
  isSyncing: boolean;
  source: CategoryMenuNode[];
  pendingSync: PendingCategorySync | null;
  labels: SyncLabels;
  onRefresh: () => void;
  onApply: () => void;
  onDiscard: () => void;
  onSetMegaLocation: () => void;
}) {
  const stateByUrl = new Map<string, RowState>();
  pendingSync?.diff.added.forEach((item) => {
    if (item.url) stateByUrl.set(item.url, "added");
  });
  pendingSync?.diff.changed.forEach((entry) => {
    if (entry.incoming.url) stateByUrl.set(entry.incoming.url, "updated");
  });

  const rows: {
    node: CategoryMenuNode;
    depth: number;
    state: RowState;
  }[] = [];
  const walk = (node: CategoryMenuNode, depth: number) => {
    const url = `/products?category=${encodeURIComponent(node.slug)}`;
    const state: RowState =
      depth >= MAX_MEGA_MENU_DEPTH
        ? "skipped"
        : stateByUrl.get(url) || "unchanged";
    rows.push({ node, depth, state });
    (node.children || []).forEach((child) => walk(child, depth + 1));
  };
  source.forEach((root) => walk(root, 0));

  const tally = rows.reduce(
    (acc, row) => ({ ...acc, [row.state]: acc[row.state] + 1 }),
    { added: 0, updated: 0, removed: 0, unchanged: 0, skipped: 0 } as Record<
      RowState,
      number
    >,
  );
  const removed = pendingSync?.diff.removed || [];

  return (
    <div className="grid min-h-0 xl:grid-cols-[minmax(0,1fr)_20.5rem]">
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{labels.source}</h3>
          <p className="text-xs tabular-nums text-muted-foreground">
            {labels.sourceCount(rows.length - tally.skipped, tally.skipped)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <DiffChip value={tally.added} label={labels.stateAdded} tone="added" />
          <DiffChip
            value={tally.updated}
            label={labels.stateUpdated}
            tone="updated"
          />
          <DiffChip
            value={removed.length}
            label={labels.stateRemoved}
            tone="removed"
          />
          <DiffChip value={tally.unchanged} label={labels.stateUnchanged} />
          <DiffChip value={tally.skipped} label={labels.stateSkipped} />
        </div>

        {isSyncing ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {labels.loading}
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            {labels.empty}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            {rows.map((row, index) => (
              <SyncRow
                key={`${row.node._id}-${index}`}
                node={row.node}
                depth={row.depth}
                state={row.state}
                labels={labels}
                isFirst={index === 0}
              />
            ))}
          </div>
        )}

        {removed.length > 0 ? (
          <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
            <p className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5" />
              {labels.removedTitle(removed.length)}
            </p>
            {removed.map((item, index) => (
              <p
                key={`${item.url}-${index}`}
                className="truncate text-xs text-amber-900/80 dark:text-amber-200/80"
              >
                {item.label}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <aside className="flex flex-col gap-3 border-t bg-muted/30 p-4 xl:border-s xl:border-t-0">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            {labels.title}
          </p>
          <p className="text-sm font-semibold">{labels.subtitle}</p>
        </div>

        <div className="space-y-2 rounded-lg border bg-background p-3">
          <p className="text-xs font-semibold">{labels.keepsTitle}</p>
          <ul className="space-y-1.5">
            {labels.keeps.map((line) => (
              <li key={line} className="flex gap-2 text-xs text-muted-foreground">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        {!isMegaMenu ? (
          <Button type="button" variant="outline" onClick={onSetMegaLocation}>
            {labels.setMega}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="gap-2"
          disabled={isSyncing}
          onClick={onRefresh}
        >
          {isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {labels.refresh}
        </Button>

        <div className="mt-auto space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-[11px] leading-snug text-muted-foreground">
            {labels.applyHint}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={!pendingSync}
              onClick={onDiscard}
            >
              {labels.discard}
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={!pendingSync}
              onClick={onApply}
            >
              {labels.apply}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function DiffChip({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: "added" | "updated" | "removed";
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
      <b
        className={cn(
          "text-[15px] font-semibold tabular-nums",
          tone === "added" && "text-emerald-600",
          tone === "updated" && "text-primary",
          tone === "removed" && "text-amber-600",
          !tone && "text-foreground",
        )}
      >
        {value}
      </b>
      {label}
    </span>
  );
}

const ROLE_KEY = ["roleRail", "roleColumn", "roleLink", "roleSkipped"] as const;
const STATE_KEY: Record<RowState, keyof SyncLabels> = {
  added: "stateAdded",
  updated: "stateUpdated",
  removed: "stateRemoved",
  unchanged: "stateUnchanged",
  skipped: "stateSkipped",
};

function SyncRow({
  node,
  depth,
  state,
  labels,
  isFirst,
}: {
  node: CategoryMenuNode;
  depth: number;
  state: RowState;
  labels: SyncLabels;
  isFirst: boolean;
}) {
  const role = ROLE_KEY[Math.min(depth, 3)];

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-2 px-3 py-1.5 text-[13px]",
        !isFirst && "border-t",
        depth === 0 && "bg-muted/40 font-semibold",
        depth >= MAX_MEGA_MENU_DEPTH && "bg-muted/30",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className="shrink-0 font-mono text-[11px] text-muted-foreground/40"
          style={{ paddingInlineStart: `${depth * 0.9}rem` }}
        >
          {depth === 0 ? "" : "└─"}
        </span>
        <span
          className={cn(
            "truncate",
            depth === 1 && "font-medium",
            depth >= MAX_MEGA_MENU_DEPTH
              ? "text-muted-foreground/70"
              : depth === 2 && "text-muted-foreground",
          )}
        >
          {node.name}
        </span>
      </span>

      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-center font-mono text-[10px] uppercase tracking-wide",
          depth === 0 && "bg-primary text-primary-foreground",
          depth === 1 && "bg-primary/10 text-primary",
          depth === 2 && "bg-muted text-muted-foreground",
          depth >= MAX_MEGA_MENU_DEPTH && "bg-amber-100 text-amber-800",
        )}
      >
        {labels[role]}
      </span>

      <span
        className={cn(
          "text-end text-[11px] font-semibold",
          state === "added" && "text-emerald-600",
          state === "updated" && "text-primary",
          state === "skipped" && "text-amber-700",
          state === "unchanged" && "font-normal text-muted-foreground",
        )}
      >
        {labels[STATE_KEY[state]] as string}
      </span>
    </div>
  );
}
