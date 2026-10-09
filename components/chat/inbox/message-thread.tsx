"use client";

import { Fragment, useMemo, type RefObject } from "react";
import { Loader2, Lock } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatMessageAttachments } from "@/components/chat/chat-message-attachments";
import { ChatMessageProduct } from "@/components/chat/chat-message-product";
import type {
  ConversationDTO,
  ConversationMessageDTO,
} from "@/lib/conversations/types";
import {
  formatDayLabel,
  formatMessageTime,
  getInitials,
  isProductOnly,
  messageAuthor,
  RUN_GAP_MS,
} from "./shared";

interface MessageThreadProps {
  locale: string;
  viewerMode: "customer" | "store";
  conversation: ConversationDTO;
  messages: ConversationMessageDTO[];
  loading: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  viewportRef: RefObject<HTMLDivElement | null>;
  deliveryStatusLabel: (status: string) => string;
  labels: {
    loadOlder: string;
    empty: string;
    today: string;
    yesterday: string;
    whatsappTemplate: string;
    /** Above a note the team keeps for itself (the business app writes them). */
    internalNote: string;
  };
}

export function MessageThread({
  locale,
  viewerMode,
  conversation,
  messages,
  loading,
  hasMore,
  loadingOlder,
  onLoadOlder,
  viewportRef,
  deliveryStatusLabel,
  labels,
}: MessageThreadProps) {
  // Day labels are derived up front rather than by carrying a running value
  // through the map below: mutating a variable while rendering makes the second
  // pass of a re-render see the first pass's leftovers, so every separator after
  // the first could silently disappear.
  const dayLabels = useMemo(
    () =>
      messages.map((message) =>
        formatDayLabel(
          message.createdAt,
          locale,
          labels.today,
          labels.yesterday,
        ),
      ),
    [messages, locale, labels.today, labels.yesterday],
  );

  return (
    <div
      ref={viewportRef}
      // A log: new messages are read out as they arrive, not the whole thread.
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 px-4 py-3"
    >
      {hasMore ? (
        <div className="pb-2 text-center">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            disabled={loadingOlder}
            onClick={onLoadOlder}
          >
            {loadingOlder ? <Loader2 className="animate-spin" /> : null}
            {labels.loadOlder}
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid h-full place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : messages.length === 0 ? (
        <p className="grid h-full place-items-center text-center text-sm text-muted-foreground">
          {labels.empty}
        </p>
      ) : (
        <div className="space-y-1">
          {messages.map((message, index) => {
            // A note is the team's own, never a reply: on the team's side,
            // in its own colour. A customer is never sent one.
            const note = message.direction === "internal";
            const own =
              viewerMode === "store"
                ? message.direction === "outbound" || note
                : message.direction === "inbound";
            const dayLabel = dayLabels[index];
            const showDay = dayLabel !== dayLabels[index - 1];

            const previous = messages[index - 1];
            const next = messages[index + 1];
            // A run of one sender's messages a few minutes apart at most
            // collapses into one block: only the first carries the picture
            // and the name, only the last the time. A new day, another
            // person, a pause or a product card standing alone ends it.
            const together = (
              a: ConversationMessageDTO,
              b: ConversationMessageDTO,
            ) =>
              messageAuthor(a) === messageAuthor(b) &&
              Math.abs(
                new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
              ) <= RUN_GAP_MS;
            const startsRun =
              showDay ||
              !previous ||
              !together(previous, message) ||
              isProductOnly(previous);
            const endsRun =
              !next ||
              dayLabels[index + 1] !== dayLabel ||
              !together(message, next) ||
              isProductOnly(message);
            const failed = own && message.deliveryStatus === "failed";
            // A product sent with nothing typed carries its name and link as
            // the body, for readers that show no card: the card says it here.
            const body =
              message.product && message.bodyIsFallback ? "" : message.body;
            const template = message.messageKind === "whatsapp_template";
            const bubble = Boolean(
              body || template || message.attachments.length,
            );

            return (
              <Fragment key={message._id}>
                {showDay ? (
                  <div className="flex justify-center py-3">
                    <span className="rounded-full bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-xs">
                      {dayLabel}
                    </span>
                  </div>
                ) : null}

                <div
                  className={cn(
                    "flex items-end gap-2",
                    own ? "justify-end" : "justify-start",
                  )}
                >
                  {!own ? (
                    startsRun ? (
                      <Avatar className="size-7 shrink-0">
                        {/* The customer's picture is theirs: a shopper sees the store's initials, not their own face. */}
                        {viewerMode === "store" && conversation.contact.image ? (
                          <AvatarImage
                            src={conversation.contact.image}
                            alt={message.senderName}
                          />
                        ) : null}
                        <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                          {getInitials(
                            viewerMode === "store"
                              ? message.senderName
                              : conversation.ownerName || message.senderName,
                          )}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <span className="size-7 shrink-0" aria-hidden="true" />
                    )
                  ) : null}

                  <div
                    className={cn(
                      "flex max-w-[78%] min-w-0 flex-col gap-0.5",
                      own ? "items-end" : "items-start",
                    )}
                  >
                    {/* The store's people are named above their own runs too: several answer for one store. */}
                    {startsRun && (!own || viewerMode === "store") ? (
                      <span className="px-1 text-[11px] font-medium text-muted-foreground">
                        {message.senderName}
                      </span>
                    ) : null}

                    {message.product ? (
                      <ChatMessageProduct
                        product={message.product}
                        own={own}
                      />
                    ) : null}

                    {bubble ? (
                      <div
                        className={cn(
                          "rounded-2xl px-3.5 py-2 text-sm shadow-xs",
                          note
                            ? "border border-amber-500/30 bg-amber-500/10 text-foreground"
                            : own
                              ? "bg-primary text-primary-foreground"
                              : "border bg-card text-foreground",
                          failed && "ring-2 ring-destructive",
                          own && !endsRun && "rounded-ee-md",
                          own && endsRun && "rounded-ee-sm",
                          !own && !endsRun && "rounded-es-md",
                          !own && endsRun && "rounded-es-sm",
                        )}
                      >
                        {note ? (
                          <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                            <Lock className="size-3" aria-hidden="true" />
                            {labels.internalNote}
                          </p>
                        ) : null}
                        {template ? (
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                            {labels.whatsappTemplate}
                          </p>
                        ) : null}
                        {body ? (
                          <p
                            dir="auto"
                            className="whitespace-pre-wrap wrap-break-word"
                          >
                            {body}
                          </p>
                        ) : null}
                        <ChatMessageAttachments
                          attachments={message.attachments}
                          own={own}
                        />
                      </div>
                    ) : null}

                    {endsRun || failed ? (
                      <span className="px-1 text-[10px] text-muted-foreground">
                        {formatMessageTime(message.createdAt, locale)}
                        {own && !note ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span
                              className={cn(
                                message.deliveryStatus === "failed" &&
                                  "font-semibold text-destructive",
                              )}
                            >
                              {deliveryStatusLabel(message.deliveryStatus)}
                            </span>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                    {/* Why it failed, where a phone can read it too (a title shows only on hover). */}
                    {failed && message.errorMessage ? (
                      <span
                        dir="auto"
                        className="max-w-full px-1 text-[10px] text-destructive"
                      >
                        {message.errorMessage}
                      </span>
                    ) : null}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
