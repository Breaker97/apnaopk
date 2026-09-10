"use client";

import { useRef } from "react";
import { Clock3, Loader2, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAttach?: (file: File) => void;
  sending: boolean;
  uploading?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder: string;
  sendLabel: string;
  attachLabel?: string;
  /** Rendered above the input — the reply-window warning, template composer. */
  notice?: React.ReactNode;
  warning?: string;
}

/**
 * The composer is a `shrink-0` row inside a `min-h-0` flex column, so it stays
 * pinned to the bottom of the pane no matter how long the thread grows. The
 * previous inbox let the message list size itself, which pushed the composer
 * out of the clipped container once a thread got long enough — the reply box
 * simply vanished and there was no way to scroll it back.
 */
export function MessageComposer({
  value,
  onChange,
  onSubmit,
  onAttach,
  sending,
  uploading = false,
  disabled = false,
  autoFocus = false,
  placeholder,
  sendLabel,
  attachLabel,
  notice,
  warning,
}: MessageComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="shrink-0 border-t bg-card px-4 py-3">
      {notice}

      {warning ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <Clock3 className="mt-0.5 size-4 shrink-0" />
          <p>{warning}</p>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Textarea
            autoFocus={autoFocus}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            maxLength={4000}
            disabled={disabled}
            rows={1}
            className={cn(
              "max-h-40 min-h-11 resize-none rounded-2xl bg-muted/50 py-2.5 ps-4 text-sm",
              onAttach ? "pe-11" : "pe-4",
            )}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />

          {onAttach ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,application/pdf"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onAttach(file);
                  event.target.value = "";
                }}
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute end-1.5 bottom-1.5 size-8 rounded-full"
                disabled={uploading || disabled}
                onClick={() => fileInputRef.current?.click()}
                aria-label={attachLabel}
                title={attachLabel}
              >
                {uploading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Paperclip className="text-muted-foreground" />
                )}
              </Button>
            </>
          ) : null}
        </div>

        <Button
          type="button"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          disabled={!value.trim() || sending || disabled}
          onClick={onSubmit}
          aria-label={sendLabel}
          title={sendLabel}
        >
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
    </div>
  );
}
