"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import Link from "@/components/language/link";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ActivityActionBadge,
  FailedMarker,
} from "@/components/admin/activity-log/activity-action";
import { ActivityChangesTable } from "@/components/admin/activity-log/activity-changes-table";
import { useActivityLabels } from "@/components/admin/activity-log/activity-labels";
import { apiClient, describeApiError } from "@/lib/api/client";
import { diffChanges } from "@/lib/activity-log/diff";
import type { ActivityLogEntry } from "@/lib/activity-log/list";
import {
  resourceHref,
  type ActivityLogArea,
} from "@/lib/activity-log/resource-links";
import { formatExactTime, formatRelativeTime } from "@/lib/activity-log/time";

/**
 * One entry in full, beside the list: who did what to which record, the fields
 * it changed (before to after), and — for an admin — the request it came from.
 * Opens from a row click and loads the entry then, because the list leaves the
 * before/after values out.
 *
 * The vendor's sheet reads the same shape from its own endpoint, whose request
 * block is only the IP address and device: the method, path and request id are
 * the platform's, so there is nothing here to hide and nothing to leak.
 */

interface ActivityLogDetailSheetProps {
  entryId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area: ActivityLogArea;
}

type Loaded =
  | { key: string; entry: ActivityLogEntry; error?: undefined }
  | { key: string; error: string; entry?: undefined };

/** The role a `user` entry's own record carries, which is what its link depends on. */
function recordedRole(entry: ActivityLogEntry): string | undefined {
  const role = entry.after?.role ?? entry.before?.role;
  return typeof role === "string" ? role : undefined;
}

