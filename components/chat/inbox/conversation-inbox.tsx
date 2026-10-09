"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, Inbox, Info, MessageCircle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import { createRequestAbort } from "@/lib/request-abort";
import { WhatsAppTemplateComposer } from "@/components/chat/whatsapp-template-composer";
import type {
  ConversationDraftPreview,
  ConversationDTO,
  ConversationMessageDTO,
} from "@/lib/conversations/types";
import {
  channelCapability,
  channelLabel,
  conversationAttachmentPolicy,
  hasReplyWindow,
  supportsTemplates,
  WEB_CHAT_ATTACHMENT_CEILING,
} from "@/lib/conversations/channels";
import type { MessageProduct } from "@/components/chat/chat-message-product";
import { useLiveResource } from "@/hooks/use-live-resource";
import { INBOX_UNREAD_CHANGED_EVENT } from "@/hooks/use-inbox-unread-count";
import { ConversationDetails } from "./conversation-details";
import { ConversationList } from "./conversation-list";
import { MessageComposer } from "./message-composer";
import { MessageThread } from "./message-thread";
import { ProductContextCard } from "./product-context-card";
import { AttachedProduct, ProductPicker } from "./product-picker";
import {
  conversationCursor,
  conversationStatusStyle,
  DELIVERY_STATUS_FALLBACKS,
  formatFileSize,
  getInitials,
  isStatusFilter,
  mergeMessages,
  mergeSnapshot,
  sortConversations,
  STATUS_FALLBACKS,
  type InboxFilter,
} from "./shared";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

/** One tick of GET /api/chat/conversations/live. */
interface ConversationFeed {
  conversations?: ConversationDTO[];
  createdMessages?: ConversationMessageDTO[];
  updatedMessages?: ConversationMessageDTO[];
  cursor?: string;
  statusSince?: string;
}

interface ConversationInboxProps {
  locale: string;
  initialConversations: ConversationDTO[];
  initialSelectedConversationId?: string;
  viewerMode: "customer" | "store";
  title?: string;
  emptyTitle?: string;
  /**
   * Context handed over by a storefront chat button when no matching thread
   * exists yet — a product, or just the vendor when the shopper started from a
   * vendor storefront. The thread is only created once the shopper sends the
   * first message, so vendors never see empty placeholder conversations.
   */
  draftContext?: {
    productId?: string;
    vendorId?: string;
    variantId?: string;
    variantName?: string;
    /** Absent when the context no longer resolves; sending then says why. */
    preview?: ConversationDraftPreview;
  };
}

/**
 * Which pane fills the screen when there is not enough room for all three.
 * Below `lg` one pane shows at a time; from `lg` the list and the thread sit
 * side by side; from `xl` the details panel joins them permanently.
 */
type Pane = "list" | "thread" | "details";

/**
 * A reply being written in one conversation: its text, the product put on
 * it, and the id of its last send (kept while the same reply is sent again,
 * so a retry after a lost answer is stored once).
 */
interface ReplyDraft {
  text: string;
  product?: MessageProduct;
  clientMessageId?: string;
  /** What the kept id was sent with: another text or product is another message. */
  sentAs?: string;
}

/** Refusal reasons the inbox words itself, by the server's `details.reason`. */
const REASON_KEYS: Record<string, [key: string, fallback: string]> = {
  PRODUCT_NOT_AVAILABLE: [
    "productNotAvailable",
    "This product can't be shared in this conversation.",
  ],
  ATTACHMENT_NOT_ACCEPTED: [
    "attachmentNotAccepted",
    "This conversation doesn't take this kind of file.",
  ],
  CONVERSATION_CLOSED: [
    "conversationClosedNotice",
    "This conversation is closed, so no more messages can be sent.",
  ],
};

/** The width (Tailwind's `lg`) from which the list and the thread show side by side. */
const SIDE_BY_SIDE = "(min-width: 1024px)";

