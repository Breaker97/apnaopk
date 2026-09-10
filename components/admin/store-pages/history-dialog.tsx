"use client";

import { useEffect, useState } from "react";
import { History, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast-notification";
import type { createTSafe } from "@/components/admin/online-store/t-safe";
import { apiClient, ApiClientError } from "@/lib/api/client";
import type { SectionInstance } from "@/lib/storefront/sections/types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface HistoryEntry {
  index: number;
  publishedAt: string | null;
  sectionsCount: number;
  sections: SectionInstance[];
}

interface HistoryResponse {
  published: { publishedAt: string | null; sectionsCount: number } | null;
  history: HistoryEntry[];
}

/**
 * Published snapshots, newest first. "Restore" copies a snapshot into the
 * DRAFT (the ordinary autosave persists it) — history is read-only and the
 * storefront changes only when the admin publishes the restored draft.
 */
export function HistoryDialog({
  open,
  onOpenChange,
  handle,
  tSafe,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  handle: string;
  tSafe: ReturnType<typeof createTSafe>;
  onRestore: (sections: SectionInstance[]) => void;
}) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useApplyOnChange([open, handle], () => {
    if (open) setLoading(true);
  });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiClient
      .get<HistoryResponse>(`/api/admin/store-pages/${handle}/history`)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((error) => {
        if (!cancelled) {
          setData({ published: null, history: [] });
          toast.error(
            error instanceof ApiClientError
              ? error.message
              : tSafe("admin.storeBuilder.actionFailed", "The action failed"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, handle]);

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString() : "—";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            {tSafe("admin.storeBuilder.historyTitle", "Version history")}
          </DialogTitle>
          <DialogDescription>
            {tSafe(
              "admin.storeBuilder.historyDescription",
              "Earlier published versions. Restoring puts one into your draft — the storefront changes only when you publish it.",
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {data?.published ? (
              <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">
                    {tSafe("admin.storeBuilder.currentVersion", "Currently live")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(data.published.publishedAt)} ·{" "}
                    {data.published.sectionsCount}{" "}
                    {tSafe("admin.storeBuilder.sectionsWord", "sections")}
                  </p>
                </div>
              </div>
            ) : null}

            {data && data.history.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {tSafe(
                  "admin.storeBuilder.historyEmpty",
                  "No earlier versions yet — they appear here after your next publish.",
                )}
              </p>
            ) : null}

            {data?.history.map((entry) => (
              <div
                key={entry.index}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {formatDate(entry.publishedAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {entry.sectionsCount}{" "}
                    {tSafe("admin.storeBuilder.sectionsWord", "sections")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => onRestore(entry.sections)}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  {tSafe("admin.storeBuilder.restore", "Restore")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
