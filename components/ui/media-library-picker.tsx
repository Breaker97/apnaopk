"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  Box,
  Check,
  File as FileIcon,
  HardDrive,
  Loader2,
  Search,
  Upload,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFile } from "@/lib/media-upload/direct-upload";
import type { MediaLibraryFile } from "@/lib/storage/types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";
import { AppImage } from "./app-image";
import { YouTubeGlyph } from "./brand-glyphs";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Input } from "./input";

/**
 * Shopify's "Select file": pick files the store already has, or upload new
 * ones into the library from here, and hand the selection back in one go.
 * Reads GET /api/media/library, which decides from the session whose library
 * it is — the store's for an admin, a vendor's own folder for a vendor.
 */

type LibraryPickerKind = "image" | "video" | "model";

/** A library file as the picker hands it back; dimensions when known. */
export type PickedLibraryFile = MediaLibraryFile & {
  kind: LibraryPickerKind;
  width?: number;
  height?: number;
};

interface MediaLibraryPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The kinds the host takes; the library is filtered to them. */
  kinds: readonly LibraryPickerKind[];
  /** How many more files the host has room for. */
  maxSelectable: number;
  /** Stored URLs the host already holds — shown as added, not offered again. */
  attachedUrls: ReadonlySet<string>;
  /** `accept` for the upload input. */
  accept: string;
  /** The host's own rules for a new upload: an error message, or null. */
  validateFile: (file: File) => string | null;
  onSelect: (files: PickedLibraryFile[]) => void;
  /**
   * Shopify's "Add from URL", beside Upload: closes the picker and hands over
   * to the host's own URL flow (a YouTube or Vimeo embed for product media).
   */
  onAddFromUrl?: () => void;
}

type PendingUpload = {
  id: string;
  file: File;
  previewUrl: string;
  kind: LibraryPickerKind;
  progress?: number;
  error?: string;
};

type PageResult = "ok" | "stale" | "forbidden" | "failed";

const PAGE_SIZE = 48;

const FILTER_LABEL_KEYS: Record<LibraryPickerKind, string> = {
  image: "admin.media.filter.images",
  video: "admin.media.filter.videos",
  model: "admin.media.filter.models",
};

function isPickerKind(value: unknown): value is LibraryPickerKind {
  return value === "image" || value === "video" || value === "model";
}

