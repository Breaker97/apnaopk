"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import {
  Box,
  Check,
  Copy,
  ExternalLink,
  FileText,
  File as FileIcon,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFile } from "@/lib/media-upload/direct-upload";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirmation-dialog";
import { ModelViewer } from "@/components/ui/model-viewer";
import { toast } from "@/components/ui/toast-notification";
import {
  STORAGE_PROVIDER_LABELS,
  type StoredStorageProvider,
} from "@/lib/storage/types";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

type MediaKind = "image" | "video" | "model" | "document" | "other";

interface MediaFile {
  key: string;
  url: string;
  size: number;
  lastModified?: string;
  filename: string;
  kind: MediaKind;
}

const KIND_FILTERS: { value: MediaKind | "all"; labelKey: string; defaultLabel: string }[] = [
  { value: "all", labelKey: "admin.media.filter.all", defaultLabel: "All" },
  { value: "image", labelKey: "admin.media.filter.images", defaultLabel: "Images" },
  { value: "video", labelKey: "admin.media.filter.videos", defaultLabel: "Videos" },
  { value: "model", labelKey: "admin.media.filter.models", defaultLabel: "3D Models" },
  { value: "document", labelKey: "admin.media.filter.documents", defaultLabel: "Documents" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Absolute URL for copying — local storage URLs are root-relative. */
function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${window.location.origin}${url}`;
}

function KindIcon({ kind, className }: { kind: MediaKind; className?: string }) {
  if (kind === "video") return <Video className={className} />;
  if (kind === "model") return <Box className={className} />;
  if (kind === "document") return <FileText className={className} />;
  return <FileIcon className={className} />;
}

function MediaThumb({ file }: { file: MediaFile }) {
  if (file.kind === "image") {
    return (
      <AppImage
        src={file.url}
        alt={file.filename}
        width={200}
        height={200}
        className="h-full w-full object-cover"
        fallback={
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <FileIcon className="h-8 w-8" />
          </div>
        }
      />
    );
  }
  if (file.kind === "video") {
    return (
      <video
        src={file.url}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
      <KindIcon kind={file.kind} className="h-8 w-8" />
    </div>
  );
}

export function MediaLibrarySection({
  tabBar,
  isDemoMode = false,
  demoModeMessage,
}: {
  tabBar?: ReactNode;
  /** In demo mode the library stays browsable and uploadable, but deletes are
      blocked client-side so no server round-trip is even attempted. */
  isDemoMode?: boolean;
  demoModeMessage?: string;
}) {
  const t = useTranslations();
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [provider, setProvider] = useState<string>("");
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<MediaKind | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeFile, setActiveFile] = useState<MediaFile | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{
    keys: string[];
    open: boolean;
  }>({ keys: [], open: false });
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce the search box before hitting the server.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Bumped whenever filters reset the list, so an in-flight "load more" from
  // the previous filter can't append its stale results to the new list.
  const listGeneration = useRef(0);

  const fetchPage = useCallback(
    (cursor?: string) => {
      // kind/search filtering happens server-side: matches can live deep in
      // the listing (e.g. a few 3D models in a bucket of images), which a
      // client-only filter over the first page would miss entirely.
      const generation = cursor ? listGeneration.current : ++listGeneration.current;
      const request = async () => {
        const params = new URLSearchParams({ limit: "60" });
        if (cursor) params.set("cursor", cursor);
        if (kindFilter !== "all") params.set("kind", kindFilter);
        if (debouncedSearch) params.set("q", debouncedSearch);
        const res = await fetch(`/api/admin/media?${params.toString()}`);
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.message || "Failed to load media");
        }
        return json.data as {
          provider: string;
          files: MediaFile[];
          nextCursor?: string;
        };
      };
      return request().then((data) => {
        if (generation !== listGeneration.current) return; // superseded
        setProvider(data.provider);
        setNextCursor(data.nextCursor);
        setFiles((prev) => (cursor ? [...prev, ...data.files] : data.files));
      });
    },
    [kindFilter, debouncedSearch],
  );

  const runReload = useCallback(
    () =>
      fetchPage()
        .catch((error) => {
          toast.error(
            error instanceof Error ? error.message : "Failed to load media",
          );
        })
        .finally(() => setIsLoading(false)),
    [fetchPage],
  );
  // Manual reloads show the spinner and drop the selection; the effect below
  // does the same during render when the filters change.
  const reload = useCallback(() => {
    setIsLoading(true);
    setSelected(new Set());
    return runReload();
  }, [runReload]);

  useApplyOnChange([runReload], () => {
    setIsLoading(true);
    setSelected(new Set());
  });
  useEffect(() => {
    void runReload();
  }, [runReload]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setIsLoadingMore(true);
    try {
      await fetchPage(nextCursor);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load media",
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return files.filter((file) => {
      if (kindFilter !== "all" && file.kind !== kindFilter) return false;
      if (query && !file.key.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [files, search, kindFilter]);

  const copyUrl = async (file: MediaFile) => {
    try {
      await navigator.clipboard.writeText(absoluteUrl(file.url));
      setCopiedKey(file.key);
      setTimeout(() => setCopiedKey((k) => (k === file.key ? null : k)), 1500);
      toast.success(
        t("admin.media.urlCopied", { defaultMessage: "URL copied" }),
      );
    } catch {
      toast.error("Could not copy URL");
    }
  };

  // Returns true (and surfaces the demo notice) when a delete should be
  // short-circuited. Everything else — browsing, uploading, copying URLs —
  // stays fully interactive in demo, matching what the server allows.
  const deleteBlockedInDemo = () => {
    if (!isDemoMode) return false;
    toast.error(
      demoModeMessage ||
        "Demo mode is enabled. Deleting files is disabled on this demo site.",
    );
    return true;
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsUploading(true);
    try {
      // Uploaded one at a time so each file gets its own presigned URL and
      // goes straight to storage, bypassing the hosting platform's
      // request-body limit that capped the old batched /api/upload call.
      const files = Array.from(fileList);
      const results = await Promise.allSettled(
        files.map((file) => uploadFile(file)),
      );

      const failures = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              `${files[index].name}: ${
                result.reason instanceof Error
                  ? result.reason.message
                  : "Upload failed"
              }`,
            ]
          : [],
      );

      // Every file failed — report it as an outright failure rather than a
      // success with a side note.
      if (failures.length === files.length) {
        throw new Error(failures.join(", "));
      }
      if (failures.length > 0) {
        toast.error(failures.join(", "));
      }
      toast.success(
        t("admin.media.uploaded", { defaultMessage: "Files uploaded" }),
      );
      await reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const performDelete = async () => {
    if (deleteBlockedInDemo()) {
      setConfirmDelete({ keys: [], open: false });
      return;
    }
    setIsDeleting(true);
    const keys = confirmDelete.keys;
    let deleted = 0;
    const failures: string[] = [];
    // Deletes are independent — run them concurrently in small batches so a
    // 50-file bulk delete doesn't take 50 sequential roundtrips.
    const BATCH = 8;
    for (let i = 0; i < keys.length; i += BATCH) {
      const results = await Promise.allSettled(
        keys.slice(i, i + BATCH).map(async (key) => {
          const res = await fetch(
            `/api/upload?key=${encodeURIComponent(key)}`,
            { method: "DELETE" },
          );
          const json = await res.json().catch(() => null);
          if (!res.ok || !json?.success) {
            throw new Error(
              `${key.split("/").pop()}: ${json?.message || "Delete failed"}`,
            );
          }
        }),
      );
      for (const result of results) {
        if (result.status === "fulfilled") deleted += 1;
        else {
          failures.push(
            result.reason instanceof Error ? result.reason.message : "failed",
          );
        }
      }
    }
    setIsDeleting(false);
    setConfirmDelete({ keys: [], open: false });
    setActiveFile(null);
    if (deleted > 0) {
      setFiles((prev) => prev.filter((f) => !keys.includes(f.key)));
      setSelected(new Set());
      toast.success(t("admin.media.deleted", { count: deleted }));
    }
    if (failures.length > 0) toast.error(failures.join(" · "));
  };

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Header row: tabs on the left, Upload aligned to the far right */}
      <div className="flex flex-wrap items-center gap-2">
        {tabBar}
        <div className="ml-auto">
          <Button
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="gap-1.5"
          >
            {isUploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {t("admin.media.upload", { defaultMessage: "Upload" })}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void handleUpload(e.target.files)}
          />
        </div>
      </div>
      <Card>
        <CardContent className="space-y-4">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1 basis-56">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("admin.media.searchPlaceholder", {
                  defaultMessage: "Search files…",
                })}
                className="bg-background pl-8"
              />
            </div>
            <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
              {KIND_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setKindFilter(filter.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    kindFilter === filter.value
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t(filter.labelKey, { defaultMessage: filter.defaultLabel })}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void reload()}
              disabled={isLoading}
              className="gap-1.5"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isLoading && "animate-spin")}
              />
              {t("admin.media.refresh", { defaultMessage: "Refresh" })}
            </Button>
          </div>

          {/* Bulk bar */}
          {selected.size > 0 && (
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
              <span className="text-sm font-medium">
                {t("admin.media.selectedCount", {
                  defaultMessage: `${selected.size} selected`,
                  count: selected.size,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelected(new Set())}
                >
                  {t("common.clear")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (deleteBlockedInDemo()) return;
                    setConfirmDelete({ keys: [...selected], open: true });
                  }}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  {t("admin.media.deleteSelected", {
                    defaultMessage: "Delete selected",
                  })}
                </Button>
              </div>
            </div>
          )}

          {/* Grid */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : visibleFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <HardDrive className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">
                {t("admin.media.empty", { defaultMessage: "No media found" })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("admin.media.emptyHint", {
                  defaultMessage:
                    "Uploaded files will appear here for the active storage provider.",
                })}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {visibleFiles.map((file) => {
                const isSelected = selected.has(file.key);
                return (
                  <div
                    key={file.key}
                    className={cn(
                      "group relative overflow-hidden rounded-lg border bg-muted/30",
                      isSelected && "ring-2 ring-primary",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveFile(file)}
                      className="block aspect-square w-full overflow-hidden bg-muted"
                      aria-label={file.filename}
                    >
                      <MediaThumb file={file} />
                    </button>

                    {/* Selection checkbox */}
                    <label
                      className={cn(
                        "absolute left-2 top-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border bg-background/80 backdrop-blur-sm transition-opacity",
                        isSelected
                          ? "border-primary opacity-100"
                          : "border-input opacity-0 group-hover:opacity-100",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(file.key)}
                        className="peer sr-only"
                      />
                      {isSelected && (
                        <Check className="h-3 w-3 text-primary" />
                      )}
                    </label>

                    {/* Hover actions */}
                    <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => void copyUrl(file)}
                        className="pointer-events-auto rounded bg-background/90 p-1 hover:bg-background"
                        aria-label="Copy URL"
                        title={t("admin.media.copyUrl", {
                          defaultMessage: "Copy URL",
                        })}
                      >
                        {copiedKey === file.key ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (deleteBlockedInDemo()) return;
                          setConfirmDelete({ keys: [file.key], open: true });
                        }}
                        className="pointer-events-auto rounded bg-destructive/90 p-1 text-destructive-foreground hover:bg-destructive"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="space-y-0.5 px-2 py-1.5">
                      <p className="truncate text-xs font-medium" title={file.filename}>
                        {file.filename}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatBytes(file.size)} · {formatDate(file.lastModified)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer: count + load more */}
          {!isLoading && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {t("admin.media.count", {
                  defaultMessage: `${visibleFiles.length} file(s)`,
                  count: visibleFiles.length,
                })}
                {provider
                  ? ` · ${STORAGE_PROVIDER_LABELS[provider as StoredStorageProvider] ?? provider}`
                  : null}
              </p>
              {nextCursor && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadMore()}
                  disabled={isLoadingMore}
                  className="gap-1.5"
                >
                  {isLoadingMore && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {t("admin.media.loadMore", { defaultMessage: "Load more" })}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail modal */}
      <Dialog
        open={!!activeFile}
        onOpenChange={(open) => !open && setActiveFile(null)}
      >
        <DialogContent className="max-w-2xl">
          {activeFile && (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pr-8">
                  {activeFile.filename}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {activeFile.kind === "image" ? (
                    <AppImage
                      src={activeFile.url}
                      alt={activeFile.filename}
                      width={600}
                      height={600}
                      className="max-h-full max-w-full object-contain"
                      fallback={
                        <FileIcon className="h-12 w-12 text-muted-foreground" />
                      }
                    />
                  ) : activeFile.kind === "video" ? (
                    <video
                      src={activeFile.url}
                      controls
                      className="max-h-full max-w-full"
                    />
                  ) : activeFile.kind === "model" ? (
                    // Interactive 3D preview — drag to rotate, scroll to zoom.
                    // Grid tiles stay as icons on purpose: models can be tens
                    // of MB, so they only load when opened here.
                    <ModelViewer
                      src={activeFile.url}
                      alt={activeFile.filename}
                      autoRotate
                      cameraControls
                    />
                  ) : (
                    <KindIcon
                      kind={activeFile.kind}
                      className="h-12 w-12 text-muted-foreground"
                    />
                  )}
                </div>
                <div className="space-y-4">
                  <dl className="space-y-1.5 text-xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        {t("admin.media.type", { defaultMessage: "Type" })}
                      </dt>
                      <dd className="font-medium capitalize">{activeFile.kind}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        {t("admin.media.size", { defaultMessage: "Size" })}
                      </dt>
                      <dd className="font-medium">{formatBytes(activeFile.size)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">
                        {t("admin.media.modified", { defaultMessage: "Modified" })}
                      </dt>
                      <dd className="font-medium">
                        {formatDate(activeFile.lastModified)}
                      </dd>
                    </div>
                    <div className="space-y-1 pt-1">
                      <dt className="text-muted-foreground">
                        {t("admin.media.key", { defaultMessage: "Storage key" })}
                      </dt>
                      <dd className="break-all rounded bg-muted px-2 py-1 font-mono text-[10px]">
                        {activeFile.key}
                      </dd>
                    </div>
                  </dl>

                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => void copyUrl(activeFile)}
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      {t("admin.media.copyUrl", { defaultMessage: "Copy URL" })}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() =>
                        window.open(
                          absoluteUrl(activeFile.url),
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      {t("admin.media.open", { defaultMessage: "Open" })}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        if (deleteBlockedInDemo()) return;
                        setConfirmDelete({ keys: [activeFile.key], open: true });
                      }}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      {t("common.delete")}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmDelete.open}
        onOpenChange={(open) =>
          setConfirmDelete((prev) => ({ ...prev, open }))
        }
        type="danger"
        title={t("admin.media.deleteTitle", {
          defaultMessage: "Delete file(s)?",
        })}
        description={t("admin.media.deleteDescription", {
          defaultMessage:
            "The file will be removed from storage permanently. Anywhere this URL is still used (products, pages, emails) will show a broken file.",
        })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        loading={isDeleting}
        onConfirm={() => void performDelete()}
      />
    </div>
  );
}
