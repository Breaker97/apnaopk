"use client";

import { useTranslations } from "next-intl";
import { Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationMessageDTO } from "@/lib/conversations/types";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

export function ChatMessageAttachments({
  attachments,
  own = false,
}: {
  attachments: ConversationMessageDTO["attachments"];
  own?: boolean;
}) {
  const t = useTranslations("chat");
  const tr = useFallbackTranslator(t);
  if (!attachments.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {attachments.map((attachment, index) => {
        if (attachment.type === "image") {
          return (
            // Provider media is served through an authenticated same-origin
            // endpoint when its upstream URL must remain private.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${attachment.url}-${index}`}
              src={attachment.url}
              alt={attachment.name || tr("attachments.alt", "Chat attachment")}
              loading="lazy"
              className="max-h-64 w-auto rounded-lg object-contain"
            />
          );
        }
        if (attachment.type === "video") {
          return (
            <video
              key={`${attachment.url}-${index}`}
              src={attachment.url}
              controls
              preload="metadata"
              className="max-h-64 max-w-full rounded-lg"
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
    </div>
  );
}
