"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { ActivityLogRow } from "@/lib/activity-log/list";

/** What a record's own history shows: its most recent entries. */
export const RECORD_ACTIVITY_LIMIT = 50;

type Result = { key: string; rows?: ActivityLogRow[]; failed?: boolean };

/**
 * A record's history from the Activity Log API, for the per-record tabs.
 *
 * `/api/admin/audit-logs` answers the standard paginated envelope (`data` +
 * `pagination`, not the `{ logs, total }` it used to), and a bare request covers
 * only the last 30 days — so a record's own history always sends `date=all`.
 * `filter` is the rest of the query: which record, or which actor.
 */
export function useRecordActivity(filter: string) {
  const query = `${filter}&date=all&limit=${RECORD_ACTIVITY_LIMIT}`;
  // A retry is a new request: it has a new key, and the old answer stops counting.
  const [attempt, setAttempt] = useState(0);
  const key = `${query}#${attempt}`;
  const [result, setResult] = useState<Result | null>(null);
  const current = result?.key === key ? result : null;

  useEffect(() => {
    const controller = new AbortController();
    apiClient
      .get<{ data: ActivityLogRow[] }>(`/api/admin/audit-logs?${query}`, {
        signal: controller.signal,
      })
      .then((page) => {
        if (!controller.signal.aborted) setResult({ key, rows: page.data ?? [] });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load activity:", error);
        setResult({ key, failed: true });
      });
    return () => controller.abort();
  }, [key, query]);

  return {
    rows: current?.rows ?? [],
    isLoading: !current,
    failed: Boolean(current?.failed),
    retry: () => setAttempt((count) => count + 1),
  };
}
