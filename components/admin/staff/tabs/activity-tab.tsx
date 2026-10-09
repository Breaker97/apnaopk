"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useActivityLabels } from "@/components/admin/activity-log/activity-labels";
import {
  RecordActivityList,
  RecordActivityToggle,
} from "@/components/admin/activity-log/record-activity-list";
import { useRecordActivity } from "@/components/admin/activity-log/use-record-activity";
import { cn } from "@/lib/utils";

interface ActivityTabProps {
  staffId: string;
}

/**
 * `all`: everything about this member. `by`: what they did. `on`: what was done
 * to their account: changes made to it, and sign-ins that failed on it.
 */
type Mode = "all" | "by" | "on";

export function ActivityTab({ staffId }: ActivityTabProps) {
  const t = useTranslations("admin.activityLogPage");
  const labels = useActivityLabels();
  const [mode, setMode] = useState<Mode>("all");
  const [action, setAction] = useState<string | null>(null);

  // A user id as the actor and as the record are different questions about the
  // same person. The API answers either half, or both, for one `member`.
  const { rows, isLoading, failed, retry } = useRecordActivity(
    mode === "all" ? `member=${staffId}` : `member=${staffId}&side=${mode}`,
  );

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.action, (map.get(row.action) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const visible = action ? rows.filter((row) => row.action === action) : rows;

  const copy = `recordTabs.staff.${mode}.description` as const;
  const emptyCopy = `recordTabs.staff.${mode}.empty` as const;

  const changeMode = (next: Mode) => {
    setMode(next);
    // The counts belong to the list that was on screen.
    setAction(null);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader className="gap-3">
            <div className="space-y-1.5">
              <CardTitle>{t("recordTabs.title")}</CardTitle>
              <CardDescription>{t(copy)}</CardDescription>
            </div>
            <RecordActivityToggle
              value={mode}
              onChange={changeMode}
              label={t("recordTabs.staff.toggleLabel")}
              options={[
                { value: "all", label: t("recordTabs.staff.all.label") },
                { value: "by", label: t("recordTabs.staff.by.label") },
                { value: "on", label: t("recordTabs.staff.on.label") },
              ]}
            />
          </CardHeader>
          <CardContent>
            <RecordActivityList
              rows={visible}
              isLoading={isLoading}
              failed={failed}
              onRetry={retry}
              detail={mode === "all" ? "direction" : mode === "by" ? "record" : "actor"}
              member={{
                id: staffId,
                byLabel: t("recordTabs.staff.by.label"),
                onLabel: t("recordTabs.staff.on.label"),
              }}
              emptyText={rows.length === 0 ? t(emptyCopy) : t("recordTabs.noEntriesForFilter")}
            />
            {mode === "by" && !isLoading && !failed ? (
              <p className="mt-4 text-sm">
                <Link
                  href={`/admin/settings/activity-log?actor=${staffId}&date=all`}
                  className="text-primary hover:underline"
                >
                  {t("recordTabs.viewAll")}
                </Link>
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle>{t("recordTabs.filterTitle")}</CardTitle>
            <CardDescription>{t("recordTabs.filterDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <button
              type="button"
              onClick={() => setAction(null)}
              className={cn(
                "flex w-full items-center justify-between gap-3 border-b py-2 text-left",
                !action && "font-medium",
              )}
            >
              <span>{t("recordTabs.allActivity")}</span>
              <span className="tabular-nums text-muted-foreground">{rows.length}</span>
            </button>
            {counts.length === 0 ? (
              <p className="py-2 text-muted-foreground">{t("recordTabs.nothingRecorded")}</p>
            ) : (
              counts.map(([key, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAction(key === action ? null : key)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b py-2 text-left last:border-b-0",
                    action === key && "font-medium text-primary",
                  )}
                >
                  <span>{labels.action(key)}</span>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </button>
              ))
            )}
            {action ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => setAction(null)}
              >
                {t("recordTabs.clearFilter")}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
