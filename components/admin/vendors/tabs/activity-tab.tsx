"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
  vendorId: string;
}

// Keys are the stored `AuditAction` values, which are upper-case — the former
// lower-case keys never matched, so every entry rendered with the fallback.
const ACTION_VARIANT: Record<
  string,
  "default" | "outline" | "secondary" | "destructive"
> = {
  CREATE: "default",
  UPDATE: "secondary",
  DELETE: "destructive",
  APPROVAL: "default",
  REJECTION: "destructive",
  SUSPENSION: "destructive",
  STATUS_CHANGE: "secondary",
  ROLE_CHANGE: "secondary",
  PERMISSION_CHANGE: "secondary",
  PAYMENT: "default",
  REFUND: "destructive",
};

function formatAction(action: string) {
  return action
    .toLowerCase()
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDateTime(date?: string) {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityTab({ vendorId }: ActivityTabProps) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useApplyOnChange([vendorId], () => {
    setIsLoading(true);
  });

  useEffect(() => {
    let active = true;

    apiClient
      .get<AuditLogsResponse>(
        `/api/admin/audit-logs?resource=vendor&resourceId=${vendorId}&limit=50`,
      )
      .then((res) => {
        if (active) setLogs(res.logs || []);
      })
      .catch((error) => {
        if (!active) return;
        console.error("Failed to load vendor activity:", error);
        toast.error("Failed to load activity");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [vendorId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity log</CardTitle>
        <CardDescription>
          Admin actions recorded against this vendor, newest first
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
                  <Skeleton className="h-3 w-24" />
                </div>
              </li>
            ))}
          </ul>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <History className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No recorded activity for this vendor yet
            </p>
          </div>
        ) : (
          <ul className="space-y-4">
            {logs.map((log) => (
              <li key={log._id} className="flex gap-3">
                <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={ACTION_VARIANT[log.action] ?? "outline"}
                      className="capitalize"
                    >
                      {formatAction(log.action)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </span>
                  </div>
                  {log.changes?.summary && (
                    <p className="mt-1 text-sm">{log.changes.summary}</p>
                  )}
                  {log.changes?.fields && log.changes.fields.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Changed: {log.changes.fields.join(", ")}
                    </p>
                  )}
                  {log.userEmail && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      by {log.userEmail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
