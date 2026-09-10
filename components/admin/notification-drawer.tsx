"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Archive,
  Bell,
  BellRing,
  CheckCheck,
  DollarSign,
  ExternalLink,
  Info,
  Loader2,
  Package,
  Settings,
  Smartphone,
  Star,
  Store,
  Ticket,
  Trash2,
  Truck,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { useAppSettings } from "@/stores/app-settings";
// The store's own name, so install copy never advertises this app's brand.
import { useAppSettings as useStoreSettings } from "@/providers/app-settings-provider";
import { localeConfig, type Locale } from "@/config/i18n.config";
import {
  SERVICE_WORKER_PATH,
  shouldEnableServiceWorker,
} from "@/lib/pwa/pwa";
import { apiClient } from "@/lib/api/client";
import { useLiveResource } from "@/hooks/use-live-resource";
import { useClientValue } from "@/hooks/use-client-value";
import { useMediaQuery } from "@/hooks/use-media-query";

type TabType = "all" | "unread" | "archived";
type NotificationAction = "read" | "unread" | "archive" | "unarchive";

interface NotificationRecord {
  _id: string;
  type: string;
  title: string;
  message: string;
  link?: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  isArchived?: boolean;
  createdAt: string;
}

interface NotificationCounts {
  all: number;
  unread: number;
  archived: number;
}

interface NotificationSnapshot {
  notifications?: NotificationRecord[];
  recentUnreadNotifications?: NotificationRecord[];
  counts?: NotificationCounts;
}

interface PushStatus {
  supported: boolean;
  configured: boolean;
  publicKey: string | null;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  activeSubscriptions: number;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface NotificationDrawerProps {
  locale: Locale;
}

const initialCounts: NotificationCounts = {
  all: 0,
  unread: 0,
  archived: 0,
};

function supportsBrowserPush() {
  return (
    typeof window !== "undefined" &&
    shouldEnableServiceWorker() &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function ensureServiceWorkerRegistration() {
  if (!shouldEnableServiceWorker()) {
    throw new Error("Browser push is disabled during development");
  }

  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not available in this browser");
  }

  await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" });
  return navigator.serviceWorker.ready;
}

function getLocalizedHref(link: string | undefined, locale: Locale) {
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
      className: "bg-blue-500/10 text-blue-600",
      label: "Order",
    },
    order_status: {
      icon: Truck,
      className: "bg-cyan-500/10 text-cyan-700",
      label: "Status",
    },
    order_delivered: {
      icon: CheckCheck,
      className: "bg-emerald-500/10 text-emerald-700",
      label: "Delivered",
    },
    payment_received: {
      icon: DollarSign,
      className: "bg-emerald-500/10 text-emerald-700",
      label: "Payment",
    },
    review_received: {
      icon: Star,
      className: "bg-amber-500/10 text-amber-700",
      label: "Review",
    },
    return_request: {
      icon: Truck,
      className: "bg-orange-500/10 text-orange-700",
      label: "Return",
    },
    support_message: {
      icon: BellRing,
      className: "bg-sky-500/10 text-sky-700",
      label: "Support",
    },
    vendor_application: {
      icon: Store,
      className: "bg-violet-500/10 text-violet-700",
      label: "Vendor",
    },
    product_low_stock: {
      icon: AlertTriangle,
      className: "bg-red-500/10 text-red-700",
      label: "Inventory",
    },
    coupon_applied: {
      icon: Ticket,
      className: "bg-fuchsia-500/10 text-fuchsia-700",
      label: "Coupon",
    },
    system: {
      icon: Info,
      className: "bg-slate-500/10 text-slate-700",
      label: "System",
    },
  } satisfies Record<
    string,
    { icon: typeof Bell; className: string; label: string }
  >;

  return visualMap[type as keyof typeof visualMap] || visualMap.system;
}

