"use client";

import { useEffect } from "react";
import { useLiveResource } from "@/hooks/use-live-resource";

/**
 * Fired on `window` when this tab changed a thread's read state, so the
 * sidebar badge drops the moment a conversation is opened instead of on the
 * next background tick.
 */
export const INBOX_UNREAD_CHANGED_EVENT = "inbox:unread-changed";

/**
 * Unread messages across the viewer's inbox, for the dashboard sidebars.
 *
 * Pass `enabled: false` when the viewer has no Inbox entry — the endpoint
 * refuses a viewer without inbox access, and polling a guaranteed 403 from
 * every page would be a request per tick for nothing.
 */
export function useInboxUnreadCount(enabled: boolean): number {
  const { data, refresh } = useLiveResource<{ unreadMessages: number }>(
    enabled ? "/api/chat/conversations/unread" : null,
  );

  useEffect(() => {
    if (!enabled) return;
    const onChanged = () => void refresh();
    window.addEventListener(INBOX_UNREAD_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(INBOX_UNREAD_CHANGED_EVENT, onChanged);
  }, [enabled, refresh]);

  return enabled ? (data?.unreadMessages ?? 0) : 0;
}
