"use client";

import { useRef } from "react";
import { Clock3, Loader2, Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WarningBanner } from "@/components/ui/warning-banner";

interface MessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAttach?: (file: File) => void;
  /** The file types the conversation's channel takes, for the file picker. */
  attachAccept?: string;
  sending: boolean;
  uploading?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder: string;
  sendLabel: string;
  attachLabel?: string;
  /** More buttons beside the file button: the product picker. */
  actions?: React.ReactNode;
  /** What is put on the reply before it is sent: a product to share. */
  attachment?: React.ReactNode;
  /** Something to send besides text (a product): the send button works without any. */
  hasAttachment?: boolean;
  /** Rendered above the input — the reply-window warning, template composer. */
  notice?: React.ReactNode;
  warning?: string;
}

/**
 * Whether Enter should send: not while an input method is still composing a
 * character (Bengali phonetic, Chinese, Japanese and Korean input commit with
 * Enter), and not on a touch screen, where the on-screen keyboard's Enter is
 * the only way to start a new line and the send button is right there.
 */
function enterSends(event: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey) return false;
  if (event.nativeEvent.isComposing || event.keyCode === 229) return false;
  return !window.matchMedia?.("(pointer: coarse)").matches;
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
  attachAccept,
  sending,
  uploading = false,
  disabled = false,
  autoFocus = false,
  placeholder,
  sendLabel,
  attachLabel,
  actions,
  attachment,
  hasAttachment = false,
  notice,
  warning,
}: MessageComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ready = Boolean(value.trim()) || hasAttachment;

  return (
    <div className="shrink-0 border-t bg-card px-4 py-3">
      {notice}

      {warning ? (
        <WarningBanner icon={Clock3} className="mb-3">
          {warning}
        </WarningBanner>
      ) : null}

      {attachment}

      <div className="flex items-end gap-2">
        {onAttach || actions ? (
          <div className="flex shrink-0 items-center gap-0.5 pb-1.5">
            {onAttach ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={attachAccept}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
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
                  className="size-8 rounded-full"
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
            {actions}
          </div>
        ) : null}

        <Textarea
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          dir="auto"
          maxLength={4000}
          disabled={disabled}
          rows={1}
          className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl bg-muted/50 px-4 py-2.5 text-sm"
          onKeyDown={(event) => {
            if (enterSends(event)) {
              event.preventDefault();
              onSubmit();
            }
          }}
        />

        <Button
          type="button"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          disabled={!ready || sending || disabled}
          onClick={onSubmit}
          aria-label={sendLabel}
          title={sendLabel}
        >
          {sending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Send className="rtl:-scale-x-100" />
          )}
        </Button>
      </div>
    </div>
  );
}
