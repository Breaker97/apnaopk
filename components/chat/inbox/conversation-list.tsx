"use client";

import { Loader2, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { channelLabel } from "@/lib/conversations/channels";
import type { ConversationDTO } from "@/lib/conversations/types";
import {
  conversationStatusStyle,
  formatRelativeTime,
  getInitials,
  type InboxFilter,
} from "./shared";

interface ConversationListProps {
  locale: string;
  viewerMode: "customer" | "store";
  conversations: ConversationDTO[];
  totalCount: number;
  selectedConversationId?: string;
  onSelect: (conversationId: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filter: InboxFilter;
  onFilterChange: (filter: InboxFilter) => void;
  filters: Array<{ key: InboxFilter; label: string }>;
  title: string;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  labels: {
    search: string;
    empty: string;
    loadMore: string;
    storeSupport: string;
    count: string;
  };
}

export function ConversationList({
  locale,
  viewerMode,
  conversations,
  totalCount,
  selectedConversationId,
  onSelect,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  filters,
  title,
  hasMore,
  loadingMore,
  onLoadMore,
  labels,
}: ConversationListProps) {
  return (
    <>
      <div className="shrink-0 space-y-3 border-b px-4 pb-3 pt-4">
        <div>
          <h2 className="text-lg font-bold leading-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">{labels.count}</p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={labels.search}
            className="h-9 rounded-full border-transparent bg-muted/60 ps-9 text-sm"
          />
        </div>

        <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-0.5">
          {filters.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onFilterChange(tab.key)}
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                filter === tab.key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/70",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            {labels.empty}
          </p>
        ) : (
          conversations.map((conversation) => {
            const selected = conversation._id === selectedConversationId;
            const unread = conversation.unreadCount > 0;
            const status = conversationStatusStyle(conversation.status);
            const displayName =
              viewerMode === "store"
                ? conversation.contact.name
                : conversation.ownerName || labels.storeSupport;
            return (
              <button
                key={conversation._id}
                type="button"
                onClick={() => onSelect(conversation._id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start transition-colors",
                  selected ? "bg-primary/10" : "hover:bg-muted/60",
                )}
              >
                <span className="relative shrink-0">
                  <Avatar className="size-12">
                    {viewerMode === "store" && conversation.contact.image ? (
                      <AvatarImage
                        src={conversation.contact.image}
                        alt={displayName}
                      />
                    ) : null}
                    <AvatarFallback className="bg-primary/10 text-sm font-semibold text-primary">
                      {getInitials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className={cn(
                      "absolute -end-0.5 -top-0.5 size-3 rounded-full ring-2 ring-card",
                      status.dot,
                    )}
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        "truncate text-sm",
                        unread ? "font-bold" : "font-medium",
                      )}
                    >
                      {displayName}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelativeTime(conversation.lastMessageAt, locale)}
                    </span>
                  </span>

                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "line-clamp-1 flex-1 text-xs",
                        unread
                          ? "font-medium text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {conversation.lastMessagePreview}
                    </span>
                    {unread ? (
                      <span className="grid size-4.5 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold tabular-nums text-primary-foreground">
                        {conversation.unreadCount > 9
                          ? "9+"
                          : conversation.unreadCount}
                      </span>
                    ) : null}
                  </span>

                  <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate rounded-full bg-muted px-1.5 py-0.5">
                      {channelLabel(conversation.channel)}
                    </span>
                    {conversation.productContext ? (
                      <span className="truncate">
                        {conversation.productContext.name}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })
        )}

        {hasMore && totalCount > 0 ? (
          <div className="p-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full rounded-full"
              disabled={loadingMore}
              onClick={onLoadMore}
            >
              {loadingMore ? <Loader2 className="animate-spin" /> : null}
              {labels.loadMore}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}
