"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { uploadFile } from "@/lib/media-upload/direct-upload";

/**
 * Intrinsic pixel size of a picked file, or `undefined` when the browser cannot
 * decode it — vector sources land here in most browsers, and they need no size
 * check because they rasterize to any dimension.
 */
async function readImageSize(file: File) {
  if (typeof createImageBitmap !== "function") return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return undefined;
  }
}

function fileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function BrandAssetCard(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  alt: string;
  replaceText: string;
  /** Enforced, not just printed — see the size check in `onPick`. */
  maxSizeMB: number;
  /** Accepted extensions, lowercase and without the dot. Also enforced. */
  formats: readonly string[];
  recommended: string;
  /**
   * Warn when a raster source is smaller than this on either axis. Advisory
   * only: /app-icon/[spec] renders every manifest icon at exactly 192/512px,
   * upscaling when it has to, so an undersized source is soft — never
   * uninstallable.
   */
  recommendedDimension?: number;
  /**
   * Preview against a dark surface. A dark-theme logo is drawn in light ink and
   * is invisible on the default light tile.
   */
  darkPreview?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const formatList = props.formats.map((format) => format.toUpperCase()).join(", ");

  const upload = async (file: File) => {
    setIsUploading(true);
    setProgress(0);
    try {
      // Same path as product media and the media library: straight to R2/S3
      // when the bucket allows it, so a logo is not capped by the hosting
      // platform's request-body limit (4.5MB on Vercel, 1MB on a default
      // nginx). Falls back to POST /api/upload transparently.
      const uploaded = await uploadFile(file, { onProgress: setProgress });
      props.onChange(uploaded.url);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error && uploadError.message
          ? uploadError.message
          : "Upload failed",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const onPick = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;

    setError(null);
    setNotice(null);

    try {
      const extension = fileExtension(file.name);
      const accepted = extension
        ? props.formats.includes(extension)
        : file.type.startsWith("image/");
      if (!accepted) {
        setError(`Needs to be a ${formatList} file`);
        return;
      }

      const maxBytes = props.maxSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        setError(
          `Needs to be under ${props.maxSizeMB} MB — this file is ${(
            file.size /
            1024 /
            1024
          ).toFixed(1)} MB`,
        );
        return;
      }

      if (props.recommendedDimension) {
        const size = await readImageSize(file);
        if (
          size &&
          (size.width < props.recommendedDimension ||
            size.height < props.recommendedDimension)
        ) {
          setNotice(
            `Smaller than ${props.recommendedDimension}x${props.recommendedDimension}px (${size.width}x${size.height}px) — it will be upscaled and may look soft`,
          );
        }
      }

      await upload(file);
    } finally {
      // Always clear, so re-picking the same file after a rejection still fires
      // a change event.
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (isUploading) return;
    void onPick(e.dataTransfer.files);
  };

  return (
    <div className="space-y-4">
      <span className="text-sm font-semibold">{props.label}</span>

      <div
        className="relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 transition-colors cursor-pointer hover:border-primary/40 hover:bg-muted/30"
        onClick={() => !isUploading && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept={props.formats.map((format) => `.${format}`).join(",")}
          onChange={(e) => void onPick(e.target.files)}
          disabled={isUploading}
          className="hidden"
          aria-label={`${props.label}-file`}
        />

        {props.value && (
          <div className="relative">
            <div
              className={`h-16 w-16 overflow-hidden rounded-lg border ${
                props.darkPreview ? "bg-neutral-900" : "bg-muted/50"
              }`}
            >
              <AppImage
                src={props.value}
                alt={props.alt}
                className="h-full w-full object-contain"
                width={64}
                height={64}
              />
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.onChange("");
              }}
              disabled={isUploading}
              className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm transition-transform hover:scale-110"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {isUploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground" />
        )}

        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {isUploading
              ? // Progress only reports on the direct-to-storage path; the
                // server fallback has none, so it stays a plain "Uploading…".
                progress > 0
                ? `Uploading… ${progress}%`
                : "Uploading…"
              : props.value
                ? props.replaceText
                : `Upload ${props.label.toLowerCase()}`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Drag and drop or click to select
          </p>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        {notice && !error && (
          <p className="text-center text-xs text-muted-foreground">{notice}</p>
        )}
      </div>

      <div className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Max size:</span>
          <span className="font-medium text-[8px]">{props.maxSizeMB} MB</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Formats:</span>
          <span className="font-medium text-[8px]">{formatList}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Recommended:</span>
          <span className="font-medium text-[8px]">{props.recommended}</span>
        </div>
      </div>
    </div>
  );
}
