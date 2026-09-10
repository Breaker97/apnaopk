import { isToday, isYesterday } from "date-fns";
// Pure constants and arithmetic, no models and no `server-only`, so the client
// and the route it polls stay on one number rather than two that can drift.
import { CONVERSATION_LIMIT } from "@/lib/conversations/live-feed";
import type { ConversationDTO } from "@/lib/conversations/types";

export type ConversationStatusValue = ConversationDTO["status"];

/** Everything the list, the thread header and the details panel can filter by. */
export type InboxFilter = "all" | "unread" | ConversationStatusValue;

/** The subset of `InboxFilter` the conversations API accepts as `?status=`. */
const FILTERABLE_STATUSES: ConversationStatusValue[] = [
  "open",
  "pending",
  "resolved",
];

export function isStatusFilter(
  filter: InboxFilter,
): filter is ConversationStatusValue {
  return (FILTERABLE_STATUSES as string[]).includes(filter);
}

interface ConversationStatusStyle {
  /** Ring dot drawn on the avatar in the conversation list. */
  dot: string;
  /** Pill used in the thread header and the details panel. */
  badge: string;
}

/**
 * One description of how a conversation status is drawn.
 *
 * Every place a status appeared used to spell its own colours out — an amber
 * dot in the omnichannel list, a plain outline badge in the thread header, a
 * hard-coded emerald "Replied" chip in the legacy support pane — so the same
 * thread was drawn in three different palettes depending on which column you
 * looked at. Describing it once is what makes those views agree, and it is why
 * a status added to the model cannot silently inherit another one's colour.
 */
const CONVERSATION_STATUS_STYLES: Record<
  ConversationStatusValue,
  ConversationStatusStyle
> = {
  open: {
    dot: "bg-amber-500",
    badge:
      "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  pending: {
    dot: "bg-sky-500",
    badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  resolved: {
    dot: "bg-emerald-500",
    badge:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  closed: {
    dot: "bg-muted-foreground",
    badge: "border-border bg-muted text-muted-foreground",
  },
  spam: {
    dot: "bg-rose-500",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

export function conversationStatusStyle(status: string): ConversationStatusStyle {
  return (
    CONVERSATION_STATUS_STYLES[status as ConversationStatusValue] ??
    CONVERSATION_STATUS_STYLES.closed
  );
}

/**
 * English fallbacks for the raw values the API returns. They double as the
 * source strings for the `chat.status.*` / `chat.deliveryStatus.*` keys, so a
 * locale that has not been translated yet still renders a proper label instead
 * of the bare enum value.
 */
export const STATUS_FALLBACKS: Record<string, string> = {
  all: "All",
  unread: "Unread",
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
  spam: "Spam",
};

export const DELIVERY_STATUS_FALLBACKS: Record<string, string> = {
  queued: "Queued",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  failed: "Failed",
};

export function getInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("");
  return (parts || "?").toUpperCase().slice(0, 2);
}

export function sortConversations(conversations: ConversationDTO[]) {
  return [...conversations].sort(
    (a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );
}

/**
 * The live snapshot is authoritative for the window it covers (the newest N
 * threads) but says nothing about older ones. Anything the user paged in below
 * that window is preserved, so "load older" survives the next tick.
 *
 * "The window it covers" is the subtle part. The tick carries the newest N
 * threads *unfiltered*, while the list beside it may have been built by a
 * status filter, which the API applies server-side. On a busy inbox those two
 * windows are nothing alike: a matching thread from yesterday can sit outside
 * the newest N and still be far newer than that page's oldest member. Treating
 * absence from a full page as proof the thread is gone is what made it vanish
 * from a filtered list on the next tick.
 *
 * So absence only counts when the page is under-filled. A page of exactly N
 * was cut off by the limit and says nothing about what did not fit; a shorter
 * one is genuinely everything the viewer has, and a thread missing from it has
 * really left (an access change, a rollback) and should go.
 */
export function mergeSnapshot(
  current: ConversationDTO[],
  snapshot: ConversationDTO[],
  snapshotLimit: number = CONVERSATION_LIMIT,
) {
  if (!snapshot.length) return current;
  const snapshotIds = new Set(snapshot.map((conversation) => conversation._id));
  const saturated = snapshot.length >= snapshotLimit;
  const oldestInSnapshot = Math.min(
    ...snapshot.map((conversation) =>
      new Date(conversation.lastMessageAt).getTime(),
    ),
  );
  const keptFromCurrent = current.filter((conversation) => {
    if (snapshotIds.has(conversation._id)) return false;
    if (saturated) return true;
    return (
      new Date(conversation.lastMessageAt).getTime() < oldestInSnapshot
    );
  });
  return sortConversations([...snapshot, ...keptFromCurrent]);
}

export function conversationCursor(conversation: ConversationDTO) {
  return `${new Date(conversation.lastMessageAt).toISOString()}_${conversation._id}`;
}

export function formatRelativeTime(value: string, locale: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const seconds = Math.round((time - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function formatMessageTime(value: string, locale: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

export function formatDayLabel(
  value: string,
  locale: string,
  today: string,
  yesterday: string,
) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  if (isToday(parsed)) return today;
  if (isYesterday(parsed)) return yesterday;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(parsed);
}

export function formatFileSize(bytes?: number) {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
