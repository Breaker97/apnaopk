"use client";

import { useCallback, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Archive,
  BellRing,
  CheckCheck,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  Package,
  RotateCcw,
  Trash2,
  Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import {
  useLiveResource,
  type LiveResourceError,
} from "@/hooks/use-live-resource";

type TabType = "all" | "unread" | "archived";
type NotificationAction = "read" | "archive" | "unarchive";

interface NotificationRecord {
  _id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  isRead: boolean;
  isArchived?: boolean;
  createdAt: string;
}

interface NotificationCounts {
  all: number;
  unread: number;
  archived: number;
}

/** The slice of GET /api/notifications this panel renders. */
interface NotificationSnapshot {
  notifications?: NotificationRecord[];
  counts?: NotificationCounts;
}

interface CustomerNotificationsProps {
  locale: string;
}

const initialCounts: NotificationCounts = {
  all: 0,
  unread: 0,
  archived: 0,
};

function getLocalizedHref(link: string | undefined, locale: string) {
  if (!link) return undefined;
  if (/^https?:\/\//i.test(link)) return link;
  if (link.startsWith(`/${locale}/`) || link === `/${locale}`) return link;
  if (link.startsWith("/")) return `/${locale}${link}`;
  return `/${locale}/${link}`;
}

function getNotificationVisual(type: string) {
  const visualMap = {
    order_placed: {
      icon: Package,
      className: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300",
      label: "Order",
    },
    order_status: {
      icon: Truck,
      className: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
      label: "Order",
    },
    order_delivered: {
      icon: CheckCircle2,
      className:
        "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
      label: "Delivery",
    },
    return_request: {
      icon: RotateCcw,
      className:
        "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
      label: "Return",
    },
    support_message: {
      icon: BellRing,
      className:
        "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
      label: "Support",
    },
    system: {
      icon: Info,
      className:
        "bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground",
      label: "System",
    },
  };

  return visualMap[type as keyof typeof visualMap] || visualMap.system;
}

export function CustomerNotifications({ locale }: CustomerNotificationsProps) {
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [counts, setCounts] = useState<NotificationCounts>(initialCounts);
  const [isFetching, setIsFetching] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [pendingId, setPendingId] = useState<string>();

  const tabs = useMemo(
    () =>
      [
        { id: "all", label: "All", count: counts.all },
        { id: "unread", label: "Unread", count: counts.unread },
        { id: "archived", label: "Archived", count: counts.archived },
      ] satisfies { id: TabType; label: string; count: number }[],
    [counts],
  );

  const emitStatsChanged = () => {
    window.dispatchEvent(new Event("account:stats-changed"));
  };

  const handleSnapshot = useCallback((snapshot: NotificationSnapshot) => {
    setNotifications(snapshot.notifications || []);
    setCounts(snapshot.counts || initialCounts);
    setIsFetching(false);
  }, []);

  const handleSnapshotError = useCallback((error: LiveResourceError) => {
    const expired = error.status === 401 || error.status === 403;
    toast.error(
      expired
        ? "Your session has expired. Sign in again to see your notifications."
        : error.message || "Failed to load notifications",
      {
        // One toast for this panel, replaced rather than stacked. Without a
        // stable id a resource that keeps failing — an expired session, an
        // endpoint that is down — raised a fresh toast on every tick and every
        // tab focus, which is a wall of "Request failed with status 401"
        // rather than a message anyone can act on.
        id: "customer-notifications-error",
      },
    );
    // Retire the skeleton either way, so a failure shows the empty state's
    // explanation rather than a placeholder that never resolves.
    setIsFetching(false);
  }, []);

  /**
   * Replaces a flat 15s timer that ran whether or not anyone was looking.
   *
   * The interval is slower now but the panel is *fresher* where it counts:
   * coming back to the tab refetches immediately, and a push refetches at
   * once. Polls that find nothing new are answered 304 (`lib/api/etag.ts`).
   */
  const { refresh: refreshNotifications } =
    useLiveResource<NotificationSnapshot>(
      `/api/notifications?tab=${activeTab}&limit=50`,
      { onData: handleSnapshot, onError: handleSnapshotError },
    );

  const updateNotifications = async (
    ids: string[],
    action: NotificationAction,
  ) => {
    if (ids.length === 0) return;
    setIsMutating(true);
    try {
      const response = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      if (!response.ok) throw new Error("Notification update failed");
      await refreshNotifications();
      emitStatsChanged();
    } catch {
      toast.error("Failed to update notification");
    } finally {
      setIsMutating(false);
      setPendingId(undefined);
    }
  };

  const markAllAsRead = async () => {
    setIsMutating(true);
    try {
      const response = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      if (!response.ok) throw new Error("Mark all failed");
      await refreshNotifications();
      emitStatsChanged();
    } catch {
      toast.error("Failed to mark notifications as read");
    } finally {
      setIsMutating(false);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    setPendingId(notificationId);
    try {
      const response = await fetch(`/api/notifications?id=${notificationId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Delete failed");
      await refreshNotifications();
      emitStatsChanged();
    } catch {
      toast.error("Failed to delete notification");
    } finally {
      setPendingId(undefined);
    }
  };

  const openNotification = async (notification: NotificationRecord) => {
    if (!notification.isRead) {
      await updateNotifications([notification._id], "read");
    }

    const href = getLocalizedHref(notification.link, locale);
    if (!href) return;
    if (/^https?:\/\//i.test(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    window.location.assign(href);
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="text-base font-semibold">Notifications</h2>
          <p className="text-sm text-muted-foreground">
            Order updates and account alerts
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          title="Mark all as read"
          onClick={() => void markAllAsRead()}
          disabled={isMutating || counts.unread === 0}
        >
          {isMutating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="border-b px-5 py-3">
        <div className="flex items-center gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-xs font-semibold",
                  activeTab === tab.id
                    ? "bg-background/20 text-background"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="h-[640px] max-h-[calc(100vh-250px)] min-h-96">
        {isFetching ? (
          <div className="flex h-60 items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
            <BellRing className="h-8 w-8" />
            <p className="text-sm font-medium">No notifications</p>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification._id}
                notification={notification}
                locale={locale}
                pending={pendingId === notification._id}
                onOpen={() => void openNotification(notification)}
                onArchive={() => {
                  setPendingId(notification._id);
                  void updateNotifications(
                    [notification._id],
                    notification.isArchived ? "unarchive" : "archive",
                  );
                }}
                onDelete={() => void deleteNotification(notification._id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function NotificationItem({
  notification,
  locale,
  pending,
  onOpen,
  onArchive,
  onDelete,
}: {
  notification: NotificationRecord;
  locale: string;
  pending: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const visual = getNotificationVisual(notification.type);
  const Icon = visual.icon;
  const href = getLocalizedHref(notification.link, locale);
  const createdAt = new Date(notification.createdAt);
  const timeAgo = Number.isNaN(createdAt.getTime())
    ? ""
    : formatDistanceToNow(createdAt, { addSuffix: true });

  return (
    <div
      className={cn(
        "group relative px-5 py-4 transition-colors hover:bg-muted/30",
        !notification.isRead && "bg-primary/[0.035]",
      )}
    >
      {!notification.isRead && (
        <div className="absolute right-5 top-5 h-2.5 w-2.5 rounded-full bg-primary" />
      )}

      <div className="flex gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
            visual.className,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <button type="button" onClick={onOpen} className="block w-full text-left">
            <div className="pr-8">
              <p
                className={cn(
                  "line-clamp-2 text-sm text-foreground",
                  !notification.isRead && "font-semibold",
                )}
              >
                {notification.title}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {notification.message}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {timeAgo && <span>{timeAgo}</span>}
                {timeAgo && <span aria-hidden="true">-</span>}
                <span>{visual.label}</span>
                {notification.isArchived && <Badge variant="outline">Archived</Badge>}
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1">
            {href && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-xs font-medium"
                onClick={onOpen}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
              title={notification.isArchived ? "Unarchive" : "Archive"}
              onClick={onArchive}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive"
              title="Delete"
              onClick={onDelete}
              disabled={pending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
