"use client";

import { useRef, useState, type ReactNode } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppImage } from "@/components/ui/app-image";

type UploadResponse = {
  success?: boolean;
  message?: unknown;
  data?: unknown;
};

type UploadedFile = {
  url?: unknown;
  key?: unknown;
};

export function ImageUploadField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  accept?: string;
  previewAlt?: string;
  previewClassName?: string;
  /** Optional trailing control rendered inline with the upload/clear buttons (e.g. an AI Studio launcher). */
  action?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = props.accept || "image/*";
  const alt = props.previewAlt || props.label;

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("files", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const json = (await res.json()) as UploadResponse;
      if (json?.success !== true) {
        const msg = typeof json?.message === "string" ? json.message : "Upload failed";
        setError(msg);
        return;
      }
      const items = Array.isArray(json.data) ? (json.data as unknown[]) : [];
      const first = (items[0] || {}) as UploadedFile;
      const url = typeof first.url === "string" ? first.url : "";
      if (!url) {
        setError("Upload failed");
        return;
      }
      props.onChange(url);
    } catch {
      setError("Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const onPick = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    const looksLikeImage =
      (file.type && file.type.startsWith("image/")) ||
      /\.(png|jpe?g|webp|gif|svg|ico)$/i.test(file.name);
    if (!looksLikeImage) {
      setError("Please select an image file");
      return;
    }
    await uploadFile(file);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="flex items-start gap-3">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted">
          <AppImage
            src={props.value}
            alt={alt}
            className={props.previewClassName}
            width={48}
            height={48}
          />
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            {/* flex-1 + min-w-0 so the URL box takes only the leftover space and
                shrinks first — the fixed-size buttons and any inline action
                (AI Studio) stay in the row instead of being pushed outside. */}
            <Input
              id={props.id}
              className="min-w-0 flex-1"
              value={props.value}
              onChange={(e) => props.onChange(e.target.value)}
              disabled={props.disabled || isUploading}
            />
            {/* Inline action (e.g. AI Studio) sits right after the URL box,
                before the Upload and Clear controls. */}
            {props.action}
            <input
              ref={inputRef}
              type="file"
              accept={accept}
              onChange={(e) => void onPick(e.target.files)}
              disabled={props.disabled || isUploading}
              className="hidden"
              aria-label={`${props.id}-file`}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={props.disabled || isUploading}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onChange("")}
              disabled={props.disabled || isUploading || !props.value}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
