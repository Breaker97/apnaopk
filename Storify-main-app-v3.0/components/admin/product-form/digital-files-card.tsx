"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  BookOpen,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/ui/number-input";
import { cn } from "@/lib/utils";

export type DigitalAssetItem = {
  _id: string;
  filename: string;
  storageKey: string;
  size?: number;
  mimeType?: string;
  position?: number;
};

export type DigitalPreviewItem = {
  url: string;
  filename?: string;
  size?: number;
  mimeType?: string;
};

const MAX_ASSETS = 20;

function formatBytes(bytes?: number): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fileExtension(filename: string): string | null {
  const ext = filename.split(".").pop();
  return ext && ext !== filename ? ext.toUpperCase() : null;
}

/**
 * Digital deliverables card (Shopify Digital Downloads equivalent). Files go
 * to PRIVATE storage via the role-scoped digital-assets endpoint — customers
 * receive them from their paid order's Downloads section, never by URL.
 *
 * The free sample at the bottom is the opposite: it goes to PUBLIC storage
 * (plain /api/upload) because the product page links it to anyone — Amazon's
 * "Look inside" equivalent.
 *
 * Rendered only when the Product format selector is set to digital.
 */
export function DigitalFilesCard({
  assets,
  onChange,
  downloadLimit,
  onDownloadLimitChange,
  preview,
  onPreviewChange,
  isVendor,
}: {
  assets: DigitalAssetItem[];
  onChange: (assets: DigitalAssetItem[]) => void;
  downloadLimit: number;
  onDownloadLimitChange: (limit: number) => void;
  preview: DigitalPreviewItem | null;
  onPreviewChange: (preview: DigitalPreviewItem | null) => void;
  isVendor: boolean;
}) {
  const t = useTranslations();
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingPreview, setIsUploadingPreview] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewInputRef = useRef<HTMLInputElement>(null);
  const uploadEndpoint = isVendor
    ? "/api/vendor/digital-assets"
    : "/api/admin/digital-assets";

  const handlePreviewFile = async (file: File | null | undefined) => {
    if (!file || isUploadingPreview) return;
    setError(null);
    setIsUploadingPreview(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const result = await res.json();
      const uploaded = Array.isArray(result?.data) ? result.data[0] : null;
      if (!result?.success || !uploaded?.url) {
        throw new Error(
          Array.isArray(result?.errors) && result.errors.length
            ? result.errors.join(" · ")
            : result?.message || "Upload failed",
        );
      }
      onPreviewChange({
        url: String(uploaded.url),
        filename: uploaded.filename ? String(uploaded.filename) : file.name,
        size: typeof uploaded.size === "number" ? uploaded.size : file.size,
        mimeType: uploaded.mimeType ? String(uploaded.mimeType) : file.type,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploadingPreview(false);
    }
  };

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || isUploading) return;
    setError(null);
    if (assets.length + fileList.length > MAX_ASSETS) {
      setError(t("admin.productForm.media.maxFiles", { max: MAX_ASSETS }));
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      for (const file of Array.from(fileList)) formData.append("files", file);
      const res = await fetch(uploadEndpoint, { method: "POST", body: formData });
      const result = await res.json();
      if (!result.success || !Array.isArray(result.data)) {
        throw new Error(
          Array.isArray(result.errors) && result.errors.length
            ? result.errors.join(" · ")
            : result.message || "Upload failed",
        );
      }
      const next = [
        ...assets,
        ...(result.data as DigitalAssetItem[]),
      ].map((asset, idx) => ({ ...asset, position: idx }));
      onChange(next);
      if (Array.isArray(result.errors) && result.errors.length > 0) {
        setError(result.errors.join(" · "));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = (id: string) => {
    onChange(
      assets
        .filter((asset) => asset._id !== id)
        .map((asset, idx) => ({ ...asset, position: idx })),
    );
  };

  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle>{t("admin.productForm.digital.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("admin.productForm.digital.help")}
        </p>

        <div
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          className={cn(
            "relative rounded-lg border-2 border-dashed p-6 transition-colors",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50",
            isUploading && "pointer-events-none opacity-60",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            disabled={isUploading}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <div className="flex flex-col items-center justify-center gap-2 text-center">
            {isUploading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="h-8 w-8 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">
                {t("admin.productForm.media.dropzoneTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("admin.productForm.digital.dropzoneHelp")}
              </p>
            </div>
          </div>
        </div>

        {assets.length === 0 ? (
          <p className="flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-500">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {t("admin.productForm.digital.noFilesHint")}
          </p>
        ) : (
          <>
            <ul className="divide-y rounded-lg border">
              {assets.map((asset) => {
                const ext = fileExtension(asset.filename);
                return (
                  <li
                    key={asset._id}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {asset.filename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ext ? `${ext} · ` : ""}
                        {formatBytes(asset.size)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(asset._id)}
                      aria-label={t("admin.productForm.digital.removeFile", {
                        filename: asset.filename,
                      })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              {t("admin.productForm.media.fileCount", {
                count: assets.length,
                max: MAX_ASSETS,
              })}
            </p>
          </>
        )}

        {error && (
          <p className="flex items-center gap-1 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </p>
        )}

        {assets.length > 0 && (
          <div className="max-w-xs space-y-1 border-t pt-4">
            <label className="text-sm font-medium" htmlFor="digital-download-limit">
              {t("admin.productForm.digital.downloadLimit")}
            </label>
            <NumberInput
              id="digital-download-limit"
              min={0}
              max={1000}
              step={1}
              value={downloadLimit}
              whenEmpty={0}
              normalize={Math.trunc}
              onValueChange={(next) => onDownloadLimitChange(next ?? 0)}
            />
            <p className="text-xs text-muted-foreground">
              {t("admin.productForm.digital.downloadLimitHelp")}
            </p>
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">
            {t("admin.productForm.digital.previewTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("admin.productForm.digital.previewHelp")}
          </p>

          <input
            ref={previewInputRef}
            type="file"
            className="hidden"
            disabled={isUploadingPreview}
            onChange={(e) => {
              handlePreviewFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {preview ? (
            <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <a
                  href={preview.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate text-sm font-medium hover:underline"
                >
                  {preview.filename || preview.url}
                </a>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(preview.size)}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => onPreviewChange(null)}
                aria-label={t("admin.productForm.digital.removePreview")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploadingPreview}
              onClick={() => previewInputRef.current?.click()}
            >
              {isUploadingPreview ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              {t("admin.productForm.digital.addPreview")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
