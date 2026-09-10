"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import type { MessageProvider } from "@/models/channel-connection.model";
import { providerLabel } from "@/lib/conversations/channels";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface FailedDeliveryDTO {
  _id: string;
  conversationId: string;
  provider: MessageProvider;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  deadLetter: boolean;
  contactName: string;
  subject: string;
  messagePreview: string;
  updatedAt: string;
}

export function DeliveryFailuresPanel() {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);

  const [deliveries, setDeliveries] = useState<FailedDeliveryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string>();

  const load = useCallback(() => {
    const request = async () => {
      const response = await fetch("/api/chat/deliveries?limit=50");
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || tr("deliveries.loadFailed", "Unable to load delivery failures"));
      }
      return (payload.data.deliveries || []) as FailedDeliveryDTO[];
    };
    return request()
      .then((deliveries) => setDeliveries(deliveries))
      .catch((error) => {
        toast.error(
          error instanceof Error
            ? error.message
            : tr("deliveries.loadFailed", "Unable to load delivery failures"),
        );
      })
      .finally(() => setLoading(false));
  }, [tr]);
  // Retries reload with the spinner; the first load sets it during render.
  const reload = useCallback(() => {
    setLoading(true);
    return load();
  }, [load]);

  useApplyOnChange([load], () => {
    setLoading(true);
  });
  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (outboxId: string) => {
    setRetrying(outboxId);
    try {
      const response = await fetch("/api/chat/deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outboxId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.message || tr("deliveries.retryFailed", "Unable to retry delivery"));
      }
      if (payload.data.sent) {
        toast.success(tr("deliveries.delivered", "Message delivered"));
      } else {
        toast.warning(
          tr("deliveries.queued", "Retry was queued but delivery still failed"),
        );
      }
      await reload();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tr("deliveries.retryFailed", "Unable to retry delivery"),
      );
    } finally {
      setRetrying(undefined);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4 text-amber-500" />
            {tr("deliveries.heading", "Provider delivery failures")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr("deliveries.subtitle", "Inspect exhausted or retryable provider messages.")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void reload()}
        >
          <RefreshCw className={loading ? "animate-spin" : undefined} />
          {tr("deliveries.refresh", "Refresh")}
        </Button>
      </div>

      {loading ? (
        <div className="grid min-h-24 place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : deliveries.length ? (
        <div className="space-y-2">
          {deliveries.map((delivery) => (
            <div
              key={delivery._id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium">
                    {delivery.contactName}
                  </p>
                  <Badge variant="outline" className="capitalize">
                    {providerLabel(delivery.provider)}
                  </Badge>
                  {delivery.deadLetter ? (
                    <Badge variant="destructive">
                      {tr("deliveries.deadLetter", "Dead letter")}
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      {tr("deliveries.attempt", "Attempt")} {delivery.attempts}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                  {delivery.messagePreview}
                </p>
                {delivery.lastError ? (
                  <p className="mt-1 line-clamp-2 text-xs text-destructive">
                    {delivery.lastError}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={Boolean(retrying)}
                onClick={() => void retry(delivery._id)}
              >
                {retrying === delivery._id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                {tr("deliveries.retry", "Retry")}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {tr("deliveries.empty", "No failed provider deliveries.")}
        </p>
      )}
    </div>
  );
}