export function ActivityLogDetailSheet({
  entryId,
  open,
  onOpenChange,
  area,
}: ActivityLogDetailSheetProps) {
  const t = useTranslations("admin.activityLogPage");
  const locale = useLocale();
  const labels = useActivityLabels();

  // A retry is a new request, so it has a new key and the old answer stops
  // counting without any state being cleared by hand.
  const [attempt, setAttempt] = useState(0);
  const requestKey = entryId ? `${entryId}:${attempt}` : "";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const current = loaded?.key === requestKey ? loaded : null;
  const entry = current?.entry ?? null;

  const loadFailed = t("sheet.loadFailed");
  useEffect(() => {
    if (!open || !entryId) return;
    const controller = new AbortController();
    const path =
      area === "vendor"
        ? `/api/vendor/activity-log/${entryId}`
        : `/api/admin/audit-logs/${entryId}`;
    apiClient
      .get<ActivityLogEntry>(path, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setLoaded({ key: requestKey, entry: data });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoaded({ key: requestKey, error: describeApiError(error, loadFailed) });
      });
    return () => controller.abort();
  }, [open, entryId, area, requestKey, loadFailed]);

  const rows = useMemo(
    () => (entry ? diffChanges(entry.before, entry.after, { fields: entry.fields }) : []),
    [entry],
  );

  const href = entry
    ? resourceHref({ ...entry, targetRole: recordedRole(entry) }, area)
    : null;
  const exact = entry ? formatExactTime(entry.createdAt, locale) : "";
  // The sheet draws after the click, never during the server render, so a clock
  // read here cannot disagree with a server's.
  const relative = entry ? formatRelativeTime(entry.createdAt, new Date(), locale) : "";

  const actorName = entry
    ? entry.userEmail || (entry.userRole === "system" ? t("system") : t("unknownActor"))
    : "";
  const resourceName = entry
    ? [labels.resource(entry.resource), entry.resourceName].filter(Boolean).join(" · ")
    : "";

  const request: Array<[string, string | undefined]> = entry
    ? [
        [t("sheet.ip"), entry.ip],
        [t("sheet.device"), entry.userAgent],
        ...(area === "admin"
          ? ([
              [t("sheet.method"), stringOf(entry.metadata?.method)],
              [t("sheet.path"), stringOf(entry.metadata?.path)],
              [t("sheet.requestId"), stringOf(entry.metadata?.requestId)],
            ] as Array<[string, string | undefined]>)
          : []),
      ]
    : [];
  const requestRows = request.filter((row): row is [string, string] => Boolean(row[1]));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-[560px]"
        // A loading or failed frame has no description of its own to point at.
        {...(!entry ? { "aria-describedby": undefined } : {})}
      >
        {!entry && !current?.error ? (
          <div className="grid gap-4 p-6" role="status" aria-live="polite">
            <SheetTitle className="sr-only">{t("sheet.loading")}</SheetTitle>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : null}

        {current?.error ? (
          <div className="grid gap-4 p-6">
            <SheetTitle className="sr-only">{t("sheet.title")}</SheetTitle>
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="min-w-0">{current.error}</p>
            </div>
            <div>
              <Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
                {t("sheet.retry")}
              </Button>
            </div>
          </div>
        ) : null}

        {entry ? (
          <>
            <SheetHeader className="gap-2 border-b px-6 pb-4 pe-12 pt-5">
              <div className="flex flex-wrap items-center gap-2">
                <ActivityActionBadge action={entry.action} resource={entry.resource} />
                {!entry.success ? <FailedMarker label={t("failed")} /> : null}
              </div>
              <SheetTitle className="text-base leading-snug">
                {entry.summary || `${labels.action(entry.action)} · ${labels.resource(entry.resource)}`}
              </SheetTitle>
              <SheetDescription>
                {[actorName, relative].filter(Boolean).join(" · ")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-6">
              <section className="grid gap-3 border-b py-4">
                <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t("sheet.when")}</dt>
                  <dd>
                    <time dateTime={entry.createdAt}>{exact}</time>
                  </dd>

                  <dt className="text-muted-foreground">{t("sheet.actor")}</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    {actorName}
                    {entry.userRole ? (
                      <span className="text-muted-foreground">
                        {" "}
                        ({labels.role(entry.userRole)})
                      </span>
                    ) : null}
                  </dd>

                  {entry.actorVendorName ? (
                    <>
                      <dt className="text-muted-foreground">{t("sheet.store")}</dt>
                      <dd className="[overflow-wrap:anywhere]">{entry.actorVendorName}</dd>
                    </>
                  ) : null}

                  <dt className="text-muted-foreground">{t("sheet.resource")}</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    {href ? (
                      <Link href={href} className="font-medium text-primary hover:underline">
                        {resourceName}
                      </Link>
                    ) : (
                      resourceName
                    )}
                  </dd>

                  {entry.errorMessage ? (
                    <>
                      <dt className="text-muted-foreground">{t("sheet.errorMessage")}</dt>
                      <dd className="text-destructive [overflow-wrap:anywhere]">
                        {entry.errorMessage}
                      </dd>
                    </>
                  ) : null}
                </dl>
              </section>

              {rows.length > 0 ? (
                <section className="grid gap-3 border-b py-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("sheet.changes")}
                  </h3>
                  <ActivityChangesTable rows={rows} />
                </section>
              ) : entry.fields?.length ? (
                // A row that names what changed and recorded no values.
                <section className="grid gap-2 border-b py-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("sheet.changes")}
                  </h3>
                  <p className="text-sm font-mono [overflow-wrap:anywhere]">
                    {t("sheet.fieldsChanged", { fields: entry.fields.join(", ") })}
                  </p>
                </section>
              ) : null}

              {requestRows.length > 0 ? (
                <section className="grid gap-3 border-b py-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("sheet.request")}
                  </h3>
                  <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                    {requestRows.map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="[overflow-wrap:anywhere]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ) : null}

              <section className="py-4">
                <details className="group rounded-lg border">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
                    {t("sheet.rawData")}
                  </summary>
                  <pre className="max-h-80 overflow-auto border-t bg-muted/40 p-3 text-xs">
                    {JSON.stringify(entry, null, 2)}
                  </pre>
                </details>
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const stringOf = (value: unknown) =>
  typeof value === "string" && value ? value : undefined;
