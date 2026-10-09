"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Circle,
  EllipsisVertical,
  Info,
  Mail,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DataTablePagination,
  type DataTablePaginationType,
} from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast-notification";
import { WarningBanner } from "@/components/ui/warning-banner";
import {
  UnderlineTabsList,
  UnderlineTabsTrigger,
} from "@/components/admin/underline-tabs";
import { useDebounce } from "@/hooks/use-debounce";
import type {
  DeliveryLogCounts,
  DeliveryLogGroup,
} from "@/lib/notifications/delivery-log-groups";
import { cn } from "@/lib/utils";

type DeliveryStatus =
  | "queued"
  | "sending"
  | "retrying"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed"
  /** Email only: called off by an admin before it went. */
  | "cancelled";

type Delivery = {
  _id: string;
  to: string;
  /** Email only. */
  subject?: string;
  /** SMS only — the text itself, which is short enough to keep. */
  body?: string;
  /** SMS only — billable segments. */
  segments?: number;
  category: string;
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: string;
};

type LogData = {
  deliveries: Delivery[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  /** Rows per tab, over the date range and search. */
  stats: DeliveryLogCounts;
  /** Every sent row, whatever the filters: what "Clear sent" deletes. */
  clearable: number;
  retentionDays: number;
  /** SMS only: whether Twilio can report deliveries back to this store. */
  receipts?: { enabled: boolean; origin: string };
};

export type DeliveryLogTab = "all" | DeliveryLogGroup;
type Tab = DeliveryLogTab;
type Range = "all" | "today" | "7d" | "30d" | "90d";
export type LogRetentionDays = 7 | 30 | 90;

const RETENTION_OPTIONS: readonly LogRetentionDays[] = [7, 30, 90];
const EMPTY_COUNTS: DeliveryLogCounts = { total: 0, sent: 0, failed: 0, waiting: 0 };

/**
 * The email and SMS outboxes share one log; what differs is the endpoint, the
 * words (`admin.settings.deliveryLogs.<kind>`), and the statuses: a text also
 * learns from the carrier whether it was delivered.
 */
const KINDS = {
  email: { endpoint: "/api/admin/email-deliveries", icon: Mail },
  sms: { endpoint: "/api/admin/sms-deliveries", icon: MessageSquareText },
} as const;

/** Orders-style badges: sent is neutral, green only for a confirmed delivery. */
const BADGE_CLASS: Record<DeliveryStatus, string> = {
  delivered:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  sent: "bg-slate-100 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200",
  failed: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  undelivered: "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  queued: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  sending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  retrying: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  cancelled: "bg-muted text-muted-foreground",
};

const TAB_CLASS = "gap-1 px-2 @md:gap-2 @md:px-4";

/** Nothing more happens to it on its own, so it can be deleted. */
function isFinished(status: DeliveryStatus) {
  return status !== "queued" && status !== "sending" && status !== "retrying";
}

function isFailed(status: DeliveryStatus) {
  return status === "failed" || status === "undelivered";
}

function isRetryable(status: DeliveryStatus) {
  return isFailed(status) || status === "retrying";
}

/**
 * Settings → Email and Settings → SMS: what went out, what the provider (and
 * for a text, the carrier) said, and what to do about what did not.
 *
 * The tabs carry the counts and the table follows them, both over the same
 * date range and search: four stat boxes used to count the whole outbox above
 * a table of the last 30 days. Actions show only once rows are picked, and
 * how long sent rows are kept is a menu choice that saves at once rather than
 * an edit for the page's save bar.
 */
export function DeliveryLogs(props: {
  kind: keyof typeof KINDS;
  retentionDays: LogRetentionDays;
  /** Saves the choice at once: it is not part of the page's form. */
  onRetentionDaysChange: (days: LogRetentionDays) => void | Promise<unknown>;
  /** Render nothing while the log is empty, for a page that is switched off. */
  hideWhenEmpty?: boolean;
  /** Changing it loads the log again, after the page itself added a row. */
  refreshKey?: number;
  /** The tab it opens on; read once, so remount (a new key) to apply another. */
  initialTab?: Tab;
}) {
  const { kind, hideWhenEmpty, refreshKey } = props;
  const config = KINDS[kind];
  const t = useTranslations("admin.settings.deliveryLogs");
  const tSettings = useTranslations("admin.settings");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const kindText = (key: string, values?: Record<string, string | number>) =>
    t(`${kind}.${key}`, values);

  const [data, setData] = useState<LogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savingRetention, setSavingRetention] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounce(searchInput.trim(), 300);
  const [appliedSearch, setAppliedSearch] = useState(search);
  const [tab, setTab] = useState<Tab>(props.initialTab ?? "all");
  const [range, setRange] = useState<Range>("all");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [deleteIds, setDeleteIds] = useState<string[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // A new search starts at its first page.
  if (appliedSearch !== search) {
    setAppliedSearch(search);
    setPage(1);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        range,
      });
      if (tab !== "all") params.set("group", tab);
      if (search) params.set("search", search);
      const response = await fetch(`${config.endpoint}?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as { success?: boolean; data?: LogData };
      if (!response.ok || !payload.success || !payload.data) throw new Error();
      setData(payload.data);
      setSelected(new Set());
    } catch {
      toast.error(tSettings("toasts.deliveryLogsLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [config.endpoint, limit, page, range, search, tab, tSettings]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  const formatDate = useMemo(() => {
    const format = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return (value: string) => format.format(new Date(value));
  }, [locale]);

  const counts = data?.stats ?? EMPTY_COUNTS;
  const deliveries = data?.deliveries ?? [];
  const filtered = Boolean(search) || range !== "all";
  // Nothing was ever logged (or all of it was cleared): the counts cover the
  // whole log when no range or search narrows them.
  const empty = data !== null && counts.total === 0 && !filtered;

  const selectable = deliveries.filter((delivery) => isFinished(delivery.status));
  const allChecked =
    selectable.length > 0 && selectable.every((delivery) => selected.has(delivery._id));
  const picked = deliveries.filter((delivery) => selected.has(delivery._id));
  const pickedFailed = picked.filter((delivery) => isFailed(delivery.status));

  const toggleAll = (checked: boolean) => {
    setSelected(
      checked ? new Set(selectable.map((delivery) => delivery._id)) : new Set(),
    );
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const retryOne = async (id: string) => {
    setBusy(true);
    try {
      const response = await fetch(`${config.endpoint}/${id}/retry`, {
        method: "POST",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message || t("retryFailed"));
      toast.success(t("retrySent"));
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("retryFailed"));
    } finally {
      setBusy(false);
      await load();
    }
  };

  /** A bulk retry or delete; true once the server took it. */
  const bulkRequest = async (
    method: "POST" | "DELETE",
    body: Record<string, unknown>,
  ) => {
    setBusy(true);
    try {
      const response = await fetch(config.endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        message?: string;
        data?: { queued?: number; deleted?: number };
      };
      if (!response.ok) throw new Error(payload.message || t("actionFailed"));
      toast.success(
        typeof payload.data?.deleted === "number"
          ? t("deleted", { count: payload.data.deleted })
          : typeof payload.data?.queued === "number"
            ? kindText("queuedForRetry", { count: payload.data.queued })
            : t("updated"),
      );
      if (method === "DELETE" && page > 1) setPage(1);
      else await load();
      return true;
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : t("actionFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeRetention = async (value: string) => {
    const days = Number(value) as LogRetentionDays;
    if (days === props.retentionDays || !RETENTION_OPTIONS.includes(days)) return;
    setSavingRetention(true);
    try {
      await props.onRetentionDaysChange(days);
    } finally {
      setSavingRetention(false);
    }
  };

  const resetView = () => {
    setTab("all");
    setRange("all");
    setSearchInput("");
    setPage(1);
  };

  if (hideWhenEmpty && (data === null || empty)) return null;

  const pagination: DataTablePaginationType = {
    page,
    pageSize: limit,
    total: data?.pagination.total ?? 0,
    totalPages: data?.pagination.totalPages ?? 1,
  };
  const receiptsOff = kind === "sms" && data?.receipts?.enabled === false;
  const EmptyIcon = config.icon;

  const noteFor = (delivery: Delivery) => {
    if (isFailed(delivery.status) && delivery.lastError) {
      return { text: delivery.lastError, className: "text-destructive" };
    }
    if (delivery.status === "retrying") {
      const values = { attempt: delivery.attempts, max: delivery.maxAttempts };
      return {
        text: delivery.lastError
          ? t("tryOfError", { ...values, error: delivery.lastError })
          : t("tryOf", values),
        className: "text-amber-700 dark:text-amber-400",
      };
    }
    if ((delivery.segments ?? 0) > 1) {
      return {
        text: t("billedAs", { count: delivery.segments ?? 0 }),
        className: "text-muted-foreground",
      };
    }
    return null;
  };

  const badge = (status: DeliveryStatus) => {
    const label = t(`status.${status}`);
    return (
      <span
        title={label}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-sm px-2 py-1 text-[12px] leading-4 font-medium",
          BADGE_CLASS[status],
        )}
      >
        <Circle aria-hidden className="size-2 shrink-0 fill-current stroke-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {kindText("retentionNote", { count: props.retentionDays })}
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={t("refresh")}
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={cn(loading && data !== null && "animate-spin")} />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label={t("options")}>
                <EllipsisVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="text-muted-foreground text-xs font-semibold">
                {kindText("keepFor")}
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={String(props.retentionDays)}
                onValueChange={(value) => void changeRetention(value)}
              >
                {RETENTION_OPTIONS.map((days) => (
                  <DropdownMenuRadioItem
                    key={days}
                    value={String(days)}
                    disabled={savingRetention}
                  >
                    {t("retentionDays", { count: days })}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={busy || !data?.clearable}
                onSelect={() => setConfirmClear(true)}
              >
                <Trash2 />
                {kindText("clearSent")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>

      <CardContent className="@container space-y-4">
        {receiptsOff && data?.receipts ? (
          <WarningBanner icon={Info}>
            {t("sms.noReceipts", { origin: data.receipts.origin })}
          </WarningBanner>
        ) : null}

        {data === null ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-10 w-72 max-w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-10 text-center">
            <span
              aria-hidden
              className="bg-muted text-muted-foreground mb-2 flex size-10 items-center justify-center rounded-xl"
            >
              <EmptyIcon className="size-[18px]" />
            </span>
            <p className="text-sm font-medium">{kindText("emptyTitle")}</p>
            <p className="text-muted-foreground text-sm">{t("emptyHint")}</p>
          </div>
        ) : (
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value as Tab);
              setPage(1);
            }}
          >
            {/* Four tabs fit a phone only with less room around each. */}
            <UnderlineTabsList aria-label={t("tabsLabel")} className="gap-0 @md:gap-1">
              <UnderlineTabsTrigger value="all" className={TAB_CLASS}>
                {t("tabs.all")}
              </UnderlineTabsTrigger>
              <UnderlineTabsTrigger value="sent" count={counts.sent} className={TAB_CLASS}>
                {t("tabs.sent")}
              </UnderlineTabsTrigger>
              <UnderlineTabsTrigger value="failed" count={counts.failed} className={TAB_CLASS}>
                {t("tabs.failed")}
              </UnderlineTabsTrigger>
              <UnderlineTabsTrigger value="waiting" count={counts.waiting} className={TAB_CLASS}>
                {t("tabs.waiting")}
              </UnderlineTabsTrigger>
            </UnderlineTabsList>

            <TabsContent value={tab} className="mt-4 space-y-4">
              {picked.length > 0 ? (
                <div className="bg-primary/10 flex min-h-9 flex-wrap items-center gap-2 rounded-xl py-1 ps-3.5 pe-1">
                  <span className="text-primary min-w-0 flex-1 text-sm font-medium">
                    {t("selected", { count: picked.length })}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="bg-background"
                    disabled={busy || pickedFailed.length === 0}
                    onClick={() =>
                      void bulkRequest("POST", {
                        action: "retry_failed",
                        ids: pickedFailed.map((delivery) => delivery._id),
                      })
                    }
                  >
                    <RotateCcw />
                    {t("retry")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="bg-background text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => setDeleteIds(picked.map((delivery) => delivery._id))}
                  >
                    <Trash2 />
                    {t("delete")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-primary hover:text-primary"
                    onClick={() => setSelected(new Set())}
                  >
                    {t("clearSelection")}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 @lg:flex-row @lg:items-center">
                  <div className="relative min-w-0 flex-1">
                    <Search
                      aria-hidden
                      className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
                    />
                    <Input
                      type="search"
                      value={searchInput}
                      onChange={(event) => setSearchInput(event.target.value)}
                      placeholder={kindText("searchPlaceholder")}
                      aria-label={t("searchLabel")}
                      className="ps-9"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Select
                      value={range}
                      onValueChange={(value) => {
                        setRange(value as Range);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger
                        aria-label={t("rangeLabel")}
                        className="min-w-0 flex-1 @lg:w-40 @lg:flex-none"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("range.all")}</SelectItem>
                        <SelectItem value="today">{t("range.today")}</SelectItem>
                        <SelectItem value="7d">{t("range.last7")}</SelectItem>
                        <SelectItem value="30d">{t("range.last30")}</SelectItem>
                        <SelectItem value="90d">{t("range.last90")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {/* What the Failed tab shows, every page of it. */}
                    {tab === "failed" && counts.failed > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void bulkRequest("POST", {
                            action: "retry_failed",
                            range,
                            ...(search ? { search } : {}),
                          })
                        }
                      >
                        <RotateCcw />
                        {t("retryAll", { count: counts.failed })}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}

              <div
                className={cn(
                  "overflow-hidden rounded-lg border transition-opacity",
                  loading && "opacity-60",
                )}
              >
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col className="w-9 @2xl:w-11" />
                    <col className="hidden w-32 @3xl:table-column" />
                    <col className="hidden w-36 @2xl:table-column" />
                    <col />
                    <col className="hidden w-36 @2xl:table-column" />
                    <col className="w-10 @2xl:w-12" />
                  </colgroup>
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr className="h-10">
                      <th scope="col" className="px-2.5 text-center @2xl:px-3">
                        <Checkbox
                          checked={allChecked}
                          disabled={selectable.length === 0 || busy}
                          onCheckedChange={(value) => toggleAll(value === true)}
                          aria-label={t("selectPage")}
                        />
                      </th>
                      <th
                        scope="col"
                        className="hidden px-2.5 text-start font-semibold @3xl:table-cell"
                      >
                        {t("columns.date")}
                      </th>
                      <th
                        scope="col"
                        className="hidden px-2.5 text-start font-semibold @2xl:table-cell"
                      >
                        {t("columns.to")}
                      </th>
                      <th scope="col" className="px-2.5 text-start font-semibold">
                        {kindText("summaryLabel")}
                      </th>
                      <th
                        scope="col"
                        className="hidden px-2.5 text-start font-semibold @2xl:table-cell"
                      >
                        {t("columns.status")}
                      </th>
                      <th scope="col">
                        <span className="sr-only">{t("columns.actions")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.length === 0 ? (
                      <tr className="border-t">
                        <td colSpan={6} className="px-4 py-8 text-center">
                          <p className="text-muted-foreground text-sm">{t("noMatch")}</p>
                          {filtered || tab !== "all" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-3"
                              onClick={resetView}
                            >
                              {t("showAll")}
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ) : (
                      deliveries.map((delivery) => {
                        const summary = delivery.subject ?? delivery.body ?? "";
                        const name = summary || delivery.to;
                        const note = noteFor(delivery);
                        const date = formatDate(delivery.createdAt);
                        const checked = selected.has(delivery._id);
                        const finished = isFinished(delivery.status);
                        const retryable = isRetryable(delivery.status);
                        return (
                          <tr
                            key={delivery._id}
                            className={cn("border-t", checked && "bg-primary/5")}
                          >
                            <td className="px-2.5 py-3 text-center align-top @2xl:px-3 @2xl:align-middle">
                              <Checkbox
                                checked={checked}
                                disabled={!finished || busy}
                                onCheckedChange={(value) =>
                                  toggleOne(delivery._id, value === true)
                                }
                                aria-label={t("selectRow", { name })}
                              />
                            </td>
                            <td className="text-muted-foreground hidden px-2.5 py-3 whitespace-nowrap @3xl:table-cell">
                              {date}
                            </td>
                            <td className="hidden px-2.5 py-3 @2xl:table-cell">
                              <div className="truncate tabular-nums" title={delivery.to}>
                                {delivery.to}
                              </div>
                            </td>
                            <td className="min-w-0 px-2.5 py-2.5">
                              {/* Narrow: who first, whole (a number's last digits
                                  are what tell it apart); how it went and when, last. */}
                              <div
                                className="mb-1 truncate font-medium tabular-nums @2xl:hidden"
                                title={delivery.to}
                              >
                                {delivery.to}
                              </div>
                              <div
                                className={cn("truncate", kind === "email" && "font-medium")}
                                title={summary}
                              >
                                {summary}
                              </div>
                              {note ? (
                                <div
                                  className={cn("mt-0.5 line-clamp-2", note.className)}
                                  title={note.text}
                                >
                                  {note.text}
                                </div>
                              ) : null}
                              <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 @3xl:hidden">
                                <span className="@2xl:hidden">{badge(delivery.status)}</span>
                                <span>{date}</span>
                              </div>
                            </td>
                            <td className="hidden px-2.5 py-3 @2xl:table-cell">
                              {badge(delivery.status)}
                            </td>
                            <td className="px-1 py-2 text-center align-top @2xl:align-middle">
                              {finished || retryable ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-muted-foreground"
                                      aria-label={t("rowActions", { name })}
                                      disabled={busy}
                                    >
                                      <EllipsisVertical />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {retryable ? (
                                      <DropdownMenuItem
                                        onSelect={() => void retryOne(delivery._id)}
                                      >
                                        <RotateCcw />
                                        {t("retryNow")}
                                      </DropdownMenuItem>
                                    ) : null}
                                    {finished ? (
                                      <DropdownMenuItem
                                        variant="destructive"
                                        onSelect={() => setDeleteIds([delivery._id])}
                                      >
                                        <Trash2 />
                                        {t("delete")}
                                      </DropdownMenuItem>
                                    ) : null}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <DataTablePagination
                pagination={pagination}
                pageSizeOptions={[10, 25, 50]}
                onPageChange={setPage}
                onPageSizeChange={(pageSize) => {
                  setLimit(pageSize);
                  setPage(1);
                }}
              />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>

      <ConfirmDialog
        open={deleteIds !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteIds(null);
        }}
        onConfirm={async () => {
          if (deleteIds) await bulkRequest("DELETE", { ids: deleteIds });
          setDeleteIds(null);
        }}
        type="danger"
        title={kindText("deleteTitle", { count: deleteIds?.length ?? 0 })}
        description={kindText("deleteDescription", { count: deleteIds?.length ?? 0 })}
        confirmText={t("delete")}
        cancelText={tCommon("cancel")}
        confirmVariant="destructive"
        loading={busy}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmClear(false);
        }}
        onConfirm={async () => {
          await bulkRequest("DELETE", { scope: "sent" });
          setConfirmClear(false);
        }}
        type="danger"
        title={kindText("clearTitle")}
        description={kindText("clearDescription", { count: data?.clearable ?? 0 })}
        confirmText={kindText("clearConfirm")}
        cancelText={tCommon("cancel")}
        confirmVariant="destructive"
        loading={busy}
      />
    </Card>
  );
}
