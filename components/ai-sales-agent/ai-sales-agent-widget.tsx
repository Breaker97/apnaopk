"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowUp, Loader2, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast-notification";
import { useCart } from "@/hooks/use-cart";
import { useCurrency } from "@/providers/currency-provider";
import { cn } from "@/lib/utils";
import { trackAddToCart } from "@/lib/analytics/events";
import type {
  AISalesChatAction,
  AISalesChatMessage,
  AISalesStreamEvent,
  PublicAISalesAgentConfig,
} from "@/lib/ai-sales-agent/types";
import type { Locale } from "@/config/i18n.config";
import {
  AISalesAssistantAvatar,
  AISalesHeaderIcon,
  AISalesMessageBubble,
} from "./ai-sales-message";

/** A message as the widget holds it: the reply in flight is marked so its bubble shows a caret. */
type WidgetMessage = AISalesChatMessage & { streaming?: boolean };

/**
 * The chat route answers with newline-delimited JSON, one `AISalesStreamEvent`
 * per line, so the cards can render the moment the tools finish and the text
 * can grow as the model writes it. A line may arrive split across chunks.
 */
async function* readStreamEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AISalesStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (line: string): AISalesStreamEvent | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as AISalesStreamEvent;
    } catch {
      return null;
    }
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const event = parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (event) yield event;
      newline = buffer.indexOf("\n");
    }
  }
  const last = parse(buffer);
  if (last) yield last;
}

