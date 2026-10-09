"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { apiClient, type ApiClientError } from "@/lib/api/client";
import { accountEmailErrorMessage } from "./account-email-messages";

interface AccountEmailBatch {
  id: string;
  status: "running" | "done";
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
}

const POLL_MS = 4000;
const DISMISSED_KEY = "storify:account-emails:dismissed";

function readDismissed(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDismissed(key: string, id: string) {
  try {
    window.localStorage.setItem(key, id);
  } catch {
    // A private window: the line comes back on the next visit, nothing worse.
  }
}

/**
 * One line above the customers list while a bulk account email is going out,
 * and afterwards only if some of it could not be sent — with a way to try
 * those again. A send that went fine says so once, in a toast, and leaves.
 *
 * The vendors list shows the same line for a vendor import's owner
 * invitations: its own route (`endpoint`, which also takes `/<id>/retry`) and
 * its own wording (`namespace`, with the same keys).
 */
export function AccountEmailProgress({
  refreshKey,
  endpoint = "/api/admin/customers/account-emails",
  namespace = "admin.customerAccountEmail",
  dismissedKey = DISMISSED_KEY,
}: {
  refreshKey: number;
  endpoint?: string;
  namespace?: "admin.customerAccountEmail" | "admin.vendorImport.invites" | "admin.vendorAccountEmail";
  dismissedKey?: string;
}) {
  const t = useTranslations(namespace as "admin.customerAccountEmail");
  const [batch, setBatch] = useState<AccountEmailBatch | null>(null);
  // Read once; on the server it is null, and nothing shows before the first
  // fetch anyway, so the two renders agree.
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed(dismissedKey));
  const [retrying, setRetrying] = useState(false);
  /** Batches seen running here, so a finished one is announced only to whoever watched it. */
  const watched = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const data = await apiClient.get<{ batch: AccountEmailBatch | null }>(endpoint);
      const next = data.batch;
      if (next?.status === "running") watched.current.add(next.id);
      if (next?.status === "done" && watched.current.delete(next.id) && next.failed === 0) {
        toast.success(t("finished", { count: next.sent }));
      }
      setBatch(next);
      return next;
    } catch {
      return null;
    }
  }, [endpoint, t]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const next = await load();
      if (active && next?.status === "running") timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [load, refreshKey]);

  const retry = useCallback(async () => {
    if (!batch) return;
    setRetrying(true);
    try {
      await apiClient.post(`${endpoint}/${batch.id}/retry`);
      watched.current.add(batch.id);
      setBatch({ ...batch, status: "running", failed: 0 });
      const poll = async () => {
        const next = await load();
        if (next?.status === "running") setTimeout(poll, POLL_MS);
      };
      setTimeout(poll, POLL_MS);
    } catch (error) {
      toast.error(accountEmailErrorMessage(error as ApiClientError, t));
    } finally {
      setRetrying(false);
    }
  }, [batch, endpoint, load, t]);

  if (!batch) return null;

  if (batch.status === "running") {
    const done = batch.sent + batch.failed + batch.skipped;
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2.5 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span className="min-w-0">
          {t("progress", { done, total: batch.queued })}
          {batch.failed > 0 ? ` · ${t("progressFailed", { count: batch.failed })}` : null}
        </span>
      </div>
    );
  }

  if (batch.failed === 0 || dismissed === batch.id) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {t("finishedWithFailures", { failed: batch.failed, total: batch.queued })}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          onClick={retry}
          disabled={retrying}
        >
          {retrying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {t("retry")}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label={t("dismiss")}
          onClick={() => {
            writeDismissed(dismissedKey, batch.id);
            setDismissed(batch.id);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