/** The browser's and the server's view of push, read together. */
async function readPushStatus(): Promise<PushStatus> {
  const supported = supportsBrowserPush();
  const permission: PushStatus["permission"] = supported
    ? Notification.permission
    : "unsupported";
  let serverStatus: Pick<
    PushStatus,
    "configured" | "publicKey" | "activeSubscriptions"
  > = {
    configured: false,
    publicKey: null,
    activeSubscriptions: 0,
  };
  let subscribed = false;

  if (typeof fetch === "function") {
    try {
      const response = await fetch("/api/notifications/push", {
        cache: "no-store",
      });
      const json = await response.json();
      if (response.ok && json?.success) {
        serverStatus = {
          configured: Boolean(json.data?.configured),
          publicKey: json.data?.publicKey || null,
          activeSubscriptions: Number(json.data?.activeSubscriptions || 0),
        };
      }
    } catch {
      // The drawer still renders useful browser support state without this.
    }
  }

  if (supported) {
    try {
      const registration = await ensureServiceWorkerRegistration();
      subscribed = Boolean(await registration.pushManager.getSubscription());
    } catch {
      subscribed = false;
    }
  }

  return {
    supported,
    permission,
    subscribed,
    ...serverStatus,
  };
}

export function NotificationDrawer({ locale }: NotificationDrawerProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("all");
  const [showSettings, setShowSettings] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [counts, setCounts] = useState<NotificationCounts>(initialCounts);
  const [loadedTab, setLoadedTab] = useState<TabType>();
  const [isMutating, setIsMutating] = useState(false);
  const [pendingNotificationId, setPendingNotificationId] = useState<string>();
  const [pushStatus, setPushStatus] = useState<PushStatus>({
    supported: false,
    configured: false,
    publicKey: null,
    permission: "unsupported",
    subscribed: false,
    activeSubscriptions: 0,
  });
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  // Installed PWA: the display-mode media query, or Safari's own flag on iOS.
  const standaloneDisplay = useMediaQuery("(display-mode: standalone)");
  const iosStandalone = useClientValue(
    () =>
      Boolean(
        (window.navigator as Navigator & { standalone?: boolean }).standalone,
      ),
    false,
  );
  const isStandalone = standaloneDisplay || iosStandalone;
  const knownNotificationIdsRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);
  const { rtl } = useAppSettings();
  const { storeName } = useStoreSettings();

  const isRtl =
    rtl || (localeConfig[locale as Locale]?.direction ?? "ltr") === "rtl";

  const tabs = useMemo(
    () =>
      [
        { id: "all", label: "All", count: counts.all },
        { id: "unread", label: "Unread", count: counts.unread },
        { id: "archived", label: "Archived", count: counts.archived },
      ] satisfies { id: TabType; label: string; count: number }[],
    [counts],
  );

  const rememberNotificationIds = useCallback(
    (items: NotificationRecord[] = []) => {
      for (const item of items) {
        if (item?._id) knownNotificationIdsRef.current.add(item._id);
      }
    },
    [],
  );

  const navigateToNotification = useCallback(
    (notification: NotificationRecord) => {
      const href = getLocalizedHref(notification.link, locale);
      if (!href) return;

      setOpen(false);
      if (/^https?:\/\//i.test(href)) {
        window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      window.location.assign(href);
    },
    [locale],
  );

  const showRealtimeToast = useCallback(
    (notification: NotificationRecord, newCount: number) => {
      const href = getLocalizedHref(notification.link, locale);
      const extraText =
        newCount > 1 ? ` ${newCount - 1} more new notification(s).` : "";

      toast.info(notification.title, {
        description: `${notification.message}${extraText}`,
        duration: 6500,
        id: `notification-${notification._id}`,
        action: href
          ? {
              label: "View",
              onClick: () => navigateToNotification(notification),
            }
          : undefined,
      });
    },
    [locale, navigateToNotification],
  );

  const applyNotificationSnapshot = useCallback(
    (
      snapshot: NotificationSnapshot,
      tab: TabType,
      options: { notifyForNew?: boolean } = {},
    ) => {
      const nextNotifications = Array.isArray(snapshot.notifications)
        ? snapshot.notifications
        : [];
      const recentUnreadNotifications = Array.isArray(
        snapshot.recentUnreadNotifications,
      )
        ? snapshot.recentUnreadNotifications
        : [];
      const alertCandidates =
        recentUnreadNotifications.length > 0
          ? recentUnreadNotifications
          : nextNotifications;
      const newNotifications = alertCandidates.filter(
        (notification) =>
          notification?._id &&
          !knownNotificationIdsRef.current.has(notification._id) &&
          !notification.isRead &&
          !notification.isArchived,
      );

      rememberNotificationIds(nextNotifications);
      rememberNotificationIds(recentUnreadNotifications);
      setNotifications(nextNotifications);
      setCounts(snapshot.counts || initialCounts);
      setLoadedTab(tab);

      if (
        options.notifyForNew &&
        bootstrappedRef.current &&
        newNotifications.length > 0
      ) {
        showRealtimeToast(newNotifications[0], newNotifications.length);
      }

      bootstrappedRef.current = true;
    },
    [rememberNotificationIds, showRealtimeToast],
  );

  // A tab switch is a different resource, so the toast suppression has to
  // re-arm: the first payload for the new tab is a bootstrap, not a burst of
  // arrivals, and announcing it would toast notifications the user has had all
  // along.
  useEffect(() => {
    bootstrappedRef.current = false;
  }, [activeTab]);

  const handleSnapshot = useCallback(
    (snapshot: NotificationSnapshot) => {
      applyNotificationSnapshot(snapshot, activeTab, { notifyForNew: true });
    },
    [activeTab, applyNotificationSnapshot],
  );

  // Retire the skeleton on failure too, so the empty state can explain itself
  // instead of leaving a placeholder shimmering against a dead endpoint.
  const handleSnapshotError = useCallback(() => {
    setLoadedTab(activeTab);
  }, [activeTab]);

  /**
   * Keeps the drawer current without holding a connection open.
   *
   * `recentUnread=true` because the toast has to fire for an arrival even while
   * the user is sitting on the archived tab, where the main list cannot contain
   * it. Mutations and the Refresh button both go through `refreshNotifications`
   * so every update takes one path — and each is a conditional request, so the
   * common "nothing changed" answer costs two indexed reads, not a payload.
   */
  const { refresh: refreshNotifications, isValidating: isRefreshing } =
    useLiveResource<NotificationSnapshot>(
      `/api/notifications?tab=${activeTab}&limit=20&recentUnread=true`,
      { onData: handleSnapshot, onError: handleSnapshotError },
    );

  const refreshPushStatus = useCallback(
    () => readPushStatus().then(setPushStatus),
    [],
  );

  // Opening the drawer is the moment staleness would be noticed, so revalidate
  // then rather than waiting out the background interval.
  useEffect(() => {
    if (!open) return;
    void refreshNotifications();
  }, [open, refreshNotifications]);

  useEffect(() => {
    if (!open || !showSettings) return;
    void refreshPushStatus();
  }, [open, refreshPushStatus, showSettings]);

  useEffect(() => {
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
  }, []);

  const updateNotifications = async (
    ids: string[],
    action: NotificationAction,
  ) => {
    if (ids.length === 0) return;
    setIsMutating(true);
    try {
      await apiClient.put("/api/notifications", { ids, action });
      await refreshNotifications();
    } catch {
      toast.error("Failed to update notification");
    } finally {
      setIsMutating(false);
      setPendingNotificationId(undefined);
    }
  };

  const markAllAsRead = async () => {
    setIsMutating(true);
    try {
      await apiClient.put("/api/notifications", { markAll: true });
      await refreshNotifications();
    } catch {
      toast.error("Failed to mark notifications as read");
    } finally {
      setIsMutating(false);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    setPendingNotificationId(notificationId);
    try {
      await apiClient.delete(`/api/notifications?id=${notificationId}`);
      await refreshNotifications();
    } catch {
      toast.error("Failed to delete notification");
    } finally {
      setPendingNotificationId(undefined);
    }
  };

  const openNotification = async (notification: NotificationRecord) => {
    if (!notification.isRead) {
      await updateNotifications([notification._id], "read");
    }

    navigateToNotification(notification);
  };

  const enablePushNotifications = async () => {
    setIsMutating(true);
    try {
      const statusResponse = await fetch("/api/notifications/push", {
        cache: "no-store",
      });
      const statusJson = await statusResponse.json();
      const publicKey = statusJson?.data?.publicKey;
      if (!statusResponse.ok || !statusJson?.data?.configured || !publicKey) {
        throw new Error(
          "Browser push is not configured on the server. Add VAPID keys first.",
        );
      }

      if (!supportsBrowserPush()) {
        throw new Error("Browser push is not supported here");
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted");
      }

      const registration = await ensureServiceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      await apiClient.post("/api/notifications/push", {
        subscription: subscription.toJSON(),
        locale,
      });

      toast.success("Browser notifications enabled");
      await refreshPushStatus();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to enable browser notifications",
      );
    } finally {
      setIsMutating(false);
    }
  };

  const disablePushNotifications = async () => {
    setIsMutating(true);
    try {
      const registration = await ensureServiceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint;

      if (subscription) {
        await subscription.unsubscribe();
      }

      await apiClient.request("DELETE", "/api/notifications/push", {
        endpoint,
      });

      toast.success("Browser notifications disabled");
      await refreshPushStatus();
    } catch {
      toast.error("Failed to disable browser notifications");
    } finally {
      setIsMutating(false);
    }
  };

  const sendTestPush = async () => {
    setIsMutating(true);
    try {
      await apiClient.post("/api/notifications/push/test");
      toast.success("Test notification sent");
      await refreshNotifications();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to send test notification",
      );
    } finally {
      setIsMutating(false);
    }
  };

  const installApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative",
            counts.unread > 0
              ? "text-foreground hover:text-primary"
              : "text-muted-foreground hover:text-primary",
          )}
          aria-label="Open notifications"
        >
          {counts.unread > 0 ? (
            <BellRing className="h-5 w-5" />
          ) : (
            <Bell className="h-5 w-5" />
          )}
          {counts.unread > 0 && (
            <Badge className="absolute -inset-e-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] leading-none text-white shadow-sm ring-2 ring-background">
              {counts.unread > 9 ? "9+" : counts.unread}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        side={isRtl ? "left" : "right"}
        showCloseButton={false}
        className={cn(
          "w-[min(92vw,420px)] max-w-[420px] gap-0 overflow-hidden bg-background p-0 shadow-2xl",
          isRtl ? "border-r-0" : "border-l-0",
        )}
      >
        <SheetHeader className="sticky top-0 z-10 flex flex-row items-center justify-between border-b border-border/30 bg-background px-4 py-4 sm:px-5">
          <SheetTitle className="text-base font-bold tracking-tight sm:text-lg">
            Notifications
          </SheetTitle>
          <SheetDescription className="sr-only">
            Recent notifications and browser push settings
          </SheetDescription>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-primary"
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
            <Button
              variant={showSettings ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              title="Notification settings"
              onClick={() => setShowSettings((value) => !value)}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </SheetClose>
          </div>
        </SheetHeader>

        {!showSettings && (
          <div className="border-b border-border/30 px-4 py-3 sm:px-5">
            <div className="scrollbar-hide flex items-center gap-1.5 overflow-x-auto sm:gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-all sm:gap-2 sm:px-4",
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
        )}

        {showSettings ? (
          <NotificationSettingsPanel
            pushStatus={pushStatus}
            isMutating={isMutating}
            canInstall={Boolean(installPrompt) && !isStandalone}
            storeName={storeName}
            onEnablePush={() => void enablePushNotifications()}
            onDisablePush={() => void disablePushNotifications()}
            onSendTest={() => void sendTestPush()}
            onInstall={() => void installApp()}
          />
        ) : (
          <ScrollArea
            className="min-h-0 flex-1"
            viewportClassName="h-full"
          >
            {loadedTab !== activeTab ? (
              <NotificationListSkeleton />
            ) : notifications.length === 0 ? (
              <div className="flex h-52 flex-col items-center justify-center gap-2 px-8 text-center text-muted-foreground">
                <BellRing className="h-8 w-8" />
                <p className="text-sm font-medium">No notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {notifications.map((notification) => (
                  <NotificationItem
                    key={notification._id}
                    notification={notification}
                    pending={pendingNotificationId === notification._id}
                    onOpen={() => void openNotification(notification)}
                    onArchive={() => {
                      setPendingNotificationId(notification._id);
                      void updateNotifications(
                        [notification._id],
                        notification.isArchived ? "unarchive" : "archive",
                      );
                    }}
                    onDelete={() => void deleteNotification(notification._id)}
                    locale={locale}
                  />
                ))}
              </div>
            )}

            <div className="flex justify-center px-4 py-4 sm:px-5">
              <Button
                variant="ghost"
                className="font-medium text-foreground hover:bg-muted"
                onClick={() => void refreshNotifications()}
                disabled={isRefreshing}
              >
                {isRefreshing && <Loader2 className="h-4 w-4 animate-spin" />}
                Refresh
              </Button>
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}

function NotificationListSkeleton() {
  return (
    <div role="status" aria-busy="true" className="divide-y divide-border/30">
      <span className="sr-only">Loading notifications</span>
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex gap-3 px-4 py-4 sm:px-5">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="space-y-2 pe-5 sm:pe-8">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-8 w-20 rounded-full" />
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationSettingsPanel({
  pushStatus,
  isMutating,
  canInstall,
  storeName,
  onEnablePush,
  onDisablePush,
  onSendTest,
  onInstall,
}: {
  pushStatus: PushStatus;
  isMutating: boolean;
  canInstall: boolean;
  storeName: string;
  onEnablePush: () => void;
  onDisablePush: () => void;
  onSendTest: () => void;
  onInstall: () => void;
}) {
  const statusText = !pushStatus.supported
    ? "Unsupported"
    : !pushStatus.configured
      ? "Server keys missing"
      : pushStatus.permission === "denied"
        ? "Blocked"
        : pushStatus.subscribed
          ? "Enabled"
          : "Off";

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="h-full">
      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div className="rounded-lg border border-border/60 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">Browser push</p>
                <Badge variant="outline" className="rounded-md">
                  {statusText}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {pushStatus.activeSubscriptions} active browser
                {pushStatus.activeSubscriptions === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {pushStatus.subscribed ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onDisablePush}
                disabled={isMutating}
              >
                {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
                Disable
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={onEnablePush}
                disabled={
                  isMutating ||
                  !pushStatus.supported ||
                  !pushStatus.configured ||
                  pushStatus.permission === "denied"
                }
              >
                {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
                Enable
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onSendTest}
              disabled={isMutating || !pushStatus.subscribed}
            >
              Send test
            </Button>
          </div>
        </div>

        {canInstall && (
          <div className="rounded-lg border border-border/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">Install app</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add {storeName} to this device.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={onInstall}>
                Install
              </Button>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function NotificationItem({
  notification,
  pending,
  onOpen,
  onArchive,
  onDelete,
  locale,
}: {
  notification: NotificationRecord;
  pending: boolean;
  onOpen: () => void;
  onArchive: () => void;
  onDelete: () => void;
  locale: Locale;
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
        "group relative px-4 py-4 transition-colors hover:bg-muted/30 sm:px-5",
        !notification.isRead && "bg-primary/[0.035]",
      )}
    >
      {!notification.isRead && (
        <div className="absolute end-4 top-5 h-2.5 w-2.5 rounded-full bg-primary sm:end-5" />
      )}

      <div className="flex gap-3">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarFallback className={cn("text-sm font-medium", visual.className)}>
            <Icon className="h-5 w-5" />
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 space-y-2.5">
          <button
            type="button"
            onClick={onOpen}
            className="block w-full text-left"
          >
            <div className="pe-5 sm:pe-8">
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
                {timeAgo && <span>·</span>}
                <span>{visual.label}</span>
              </div>
            </div>
          </button>

          <div className="flex flex-wrap items-center gap-1.5">
            {href && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-full px-3 text-xs font-medium"
                onClick={onOpen}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
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
              className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted hover:text-destructive"
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
