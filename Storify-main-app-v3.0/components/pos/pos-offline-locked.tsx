"use client";

import { formatDistanceToNow } from "date-fns";
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
  const lastSeen = session.lastAuthenticatedAt
    ? formatDistanceToNow(session.lastAuthenticatedAt, { addSuffix: true })
    : null;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
          <Lock className="h-6 w-6" aria-hidden />
        </div>

        <h2 className="text-lg font-semibold">Reconnect to keep selling</h2>

        <p className="mt-2 text-sm text-muted-foreground">
          {lastSeen
            ? `This register last reached the server ${lastSeen}. For security it stays locked until it can sign in again.`
            : "This register has not reached the server on this device yet, so it cannot be used offline."}
        </p>

        {queuedCount > 0 && (
          <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-sm">
            <strong>{queuedCount}</strong> offline sale
            {queuedCount === 1 ? " is" : "s are"} still saved on this device and
            will sync automatically once you are back online. Do not clear the
            browser data.
          </p>
        )}

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Wifi className="h-3.5 w-3.5" aria-hidden />
          Waiting for a connection…
        </div>
      </div>
    </div>
  );
}