function fileKind(file: File): LibraryPickerKind {
  if (file.type.startsWith("video/")) return "video";
  if (/\.(glb|gltf)$/i.test(file.name)) return "model";
  return "image";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function hasFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function MediaLibraryPicker({
  open,
  onOpenChange,
  ...props
}: MediaLibraryPickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `sm:` prefix required: the primitive's own `sm:max-w-lg` outranks an
          unprefixed `max-w-*` at every width above the sm breakpoint. The
          body unmounts with the content once the dialog has closed, so every
          visit starts from a fresh listing and an empty selection. */}
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <PickerBody {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  kinds,
  maxSelectable,
  attachedUrls,
  accept,
  validateFile,
  onSelect,
  onAddFromUrl,
  onClose,
}: Omit<MediaLibraryPickerProps, "open" | "onOpenChange"> & {
  onClose: () => void;
}) {
  const t = useTranslations();
  // A primitive, so a host that rebuilds its kinds array on every render does
  // not restart the listing each time.
  const kindsParam = kinds.join(",");
  const [filter, setFilter] = useState<LibraryPickerKind | "all">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<PickedLibraryFile[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [status, setStatus] = useState<
    "loading" | "ready" | "error" | "forbidden"
  >("loading");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [uploaded, setUploaded] = useState<PickedLibraryFile[]>([]);
  const [selected, setSelected] = useState<PickedLibraryFile[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Bumped by every fresh listing, so a response to an older filter or search
  // (or a "load more" started before it) cannot land on the new list.
  const generationRef = useRef(0);
  const previewUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    // The same array for the component's whole life; uploads push into it.
    const previewUrls = previewUrlsRef.current;
    return () => previewUrls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const fetchPage = useCallback(
    async (next?: string): Promise<PageResult> => {
      const generation = next
        ? generationRef.current
        : ++generationRef.current;
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          kind: filter === "all" ? kindsParam : filter,
        });
        if (next) params.set("cursor", next);
        if (query) params.set("q", query);
        const res = await fetch(`/api/media/library?${params.toString()}`);
        const json = await res.json().catch(() => null);
        if (generation !== generationRef.current) return "stale";
        if (res.status === 403) return "forbidden";
        if (!res.ok || !json?.success) return "failed";
        const data = json.data as {
          files: PickedLibraryFile[];
          nextCursor?: string;
        };
        setRows((prev) => (next ? [...prev, ...data.files] : data.files));
        setCursor(data.nextCursor);
        return "ok";
      } catch {
        return generation === generationRef.current ? "failed" : "stale";
      }
    },
    [filter, kindsParam, query],
  );

  const loadFirstPage = useCallback(async () => {
    const result = await fetchPage();
    if (result === "ok") setStatus("ready");
    else if (result === "forbidden") setStatus("forbidden");
    else if (result === "failed") setStatus("error");
  }, [fetchPage]);

  // A new filter or search starts from an empty grid; the effect below loads
  // it. The selection survives — it is kept apart from the visible rows.
  useApplyOnChange([loadFirstPage], () => {
    setStatus("loading");
    setRows([]);
    setCursor(undefined);
  });
  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const retry = () => {
    setStatus("loading");
    void loadFirstPage();
  };

  const loadMore = async () => {
    if (!cursor) return;
    setIsLoadingMore(true);
    const result = await fetchPage(cursor);
    setIsLoadingMore(false);
    if (result === "failed") setNotice(t("admin.mediaPicker.loadFailed"));
  };

  const selectedKeys = useMemo(
    () => new Set(selected.map((file) => file.key)),
    [selected],
  );
  const limitReached = selected.length >= maxSelectable;

  const toggle = (file: PickedLibraryFile) => {
    if (attachedUrls.has(file.publicUrl)) return;
    setSelected((prev) => {
      if (prev.some((item) => item.key === file.key)) {
        return prev.filter((item) => item.key !== file.key);
      }
      return prev.length >= maxSelectable ? prev : [...prev, file];
    });
  };

  const runUpload = async (pending: PendingUpload) => {
    try {
      const result = await uploadFile(pending.file, {
        onProgress: (progress) =>
          setUploads((prev) =>
            prev.map((item) =>
              item.id === pending.id ? { ...item, progress } : item,
            ),
          ),
      });
      const file: PickedLibraryFile = {
        key: result.key,
        // The local copy: a bucket without a public URL cannot show the
        // stored one, and this is the same picture.
        url: pending.previewUrl,
        publicUrl: result.url,
        size: result.size,
        lastModified: new Date().toISOString(),
        filename: result.filename,
        kind: isPickerKind(result.type) ? result.type : pending.kind,
        mimeType: result.mimeType,
        width: result.width,
        height: result.height,
      };
      setUploads((prev) => prev.filter((item) => item.id !== pending.id));
      setUploaded((prev) => [file, ...prev]);
      // What was just uploaded is what the person came to add — pre-select
      // it while there is room, the way Shopify's picker does.
      setSelected((prev) =>
        prev.length < maxSelectable ? [...prev, file] : prev,
      );
    } catch (error) {
      setUploads((prev) =>
        prev.map((item) =>
          item.id === pending.id
            ? {
                ...item,
                error:
                  error instanceof Error && error.message
                    ? error.message
                    : t("admin.mediaPicker.uploadFailed"),
              }
            : item,
        ),
      );
    }
  };

  const startUploads = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const rejected: string[] = [];
    const accepted: PendingUpload[] = [];
    for (const file of files) {
      const error = validateFile(file);
      if (error) {
        rejected.push(`${file.name}: ${error}`);
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      previewUrlsRef.current.push(previewUrl);
      accepted.push({
        id: crypto.randomUUID(),
        file,
        previewUrl,
        kind: fileKind(file),
      });
    }
    setNotice(rejected.length > 0 ? rejected.join(" · ") : null);
    if (accepted.length === 0) return;
    setUploads((prev) => [...accepted, ...prev]);
    accepted.forEach((pending) => void runUpload(pending));
  };

  // Uploads made here stay on top whatever the listing is doing; they obey
  // the filter and search like everything else, and a listing that already
  // contains one does not show it twice.
  const visibleUploaded = uploaded.filter(
    (file) =>
      (filter === "all" || file.kind === filter) &&
      (!query || file.key.toLowerCase().includes(query.toLowerCase())),
  );
  const uploadedKeys = new Set(uploaded.map((file) => file.key));
  const files = [
    ...visibleUploaded,
    ...rows.filter((file) => !uploadedKeys.has(file.key)),
  ];
  const isUploading = uploads.some((item) => !item.error);
  const isFiltered = filter !== "all" || query !== "";

  const renderGrid = () => {
    if (status === "loading" && uploads.length === 0) {
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 10 }, (_, index) => (
            <div
              key={index}
              className="aspect-[4/5] animate-pulse rounded-lg bg-muted"
            />
          ))}
        </div>
      );
    }

    const message =
      status === "forbidden"
        ? t("admin.mediaPicker.forbidden")
        : status === "error"
          ? t("admin.mediaPicker.loadFailed")
          : files.length === 0 && uploads.length === 0
            ? isFiltered
              ? t("admin.mediaPicker.noMatches")
              : t("admin.mediaPicker.empty")
            : null;

    return (
      <div className="space-y-4">
        {message ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <HardDrive className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">{message}</p>
            {status === "ready" && !isFiltered ? (
              <p className="max-w-sm text-xs text-muted-foreground">
                {t("admin.mediaPicker.emptyHint")}
              </p>
            ) : null}
            {status === "error" ? (
              <Button type="button" variant="outline" size="sm" onClick={retry}>
                {t("admin.mediaPicker.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}

        {files.length > 0 || uploads.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {uploads.map((pending) => (
              <PendingTile
                key={pending.id}
                pending={pending}
                onDismiss={() =>
                  setUploads((prev) =>
                    prev.filter((item) => item.id !== pending.id),
                  )
                }
              />
            ))}
            {files.map((file) => {
              const isAttached = attachedUrls.has(file.publicUrl);
              const isSelected = selectedKeys.has(file.key);
              return (
                <FileTile
                  key={file.key}
                  file={file}
                  isSelected={isSelected}
                  isAttached={isAttached}
                  isDisabled={isAttached || (!isSelected && limitReached)}
                  addedLabel={t("admin.mediaPicker.added")}
                  onToggle={() => toggle(file)}
                />
              );
            })}
          </div>
        ) : null}

        {cursor && status === "ready" ? (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadMore()}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("admin.media.loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <DialogHeader className="border-b px-6 pb-4 pt-6">
        <DialogTitle className="pr-8">{t("admin.mediaPicker.title")}</DialogTitle>
        <DialogDescription>{t("admin.mediaPicker.description")}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("admin.mediaPicker.searchPlaceholder")}
            aria-label={t("admin.mediaPicker.searchPlaceholder")}
            className="h-9 bg-background pl-8"
          />
        </div>
        {kinds.length > 1 ? (
          <div
            role="group"
            className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1"
          >
            {(["all", ...kinds] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  filter === value
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(value === "all" ? "admin.media.filter.all" : FILTER_LABEL_KEYS[value])}
              </button>
            ))}
          </div>
        ) : null}
        <Button
          type="button"
          size="sm"
          className="h-9"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" />
          {t("admin.media.upload")}
        </Button>
        {onAddFromUrl ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 bg-card"
            onClick={() => {
              onClose();
              onAddFromUrl();
            }}
          >
            <YouTubeGlyph className="h-3.5 w-3.5 text-red-600 dark:text-red-500" />
            {t("admin.mediaPicker.addVideoUrl")}
          </Button>
        ) : null}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(event) => {
            startUploads(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      <div
        className="relative min-h-[16rem] flex-1 overflow-y-auto px-6 py-4"
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setIsDragging(false);
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setIsDragging(false);
          startUploads(event.dataTransfer.files);
        }}
      >
        {notice ? (
          <p className="mb-3 flex items-start gap-1.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </p>
        ) : null}
        {renderGrid()}
        {isDragging ? (
          <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5">
            <p className="flex items-center gap-2 rounded-md bg-background px-3 py-1.5 text-sm font-medium shadow-sm">
              <Upload className="h-4 w-4" />
              {t("admin.mediaPicker.dropToUpload")}
            </p>
          </div>
        ) : null}
      </div>

      <DialogFooter className="items-center border-t px-6 py-4 sm:justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {selected.length > 0
            ? t("admin.mediaPicker.selectedCount", {
                count: selected.length,
                max: maxSelectable,
              })
            : t("admin.mediaPicker.selectUpTo", { max: maxSelectable })}
        </p>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            type="button"
            variant="outline"
            className="flex-1 sm:flex-none"
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            className="flex-1 sm:flex-none"
            // Wait for uploads in flight: they are about to join the selection.
            disabled={selected.length === 0 || isUploading}
            onClick={() => {
              onSelect(selected);
              onClose();
            }}
          >
            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("common.done")}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function KindBadge({ kind }: { kind: LibraryPickerKind }) {
  if (kind === "image") return null;
  return (
    <span className="absolute bottom-2 right-2 flex items-center rounded bg-background/85 p-1 backdrop-blur-sm">
      {kind === "video" ? <Video className="h-3.5 w-3.5" /> : <Box className="h-3.5 w-3.5" />}
    </span>
  );
}

function FileTile({
  file,
  isSelected,
  isAttached,
  isDisabled,
  addedLabel,
  onToggle,
}: {
  file: PickedLibraryFile;
  isSelected: boolean;
  isAttached: boolean;
  isDisabled: boolean;
  addedLabel: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={file.filename}
      aria-pressed={isSelected}
      disabled={isDisabled}
      onClick={onToggle}
      className={cn(
        "group flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected
          ? "border-primary ring-2 ring-primary"
          : "hover:border-foreground/30",
        isDisabled && "cursor-not-allowed opacity-50 hover:border-border",
      )}
    >
      <span className="relative block aspect-square w-full overflow-hidden bg-muted">
        {file.kind === "image" ? (
          <AppImage
            src={file.url}
            alt=""
            width={240}
            height={240}
            className="h-full w-full object-cover"
            fallback={
              <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                <FileIcon className="h-8 w-8" />
              </span>
            }
          />
        ) : file.kind === "video" ? (
          <video
            src={file.url}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : (
          // Models stay an icon: one can be tens of MB, too much for a tile.
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Box className="h-8 w-8" />
          </span>
        )}
        <span
          aria-hidden
          className={cn(
            "absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded border shadow-sm transition-opacity",
            isSelected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-background/90 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
            isDisabled && "hidden",
          )}
        >
          {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
        {isAttached ? (
          <span className="absolute right-2 top-2 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium shadow-sm">
            {addedLabel}
          </span>
        ) : null}
        <KindBadge kind={file.kind} />
      </span>
      <span className="block min-w-0 px-2 py-1.5">
        <span className="block truncate text-xs font-medium">{file.filename}</span>
        <span className="block text-[10px] text-muted-foreground">
          {formatBytes(file.size)}
        </span>
      </span>
    </button>
  );
}

function PendingTile({
  pending,
  onDismiss,
}: {
  pending: PendingUpload;
  onDismiss: () => void;
}) {
  const t = useTranslations();
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card",
        pending.error && "border-destructive",
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {pending.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a blob: preview of a file still uploading
          <img
            src={pending.previewUrl}
            alt=""
            className="h-full w-full object-cover opacity-60"
          />
        ) : null}
        <div className="absolute inset-0 flex items-center justify-center">
          {pending.error ? (
            <AlertCircle className="h-6 w-6 text-destructive" />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
        </div>
        {pending.error ? (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("common.remove")}
            className="absolute right-2 top-2 rounded bg-background/90 p-1 hover:bg-background"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {!pending.error && pending.progress !== undefined ? (
          <div className="absolute inset-x-2 bottom-2 h-1 overflow-hidden rounded-full bg-background/70">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${pending.progress}%` }}
            />
          </div>
        ) : null}
      </div>
      <div className="min-w-0 px-2 py-1.5">
        <p className="truncate text-xs font-medium">{pending.file.name}</p>
        <p
          className={cn(
            "truncate text-[10px]",
            pending.error ? "text-destructive" : "text-muted-foreground",
          )}
          title={pending.error}
        >
          {pending.error ?? t("admin.mediaPicker.uploading")}
        </p>
      </div>
    </div>
  );
}
