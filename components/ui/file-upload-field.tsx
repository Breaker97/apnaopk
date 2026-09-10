"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Eye,
  FileText,
  ImageIcon,
  Loader2,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";

type UploadResponse = { success?: boolean; message?: unknown; data?: unknown };

const DEFAULT_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

/** ".pdf" or an "application/pdf" type — a receipt is as often a bill as a photo. */
function isPdf(name: string, type?: string) {
  return type === "application/pdf" || /\.pdf$/i.test(name);
}

/** The last path segment of a stored URL, which is all a saved value carries. */
function nameFromUrl(url: string) {
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url;
    return decodeURIComponent(path.split("/").filter(Boolean).pop() || url);
  } catch {
    return url;
  }
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * One file, attached — the field behind expense receipts, payout proof and
 * anything else whose value is evidence rather than decoration.
 *
 * Replaces the row of a permanent grey preview square, a URL text box and two
 * icon-only buttons that `ImageUploadField` renders. Three things were wrong
 * with that shape and are fixed here: the primary affordance was typing a URL,
 * which nobody has; the empty square said "image missing" rather than "nothing
 * attached yet"; and a PDF — what a landlord or an accountant actually sends —
 * could not be attached at all.
 *
 * The value is still the stored URL, so callers and their APIs are unchanged.
 * The file name and size are only known for a file uploaded in this session; a
 * value loaded from the server shows the name its URL ends with.
 */