export function ConversationInbox({
  locale,
  initialConversations,
  initialSelectedConversationId,
  viewerMode,
  title,
  emptyTitle,
  draftContext,
}: ConversationInboxProps) {
  const t = useTranslations("chat");
  // Memoized on `t` (itself stable per locale) so the data callbacks below can
  // depend on it without being rebuilt — and torn down and re-run — every
  // keystroke in the composer.
  const tr = useCallback(
    (
      key: string,
      fallback: string,
      values?: Record<string, string | number>,
    ) => {
      // Values have to reach next-intl itself: a message containing `{count}`
      // that is looked up without them throws a FORMATTING_ERROR and renders
      // the raw key. Interpolating the result afterwards, as this used to do,
      // never gets that far.
      if (t.has(key)) return t(key as never, values as never);
      // The English fallback carries the same placeholders as the source
      // string, so it is filled in the same way instead of leaking "{count}".
      return values
        ? Object.entries(values).reduce(
            (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
            fallback,
          )
        : fallback;
    },
    [t],
  );
  const statusLabel = (status: string) =>
    tr(`status.${status}`, STATUS_FALLBACKS[status] || status);
  const deliveryStatusLabel = (status: string) =>
    tr(`deliveryStatus.${status}`, DELIVERY_STATUS_FALLBACKS[status] || status);

  const [conversations, setConversations] = useState(
    sortConversations(initialConversations),
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(
    initialSelectedConversationId || initialConversations[0]?._id,
  );
  const [messages, setMessages] = useState<ConversationMessageDTO[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string>();
  // One draft per conversation: what was typed for one customer never goes
  // to the next one opened.
  const [drafts, setDrafts] = useState<Record<string, ReplyDraft>>({});
  const [sending, setSending] = useState(false);
  const [draftOpen, setDraftOpen] = useState(Boolean(draftContext));
  const [draftBody, setDraftBody] = useState("");
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  // A link to one conversation (a notification) opens it, not the list.
  const [pane, setPane] = useState<Pane>(
    draftContext || initialSelectedConversationId ? "thread" : "list",
  );
  const [loadingOlderConversations, setLoadingOlderConversations] =
    useState(false);
  // The server pages at 100; a full first page is the signal that more exist.
  const [hasMoreConversations, setHasMoreConversations] = useState(
    initialConversations.length >= 100,
  );
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const messageViewportRef = useRef<HTMLDivElement>(null);

  const selectedConversation = useMemo(
    () =>
      conversations.find((conversation) => conversation._id === selectedId) ||
      conversations[0],
    [conversations, selectedId],
  );
  // `selectedId` is seeded from an unvalidated URL parameter, so it can point at
  // a thread that is not in the list; `selectedConversation` then silently falls
  // back to the newest one. Everything rendered follows the fallback while the
  // live-message filter followed `selectedId`, so the open thread received no
  // streamed messages at all. Collapse the two onto one effective id.
  const activeConversationId = selectedConversation?._id;
  const activeConversationIdRef = useRef(activeConversationId);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  useApplyOnChange([activeConversationId, selectedId], () => {
    if (activeConversationId && activeConversationId !== selectedId) {
      setSelectedId(activeConversationId);
    }
  });

  const draft = activeConversationId ? drafts[activeConversationId] : undefined;
  const reply = draft?.text ?? "";
  const updateDraft = useCallback(
    (conversationId: string, change: (draft: ReplyDraft) => ReplyDraft) => {
      setDrafts((current) => {
        const next = change(current[conversationId] ?? { text: "" });
        const rest = { ...current };
        delete rest[conversationId];
        return next.text || next.product
          ? { ...rest, [conversationId]: next }
          : rest;
      });
    },
    [],
  );
  const setReply = (text: string) => {
    if (activeConversationId) {
      updateDraft(activeConversationId, (current) => ({ ...current, text }));
    }
  };

  const selectedCapability = selectedConversation
    ? channelCapability(selectedConversation.channel)
    : undefined;
  const conversationClosed =
    selectedConversation?.status === "closed" ||
    selectedConversation?.status === "spam";
  const attachmentPolicy = selectedConversation
    ? conversationAttachmentPolicy(
        selectedConversation.channel,
        WEB_CHAT_ATTACHMENT_CEILING,
      )
    : undefined;
  const providerReplyExpired =
    viewerMode === "store" &&
    Boolean(
      selectedConversation &&
        selectedCapability?.external &&
        // A channel with no provider window (Telegram) can always be replied
        // to. Treating "no window" as "expired window" would lock the composer
        // permanently, which is what the absent `replyWindowHours` guards.
        hasReplyWindow(selectedConversation.channel) &&
        // Channels with an extended manual-support window are judged on that
        // window once it exists; everything else on the standard reply window.
        (selectedCapability.humanAgentWindowDays !== undefined &&
        selectedConversation.humanAgentWindowExpiresAt
          ? new Date(
              selectedConversation.humanAgentWindowExpiresAt,
            ).getTime() <= currentTime
          : !selectedConversation.replyWindowExpiresAt ||
            new Date(selectedConversation.replyWindowExpiresAt).getTime() <=
              currentTime),
    );

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (filter === "unread" && conversation.unreadCount === 0) return false;
      if (isStatusFilter(filter) && conversation.status !== filter) return false;
      if (!query) return true;
      return [
        conversation.contact.name,
        conversation.contact.email,
        conversation.subject,
        conversation.productContext?.name,
        conversation.ownerName,
        conversation.lastMessagePreview,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [conversations, search, filter]);

  const replaceConversation = useCallback((next: ConversationDTO) => {
    setConversations((current) => {
      const held = current.find((conversation) => conversation._id === next._id);
      // An answer that left the server before a newer snapshot arrived (a slow
      // read receipt, a send) must not put the older row back.
      if (
        held &&
        new Date(held.updatedAt).getTime() > new Date(next.updatedAt).getTime()
      ) {
        return current;
      }
      return sortConversations([
        next,
        ...current.filter((conversation) => conversation._id !== next._id),
      ]);
    });
  }, []);

  /** The server's refusal in the inbox's words where it has them, else the server's own. */
  const errorText = useCallback(
    (payload: unknown, fallback: string) => {
      const body = payload as
        | { message?: string; details?: { reason?: string } }
        | null
        | undefined;
      const known = body?.details?.reason
        ? REASON_KEYS[body.details.reason]
        : undefined;
      if (known) return tr(known[0], known[1]);
      return body?.message || fallback;
    },
    [tr],
  );

  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      const viewport = messageViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
  }, []);

  const markRead = useCallback(
    async (conversationId: string) => {
      try {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/read`,
          { method: "POST" },
        );
        const payload = await response.json().catch(() => null);
        const conversation = payload?.data?.conversation as
          | ConversationDTO
          | undefined;
        if (response.ok && conversation) {
          replaceConversation(conversation);
          window.dispatchEvent(new Event(INBOX_UNREAD_CHANGED_EVENT));
        }
      } catch {
        // The next snapshot retries the read-state synchronization.
      }
    },
    [replaceConversation],
  );

  const loadMessages = useCallback(
    (conversationId: string, signal: AbortSignal) => {
      const request = async () => {
        const response = await fetch(
          `/api/chat/conversations/${conversationId}/messages?limit=30`,
          { signal },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(
            payload?.message ||
              tr("errors.loadMessages", "Unable to load messages"),
          );
        }
        return payload.data;
      };
      return request()
        .then((data) => {
          // A slow response for a thread the user has already navigated away
          // from must not overwrite the thread now on screen.
          if (signal.aborted) return;
          // Merged, not replaced: a message the feed delivered while this
          // page was on its way is kept.
          setMessages((current) =>
            mergeMessages(
              current.filter((message) => message.conversationId === conversationId),
              data.messages || [],
            ),
          );
          setHasMore(Boolean(data.hasMore));
          setNextCursor(data.nextCursor);
          if (data.conversation) {
            replaceConversation(data.conversation);
          }
          scrollToLatest();
        })
        .catch((error) => {
          if (signal.aborted) return;
          toast.error(
            error instanceof Error
              ? error.message
              : tr("errors.loadMessages", "Unable to load messages"),
          );
        })
        .finally(() => {
          if (!signal.aborted) setLoadingMessages(false);
        });
    },
    [replaceConversation, scrollToLatest, tr],
  );

  // Another thread starts empty: the last one's messages, its cursor and
  // "load older" never show under the new one's name while it loads.
  useApplyOnChange([activeConversationId], () => {
    setMessages([]);
    setHasMore(false);
    setNextCursor(undefined);
    if (activeConversationId) setLoadingMessages(true);
  });

  /**
   * Whether the open thread is in front of someone: the tab is visible and,
   * on a narrow screen where one pane shows at a time, the thread is that
   * pane. Only then are its messages marked read: a thread loaded behind the
   * list, or in a background tab, keeps its unread badge (and the customer's
   * channel sends no read receipt).
   */
  const paneRef = useRef(pane);
  useEffect(() => {
    paneRef.current = pane;
  }, [pane]);
  const threadInView = useCallback(
    () =>
      document.visibilityState === "visible" &&
      (paneRef.current !== "list" || window.matchMedia(SIDE_BY_SIDE).matches),
    [],
  );
  const activeUnread = selectedConversation?.unreadCount ?? 0;
  useEffect(() => {
    if (!activeConversationId || activeUnread === 0 || loadingMessages) return;
    const markWhenSeen = () => {
      if (threadInView()) void markRead(activeConversationId);
    };
    markWhenSeen();
    document.addEventListener("visibilitychange", markWhenSeen);
    window.addEventListener("resize", markWhenSeen);
    return () => {
      document.removeEventListener("visibilitychange", markWhenSeen);
      window.removeEventListener("resize", markWhenSeen);
    };
  }, [activeConversationId, activeUnread, loadingMessages, pane, markRead, threadInView]);

  // The ids on screen, for the feed to tell a genuine arrival from a message it re-reads.
  const knownMessageIdsRef = useRef(new Set<string>());
  useEffect(() => {
    knownMessageIdsRef.current = new Set(messages.map((message) => message._id));
  }, [messages]);
  useEffect(() => {
    if (!activeConversationId) return;
    // This effect also re-runs whenever `loadMessages` changes identity, not
    // only when the thread does, so most cleanups happen with nothing left to
    // cancel — hence `cancel()` rather than an unconditional `abort()`.
    const request = createRequestAbort("Message history request");
    void loadMessages(activeConversationId, request.signal).finally(
      request.settle,
    );
    return request.cancel;
  }, [loadMessages, activeConversationId]);

  /**
   * Feed cursors, held here rather than on the server.
   *
   * These are the whole of what the old SSE connection was keeping alive: how
   * far the message stream had been consumed, and how far back delivery-status
   * changes still had to be re-read. In refs, not state, because advancing them
   * must not re-render the inbox — and because the url builder below has to see
   * the newest values at request time, not the ones captured by the render that
   * scheduled the tick.
   */
  const feedCursorRef = useRef<string | null>(null);
  const feedStatusSinceRef = useRef<string | null>(null);

  const buildFeedUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (feedCursorRef.current) params.set("cursor", feedCursorRef.current);
    if (feedStatusSinceRef.current) {
      params.set("statusSince", feedStatusSinceRef.current);
    }
    const query = params.toString();
    return `/api/chat/conversations/live${query ? `?${query}` : ""}`;
  }, []);

  /**
   * Applies one tick.
   *
   * Deliberately independent of the current selection: it reads the open thread
   * through `activeConversationIdRef`, so picking a thread does not restart the
   * feed — which under the old stream re-ran the whole first-poll replay and
   * multiplied the server's per-tick cost by every click.
   */
  const applyFeed = useCallback(
    (feed: ConversationFeed) => {
      if (Array.isArray(feed.conversations) && feed.conversations.length > 0) {
        // The tick only carries the newest page. Replacing the list outright
        // would discard any older pages the user paged in, so keep the ones it
        // does not cover.
        setConversations((current) =>
          mergeSnapshot(current, feed.conversations as ConversationDTO[]),
        );
        setSelectedId((current) => current || feed.conversations?.[0]?._id);
      }

      const activeId = activeConversationIdRef.current;
      const created = (feed.createdMessages || []).filter(
        (message) => message.conversationId === activeId,
      );
      const updated = (feed.updatedMessages || []).filter(
        (message) => message.conversationId === activeId,
      );

      // The feed re-reads its last few seconds (another server may store a
      // message a moment later under a lower id), so what is already on
      // screen is not news.
      const arrivals = created.filter(
        (message) => !knownMessageIdsRef.current.has(message._id),
      );
      if (created.length > 0 || updated.length > 0) {
        setMessages((current) => {
          // A status change for a message not loaded (further back) waits for
          // its page; everything else lands in its place by time.
          const held = new Set(current.map((item) => item._id));
          return mergeMessages(current, [
            ...created,
            ...updated.filter((message) => held.has(message._id)),
          ]);
        });
      }
      // Reading it is the unread effect's job, once the thread is in view.
      if (arrivals.length > 0) scrollToLatest();

      if (feed.cursor) feedCursorRef.current = feed.cursor;
      if (feed.statusSince) feedStatusSinceRef.current = feed.statusSince;
    },
    [scrollToLatest],
  );

  /**
   * Replaces an SSE connection that was held open per agent and polled Mongo
   * every 2.5s. 15s is the backstop, not the delivery path: an inbound message
   * raises a `chat_message` notification, whose web push wakes this tab through
   * the service worker and refetches at once — and returning to the tab
   * refetches before the reader can notice anything was stale.
   */
  useLiveResource<ConversationFeed>(buildFeedUrl, {
    intervalMs: 15_000,
    onData: applyFeed,
  });

  const loadOlderConversations = async () => {
    const oldest = conversations[conversations.length - 1];
    if (!oldest || loadingOlderConversations) return;
    setLoadingOlderConversations(true);
    try {
      const params = new URLSearchParams({
        limit: "50",
        before: conversationCursor(oldest),
      });
      // "unread" is a client-side view of the same threads, not a status the
      // API knows about — sending it would be rejected as an invalid filter.
      if (isStatusFilter(filter)) params.set("status", filter);
      const response = await fetch(`/api/chat/conversations?${params}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ||
            tr("errors.loadConversations", "Unable to load conversations"),
        );
      }
      const older = (payload.data.conversations || []) as ConversationDTO[];
      setConversations((current) =>
        sortConversations([
          ...current,
          ...older.filter(
            (conversation) =>
              !current.some((existing) => existing._id === conversation._id),
          ),
        ]),
      );
      setHasMoreConversations(Boolean(payload.data.hasMore));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("errors.loadConversations", "Unable to load conversations"),
      );
    } finally {
      setLoadingOlderConversations(false);
    }
  };

  const loadOlder = async () => {
    if (!selectedConversation || !nextCursor || loadingOlder) return;
    const conversationId = selectedConversation._id;
    setLoadingOlder(true);
    try {
      const response = await fetch(
        `/api/chat/conversations/${conversationId}/messages?limit=30&before=${encodeURIComponent(nextCursor)}`,
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ||
            tr("errors.loadOlderMessages", "Unable to load older messages"),
        );
      }
      // Another thread was opened meanwhile: this page is not its history.
      if (activeConversationIdRef.current !== conversationId) return;
      setMessages((current) => mergeMessages(current, payload.data.messages || []));
      setHasMore(Boolean(payload.data.hasMore));
      setNextCursor(payload.data.nextCursor);
    } catch (error) {
      if (activeConversationIdRef.current !== conversationId) return;
      toast.error(
        error instanceof Error
          ? error.message
          : tr("errors.loadOlderMessages", "Unable to load older messages"),
      );
    } finally {
      setLoadingOlder(false);
    }
  };

  /**
   * Draft mode has no conversation to append to, so the first message goes to
   * the create endpoint; the returned thread then takes over as the selection.
   */
  const startDraftConversation = async () => {
    if (!draftContext || !draftBody.trim() || sending) return;
    const body = draftBody.trim();
    setSending(true);
    try {
      const response = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: body,
          productId: draftContext.productId,
          vendorId: draftContext.vendorId,
          variantId: draftContext.variantId,
          variantName: draftContext.variantName,
          clientMessageId: crypto.randomUUID(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          payload?.message ||
            tr("errors.startConversation", "Unable to start the conversation"),
        );
      }
      const conversation = payload.data.conversation as ConversationDTO;
      const message = payload.data.message as ConversationMessageDTO;
      setConversations((current) =>
        sortConversations([
          conversation,
          ...current.filter((item) => item._id !== conversation._id),
        ]),
      );
      setMessages([message]);
      setSelectedId(conversation._id);
      setDraftBody("");
      setDraftOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("errors.startConversation", "Unable to start the conversation"),
      );
    } finally {
      setSending(false);
    }
  };

  const sendReply = async () => {
    if (!selectedConversation || sending || conversationClosed) return;
    const conversationId = selectedConversation._id;
    const current = drafts[conversationId] ?? { text: "" };
    const body = current.text.trim();
    const product = current.product;
    if (!body && !product) return;
    // The same reply sent again (its answer was lost) keeps its id, so the
    // server stores it once; anything else is a new message.
    const sentAs = JSON.stringify([body, product?.productId ?? null]);
    const clientMessageId =
      current.sentAs === sentAs && current.clientMessageId
        ? current.clientMessageId
        : crypto.randomUUID();
    updateDraft(conversationId, (draft) => ({ ...draft, clientMessageId, sentAs }));
    setSending(true);
    try {
      const response = await fetch(
        `/api/chat/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: body,
            ...(product ? { productId: product.productId } : {}),
            clientMessageId,
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          errorText(payload, tr("errors.sendMessage", "Unable to send message")),
        );
      }
      const message = payload.data.message as ConversationMessageDTO;
      // The operator may have opened another thread while this was on its way.
      if (activeConversationIdRef.current === conversationId) {
        setMessages((messages) => mergeMessages(messages, [message]));
        scrollToLatest();
      }
      replaceConversation(payload.data.conversation);
      // Only what was sent is cleared: words typed meanwhile stay.
      updateDraft(conversationId, (draft) => ({
        text: draft.text.trim() === body ? "" : draft.text,
        product:
          draft.product?.productId === product?.productId ? undefined : draft.product,
      }));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("errors.sendMessage", "Unable to send message"),
      );
    } finally {
      setSending(false);
    }
  };

  const sendAttachment = async (file: File) => {
    if (
      !selectedConversation ||
      !attachmentPolicy ||
      uploading ||
      providerReplyExpired ||
      conversationClosed
    ) {
      return;
    }
    // Held to the channel's own types and sizes before anything is uploaded
    // (the server checks again).
    const allowed = attachmentPolicy.types.find(
      (type) => type.mimeType === file.type.split(";")[0]?.trim().toLowerCase(),
    );
    if (!allowed) {
      toast.error(
        tr("attachmentNotAccepted", "This conversation doesn't take this kind of file."),
      );
      return;
    }
    if (file.size > allowed.maxBytes) {
      toast.error(
        tr("attachmentTooLargeFor", "This file is larger than {size}, the most this conversation takes.", {
          size: formatFileSize(allowed.maxBytes),
        }),
      );
      return;
    }
    const conversationId = selectedConversation._id;
    // A channel whose files take no caption (Messenger, Instagram) gets the
    // file alone; the text stays in the composer to send after it.
    const caption = selectedCapability?.captionsWithMedia ? reply.trim() : "";
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (caption) formData.append("message", caption);
      formData.append("clientMessageId", crypto.randomUUID());
      const response = await fetch(
        `/api/chat/conversations/${conversationId}/attachments`,
        { method: "POST", body: formData },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          errorText(
            payload,
            tr("errors.sendAttachment", "Unable to send attachment"),
          ),
        );
      }
      const message = payload.data.message as ConversationMessageDTO;
      if (activeConversationIdRef.current === conversationId) {
        setMessages((messages) => mergeMessages(messages, [message]));
        scrollToLatest();
      }
      replaceConversation(payload.data.conversation);
      if (caption) {
        updateDraft(conversationId, (draft) => ({
          ...draft,
          text: draft.text.trim() === caption ? "" : draft.text,
        }));
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("errors.sendAttachment", "Unable to send attachment"),
      );
    } finally {
      setUploading(false);
    }
  };

  const updateStatus = async (status: "open" | "resolved") => {
    if (!selectedConversation) return;
    try {
      const response = await fetch(
        `/api/chat/conversations/${selectedConversation._id}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        throw new Error(
          errorText(
            payload,
            tr("errors.updateConversation", "Unable to update conversation"),
          ),
        );
      }
      replaceConversation(payload.data.conversation);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tr("errors.updateConversation", "Unable to update conversation"),
      );
    }
  };

  const windowClosedMessage =
    selectedConversation && providerReplyExpired
      ? supportsTemplates(selectedConversation.channel)
        ? tr(
            "whatsappWindowClosed",
            "The 24-hour reply window is closed. Send an approved WhatsApp template to reopen customer contact.",
          )
        : tr(
            "providerWindowClosed",
            "The {channel} reply window is closed, so standard replies are unavailable until the customer messages again.",
            { channel: channelLabel(selectedConversation.channel) },
          )
      : undefined;

  // A pending draft outranks the empty state: a first-time shopper arriving from
  // a storefront chat button has no conversations yet, and this early return
  // would otherwise swallow the composer they came here to use.
  if (!conversations.length && !draftOpen) {
    return (
      <div className="flex min-h-[32rem] flex-col items-center justify-center gap-3 rounded-xl border bg-card p-8 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-muted">
          <Inbox className="size-5 text-muted-foreground" />
        </span>
        <div>
          <p className="font-semibold">
            {emptyTitle || tr("noConversations", "No conversations yet")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr(
              "noConversationsHint",
              "New live-chat conversations will appear here.",
            )}
          </p>
        </div>
      </div>
    );
  }

  const headerName = selectedConversation
    ? viewerMode === "store"
      ? selectedConversation.contact.name
      : selectedConversation.ownerName || tr("storeSupport", "Store support")
    : "";
  const headerStatus = selectedConversation
    ? conversationStatusStyle(selectedConversation.status)
    : undefined;
  const draftPreview = draftContext?.preview;
  const draftOwnerName =
    draftPreview?.ownerName || tr("storeSupport", "Store support");

  return (
    <div className="flex h-[calc(100dvh-var(--dashboard-header-height,4rem)-var(--inbox-offset,7.5rem))] min-h-[32rem] overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* ---------- Conversations ---------- */}
      <aside
        className={cn(
          "min-h-0 w-full shrink-0 flex-col border-e bg-card lg:w-[340px]",
          pane === "list" ? "flex" : "hidden lg:flex",
        )}
      >
        <ConversationList
          locale={locale}
          viewerMode={viewerMode}
          conversations={filteredConversations}
          totalCount={conversations.length}
          selectedConversationId={
            draftOpen ? undefined : selectedConversation?._id
          }
          onSelect={(conversationId) => {
            setDraftOpen(false);
            setSelectedId(conversationId);
            setPane("thread");
          }}
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
          filters={(
            ["all", "unread", "open", "pending", "resolved"] as InboxFilter[]
          ).map((key) => ({ key, label: statusLabel(key) }))}
          title={title || tr("messages", "Messages")}
          hasMore={hasMoreConversations}
          loadingMore={loadingOlderConversations}
          onLoadMore={() => void loadOlderConversations()}
          labels={{
            search: tr("search", "Search conversations"),
            empty: tr("noMatchingConversations", "No matching conversations."),
            loadMore: tr("loadOlderConversations", "Load older conversations"),
            storeSupport: tr("storeSupport", "Store support"),
            unread: (count) => tr("unreadCount", "{count} unread", { count }),
            count:
              conversations.length === 1
                ? tr("conversationCountOne", "{count} conversation", {
                    count: conversations.length,
                  })
                : tr("conversationCount", "{count} conversations", {
                    count: conversations.length,
                  }),
          }}
        />
      </aside>

      {/* ---------- Thread ---------- */}
      <section
        className={cn(
          "min-h-0 min-w-0 flex-1 flex-col",
          pane === "thread" ? "flex" : "hidden",
          pane === "list" && "lg:flex",
          pane === "details" && "xl:flex",
        )}
      >
        {draftOpen ? (
          <>
            <header className="flex min-h-16 shrink-0 items-center gap-3 border-b px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-full lg:hidden"
                onClick={() => setPane("list")}
                aria-label={tr("backToList", "Back to conversations")}
              >
                <ArrowLeft className="rtl:rotate-180" />
              </Button>
              {draftPreview ? (
                // Laid out like the thread header that replaces it once the
                // first message is sent, so the pane does not jump.
                <>
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {getInitials(draftOwnerName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold leading-tight">
                      {draftOwnerName}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {tr("newConversation", "New conversation")}
                    </p>
                  </div>
                </>
              ) : (
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {tr("newConversation", "New conversation")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {draftContext?.productId
                      ? tr(
                          "draftProductContext",
                          "The product you were viewing is attached to this message.",
                        )
                      : tr(
                          "draftStoreContext",
                          "Your message goes straight to the store you were viewing.",
                        )}
                  </p>
                </div>
              )}
            </header>

            <div className="grid min-h-0 flex-1 place-items-center bg-muted/20 px-6 text-center">
              <div>
                <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                  <MessageCircle className="size-5" />
                </span>
                <p className="mt-3 font-semibold">
                  {tr("startConversation", "Start a conversation")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tr(
                    "startDescription",
                    "Ask about availability, delivery, variants, or anything else.",
                  )}
                </p>
              </div>
            </div>

            <MessageComposer
              autoFocus
              value={draftBody}
              onChange={setDraftBody}
              onSubmit={() => void startDraftConversation()}
              sending={sending}
              placeholder={tr("writeMessage", "Write a message…")}
              sendLabel={tr("sendMessage", "Send message")}
              notice={
                draftPreview?.productContext ? (
                  <div className="mb-3">
                    <p className="mb-1.5 text-[11px] text-muted-foreground">
                      {tr(
                        "draftProductContext",
                        "The product you were viewing is attached to this message.",
                      )}
                    </p>
                    <div className="rounded-lg border bg-muted/20">
                      <ProductContextCard
                        product={draftPreview.productContext}
                        viewProductLabel={tr("viewProduct", "View product")}
                      />
                    </div>
                  </div>
                ) : null
              }
            />
          </>
        ) : selectedConversation ? (
          <>
            <header className="flex min-h-16 shrink-0 items-center gap-3 border-b px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-full lg:hidden"
                onClick={() => setPane("list")}
                aria-label={tr("backToList", "Back to conversations")}
              >
                <ArrowLeft className="rtl:rotate-180" />
              </Button>

              <Avatar className="size-9 shrink-0">
                {viewerMode === "store" && selectedConversation.contact.image ? (
                  <AvatarImage
                    src={selectedConversation.contact.image}
                    alt={headerName}
                  />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                  {getInitials(headerName)}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">
                  {headerName}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    {channelLabel(selectedConversation.channel)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-1.5 py-px font-medium",
                      headerStatus?.badge,
                    )}
                  >
                    {statusLabel(selectedConversation.status)}
                  </span>
                </p>
              </div>

              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-full xl:hidden"
                onClick={() => setPane("details")}
                aria-label={tr("conversationDetails", "Conversation details")}
              >
                <Info />
              </Button>
            </header>

            <MessageThread
              locale={locale}
              viewerMode={viewerMode}
              conversation={selectedConversation}
              messages={messages}
              loading={loadingMessages}
              hasMore={hasMore}
              loadingOlder={loadingOlder}
              onLoadOlder={() => void loadOlder()}
              viewportRef={messageViewportRef}
              deliveryStatusLabel={deliveryStatusLabel}
              labels={{
                loadOlder: tr("loadOlder", "Load older messages"),
                empty: tr("noMessagesYet", "No messages yet."),
                today: tr("today", "Today"),
                yesterday: tr("yesterday", "Yesterday"),
                whatsappTemplate: tr("whatsappTemplate", "WhatsApp template"),
                internalNote: tr("internalNote", "Internal note · only your team sees this"),
              }}
            />

            <MessageComposer
              value={reply}
              onChange={setReply}
              onSubmit={() => void sendReply()}
              onAttach={
                attachmentPolicy?.types.length
                  ? (file) => void sendAttachment(file)
                  : undefined
              }
              attachAccept={attachmentPolicy?.types
                .map((type) => type.mimeType)
                .join(",")}
              sending={sending}
              uploading={uploading}
              disabled={providerReplyExpired || conversationClosed}
              placeholder={tr("writeReply", "Write a reply…")}
              sendLabel={tr("sendMessage", "Send message")}
              attachLabel={tr("attachFile", "Attach file")}
              actions={
                <ProductPicker
                  conversationId={selectedConversation._id}
                  disabled={providerReplyExpired || conversationClosed}
                  onPick={(product) =>
                    updateDraft(selectedConversation._id, (current) => ({
                      ...current,
                      product,
                    }))
                  }
                  labels={{
                    button: tr("shareProduct", "Share a product"),
                    search: tr("searchProducts", "Search products by name or SKU"),
                    empty: tr("noProductsFound", "No products found"),
                    error: tr("productsUnavailable", "Products could not be loaded"),
                    share: (name) =>
                      tr("shareProductNamed", "Share {name}", { name }),
                    priceOnRequest: tr(
                      "messageProduct.priceOnRequest",
                      "Price on request",
                    ),
                  }}
                />
              }
              hasAttachment={Boolean(draft?.product)}
              attachment={
                draft?.product ? (
                  <AttachedProduct
                    product={draft.product}
                    onRemove={() =>
                      updateDraft(selectedConversation._id, (current) => ({
                        ...current,
                        product: undefined,
                      }))
                    }
                    removeLabel={tr("removeProduct", "Remove {name}", {
                      name: draft.product.name,
                    })}
                    priceOnRequest={tr(
                      "messageProduct.priceOnRequest",
                      "Price on request",
                    )}
                  />
                ) : null
              }
              warning={
                conversationClosed
                  ? tr(
                      "conversationClosedNotice",
                      "This conversation is closed, so no more messages can be sent.",
                    )
                  : windowClosedMessage
              }
              notice={
                viewerMode === "store" &&
                supportsTemplates(selectedConversation.channel) ? (
                  <div className="mb-3">
                    <WhatsAppTemplateComposer
                      conversationId={selectedConversation._id}
                      required={providerReplyExpired}
                      onSent={({ conversation, message }) => {
                        if (activeConversationIdRef.current === conversation._id) {
                          setMessages((current) => mergeMessages(current, [message]));
                          scrollToLatest();
                        }
                        replaceConversation(conversation);
                      }}
                    />
                  </div>
                ) : null
              }
            />
          </>
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            {tr("selectConversation", "Select a conversation.")}
          </div>
        )}
      </section>

      {/* ---------- Details ---------- */}
      {selectedConversation && !draftOpen ? (
        <aside
          className={cn(
            "min-h-0 w-full shrink-0 flex-col border-s bg-card xl:w-[320px]",
            pane === "details" ? "flex" : "hidden xl:flex",
          )}
        >
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-3 xl:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 rounded-full"
              onClick={() => setPane("thread")}
              aria-label={tr("backToConversation", "Back to conversation")}
            >
              <ArrowLeft className="rtl:rotate-180" />
            </Button>
            <h3 className="text-sm font-semibold">
              {tr("conversationDetails", "Conversation details")}
            </h3>
          </div>

          <ConversationDetails
            viewerMode={viewerMode}
            conversation={selectedConversation}
            messages={messages}
            onConversationUpdated={replaceConversation}
            onUpdateStatus={(status) => void updateStatus(status)}
            replyWindowExpired={providerReplyExpired}
            statusLabel={statusLabel}
            labels={{
              mediaAndFiles: tr("mediaAndFiles", "Media, files and links"),
              media: tr("media", "Media"),
              files: tr("files", "Files"),
              links: tr("links", "Links"),
              noMedia: tr("noMedia", "No media shared yet"),
              noFiles: tr("noFiles", "No files shared yet"),
              noLinks: tr("noLinks", "No links shared yet"),
              subject: tr("subject", "Subject"),
              product: tr("productAttached", "Product context attached"),
              viewProduct: tr("viewProduct", "View product"),
              resolve: tr("resolve", "Resolve"),
              reopen: tr("reopen", "Reopen"),
              back: tr("backToConversation", "Back to conversation"),
              windowClosed: windowClosedMessage || "",
              storeSupport: tr("storeSupport", "Store support"),
            }}
          />
        </aside>
      ) : null}
    </div>
  );
}
