"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  Clock,
  FileText,
  Loader2,
  Store,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast-notification";
import { AdminListSkeleton } from "@/components/admin/admin-list-skeleton";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface AccessRequestRow {
  _id: string;
  vendorId: string;
  storeName: string;
  planName: string | null;
  plansAvailable: boolean;
  pack: string;
  packLabel: string;
  permissions: string[];
  reason: string;
  duration: string;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

/** Mirrors VENDOR_ACCESS_REQUEST_DURATIONS; the vendor gate offers the same three. */
const DURATION_KEYS: Record<string, string> = {
  permanent: "durationPermanent",
  "30d": "duration30",
  "90d": "duration90",
};

/**
 * The admin side of a vendor access request.
 *
 * Each row carries enough to decide without opening the vendor: the store, its
 * plan, the pack, the permission strings it expands to, and the vendor's own
 * reason. Approving writes ONE override per permission with that reason and the
 * requested expiry — it never edits the plan, so a later upgrade or downgrade
 * leaves the decision standing.
 */
export function AccessRequestsTable({ locale }: { locale: string }) {
  const t = useTranslations("admin.accessRequests");
  const tPacks = useTranslations("permissionPacks");
  const [status, setStatus] = useState<"pending" | "decided">("pending");
  const [rows, setRows] = useState<AccessRequestRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);
  /** Decline notes, keyed by request id. Cleared once the decision lands. */
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(
    (nextStatus: "pending" | "decided") => {
      const request = async () => {
        const response = await fetch(
          `/api/admin/access-requests?status=${nextStatus}&limit=50`,
        );
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) {
          return { ok: false as const, message: body?.message || t("loadFailed") };
        }
        // The route answers with `paginatedResponse`, which nests the array as
        // `data.data` alongside `pagination`. Reading `body.data` as the array
        // silently yielded [] on every load, so a vendor could file a request
        // and the queue would still say "nothing waiting".
        const rows = body.data?.data;
        return { ok: true as const, rows: Array.isArray(rows) ? rows : [] };
      };
      return request()
        .then((result) => {
          if (!result.ok) {
            toast.error(result.message);
            setRows([]);
            return;
          }
          setRows(result.rows);
        })
        .catch(() => {
          toast.error(t("loadFailed"));
          setRows([]);
        })
        .finally(() => setIsLoading(false));
    },
    [t],
  );
  // Manual reloads (after a decision) show the spinner; the effect below sets
  // it during render instead.
  const reload = useCallback(
    (nextStatus: "pending" | "decided") => {
      setIsLoading(true);
      return load(nextStatus);
    },
    [load],
  );

  useApplyOnChange([status], () => {
    setIsLoading(true);
  });

  useEffect(() => {
    void load(status);
  }, [load, status]);

  const decide = useCallback(
    async (id: string, decision: "approved" | "declined") => {
      setDeciding(id);
      try {
        const response = await fetch(`/api/admin/access-requests/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // A decline reaches the vendor as a notification, so the note is the
          // only chance to say what would change the answer. Sent only when the
          // admin actually wrote one.
          body: JSON.stringify({
            decision,
            note: decision === "declined" ? notes[id]?.trim() || undefined : undefined,
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) {
          toast.error(body?.message || t("decisionFailed"));
          return;
        }
        toast.success(
          t(decision === "approved" ? "approvedToast" : "declinedToast"),
        );
        setNotes((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        // Reload rather than patch in place: approving writes overrides, so the
        // list the admin sees next should come from the server that wrote them.
        await reload(status);
      } catch {
        toast.error(t("decisionFailed"));
      } finally {
        setDeciding(null);
      }
    },
    [reload, notes, status, t],
  );

  const pendingCount = useMemo(
    () => rows.filter((row) => row.status === "pending").length,
    [rows],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={status}
          onValueChange={(value) => setStatus(value as "pending" | "decided")}
        >
          <TabsList>
            <TabsTrigger value="pending">
              <Clock className="size-4" />
              {t("tabPending")}
            </TabsTrigger>
            <TabsTrigger value="decided">
              <Check className="size-4" />
              {t("tabDecided")}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {status === "pending" && !isLoading && (
          <Badge
            variant="outline"
            className="border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          >
            {t("pendingCount", { count: pendingCount })}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <AdminListSkeleton />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 text-lg font-semibold">
              {t(status === "pending" ? "emptyPendingTitle" : "emptyDecidedTitle")}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t(status === "pending" ? "emptyPendingBody" : "emptyDecidedBody")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y">
            {rows.map((row) => (
              <div key={row._id} className="p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                    <Store className="size-4" />
                  </span>

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/${locale}/admin/vendors/${row.vendorId}`}
                        className="font-medium hover:underline"
                      >
                        {row.storeName}
                      </Link>
                      <ArrowUpRight className="size-3 text-muted-foreground" />
                      <Badge
                        variant="outline"
                        className="border-primary/30 bg-primary/10 text-primary"
                      >
                        {tPacks.has(row.pack) ? tPacks(row.pack) : row.packLabel}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {row.plansAvailable && row.planName
                          ? t("onPlan", { plan: row.planName })
                          : t("commissionOnly")}
                      </span>
                    </div>

                    <p className="text-sm leading-relaxed text-pretty">
                      {row.reason}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {DURATION_KEYS[row.duration]
                          ? t(DURATION_KEYS[row.duration])
                          : row.duration}
                      </span>
                      <span>·</span>
                      <span>
                        {t("sentOn", { date: new Date(row.requestedAt).toLocaleDateString(locale) })}
                      </span>
                      <span>·</span>
                      <span className="font-mono">
                        {row.permissions.join(", ")}
                      </span>
                    </div>

                    {row.status !== "pending" && (
                      <div
                        className={cn(
                          "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                          row.status === "approved" &&
                            "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                          row.status === "declined" &&
                            "border-destructive/30 bg-destructive/5 text-destructive",
                          row.status === "withdrawn" &&
                            "bg-muted/40 text-muted-foreground",
                        )}
                      >
                        <FileText className="mt-0.5 size-3.5 shrink-0" />
                        <span className="text-pretty">
                          {t(
                            row.status === "approved"
                              ? "outcomeApproved"
                              : row.status === "withdrawn"
                                ? "outcomeWithdrawn"
                                : "outcomeDeclined",
                          )}
                          {row.decisionNote ? ` “${row.decisionNote}”` : ""}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {row.status === "pending" ? (
                      <>
                        <Input
                          value={notes[row._id] ?? ""}
                          maxLength={1000}
                          placeholder={t("notePlaceholder")}
                          className="h-8 w-64 text-xs"
                          onChange={(event) =>
                            setNotes((prev) => ({
                              ...prev,
                              [row._id]: event.target.value,
                            }))
                          }
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={deciding === row._id}
                            onClick={() => decide(row._id, "declined")}
                          >
                            {deciding === row._id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <X className="size-4" />
                            )}
                            {t("decline")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={deciding === row._id}
                            onClick={() => decide(row._id, "approved")}
                          >
                            {deciding === row._id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                            {t("approve")}
                          </Button>
                        </div>
                        {row.plansAvailable && (
                          <Button
                            asChild
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                          >
                            <Link
                              href={`/${locale}/admin/vendors/${row.vendorId}?tab=subscription`}
                            >
                              {t("suggestUpgrade")}
                            </Link>
                          </Button>
                        )}
                      </>
                    ) : (
                      <Badge
                        variant="outline"
                        className={cn(
                          row.status === "approved" &&
                            "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                          row.status === "declined" &&
                            "border-destructive/30 bg-destructive/10 text-destructive",
                          // Withdrawn is neutral: nobody refused it.
                          row.status === "withdrawn" && "text-muted-foreground",
                        )}
                      >
                        {t(
                          row.status === "approved"
                            ? "statusApproved"
                            : row.status === "withdrawn"
                              ? "statusWithdrawn"
                              : "statusDeclined",
                        )}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-sm text-muted-foreground text-pretty">
        Approving writes one override per permission on that vendor, carrying the
        reason and expiry above plus an audit entry. It never edits their plan —
        so a later upgrade or downgrade leaves the decision intact.
      </p>
    </div>
  );
}
