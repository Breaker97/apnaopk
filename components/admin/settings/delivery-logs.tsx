"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  ListChecks,
  MailCheck,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DataTablePagination,
  type DataTablePaginationType,
} from "@/components/ui/data-table";
import { ConfirmDialog } from "@/components/ui/confirmation-dialog";
import { toast } from "@/components/ui/toast-notification";
import { useTranslations } from "next-intl";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type DeliveryStatus =
  | "queued"
  | "sending"
  | "retrying"
  | "sent"
  | "delivered"
  | "undelivered"
  | "failed";

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

type LogResponse = {
  success?: boolean;
  data?: {
    deliveries: Delivery[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
    stats: { total: number; sent: number; failed: number; pending: number };
    retentionDays: number;
  };
};

const EMPTY_STATS = { total: 0, sent: 0, failed: 0, pending: 0 };
type DeleteIntent = "selected" | "sent" | null;

/**
 * The email and SMS outboxes share one log screen; what differs is the
 * endpoint, the words, and the statuses — a text also learns from the carrier
 * whether it was delivered.
 */
const KINDS = {
  email: {
    endpoint: "/api/admin/email-deliveries",
    title: "Email delivery logs",
    description:
      "Sent payloads are removed immediately; only delivery metadata is retained. Save email settings after changing retention.",
    summaryLabel: "Subject",
    searchPlaceholder: "Recipient, subject, or category",
    noun: "email",
    statuses: ["sent", "failed", "queued", "retrying", "sending"],
  },
  sms: {
    endpoint: "/api/admin/sms-deliveries",
    title: "SMS delivery logs",
    description:
      "Each text is kept with the carrier's verdict until the retention period ends. Save SMS settings after changing retention.",
    summaryLabel: "Message",
    searchPlaceholder: "Phone number, message, or category",
    noun: "text",
    statuses: [
      "delivered",
      "sent",
      "undelivered",
      "failed",
      "queued",
      "retrying",
      "sending",
    ],
  },
} as const satisfies Record<
  string,
  {
    endpoint: string;
    title: string;
    description: string;
    summaryLabel: string;
    searchPlaceholder: string;
    noun: string;
    statuses: readonly DeliveryStatus[];
  }
>;

function statusClass(status: DeliveryStatus) {
  if (status === "sent" || status === "delivered") {
    return "bg-emerald-100 text-emerald-800";
  }
  if (status === "failed" || status === "undelivered") {
    return "bg-red-100 text-red-800";
  }
  return "bg-amber-100 text-amber-800";
}

function isTerminal(status: DeliveryStatus) {
  return status !== "queued" && status !== "sending" && status !== "retrying";
}

function isRetryable(status: DeliveryStatus) {
  return status === "failed" || status === "retrying" || status === "undelivered";
}

export function DeliveryLogs(props: {
  kind: keyof typeof KINDS;
  retentionDays: 7 | 30 | 90;
  onRetentionDaysChange: (days: 7 | 30 | 90) => void;
}) {
  const config = KINDS[props.kind];
  const t = useTranslations();
  const tSafe = useFallbackTranslator(t);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [range, setRange] = useState("30d");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        range,
      });
      if (status !== "all") params.set("status", status);
      if (search) params.set("search", search);
      const response = await fetch(`${config.endpoint}?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as LogResponse;
      if (!response.ok || !payload.success || !payload.data) throw new Error();
      setDeliveries(payload.data.deliveries);
      setTotal(payload.data.pagination.total);
      setTotalPages(payload.data.pagination.totalPages);
      setStats(payload.data.stats);
      setSelected(new Set());
    } catch {
      toast.error(
        tSafe(
          "admin.settings.toasts.deliveryLogsLoadFailed",
          "Failed to load the delivery logs",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [config.endpoint, limit, page, range, search, status, tSafe]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const terminalRows = useMemo(
    () => deliveries.filter((delivery) => isTerminal(delivery.status)),
    [deliveries],
  );
  const allTerminalSelected =
    terminalRows.length > 0 && terminalRows.every((row) => selected.has(row._id));

  const toggleAll = (checked: boolean) => {
    setSelected(
      checked ? new Set(terminalRows.map((delivery) => delivery._id)) : new Set(),
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

  const retry = async (id: string) => {
    setRetryingId(id);
    try {
      const response = await fetch(`${config.endpoint}/${id}/retry`, {
        method: "POST",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message || "Retry failed");
      toast.success(payload.message || "Sent successfully");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed");
    } finally {
      setRetryingId(null);
      await load();
    }
  };

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
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(payload.message || "Action failed");
      toast.success(payload.message || "Delivery logs updated");
      if (method === "DELETE" && page > 1) setPage(1);
      else await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const selectedIds = Array.from(selected);
  const selectedFailedIds = deliveries
    .filter(
      (delivery) =>
        selected.has(delivery._id) &&
        (delivery.status === "failed" || delivery.status === "undelivered"),
    )
    .map((delivery) => delivery._id);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const pagination = useMemo<DataTablePaginationType>(
    () => ({ page, pageSize: limit, total, totalPages }),
    [limit, page, total, totalPages],
  );

  const confirmDeletion = async () => {
    if (deleteIntent === "selected") {
      await bulkRequest("DELETE", { ids: selectedIds });
    } else if (deleteIntent === "sent") {
      await bulkRequest("DELETE", { scope: "sent" });
    }
    setDeleteIntent(null);
  };

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">{config.title}</p>
          <p className="text-sm text-muted-foreground">{config.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Keep sent logs
            <Select
              value={String(props.retentionDays)}
              onValueChange={(value) =>
                props.onRetentionDaysChange(Number(value) as 7 | 30 | 90)
              }
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          { label: "Total", value: stats.total, icon: ListChecks },
          { label: "Sent", value: stats.sent, icon: MailCheck },
          { label: "Failed", value: stats.failed, icon: AlertTriangle },
          { label: "Pending", value: stats.pending, icon: Clock3 },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3 rounded-md border p-3">
            <item.icon className="h-4 w-4 text-muted-foreground" />
            <div><p className="text-xs text-muted-foreground">{item.label}</p><p className="font-semibold">{item.value}</p></div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={submitSearch} className="flex min-w-[220px] flex-1 gap-2">
          <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={config.searchPlaceholder} className="min-w-0" />
          <Button type="submit" variant="outline" size="icon" aria-label="Search"><Search className="h-4 w-4" /></Button>
        </form>
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}>
          <SelectTrigger className="w-[145px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {config.statuses.map((value) => (
              <SelectItem key={value} value={value} className="capitalize">
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={(value) => { setRange(value); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy || selectedIds.length === 0} onClick={() => setDeleteIntent("selected")}><Trash2 className="mr-2 h-4 w-4" />Delete selected</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy || selectedFailedIds.length === 0} onClick={() => void bulkRequest("POST", { action: "retry_failed", ids: selectedFailedIds })}><RotateCcw className="mr-2 h-4 w-4" />Retry selected failed</Button>
        <Button type="button" variant="outline" size="sm" disabled={busy || stats.failed === 0} onClick={() => void bulkRequest("POST", { action: "retry_failed" })}>Retry all failed</Button>
        <Button type="button" variant="destructive" size="sm" disabled={busy || stats.sent === 0} onClick={() => setDeleteIntent("sent")}>Clear sent logs</Button>
      </div>

      <div className="min-w-0 overflow-hidden rounded-md border">
        <table className="w-full table-fixed text-sm">
          <colgroup><col className="w-[7%]" /><col className="hidden w-[20%] xl:table-column" /><col className="w-[27%]" /><col className="w-[35%]" /><col className="w-[17%]" /><col className="hidden w-[9%] lg:table-column" /><col className="w-[14%]" /></colgroup>
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2 text-center"><Checkbox checked={allTerminalSelected} onCheckedChange={(value) => toggleAll(value === true)} aria-label="Select terminal logs on this page" /></th>
              <th className="hidden p-2 font-medium xl:table-cell">Created</th><th className="p-2 font-medium">Recipient</th><th className="p-2 font-medium">{config.summaryLabel}</th><th className="p-2 font-medium">Status</th><th className="hidden p-2 text-center font-medium lg:table-cell">Tries</th><th className="p-2 text-center font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {!loading && deliveries.length === 0 && <tr><td className="p-5 text-center text-muted-foreground" colSpan={7}>No matching deliveries.</td></tr>}
            {deliveries.map((delivery) => (
              <tr key={delivery._id} className="border-t align-middle">
                <td className="p-2 text-center"><Checkbox checked={selected.has(delivery._id)} disabled={!isTerminal(delivery.status)} onCheckedChange={(value) => toggleOne(delivery._id, value === true)} aria-label={`Select ${delivery.subject ?? delivery.to}`} /></td>
                <td className="hidden p-2 text-xs xl:table-cell">{new Date(delivery.createdAt).toLocaleString()}</td>
                <td className="min-w-0 p-2"><div className="truncate" title={delivery.to}>{delivery.to}</div></td>
                <td className="min-w-0 p-2"><div className="truncate" title={delivery.subject ?? delivery.body}>{delivery.subject ?? delivery.body}</div>{delivery.segments && delivery.segments > 1 ? <div className="text-xs text-muted-foreground">{delivery.segments} segments</div> : null}<div className="truncate text-xs text-muted-foreground xl:hidden">{new Date(delivery.createdAt).toLocaleString()}</div>{delivery.lastError && <div className="line-clamp-2 text-xs text-destructive" title={delivery.lastError}>{delivery.lastError}</div>}</td>
                <td className="p-2"><span className={`inline-block max-w-full truncate rounded-full px-2 py-1 text-xs font-medium ${statusClass(delivery.status)}`}>{delivery.status}</span></td>
                <td className="hidden p-2 text-center lg:table-cell">{delivery.attempts}/{delivery.maxAttempts}</td>
                <td className="p-2 text-center">{isRetryable(delivery.status) && <Button type="button" variant="ghost" size="icon" title="Retry now" aria-label="Retry now" onClick={() => void retry(delivery._id)} disabled={retryingId === delivery._id || busy}><RotateCcw className={`h-4 w-4 ${retryingId === delivery._id ? "animate-spin" : ""}`} /></Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DataTablePagination
        pagination={pagination}
        pageSizeOptions={[5, 10, 25, 50]}
        onPageChange={setPage}
        onPageSizeChange={(pageSize) => { setLimit(pageSize); setPage(1); }}
      />

      <ConfirmDialog
        open={deleteIntent !== null}
        onOpenChange={(open) => { if (!open && !busy) setDeleteIntent(null); }}
        onConfirm={() => void confirmDeletion()}
        type="danger"
        title={deleteIntent === "sent" ? `Clear sent ${config.noun} logs?` : `Delete selected ${config.noun} logs?`}
        description={
          deleteIntent === "sent"
            ? `This permanently deletes all ${stats.sent} sent ${config.noun} log${stats.sent === 1 ? "" : "s"}. This action cannot be undone.`
            : `This permanently deletes ${selectedIds.length} selected terminal log${selectedIds.length === 1 ? "" : "s"}. Queued or sending ${config.noun}s are never deleted.`
        }
        confirmText={deleteIntent === "sent" ? "Clear sent logs" : "Delete logs"}
        cancelText="Cancel"
        confirmVariant="destructive"
        loading={busy}
      />
    </div>
  );
}
