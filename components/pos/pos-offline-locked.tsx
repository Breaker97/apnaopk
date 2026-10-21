"use client";

import { useFormatter, useNow, useTranslations } from "next-intl";
import { Lock, Wifi } from "lucide-react";
import type { POSOfflineSessionState } from "@/lib/pos/offline-session";

interface POSOfflineLockedProps {
  session: POSOfflineSessionState;
  /** Sales still queued, so the cashier is told they are not lost. */
  queuedCount: number;
}

/**
 * Shown in place of the terminal when the register has been offline longer
 * than its session window allows.
 *
 * The reassurance about queued sales is not decoration. A cashier who reaches
 * this screen with unsynced sales needs to know, immediately, that the money
 * they took is still recorded — otherwise the reasonable response is to start
 * writing things on paper, or to clear the browser and lose the queue outright.
 */
export function POSOfflineLocked({
  session,
  queuedCount,
}: POSOfflineLockedProps) {
  const t = useTranslations("pos.offline");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const lastSeen = session.lastAuthenticatedAt
    ? format.relativeTime(session.lastAuthenticatedAt, now)
    : null;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <Lock className="h-6 w-6" aria-hidden />
        </div>

        <h2 className="text-lg font-semibold">{t("lockedTitle")}</h2>

        <p className="mt-2 text-sm text-muted-foreground">
          {lastSeen
            ? t("lockedLastSeen", { time: lastSeen })
            : t("lockedNever")}
        </p>

        {queuedCount > 0 && (
          <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            {t.rich("lockedQueued", {
              count: queuedCount,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Wifi className="h-3.5 w-3.5" aria-hidden />
          {t("waitingForConnection")}
        </div>
      </div>
    </div>
  );
}