export function AISalesAgentWidget({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const accountPath = `/${locale}/account`;
  const isAccountRoute =
    pathname === accountPath || pathname.startsWith(`${accountPath}/`);
  const t = useTranslations("aiSalesAgent");
  // The quoted-price wording is the storefront's, not the widget's: the card
  // must read the same here as it does on the product page it links to.
  const tProduct = useTranslations("product");
  const { addItem, refreshCart } = useCart();
  const { currency, formatPrice } = useCurrency();
  const [config, setConfig] = React.useState<PublicAISalesAgentConfig | null>(
    null,
  );
  const [open, setOpen] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string>();
  const [messages, setMessages] = React.useState<WidgetMessage[]>([]);
  const [input, setInput] = React.useState("");
  /** A request is in flight: the composer is locked. */
  const [loading, setLoading] = React.useState(false);
  /** Nothing of the reply has arrived yet: the typing dots show. */
  const [awaitingReply, setAwaitingReply] = React.useState(false);
  const [addedActions, setAddedActions] = React.useState<Set<string>>(new Set());
  const [pendingActions, setPendingActions] = React.useState<Set<string>>(
    new Set(),
  );
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/ai-sales-agent/config", { cache: "no-store" })
      .then((res) => res.json())
      .then((json) => {
        if (!alive) return;
        if (json?.success) setConfig(json.data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  React.useEffect(() => {
    const handleOpenWidget = () => setOpen(true);
    window.addEventListener("ai-sales-agent:open", handleOpenWidget);
    return () => {
      window.removeEventListener("ai-sales-agent:open", handleOpenWidget);
    };
  }, []);

  if (isAccountRoute) return null;
  if (!config?.enabled) return null;

  const labels = {
    addedToCart: t("addedToCart"),
    orderPayment: t("orderPayment"),
    orderTotal: t("orderTotal"),
    viewOrder: t("viewOrder"),
    priceOnRequest: tProduct("priceOnRequest"),
  };

  const sendMessage = async (override?: string) => {
    const text = (override || input).trim();
    if (!text || loading) return;
    const userMessage: WidgetMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setAwaitingReply(true);

    // The reply is one bubble that fills in: the first event creates it and
    // every later one patches it in place, so nothing flickers or reorders.
    const replyId = crypto.randomUUID();
    const patchReply = (patch: (message: WidgetMessage) => WidgetMessage) => {
      setMessages((prev) => {
        const index = prev.findIndex((message) => message.id === replyId);
        if (index === -1) {
          return [
            ...prev,
            patch({ id: replyId, role: "assistant", content: "", streaming: true }),
          ];
        }
        const next = [...prev];
        next[index] = patch(next[index]!);
        return next;
      });
    };

    try {
      const res = await fetch("/api/ai-sales-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text, locale }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !res.body || !contentType.includes("application/x-ndjson")) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message || "Chat failed");
      }

      let cartUpdated = false;
      for await (const event of readStreamEvents(res.body)) {
        switch (event.type) {
          case "meta":
            setConversationId(event.conversationId);
            break;
          case "tools":
            // Cards land before the sentence about them; the dots stay until
            // the text starts, below the cards.
            patchReply((message) => ({
              ...message,
              productCards: event.productCards,
              orderCards: event.orderCards,
              actions: event.actions,
            }));
            break;
          case "delta":
            setAwaitingReply(false);
            patchReply((message) => ({
              ...message,
              content: message.content + event.text,
            }));
            break;
          case "done":
            setConversationId(event.conversationId);
            patchReply(() => ({ ...event.message, id: replyId }));
            cartUpdated = Boolean(event.cartUpdated);
            break;
          case "error":
            throw new Error(event.message);
        }
      }
      if (cartUpdated) await refreshCart();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("chatFailed"));
      setMessages((prev) => [
        // Whatever did arrive stays; an empty in-flight bubble does not.
        ...prev
          .filter(
            (message) =>
              message.id !== replyId ||
              message.content ||
              (message.productCards && message.productCards.length > 0),
          )
          .map((message) =>
            message.id === replyId ? { ...message, streaming: false } : message,
          ),
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: t("errorRetry"),
        },
      ]);
    } finally {
      setLoading(false);
      setAwaitingReply(false);
    }
  };

  const handleAddToCart = async (
    action: Extract<AISalesChatAction, { type: "add_to_cart" }>,
  ) => {
    const key = `${action.productId}-${action.variantId || "default"}`;
    if (addedActions.has(key) || pendingActions.has(key)) return;

    // Pull the matching product details from the most recent assistant message
    // that exposes a productCards entry for this product.
    const product = [...messages]
      .reverse()
      .flatMap((m) => m.productCards || [])
      .find(
        (p) =>
          p.id === action.productId &&
          (action.variantId ? p.variantId === action.variantId : true),
      );

    setPendingActions((prev) => new Set(prev).add(key));
    try {
      await addItem({
        productId: action.productId,
        variantId: action.variantId,
        quantity: 1,
        price: product?.price ?? 0,
        name: product?.name ?? action.label,
        image: product?.image,
      });
      trackAddToCart({
        currency: currency.code,
        value: product?.price ?? 0,
        items: [
          {
            item_id: action.productId,
            item_name: product?.name ?? action.label,
            item_variant: action.variantId,
            price: product?.price ?? 0,
            quantity: 1,
          },
        ],
      });
      await refreshCart();
      setAddedActions((prev) => new Set(prev).add(key));
      toast.success(t("addedToCart"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("chatFailed"));
    } finally {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const right = config.widget.position !== "bottom-left";
  const headerGradient = `linear-gradient(135deg, ${config.widget.primaryColor}, ${config.widget.accentColor})`;

  return (
    <div
      // The scroll-to-top button shares this corner. `data-fab-side` is the
      // PHYSICAL side the merchant pinned the widget to, which is what the
      // stacking rule in globals.css keys on.
      data-store-fab="assistant"
      data-fab-side={right ? "right" : "left"}
      className={cn(
        // Cleared above the mobile bottom nav (its bar plus the safe-area inset),
        // which only exists below `xl`.
        "fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 xl:bottom-6",
        right ? "right-4 sm:right-6" : "left-4 sm:left-6",
      )}
    >
      {open && (
        <div
          className="mb-3 flex w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[32px] border bg-background text-foreground shadow-2xl"
          style={{
            width: `min(${config.widget.width}px, calc(100vw - 2rem))`,
            // Leaves room for the FAB plus the bottom nav it now sits above.
            height: `min(${config.widget.height}px, calc(100vh - 12rem))`,
          }}
        >
          <div className="relative px-4 pt-4">
            <div
              className="flex h-12 items-center justify-between rounded-full px-5 text-white"
              style={{ background: headerGradient }}
            >
              <span className="text-sm font-semibold tracking-wide">
                {config.widget.headerTitle?.trim() || config.agentName}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 transition-colors hover:bg-white/30"
                aria-label={t("close")}
              >
                <Plus className="h-4 w-4 rotate-45" />
              </button>
            </div>
            <div className="pointer-events-none absolute left-1/2 top-11 -translate-x-1/2">
              <AISalesHeaderIcon
                avatarUrl={config.widget.avatarUrl}
                faviconUrl={config.faviconUrl}
                primaryColor={config.widget.primaryColor}
                accentColor={config.widget.accentColor}
                agentName={config.agentName}
              />
            </div>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-10"
          >
            <div className="flex gap-2">
              <AISalesAssistantAvatar primaryColor={config.widget.primaryColor} />
              <div className="w-fit max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 text-sm leading-relaxed text-foreground">
                {config.greeting}
              </div>
            </div>

            {messages.map((message) => (
              <AISalesMessageBubble
                key={message.id}
                message={message}
                primaryColor={config.widget.primaryColor}
                formatPrice={formatPrice}
                onAddToCart={handleAddToCart}
                addedActions={addedActions}
                pendingActions={pendingActions}
                labels={labels}
                streaming={message.streaming}
              />
            ))}

            {awaitingReply && (
              <div className="flex items-center gap-2">
                <AISalesAssistantAvatar primaryColor={config.widget.primaryColor} />
                <div className="flex items-center gap-1 rounded-3xl bg-muted px-4 py-3">
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full"
                    style={{ backgroundColor: config.widget.primaryColor, animationDelay: "0ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full"
                    style={{ backgroundColor: config.widget.primaryColor, animationDelay: "150ms" }}
                  />
                  <span
                    className="h-1.5 w-1.5 animate-bounce rounded-full"
                    style={{ backgroundColor: config.widget.primaryColor, animationDelay: "300ms" }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="px-4 pb-4">
            <div
              className="flex items-center gap-2 rounded-full border-2 bg-card py-1.5 pl-4 pr-1.5 text-foreground"
              style={{ borderColor: config.widget.primaryColor }}
            >
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void sendMessage();
                }}
                placeholder={t("typeMessage")}
                aria-label={t("typeMessage")}
                className="h-9 flex-1 bg-transparent text-sm leading-none outline-none placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={loading || !input.trim()}
                aria-label={t("send")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
                style={{ backgroundColor: config.widget.primaryColor }}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
            {config.widget.showFooterText && config.widget.footerText && (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {config.widget.footerText}
              </p>
            )}
          </div>
        </div>
      )}

      {!open && (
        <Button
          size="icon"
          className="h-14 w-14 rounded-full shadow-xl"
          onClick={() => setOpen(true)}
          style={{ background: headerGradient }}
        >
          <MessageCircle className="h-6 w-6" />
          <span className="sr-only">{t("open")}</span>
        </Button>
      )}
    </div>
  );
}
