"use client";

import { useEffect, useMemo, useRef } from "react";
import { Clock3, FileText, Film, Loader2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { WarningBanner } from "@/components/ui/warning-banner";

interface MessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Sends the typed text and any staged files together. */
  onSubmit: () => void;
  /**
   * Files picked but not sent yet. With `onAttachmentsChange` the composer
   * offers the paperclip: picking stages a file here, with a preview and a
   * remove button, and only Send sends it — as in Messenger or WhatsApp.
   */
  attachments?: File[];
  onAttachmentsChange?: (files: File[]) => void;
  /** The file types the conversation's channel takes, for the file picker. */
  attachAccept?: string;
  sending: boolean;
  uploading?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder: string;
  sendLabel: string;
  attachLabel?: string;
  removeAttachmentLabel?: string;
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

/** A staged file as its chip shows it; image chips carry a local preview. */
function useStagedPreviews(files: File[]) {
  const previews = useMemo(
    () =>
      files.map((file) => ({
        file,
        url: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
      })),
    [files],
  );
  // The object URLs live as long as their chips.
  useEffect(
    () => () => {
      for (const preview of previews) if (preview.url) URL.revokeObjectURL(preview.url);
    },
    [previews],
  );
  return previews;
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
  attachments = [],
  onAttachmentsChange,
  attachAccept,
  sending,
  uploading = false,
  disabled = false,
  autoFocus = false,
  placeholder,
  sendLabel,
  attachLabel,
  removeAttachmentLabel,
  actions,
  attachment,
  hasAttachment = false,
  notice,
  warning,
}: MessageComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previews = useStagedPreviews(attachments);
  const busy = sending || uploading;
  const ready = Boolean(value.trim()) || hasAttachment || attachments.length > 0;

  return (
    <div className="shrink-0 border-t bg-card px-4 py-3">
      {notice}

      {warning ? (
        <WarningBanner icon={Clock3} className="mb-3">
          {warning}
        </WarningBanner>
      ) : null}

      {attachment}

      {previews.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2">
          {previews.map(({ file, url }, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="relative flex h-16 items-center gap-2 overflow-hidden rounded-xl border bg-muted/40"
            >
              {url ? (
                // A local blob preview: next/image cannot optimise it.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={file.name} className="h-16 w-16 object-cover" />
              ) : (
                <span className="flex max-w-48 items-center gap-2 ps-3 pe-8 text-xs">
                  {file.type.startsWith("video/") ? (
                    <Film className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{file.name}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() =>
                  onAttachmentsChange?.(attachments.filter((_, i) => i !== index))
                }
                disabled={busy}
                aria-label={
                  removeAttachmentLabel ? `${removeAttachmentLabel}: ${file.name}` : file.name
                }
                className="absolute end-1 top-1 grid size-5 place-items-center rounded-full bg-background/90 text-foreground shadow-sm transition-colors hover:bg-background disabled:opacity-50"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-end gap-2">
        {onAttachmentsChange || actions ? (
          <div className="flex shrink-0 items-center gap-0.5 pb-1.5">
            {onAttachmentsChange ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={attachAccept}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? []);
                    if (picked.length > 0) onAttachmentsChange([...attachments, ...picked]);
                    event.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 rounded-full"
                  disabled={busy || disabled}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={attachLabel}
                  title={attachLabel}
                >
                  <Paperclip className="text-muted-foreground" />
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
              if (ready && !busy && !disabled) onSubmit();
            }
          }}
        />

        <Button
          type="button"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          disabled={!ready || busy || disabled}
          onClick={onSubmit}
          aria-label={sendLabel}
          title={sendLabel}
        >
          {busy ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Send className="rtl:-scale-x-100" />
          )}
        </Button>
      </div>
    </div>
  );
}
