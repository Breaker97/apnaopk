"use client";

import { useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, Upload, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import {
  VENDOR_DOCUMENT_ACCEPT,
  VENDOR_DOCUMENT_MAX_SIZE_MB,
  vendorDocumentViewUrl,
} from "@/lib/vendors/vendor-documents";

const MAX_SIZE_BYTES = VENDOR_DOCUMENT_MAX_SIZE_MB * 1024 * 1024;

interface AdminDocumentUploadFieldProps {
  label: string;
  hint?: string;
  /**
   * Private storage key of the current document (new uploads), a public URL
   * (documents saved before private storage), or "" when nothing yet.
   */
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}

/**
 * Admin-side single-file uploader for vendor verification documents.
 * Posts to the admin vendor-documents route (private storage) rather than the
 * registration-scoped /api/vendor/apply/documents route, which rejects callers
 * that already own a Vendor. Shows a "View" link for the current document so
 * admins can inspect what the vendor submitted during onboarding — private
 * keys resolve through the authenticated download route, legacy URLs open
 * directly.
 */
export function AdminDocumentUploadField({
  label,
  hint,
  value,
  onChange,
  disabled,
}: AdminDocumentUploadFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState("");

  const handleFile = async (file: File) => {
    if (file.size > MAX_SIZE_BYTES) {
      toast.error(`${file.name} is larger than 10MB`);
      return;
    }

    setIsUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);

      const res = await fetch("/api/admin/vendors/documents", {
        method: "POST",
        body,
      });
      const result = await res.json();

      if (!res.ok || !result.success || !result.data?.key) {
        toast.error(result.message || `Failed to upload ${file.name}`);
        return;
      }

      onChange(result.data.key);
      setFileName(file.name);
    } catch {
      toast.error(`Failed to upload ${file.name}`);
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = () => {
    onChange("");
    setFileName("");
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>

      {value ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm">
            {fileName || "Uploaded document"}
          </span>
          <a
            href={vendorDocumentViewUrl(value)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          >
            View
            <ExternalLink className="h-3 w-3" />
          </a>
          {!disabled && (
            <button
              type="button"
              onClick={handleRemove}
              aria-label={`Remove ${label}`}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isUploading}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-3 text-sm text-muted-foreground transition-colors",
            "hover:border-primary/50 hover:bg-muted/40 hover:text-foreground",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        >
          {isUploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Upload file
            </>
          )}
        </button>
      )}

      {hint && !value ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={VENDOR_DOCUMENT_ACCEPT}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