export function FileUploadField({
  id,
  label,
  hint,
  value,
  onChange,
  accept = DEFAULT_ACCEPT,
  maxSizeMb = 10,
  disabled = false,
  /** Attached file, no controls — a closed period, or a viewer without rights. */
  readOnly = false,
  readOnlyHint,
  className,
}: {
  id: string;
  label?: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  accept?: string;
  maxSizeMb?: number;
  disabled?: boolean;
  readOnly?: boolean;
  readOnlyHint?: string;
  className?: string;
}) {
  const t = useTranslations();
  const text = useFallbackTranslator(t);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Known only for a file picked here; a saved value has just its URL. */
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(
    null,
  );

  const busy = disabled || isUploading;

  const upload = useCallback(
    async (file: File) => {
      setError(null);

      if (file.size > maxSizeMb * 1024 * 1024) {
        setError(
          text(
            "ui.fileUpload.tooLarge",
            `That file is larger than ${maxSizeMb} MB`,
          ).replace("{size}", String(maxSizeMb)),
        );
        return;
      }

      // Types are checked here as well as by the picker: a drop bypasses the
      // input's `accept` entirely, so without this a .tiff scan reached the
      // server and came back as an opaque failure.
      const allowed = accept
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      const matches = allowed.some((entry) =>
        entry.endsWith("/*")
          ? file.type.startsWith(entry.slice(0, -1))
          : entry.startsWith(".")
            ? file.name.toLowerCase().endsWith(entry.toLowerCase())
            : file.type === entry,
      );
      if (allowed.length > 0 && !matches) {
        setError(
          text(
            "ui.fileUpload.wrongType",
            "That file type isn't accepted. Use PNG, JPG or PDF.",
          ),
        );
        return;
      }

      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("files", file);
        const res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const json = (await res.json()) as UploadResponse;
        const items = Array.isArray(json?.data) ? (json.data as unknown[]) : [];
        const url = (items[0] as { url?: unknown } | undefined)?.url;
        if (json?.success !== true || typeof url !== "string" || !url) {
          setError(
            typeof json?.message === "string"
              ? json.message
              : text("ui.fileUpload.failed", "Upload failed"),
          );
          return;
        }
        setPicked({ name: file.name, size: file.size });
        onChange(url);
      } catch {
        setError(text("ui.fileUpload.failed", "Upload failed"));
      } finally {
        setIsUploading(false);
        // Allow re-picking the same file after a failure or a removal.
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [accept, maxSizeMb, onChange, text],
  );

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (busy || readOnly) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  const name = picked?.name || (value ? nameFromUrl(value) : "");
  const pdf = Boolean(value) && isPdf(name);

  const fieldLabel = label ? (
    <Label htmlFor={id} className={readOnly ? "text-muted-foreground" : undefined}>
      {label}
      {hint ? (
        <span className="font-normal text-muted-foreground">{hint}</span>
      ) : null}
    </Label>
  ) : null;

  const fileInput = (
    <input
      ref={inputRef}
      id={id}
      type="file"
      accept={accept}
      className="hidden"
      disabled={busy}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void upload(file);
      }}
    />
  );

  // Uploading — the file is named while it travels, so a slow connection is
  // legible as progress rather than as a frozen dialog.
  if (isUploading) {
    return (
      <div className={cn("space-y-2", className)}>
        {fieldLabel}
        <div className="flex h-[92px] items-center gap-3 rounded-xl border px-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Loader2 className="size-[18px] animate-spin" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {picked?.name || text("ui.fileUpload.uploading", "Uploading…")}
            </p>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-1 w-1/2 animate-pulse rounded-full bg-primary" />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {text("ui.fileUpload.uploading", "Uploading…")}
            </p>
          </div>
        </div>
        {fileInput}
      </div>
    );
  }

  // Attached.
  if (value) {
    return (
      <div className={cn("space-y-2", className)}>
        {fieldLabel}
        <div
          className={cn(
            "flex h-[92px] items-center gap-3 rounded-xl border px-3",
            readOnly && "bg-muted/40",
          )}
        >
          {pdf ? (
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <FileText className="size-[18px]" />
            </span>
          ) : (
            <span className="relative size-11 shrink-0 overflow-hidden rounded-lg border bg-muted">
              <AppImage src={value} alt={name} width={44} height={44} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "truncate text-sm font-medium",
                readOnly && "text-muted-foreground",
              )}
            >
              {name}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {readOnly
                ? readOnlyHint ||
                  text("ui.fileUpload.readOnly", "This period is closed")
                : picked
                  ? formatSize(picked.size)
                  : text("ui.fileUpload.attached", "Attached")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="ghost" size="sm" asChild>
              <a href={value} target="_blank" rel="noreferrer">
                <Eye className="size-3.5 text-muted-foreground" />
                {text("ui.fileUpload.view", "View")}
              </a>
            </Button>
            {readOnly ? null : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                >
                  <RefreshCw className="size-3.5 text-muted-foreground" />
                  {text("ui.fileUpload.replace", "Replace")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={text("ui.fileUpload.remove", "Remove file")}
                  onClick={() => {
                    setPicked(null);
                    setError(null);
                    onChange("");
                  }}
                >
                  <X className="size-3.5 text-muted-foreground" />
                </Button>
              </>
            )}
          </div>
        </div>
        {fileInput}
      </div>
    );
  }

  // Empty, or rejected — the message replaces the hint rather than joining it,
  // so the reason a file did not attach is the only thing being read.
  return (
    <div className={cn("space-y-2", className)}>
      {fieldLabel}
      {error ? (
        <div className="flex h-[92px] items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <AlertTriangle className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {text("ui.fileUpload.notAttached", "Nothing attached")}
            </p>
            <p className="mt-0.5 text-xs text-destructive">{error}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {text("ui.fileUpload.chooseAnother", "Choose another")}
          </Button>
        </div>
      ) : (
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-label={label || text("ui.fileUpload.browse", "browse")}
          onClick={() => {
            if (!busy) inputRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (busy) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy && !isDragging) setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex h-[92px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed bg-muted/30 text-center transition-colors",
            "hover:border-primary/50 hover:bg-muted/50",
            isDragging && "border-primary bg-primary/5",
            disabled && "cursor-not-allowed opacity-60 hover:bg-muted/30",
          )}
        >
          {isDragging ? (
            <>
              <Upload className="size-5 text-primary" />
              <p className="text-sm font-medium text-primary">
                {text("ui.fileUpload.dropToAttach", "Drop to attach")}
              </p>
            </>
          ) : (
            <>
              <ImageIcon className="size-5 text-muted-foreground/70" />
              <p className="text-sm text-muted-foreground">
                {text("ui.fileUpload.dropHere", "Drop a file here or")}{" "}
                <span className="font-medium text-primary">
                  {text("ui.fileUpload.browse", "browse")}
                </span>
              </p>
              <p className="text-xs text-muted-foreground/80">
                {text("ui.fileUpload.limits", "PNG, JPG or PDF")} ·{" "}
                {text("ui.fileUpload.upTo", "up to {size} MB").replace(
                  "{size}",
                  String(maxSizeMb),
                )}
              </p>
            </>
          )}
        </div>
      )}
      {fileInput}
    </div>
  );
}
