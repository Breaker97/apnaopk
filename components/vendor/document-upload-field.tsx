"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";
import { toast } from "@/components/ui/toast-notification";
import { cn } from "@/lib/utils";
import {
  VENDOR_DOCUMENT_ACCEPT,
  VENDOR_DOCUMENT_MAX_SIZE_MB,
} from "@/lib/vendors/vendor-documents";

const MAX_SIZE_BYTES = VENDOR_DOCUMENT_MAX_SIZE_MB * 1024 * 1024;

interface DocumentUploadFieldProps {
  label: string;
  hint?: string;
  /** Private storage key of the uploaded file, or "" when nothing yet. */
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
}

/**
 * Single-file uploader for vendor verification documents.
 * Posts to the registration-scoped upload route rather than /api/upload,
 * because an applicant who has just signed up is still pending email
 * verification and /api/upload would reject that session. Documents are
 * stored privately — the value handed to onChange is a storage key, and only
 * admins can fetch the file back.
 */
export function DocumentUploadField({
  label,
  hint,
  value,
  onChange,
  disabled,
}: DocumentUploadFieldProps) {
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

      const res = await fetch("/api/vendor/apply/documents", {
        method: "POST",
        body,
      });
      const result = await res.json();

      if (!res.ok || !result.success || !result.data?.[0]?.key) {
        toast.error(result.message || `Failed to upload ${file.name}`);
        return;
      }

      onChange(result.data[0].key);
      setFileName(file.name);
    } catch {
      toast.error(`Failed to upload ${file.name}`);
    } finally {
      setIsUploading(false);
      // Allow re-selecting the same file after a failure or a removal.
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
      <label className="text-sm font-medium text-foreground">{label}</label>

      {value ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {fileName || "Uploaded document"}
          </span>
          <button
            type="button"
            onClick={handleRemove}
            disabled={disabled}
            aria-label={`Remove ${label}`}
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isUploading}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground transition-colors",
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
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
