"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Download, ExternalLink, Paperclip } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ConversationMessageDTO } from "@/lib/conversations/types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type Attachment = ConversationMessageDTO["attachments"][number];

export function ChatMessageAttachments({
  attachments,
  own = false,
}: {
  attachments: ConversationMessageDTO["attachments"];
  own?: boolean;
}) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);
  // The image open full size, as Messenger and WhatsApp show it on a tap.
  const [viewing, setViewing] = useState<Attachment | null>(null);
  if (!attachments.length) return null;
  const altOf = (attachment: Attachment) =>
    attachment.name || tr("attachments.alt", "Chat attachment");
  return (
    // No gap above when nothing in the bubble comes before the files.
    <div className="mt-2 space-y-2 first:mt-0">
      {attachments.map((attachment, index) => {
        if (attachment.type === "image") {
          return (
            <button
              key={`${attachment.url}-${index}`}
              type="button"
              onClick={() => setViewing(attachment)}
              aria-label={tr("attachments.view", "View full image")}
              className="block max-w-full cursor-zoom-in rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {/* Provider media is served through an authenticated
                  same-origin endpoint when its upstream URL must remain
                  private. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.url}
                alt={altOf(attachment)}
                loading="lazy"
                className="block max-h-64 w-auto max-w-full rounded-lg object-contain"
              />
            </button>
          );
        }
        if (attachment.type === "video") {
          return (
            <video
              key={`${attachment.url}-${index}`}
              src={attachment.url}
              controls
              preload="metadata"
              className="block max-h-64 max-w-full rounded-lg"
            />
          );
        }
        if (attachment.type === "audio") {
          return (
            <audio
              key={`${attachment.url}-${index}`}
              src={attachment.url}
              controls
              preload="metadata"
              className="max-w-full"
            />
          );
        }
        return (
          <a
            key={`${attachment.url}-${index}`}
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs underline-offset-2 hover:underline",
              own ? "border-primary-foreground/30" : "border-border",
            )}
          >
            <Paperclip className="size-3.5" />
            {attachment.name || tr("attachments.open", "Open attachment")}
          </a>
        );
      })}

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="flex max-h-[95vh] w-auto max-w-[95vw] flex-col items-center gap-3 border-0 bg-transparent p-0 shadow-none sm:max-w-[95vw] [&>button]:bg-background/90 [&>button]:p-1 [&>button]:opacity-100">
          <DialogTitle className="sr-only">
            {viewing ? altOf(viewing) : tr("attachments.alt", "Chat attachment")}
          </DialogTitle>
          {viewing ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewing.url}
                alt={altOf(viewing)}
                className="max-h-[85vh] max-w-[95vw] rounded-lg object-contain"
              />
              <div className="flex gap-2">
                <a
                  href={viewing.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-background"
                >
                  <ExternalLink className="size-3.5" />
                  {tr("attachments.openNewTab", "Open in new tab")}
                </a>
                <a
                  href={viewing.url}
                  download={viewing.name || true}
                  className="inline-flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-background"
                >
                  <Download className="size-3.5" />
                  {tr("attachments.download", "Download")}
                </a>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
