"use client";

import { useLocale, useTranslations } from "next-intl";
import { History, TriangleAlert } from "lucide-react";
import {
  ActivityActionBadge,
  FailedMarker,
} from "@/components/admin/activity-log/activity-action";
import { useActivityLabels } from "@/components/admin/activity-log/activity-labels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ActivityLogRow } from "@/lib/activity-log/list";
import { formatShortTime } from "@/lib/activity-log/time";
import { cn } from "@/lib/utils";

/**
 * The pieces the staff and vendor detail pages' Activity tabs share: the
 * switch between "changes to this record" and "actions by it", and the list of
 * entries, with its loading, failed and empty states.
 */

export interface RecordActivityMode<T extends string> {
  value: T;
  label: string;
}

/** A two-way switch. A group of toggle buttons: each says whether it is on. */
export function RecordActivityToggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: RecordActivityMode<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-[3px]"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? "secondary" : "ghost"}
          aria-pressed={option.value === value}
          className={cn(
            "h-8 px-3 text-sm",
            // The `secondary` variant's text is made for its own background, which
            // this replaces: a theme with a dark `--secondary` gives white text on
            // `bg-background`, so the label has to be set to match.
            option.value === value &&
              "bg-background text-foreground shadow-sm hover:bg-background",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

interface RecordActivityListProps {
  rows: ActivityLogRow[];
  isLoading: boolean;
  failed: boolean;
  onRetry: () => void;
  /**
   * What an entry's last line says: who did it (the changes made to a record),
   * what it was done to (the actions someone took), or both (the actions of a
   * whole team, where the person matters as much as the thing). `direction` is
   * for one person's whole history: each entry says which of the two it is, by
   * `member`'s own hand or done to their account, and reads like that kind.
   */
  detail: "actor" | "record" | "both" | "direction";
  /** With `direction`: the person the history belongs to. */
  member?: { id: string; byLabel: string; onLabel: string };
  emptyText: string;
}

/**
 * Who an entry was done by. A failed sign-in has no actor: its `userEmail` is the
 * address that was tried, and nobody knows who typed it, so naming it would
 * blame the account's owner for someone else's attempt.
 */
function actorOf(row: ActivityLogRow, system: string): string {
  if (row.action === "LOGIN_FAILED") return "";
  return row.userEmail || system;
}

export function RecordActivityList({
  rows,
  isLoading,
  failed,
  onRetry,
  detail,
  member,
  emptyText,
}: RecordActivityListProps) {
  const t = useTranslations("admin.activityLogPage");
  const locale = useLocale();
  const labels = useActivityLabels();

  if (isLoading) {
    return (
      <ul className="space-y-4" role="status" aria-label={t("sheet.loading")}>
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="flex gap-3">
            <Skeleton className="mt-1.5 h-2 w-2 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-4 w-3/4" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (failed) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center gap-3 py-10 text-center"
      >
        <TriangleAlert aria-hidden="true" className="h-8 w-8 text-destructive" />
        <p className="text-sm">{t("recordTabs.loadFailed")}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("recordTabs.retry")}
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <History className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {rows.map((row) => {
        // In one person's whole history each entry decides for itself: what they
        // did says what it touched, what was done to them says who did it.
        const byMember = detail === "direction" && row.userId === member?.id;
        const showActor =
          detail === "actor" || detail === "both" || (detail === "direction" && !byMember);
        const showRecord = detail === "record" || detail === "both" || byMember;
        const actor = showActor ? actorOf(row, t("system")) : "";

        return (
          <li key={row._id} className="flex gap-3">
            <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <ActivityActionBadge action={row.action} resource={row.resource} />
                {!row.success ? <FailedMarker label={t("failed")} /> : null}
                <time
                  dateTime={row.createdAt}
                  className="text-xs text-muted-foreground"
                >
                  {formatShortTime(row.createdAt, locale)}
                </time>
                {detail === "direction" && member ? (
                  <span className="rounded-sm border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {byMember ? member.byLabel : member.onLabel}
                  </span>
                ) : null}
              </div>
              {row.summary ? (
                <p className="mt-1 text-sm [overflow-wrap:anywhere]">{row.summary}</p>
              ) : row.fields?.length ? (
                <p className="mt-1 text-sm">
                  {t("recordTabs.changed", { fields: row.fields.join(", ") })}
                </p>
              ) : null}
              <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {[
                  actor ? t("recordTabs.by", { actor }) : "",
                  showRecord
                    ? [labels.resource(row.resource), row.resourceName].filter(Boolean).join(" · ")
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
