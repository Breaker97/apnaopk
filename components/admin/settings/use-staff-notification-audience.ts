"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api/client";
import type { NotificationSettings } from "@/lib/notifications/notification-settings";

/** How many staff each staff event can reach, and how many staff there are. */
export interface StaffNotificationAudience {
  total: number;
  events: Record<keyof NotificationSettings["staff"], number>;
}

/**
 * Who the staff events can reach, for Settings → Notifications; `null` until
 * it arrives or when the request fails. The page then says nothing about it:
 * the note is a help, and the switches work without it.
 */
export function useStaffNotificationAudience(): StaffNotificationAudience | null {
  const [audience, setAudience] = useState<StaffNotificationAudience | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ staff: StaffNotificationAudience }>(
        "/api/admin/settings/notifications/audience",
      )
      .then((data) => {
        if (!cancelled && data?.staff) setAudience(data.staff);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return audience;
}
