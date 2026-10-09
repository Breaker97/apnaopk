"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  RecordActivityList,
  RecordActivityToggle,
} from "@/components/admin/activity-log/record-activity-list";
import { useRecordActivity } from "@/components/admin/activity-log/use-record-activity";

interface ActivityTabProps {
  vendorId: string;
}

/**
 * `changes`: what an admin did to this vendor's record. `actions`: what the
 * vendor and its staff did in the store — the rows that carry this vendor as
 * `actorVendorId`, which an admin's changes to the vendor never do.
 */
type Mode = "changes" | "actions";

export function ActivityTab({ vendorId }: ActivityTabProps) {
  const t = useTranslations("admin.activityLogPage");
  const [mode, setMode] = useState<Mode>("changes");

  const { rows, isLoading, failed, retry } = useRecordActivity(
    mode === "changes" ? `resource=vendor&resourceId=${vendorId}` : `vendor=${vendorId}`,
  );

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="space-y-1.5">
          <CardTitle>{t("recordTabs.title")}</CardTitle>
          <CardDescription>
            {mode === "changes"
              ? t("recordTabs.vendor.changesDescription")
              : t("recordTabs.vendor.actionsDescription")}
          </CardDescription>
        </div>
        <RecordActivityToggle
          value={mode}
          onChange={setMode}
          label={t("recordTabs.vendor.toggleLabel")}
          options={[
            { value: "changes", label: t("recordTabs.vendor.changesTo") },
            { value: "actions", label: t("recordTabs.vendor.actionsBy") },
          ]}
        />
      </CardHeader>
      <CardContent>
        <RecordActivityList
          rows={rows}
          isLoading={isLoading}
          failed={failed}
          onRetry={retry}
          detail={mode === "changes" ? "actor" : "both"}
          emptyText={
            mode === "changes"
              ? t("recordTabs.vendor.emptyChanges")
              : t("recordTabs.vendor.emptyActions")
          }
        />
        {mode === "actions" && !isLoading && !failed ? (
          <p className="mt-4 text-sm">
            <Link
              href={`/admin/settings/activity-log?vendor=${vendorId}&date=all`}
              className="text-primary hover:underline"
            >
              {t("recordTabs.viewAll")}
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
