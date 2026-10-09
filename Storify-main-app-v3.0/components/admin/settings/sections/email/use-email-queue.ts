"use client";

import { useCallback, useEffect, useState } from "react";

import type { EmailQueueHealth } from "@/lib/email/email-queue";

export const EMAIL_QUEUE_ENDPOINT = "/api/admin/email-deliveries/queue";

/**
 * The outbox as Settings → Email needs it (`getEmailQueueHealth`): emails stuck
 * waiting for the retry job, whether that job runs, and how the newest email
 * fared. Null until it loads, and when it cannot: the page then shows no
 * warning, and the log still lists every email.
 */
export function useEmailQueueHealth() {
  const [health, setHealth] = useState<EmailQueueHealth | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await fetch(EMAIL_QUEUE_ENDPOINT, { cache: "no-store" });
      const payload = (await response.json()) as {
        success?: boolean;
        data?: EmailQueueHealth;
      };
      if (response.ok && payload.success && payload.data) setHealth(payload.data);
    } catch {
      // Warnings only; see above.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  return { health, reload };
}
