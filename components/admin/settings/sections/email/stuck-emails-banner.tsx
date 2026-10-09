"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast-notification";
import { WarningBanner } from "@/components/ui/warning-banner";
import type { EmailQueueHealth } from "@/lib/email/email-queue";
import { EMAIL_QUEUE_ENDPOINT } from "./use-email-queue";

/**
 * The warning that emails which failed once are not being retried.
 *
 * Shown only while some wait past their retry and the retry job is not
 * running here: a store whose job runs works through its backlog by itself.
 * The count is the log's (its Waiting tab); this says why, and what happens
 * when the job starts: the whole backlog goes out, weeks late.
 */
export function StuckEmailsBanner({
  health,
  onShow,
  onCancelled,
}: {
  health: EmailQueueHealth | null;
  /** Open the log on its Waiting tab. */
  onShow: () => void;
  /** The emails were cancelled: the page should load the outbox again. */
  onCancelled: () => void | Promise<unknown>;
}) {
  const t = useTranslations("admin.settings.email.stuck");
  const locale = useLocale();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!health || health.stuck === 0 || health.job.running) return null;

  const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const moment = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const oldest = health.oldestStuckAt ? day.format(new Date(health.oldestStuckAt)) : "";

  const cancel = async () => {
    setBusy(true);
    try {
      const response = await fetch(EMAIL_QUEUE_ENDPOINT, { method: "POST" });
      const payload = (await response.json()) as {
        success?: boolean;
        message?: string;
        data?: { cancelled?: number };
      };
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || t("cancelFailed"));
      }
      toast.success(t("cancelled", { count: payload.data?.cancelled ?? 0 }));
      setConfirming(false);
      await onCancelled();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : t("cancelFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <WarningBanner
        title={t("title")}
        action={
          <>
            <Button type="button" variant="outline" size="sm" onClick={onShow}>
              {t("show")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(true)}
            >
              {t("cancel")}
            </Button>
          </>
        }
      >
        {health.job.lastRunAt
          ? t("stopped", {
              lastRun: moment.format(new Date(health.job.lastRunAt)),
              date: oldest,
            })
          : t("neverRan", { date: oldest })}
      </WarningBanner>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) setConfirming(open);
        }}
        onConfirm={() => void cancel()}
        type="warning"
        title={t("cancelTitle", { count: health.stuck })}
        description={t("cancelDescription")}
        confirmText={t("cancelConfirm")}
        cancelText={t("keep")}
        confirmVariant="destructive"
        loading={busy}
      />
    </>
  );
}
