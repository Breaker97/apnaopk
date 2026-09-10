"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCheck,
  Circle,
  Clock3,
  FileText,
  Image as ImageIcon,
  Link as LinkIcon,
  Mail,
  Package,
  Paperclip,
  Phone,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConversationAssignmentControl } from "@/components/chat/conversation-assignment-control";
import { channelLabel } from "@/lib/conversations/channels";
import type {
  ConversationDTO,
  ConversationMessageDTO,
} from "@/lib/conversations/types";
import {
  conversationStatusStyle,
  formatFileSize,
  getInitials,
} from "./shared";

type DetailsView = "details" | "media";
type MediaTab = "media" | "files" | "links";

interface ConversationDetailsProps {
  locale: string;
  viewerMode: "customer" | "store";
  conversation: ConversationDTO;
  messages: ConversationMessageDTO[];
  onConversationUpdated: (conversation: ConversationDTO) => void;
  onUpdateStatus: (status: "open" | "resolved") => void;
  replyWindowExpired: boolean;
  statusLabel: (status: string) => string;
  labels: {
    mediaAndFiles: string;
    media: string;
    files: string;
    links: string;
    noMedia: string;
    noFiles: string;
    noLinks: string;
    subject: string;
    product: string;
    viewProduct: string;
    resolve: string;
    reopen: string;
    back: string;
    windowClosed: string;
    storeSupport: string;
  };
}

const URL_PATTERN = /https?:\/\/[^\s]+/g;

