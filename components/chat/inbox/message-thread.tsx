"use client";

import { Fragment, useMemo, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChatMessageAttachments } from "@/components/chat/chat-message-attachments";
import type {
  ConversationDTO,
  ConversationMessageDTO,
} from "@/lib/conversations/types";
import { formatDayLabel, formatMessageTime, getInitials } from "./shared";

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
            const own =
              viewerMode === "store"
                ? message.direction === "outbound"
                : message.direction === "inbound";
            const dayLabel = dayLabels[index];
            const showDay = dayLabel !== dayLabels[index - 1];

            const previous = messages[index - 1];
            const next = messages[index + 1];
            // A run of messages from the same side collapses into one visual
            // block: only the first carries an avatar, only the last carries a
            // timestamp. The day separator always restarts a run.
            const startsRun =
              showDay || !previous || previous.direction !== message.direction;
            const endsRun = !next || next.direction !== message.direction;

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
                        {conversation.contact.image ? (
                          <AvatarImage
                            src={conversation.contact.image}
                            alt={message.senderName}
                          />
                        ) : null}
                        <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                          {getInitials(message.senderName)}
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
                    {startsRun && !own ? (
                      <span className="px-1 text-[11px] font-medium text-muted-foreground">
                        {message.senderName}
                      </span>
                    ) : null}

                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2 text-sm shadow-xs",
                        own
                          ? "bg-primary text-primary-foreground"
                          : "border bg-card text-foreground",
                        own && !endsRun && "rounded-ee-md",
                        own && endsRun && "rounded-ee-sm",
                        !own && !endsRun && "rounded-es-md",
                        !own && endsRun && "rounded-es-sm",
                      )}
                    >
                      {message.messageKind === "whatsapp_template" ? (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                          {labels.whatsappTemplate}
                        </p>
                      ) : null}
                      {message.body ? (
                        <p className="whitespace-pre-wrap wrap-break-word">
                          {message.body}
                        </p>
                      ) : null}
                      <ChatMessageAttachments
                        attachments={message.attachments}
                        own={own}
                      />
                    </div>

                    {endsRun ? (
                      <span className="px-1 text-[10px] text-muted-foreground">
                        {formatMessageTime(message.createdAt, locale)}
                        {own ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span
                              className={cn(
                                message.deliveryStatus === "failed" &&
                                  "font-semibold text-destructive",
                              )}
                              title={message.errorMessage}
                            >
                              {deliveryStatusLabel(message.deliveryStatus)}
                            </span>
                          </>
                        ) : null}
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
