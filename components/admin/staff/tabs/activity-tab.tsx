"use client";

import { useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast-notification";
import { apiClient } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface AuditLogEntry {
  _id: string;
  action: string;
  resourceName?: string;
  userEmail?: string;
  changes?: { summary?: string; fields?: string[] };
  createdAt: string;
}

interface AuditLogsResponse {
  logs: AuditLogEntry[];
  total: number;
}

interface ActivityTabProps {
  staffId: string;
}

// Keys are the stored `AuditAction` values, which are upper-case.
const ACTION_VARIANT: Record<
  string,
  "default" | "outline" | "secondary" | "destructive"
> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
  STATUS_CHANGE: "secondary",
  ROLE_CHANGE: "secondary",
  PERMISSION_CHANGE: "secondary",
  SUSPENSION: "destructive",
};

function formatAction(action: string) {
  return action
    .toLowerCase()
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDateTime(value?: string) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityTab({ staffId }: ActivityTabProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);

  useApplyOnChange([staffId], () => {
    setIsLoading(true);
  });

  useEffect(() => {
    let active = true;

    apiClient
      .get<AuditLogsResponse>(
        `/api/admin/audit-logs?resource=user&resourceId=${staffId}&limit=50`,
      )
      .then((res) => {
        if (active) setLogs(res.logs || []);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load staff activity:", error);
        toast.error("Failed to load activity");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [staffId]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of logs) {
      map.set(log.action, (map.get(log.action) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [logs]);

  const visible = action ? logs.filter((log) => log.action === action) : logs;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Activity log</CardTitle>
            <CardDescription>
              Admin actions recorded against this staff account, newest first
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <ul className="space-y-4">
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
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <History className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {logs.length === 0
                    ? "No recorded activity for this staff member yet"
                    : "No entries for that filter"}
                </p>
              </div>
            ) : (
              <ul className="space-y-4">
                {visible.map((log) => (
                  <li key={log._id} className="flex gap-3">
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={ACTION_VARIANT[log.action] ?? "outline"}>
                          {formatAction(log.action)}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(log.createdAt)}
                        </span>
                      </div>
                      {log.changes?.summary ? (
                        <p className="mt-1 text-sm">{log.changes.summary}</p>
                      ) : log.changes?.fields?.length ? (
                        <p className="mt-1 text-sm">
                          Changed {log.changes.fields.join(", ")}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        by {log.userEmail || "system"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle>Filter</CardTitle>
            <CardDescription>
              Counted from the 50 most recent entries
            </CardDescription>
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
              <span>All activity</span>
              <span className="tabular-nums text-muted-foreground">
                {logs.length}
              </span>
            </button>
            {counts.length === 0 ? (
              <p className="py-2 text-muted-foreground">Nothing recorded yet</p>
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
                  <span>{formatAction(key)}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {count}
                  </span>
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
                Clear filter
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