export function ConversationDetails({
  locale,
  viewerMode,
  conversation,
  messages,
  onConversationUpdated,
  onUpdateStatus,
  replyWindowExpired,
  statusLabel,
  labels,
}: ConversationDetailsProps) {
  const [view, setView] = useState<DetailsView>("details");
  const [mediaTab, setMediaTab] = useState<MediaTab>("media");

  const { mediaItems, fileItems, linkItems } = useMemo(() => {
    const media: Array<{ key: string; attachment: ConversationMessageDTO["attachments"][number] }> =
      [];
    const files: typeof media = [];
    const links: Array<{ key: string; url: string }> = [];

    for (const message of messages) {
      message.attachments.forEach((attachment, index) => {
        const entry = { key: `${message._id}-${index}`, attachment };
        if (attachment.type === "image" || attachment.type === "video") {
          media.push(entry);
        } else {
          files.push(entry);
        }
      });
      const matches = message.body?.match(URL_PATTERN);
      if (matches) {
        matches.forEach((url, index) =>
          links.push({ key: `${message._id}-link-${index}`, url }),
        );
      }
    }

    return {
      mediaItems: media.reverse(),
      fileItems: files.reverse(),
      linkItems: links.reverse(),
    };
  }, [messages]);

  const status = conversationStatusStyle(conversation.status);
  const displayName =
    viewerMode === "store"
      ? conversation.contact.name
      : conversation.ownerName || labels.storeSupport;

  if (view === "media") {
    return (
      <>
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 rounded-full"
            onClick={() => setView("details")}
            aria-label={labels.back}
          >
            <ArrowLeft />
          </Button>
          <h3 className="text-sm font-semibold">{labels.mediaAndFiles}</h3>
        </div>

        <div className="flex shrink-0 border-b">
          {(["media", "files", "links"] as MediaTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMediaTab(tab)}
              className={cn(
                "relative flex-1 py-2.5 text-xs font-medium transition-colors",
                mediaTab === tab
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {labels[tab]}
              {mediaTab === tab ? (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {mediaTab === "media" ? (
            mediaItems.length === 0 ? (
              <EmptyPanel icon={ImageIcon} text={labels.noMedia} />
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {mediaItems.map(({ key, attachment }) => (
                  <a
                    key={key}
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="relative aspect-square overflow-hidden rounded-md bg-muted"
                  >
                    {attachment.type === "image" ? (
                      // Provider media is served through an authenticated
                      // same-origin endpoint when its upstream URL is private.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachment.url}
                        alt={attachment.name || ""}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <span className="grid size-full place-items-center">
                        <Paperclip className="size-4 text-muted-foreground" />
                      </span>
                    )}
                  </a>
                ))}
              </div>
            )
          ) : mediaTab === "files" ? (
            fileItems.length === 0 ? (
              <EmptyPanel icon={FileText} text={labels.noFiles} />
            ) : (
              <div className="space-y-1">
                {fileItems.map(({ key, attachment }) => (
                  <a
                    key={key}
                    href={attachment.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-muted/60"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {attachment.name || attachment.url}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {formatFileSize(attachment.size)}
                      </span>
                    </span>
                  </a>
                ))}
              </div>
            )
          ) : linkItems.length === 0 ? (
            <EmptyPanel icon={LinkIcon} text={labels.noLinks} />
          ) : (
            <div className="space-y-1">
              {linkItems.map(({ key, url }) => (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-muted/60"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <LinkIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-primary">
                    {url}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col items-center gap-2 px-4 pb-4 pt-6 text-center">
        <Avatar className="size-20">
          {viewerMode === "store" && conversation.contact.image ? (
            <AvatarImage src={conversation.contact.image} alt={displayName} />
          ) : null}
          <AvatarFallback className="bg-primary/10 text-xl font-bold text-primary">
            {getInitials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div>
          <h3 className="text-base font-semibold">{displayName}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {channelLabel(conversation.channel)}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            status.badge,
          )}
        >
          {statusLabel(conversation.status)}
        </span>
      </div>

      {viewerMode === "store" ? (
        <div className="space-y-2 border-t px-4 py-3">
          <ConversationAssignmentControl
            conversation={conversation}
            onUpdated={onConversationUpdated}
          />
          {conversation.status === "resolved" ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onUpdateStatus("open")}
            >
              <Circle />
              {labels.reopen}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => onUpdateStatus("resolved")}
            >
              <CheckCheck />
              {labels.resolve}
            </Button>
          )}
        </div>
      ) : null}

      <dl className="space-y-3 border-t px-4 py-3 text-xs">
        <Row label={labels.subject} value={conversation.subject} />
        {viewerMode === "store" && conversation.contact.email ? (
          <Row
            icon={Mail}
            label={conversation.contact.email}
            href={`mailto:${conversation.contact.email}`}
          />
        ) : null}
        {viewerMode === "store" && conversation.contact.phone ? (
          <Row
            icon={Phone}
            label={conversation.contact.phone}
            href={`tel:${conversation.contact.phone}`}
          />
        ) : null}
      </dl>

      {conversation.productContext ? (
        <div className="border-t px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {labels.product}
          </p>
          <Link
            href={`/${locale}/products/${conversation.productContext.slug}`}
            className="flex items-center gap-2.5 rounded-lg p-1.5 transition-colors hover:bg-muted/60"
          >
            <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
              {conversation.productContext.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={conversation.productContext.image}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <Package className="size-4 text-muted-foreground" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">
                {conversation.productContext.name}
              </span>
              {conversation.productContext.variantName ? (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {conversation.productContext.variantName}
                </span>
              ) : (
                <span className="block text-[11px] text-primary">
                  {labels.viewProduct}
                </span>
              )}
            </span>
          </Link>
        </div>
      ) : null}

      {replyWindowExpired ? (
        <div className="border-t px-4 py-3">
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-800 dark:text-amber-200">
            <Clock3 className="mt-0.5 size-3.5 shrink-0" />
            {labels.windowClosed}
          </p>
        </div>
      ) : null}

      <div className="border-t p-2">
        <button
          type="button"
          onClick={() => setView("media")}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-start transition-colors hover:bg-muted/60"
        >
          <ImageIcon className="size-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">
            {labels.mediaAndFiles}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {mediaItems.length + fileItems.length + linkItems.length}
          </span>
        </button>
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon?: React.ElementType;
  label: string;
  value?: string;
  href?: string;
}) {
  const body = (
    <>
      {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
      <span className="min-w-0 flex-1 break-words">{value || label}</span>
    </>
  );
  return (
    <div>
      {value ? (
        <dt className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </dt>
      ) : null}
      <dd className="flex items-center gap-2">
        {href ? (
          <a
            href={href}
            className="flex min-w-0 flex-1 items-center gap-2 hover:underline"
          >
            {body}
          </a>
        ) : (
          body
        )}
      </dd>
    </div>
  );
}

function EmptyPanel({
  icon: Icon,
  text,
}: {
  icon: React.ElementType;
  text: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <span className="grid size-10 place-items-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
