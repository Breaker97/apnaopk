"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Upload,
  X,
  Loader2,
  Image as ImageIcon,
  Video,
  Box,
  Star,
  Trash2,
  RefreshCw,
  GripVertical,
  AlertCircle,
  Wand2,
  Sparkles,
  Play,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { uploadFile } from "@/lib/media-upload/direct-upload";
import {
  fetchVimeoThumbnailUrl,
  parseExternalVideoUrl,
} from "@/lib/products/external-video";
import { ExternalVideoPlayer } from "@/components/products/external-video-player";
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
import { ModelViewer } from "./model-viewer";

export type UploadedMedia = {
  _id: string;
  url: string;
  type: "image" | "video" | "model" | "external_video";
  mimeType: string;
  filename?: string;
  alt?: string;
  position?: number;
  size?: number;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  /** external_video only. */
  provider?: "youtube" | "vimeo";
  embedId?: string;
  /** Images only; offered when the host passes `allowImageFit`. */
  fit?: "auto" | "contain" | "cover";
};

interface MediaUploaderProps {
  value: UploadedMedia[];
  onChange: (value: UploadedMedia[]) => void;
  maxFiles?: number;
  acceptTypes?: ("image" | "video" | "model")[];
  accept?: string;
  allowedFileExtensions?: string[];
  disabled?: boolean;
  className?: string;
  uploadTitle?: ReactNode;
  uploadDescription?: ReactNode;
  sizeGuide?: ReactNode;
  uploadZoneClassName?: string;
  mediaGridClassName?: string;
  previewAspectRatio?: string;
  previewFit?: "cover" | "contain";
  previewTileClassName?: string;
  showCoverBadge?: boolean;
  coverHint?: ReactNode | false;
  aiGenerateAction?: ReactNode;
  /** When set, images show an "Edit with AI" action that calls this handler. */
  onEditWithAi?: (media: UploadedMedia) => void;
  /** When set, the detail modal offers AI alt-text; resolves to the text. */
  onGenerateAlt?: (media: UploadedMedia) => Promise<string | null>;
  /** Offer "Add from URL" for YouTube/Vimeo videos (Shopify's ExternalVideo). */
  allowExternalVideo?: boolean;
  /**
   * Offer a per-image fit in the detail modal (Fill / Fit with padding). Off
   * by default: only the product gallery reads it, and a collection or
   * slider upload offering a setting nothing renders would be a lie.
   */
  allowImageFit?: boolean;
  hideUploadZoneWhenFull?: boolean;
  showFileCount?: boolean;
  // Soft client-side limits (server still enforces). Defaults match Shopify:
  // 20MB image, 1024MB (1GB) video, 500MB 3D model.
  maxImageSizeMB?: number;
  maxVideoSizeMB?: number;
  maxModelSizeMB?: number;
}

const ACCEPT_MAP: Record<string, string> = {
  image:
    "image/*,.jpg,.jpeg,.png,.gif,.webp,.svg,.avif,.heic,.heif,.bmp,.tiff,.ico",
  video: "video/*,.mp4,.webm,.ogg,.mov,.avi,.mkv",
  model: ".glb,.gltf,model/gltf-binary,model/gltf+json,application/octet-stream",
};

type MediaKind = "image" | "video" | "model";

type PendingUpload = {
  tempId: string;
  file: File;
  status: "uploading" | "error";
  error?: string;
  // Local object URL so the tile can preview while uploading.
  previewUrl: string;
  kind: MediaKind;
  // 0–100, reported by direct-to-storage uploads. Undefined while the size is
  // still unknown or when the upload goes through the server path, which has
  // no progress events.
  progress?: number;
};

function detectKind(file: File): MediaKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".glb") || lower.endsWith(".gltf")) return "model";
  return "image";
}

function formatBytes(bytes?: number): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getFileExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext && ext !== filename.toLowerCase() ? ext : "";
}

function getDefaultUploadDescription(acceptTypes: MediaKind[]) {
  if (acceptTypes.length === 1 && acceptTypes[0] === "image") {
    return "Images only. Paste with Ctrl+V.";
  }
  if (acceptTypes.length === 1 && acceptTypes[0] === "video") {
    return "Videos only. Paste with Ctrl+V.";
  }
  if (acceptTypes.length === 1 && acceptTypes[0] === "model") {
    return "3D models only. Paste with Ctrl+V.";
  }
  if (acceptTypes.length === 2 && acceptTypes.includes("image") && acceptTypes.includes("video")) {
    return "Images and videos. Paste with Ctrl+V.";
  }
  return "Images, videos, and 3D models. Paste with Ctrl+V.";
}

export function MediaUploader({
  value,
  onChange,
  maxFiles = 10,
  acceptTypes = ["image", "video", "model"],
  accept,
  allowedFileExtensions,
  disabled = false,
  className,
  uploadTitle,
  uploadDescription,
  sizeGuide,
  uploadZoneClassName,
  mediaGridClassName,
  previewAspectRatio,
  previewFit = "cover",
  previewTileClassName,
  showCoverBadge = true,
  coverHint,
  aiGenerateAction,
  onEditWithAi,
  onGenerateAlt,
  allowExternalVideo = false,
  allowImageFit = false,
  hideUploadZoneWhenFull = true,
  showFileCount,
  maxImageSizeMB = 20,
  maxVideoSizeMB = 1024,
  maxModelSizeMB = 500,
}: MediaUploaderProps) {
  const t = useTranslations();
  const [isDragging, setIsDragging] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeMedia, setActiveMedia] = useState<UploadedMedia | null>(null);
  const [topLevelError, setTopLevelError] = useState<string | null>(null);
  const [isUrlDialogOpen, setIsUrlDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const normalizedAllowedExtensions = useMemo(
    () =>
      allowedFileExtensions?.map((ext) =>
        ext.replace(/^\./, "").toLowerCase(),
      ),
    [allowedFileExtensions],
  );
  const acceptString =
    accept ??
    (normalizedAllowedExtensions?.length
      ? normalizedAllowedExtensions.map((ext) => `.${ext}`).join(",")
      : acceptTypes.map((t) => ACCEPT_MAP[t]).join(","));
  const resolvedUploadTitle =
    uploadTitle ?? t("admin.productForm.media.dropzoneTitle");
  const resolvedUploadDescription =
    uploadDescription ??
    (acceptTypes.length === 3
      ? t("admin.productForm.media.dropzoneHelp")
      : getDefaultUploadDescription(acceptTypes));
  const resolvedCoverHint =
    coverHint === undefined
      ? t("admin.productForm.media.coverHint")
      : coverHint;
  const sortedValue = useMemo(
    () => [...value].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [value],
  );

  // Mirror of `value` that stays correct within a single tick. Uploads run in
  // parallel and each completion appends to the gallery; reading the captured
  // `value` prop there would give every completion the same pre-upload list,
  // so several finishing before the parent re-renders would each emit "old
  // list + my one item" and only the last one would survive.
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  /**
   * Emit a new gallery, renumbering positions, and advance the mirror
   * synchronously so anything else acting in the same tick (a sibling upload
   * finishing, a delete clicked while uploads are in flight) builds on this
   * list rather than the one before it.
   */
  const commitValue = useCallback(
    (next: UploadedMedia[]) => {
      const normalized = next.map((m, idx) => ({ ...m, position: idx }));
      valueRef.current = normalized;
      onChange(normalized);
    },
    [onChange],
  );

  /** The live gallery in display order — positions win over array order. */
  const currentOrder = useCallback(
    () =>
      [...valueRef.current].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [],
  );

  const appendMedia = useCallback(
    (item: UploadedMedia) => commitValue([...currentOrder(), item]),
    [commitValue, currentOrder],
  );
  const totalCount = sortedValue.length + pendingUploads.length;
  const remainingSlots = Math.max(0, maxFiles - totalCount);
  const shouldShowUploadZone = !hideUploadZoneWhenFull || remainingSlots > 0;
  const shouldShowFileCount = showFileCount ?? maxFiles > 1;

  // Reflect new value into selection: drop ids no longer present.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set<string>();
      const existing = new Set(value.map((m) => m._id));
      prev.forEach((id) => existing.has(id) && next.add(id));
      return next;
    });
  }, [value]);

  const validate = useCallback(
    (file: File): string | null => {
      const kind = detectKind(file);
      const sizeMB = file.size / 1024 / 1024;
      const limit =
        kind === "image"
          ? maxImageSizeMB
          : kind === "video"
            ? maxVideoSizeMB
            : maxModelSizeMB;
      if (sizeMB > limit) {
        return `File too large (${sizeMB.toFixed(1)}MB > ${limit}MB limit)`;
      }
      if (!acceptTypes.includes(kind)) {
        return `${kind} files are not allowed here`;
      }
      if (normalizedAllowedExtensions?.length) {
        const extension = getFileExtension(file.name);
        if (!extension || !normalizedAllowedExtensions.includes(extension)) {
          return `Only ${normalizedAllowedExtensions
            .map((ext) => ext.toUpperCase())
            .join(", ")} files are allowed`;
        }
      }
      return null;
    },
    [
      acceptTypes,
      maxImageSizeMB,
      maxVideoSizeMB,
      maxModelSizeMB,
      normalizedAllowedExtensions,
    ],
  );

  const uploadOne = useCallback(
    async (pending: PendingUpload) => {
      try {
        // Uploads go browser → R2/S3 directly when storage supports it, so
        // large files are not capped by the hosting platform's request-body
        // limit. Falls back to POST /api/upload transparently.
        const uploaded = await uploadFile(pending.file, {
          onProgress: (percent) =>
            setPendingUploads((prev) =>
              prev.map((p) =>
                p.tempId === pending.tempId ? { ...p, progress: percent } : p,
              ),
            ),
        });

        const item: UploadedMedia = {
          _id: uploaded._id,
          url: uploaded.url,
          // The uploader only accepts image/video/model, so the storage
          // pipeline's wider kind union (audio, document, unknown) cannot
          // occur here; fall back to the tile's own detection if it ever does.
          type:
            uploaded.type === "image" ||
            uploaded.type === "video" ||
            uploaded.type === "model"
              ? uploaded.type
              : pending.kind,
          mimeType: uploaded.mimeType,
          filename: uploaded.filename,
          size: uploaded.size,
          width: uploaded.width,
          height: uploaded.height,
          // Append at the end of the gallery preserving order of completion;
          // appendMedia renumbers every position afterwards.
          position: valueRef.current.length,
        };

        appendMedia(item);

        URL.revokeObjectURL(pending.previewUrl);
        setPendingUploads((prev) =>
          prev.filter((p) => p.tempId !== pending.tempId),
        );
      } catch (err) {
        setPendingUploads((prev) =>
          prev.map((p) =>
            p.tempId === pending.tempId
              ? {
                  ...p,
                  status: "error",
                  error:
                    err instanceof Error ? err.message : "Upload failed",
                }
              : p,
          ),
        );
      }
    },
    [appendMedia],
  );

  const enqueueFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files || disabled) return;
      const arr = Array.from(files);
      if (arr.length === 0) return;

      setTopLevelError(null);

      if (remainingSlots <= 0) {
        setTopLevelError(
          t("admin.productForm.media.maxFiles", { max: maxFiles }),
        );
        return;
      }

      const accepted: PendingUpload[] = [];
      const rejected: string[] = [];
      const withinLimit = arr.slice(0, remainingSlots);
      // Anything past the cap used to be dropped without a word, which reads
      // as "half my selection failed to upload".
      if (withinLimit.length < arr.length) {
        rejected.push(t("admin.productForm.media.maxFiles", { max: maxFiles }));
      }

      for (const file of withinLimit) {
        const error = validate(file);
        if (error) {
          rejected.push(`${file.name}: ${error}`);
          continue;
        }
        accepted.push({
          tempId: crypto.randomUUID(),
          file,
          status: "uploading",
          previewUrl: URL.createObjectURL(file),
          kind: detectKind(file),
        });
      }

      if (rejected.length > 0) {
        setTopLevelError(rejected.join(" · "));
      }
      if (accepted.length === 0) return;

      setPendingUploads((prev) => [...prev, ...accepted]);
      // Fire all uploads in parallel — each manages its own state.
      accepted.forEach((p) => {
        uploadOne(p);
      });
    },
    [disabled, maxFiles, remainingSlots, uploadOne, validate, t],
  );

  const handleRetry = useCallback(
    (tempId: string) => {
      const target = pendingUploads.find((p) => p.tempId === tempId);
      if (!target) return;
      setPendingUploads((prev) =>
        prev.map((p) =>
          p.tempId === tempId
            ? { ...p, status: "uploading", error: undefined, progress: undefined }
            : p,
        ),
      );
      uploadOne({ ...target, status: "uploading", error: undefined });
    },
    [pendingUploads, uploadOne],
  );

  const handleDismissPending = useCallback((tempId: string) => {
    setPendingUploads((prev) => {
      const target = prev.find((p) => p.tempId === tempId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.tempId !== tempId);
    });
  }, []);

  const handleAddExternalVideo = useCallback(
    (item: UploadedMedia) => {
      setTopLevelError(null);
      appendMedia(item);
    },
    [appendMedia],
  );

  const handleRemove = useCallback(
    (id: string) => {
      commitValue(currentOrder().filter((m) => m._id !== id));
    },
    [commitValue, currentOrder],
  );

  const handleBulkDelete = useCallback(() => {
    commitValue(currentOrder().filter((m) => !selected.has(m._id)));
    setSelected(new Set());
  }, [commitValue, currentOrder, selected]);

  const handleSetCover = useCallback(
    (id: string) => {
      const list = currentOrder();
      const target = list.find((m) => m._id === id);
      if (!target) return;
      commitValue([target, ...list.filter((m) => m._id !== id)]);
    },
    [commitValue, currentOrder],
  );

  const handleUpdateFit = useCallback(
    (id: string, fit: NonNullable<UploadedMedia["fit"]>) => {
      commitValue(
        currentOrder().map((m) => (m._id === id ? { ...m, fit } : m)),
      );
      setActiveMedia((curr) =>
        curr && curr._id === id ? { ...curr, fit } : curr,
      );
    },
    [commitValue, currentOrder],
  );

  const handleUpdateAlt = useCallback(
    (id: string, alt: string) => {
      commitValue(
        currentOrder().map((m) => (m._id === id ? { ...m, alt } : m)),
      );
      setActiveMedia((curr) =>
        curr && curr._id === id ? { ...curr, alt } : curr,
      );
    },
    [commitValue, currentOrder],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const list = currentOrder();
      const oldIndex = list.findIndex((m) => m._id === active.id);
      const newIndex = list.findIndex((m) => m._id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      commitValue(arrayMove(list, oldIndex, newIndex));
    },
    [commitValue, currentOrder],
  );

  // Drag-and-drop on the upload zone.
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      enqueueFiles(e.dataTransfer.files);
    },
    [enqueueFiles],
  );
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      enqueueFiles(e.target.files);
      e.target.value = "";
    },
    [enqueueFiles],
  );

  // Paste from clipboard support — listens globally only when the upload
  // zone is focused or hovered, to avoid hijacking pastes elsewhere on the
  // page.
  useEffect(() => {
    if (!shouldShowUploadZone) return;

    const handler = (e: ClipboardEvent) => {
      if (disabled) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        enqueueFiles(files);
      }
    };
    const node = dropZoneRef.current;
    if (!node) return;
    node.addEventListener("paste", handler as EventListener);
    return () => node.removeEventListener("paste", handler as EventListener);
  }, [disabled, enqueueFiles, shouldShowUploadZone]);

  // Cleanup any object URLs left over on unmount. Read through a ref: an
  // empty dependency list would otherwise capture the pending list as it was
  // on mount (always empty), leaking the previews of uploads still in flight
  // when the form is closed.
  const pendingUploadsRef = useRef<PendingUpload[]>([]);
  useEffect(() => {
    pendingUploadsRef.current = pendingUploads;
  }, [pendingUploads]);
  useEffect(() => {
    return () => {
      pendingUploadsRef.current.forEach((p) =>
        URL.revokeObjectURL(p.previewUrl),
      );
    };
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className={cn("space-y-4", className)}>
      {aiGenerateAction ? (
        <div className="flex justify-end">{aiGenerateAction}</div>
      ) : null}

      {/* Bulk action bar — only when something is selected */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
          <span className="text-sm font-medium">
            {t("admin.productForm.media.selected", {
              count: selected.size,
            })}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              {t("common.clear")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              {t("admin.productForm.media.deleteSelected")}
            </Button>
          </div>
        </div>
      )}

      {shouldShowUploadZone ? (
        <div
          ref={dropZoneRef}
          tabIndex={0}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={cn(
            "relative rounded-lg border-2 border-dashed p-6 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isDragging
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50",
            disabled && "pointer-events-none opacity-50",
            uploadZoneClassName,
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple={remainingSlots > 1}
            accept={acceptString}
            onChange={handleFileSelect}
            disabled={disabled}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
          <div className="flex flex-col items-center justify-center gap-2 text-center">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{resolvedUploadTitle}</p>
              {resolvedUploadDescription ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {resolvedUploadDescription}
                </p>
              ) : null}
              {sizeGuide ? (
                <p className="mt-1 text-xs font-medium text-muted-foreground">
                  {sizeGuide}
                </p>
              ) : null}
            </div>
            {allowExternalVideo && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                // Above the invisible file input so the click doesn't open
                // the file picker.
                className="relative z-10 mt-1 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setIsUrlDialogOpen(true)}
              >
                <Video className="mr-1.5 h-3.5 w-3.5" />
                {t("admin.productForm.media.embedVideo")}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {topLevelError && (
        <p className="flex items-center gap-1 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {topLevelError}
        </p>
      )}

      {/* Media grid (sortable) + pending tiles */}
      {(sortedValue.length > 0 || pendingUploads.length > 0) && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortedValue.map((m) => m._id)}
            strategy={rectSortingStrategy}
          >
            <div
              className={cn(
                "grid grid-cols-2 gap-3 md:grid-cols-4",
                mediaGridClassName,
              )}
            >
              {sortedValue.map((media, idx) => (
                <SortableTile
                  key={media._id}
                  media={media}
                  isCover={idx === 0}
                  isSelected={selected.has(media._id)}
                  previewAspectRatio={previewAspectRatio}
                  previewFit={previewFit}
                  previewTileClassName={previewTileClassName}
                  showCoverBadge={showCoverBadge}
                  onToggleSelect={() => toggleSelect(media._id)}
                  onOpen={() => setActiveMedia(media)}
                  onRemove={() => handleRemove(media._id)}
                  onSetCover={() => handleSetCover(media._id)}
                  onEditWithAi={onEditWithAi}
                />
              ))}
              {pendingUploads.map((pending) => (
                <PendingTile
                  key={pending.tempId}
                  pending={pending}
                  previewAspectRatio={previewAspectRatio}
                  previewFit={previewFit}
                  previewTileClassName={previewTileClassName}
                  onRetry={() => handleRetry(pending.tempId)}
                  onDismiss={() => handleDismissPending(pending.tempId)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {shouldShowFileCount ? (
        <p className="text-xs text-muted-foreground">
          {t("admin.productForm.media.fileCount", {
            count: totalCount,
            max: maxFiles,
          })}
          {sortedValue.length > 0 && resolvedCoverHint && (
            <span> · {resolvedCoverHint}</span>
          )}
        </p>
      ) : null}

      {allowExternalVideo && (
        <ExternalVideoUrlDialog
          open={isUrlDialogOpen}
          onOpenChange={setIsUrlDialogOpen}
          canAdd={remainingSlots > 0}
          maxFiles={maxFiles}
          onAdd={handleAddExternalVideo}
        />
      )}

      {/* Detail / edit modal */}
      <MediaDetailModal
        media={activeMedia}
        onClose={() => setActiveMedia(null)}
        onUpdateAlt={handleUpdateAlt}
        onUpdateFit={allowImageFit ? handleUpdateFit : undefined}
        onDelete={(id) => {
          handleRemove(id);
          setActiveMedia(null);
        }}
        onSetCover={(id) => {
          handleSetCover(id);
          setActiveMedia(null);
        }}
        onEditWithAi={
          onEditWithAi
            ? (media) => {
                onEditWithAi(media);
                setActiveMedia(null);
              }
            : undefined
        }
        onGenerateAlt={onGenerateAlt}
        canSetCover={
          activeMedia
            ? sortedValue[0]?._id !== activeMedia._id
            : false
        }
      />
    </div>
  );
}

function ExternalVideoUrlDialog({
  open,
  onOpenChange,
  canAdd,
  maxFiles,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canAdd: boolean;
  maxFiles: number;
  onAdd: (item: UploadedMedia) => void;
}) {
  const t = useTranslations();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setUrl("");
      setError(null);
      setIsAdding(false);
    }
    onOpenChange(nextOpen);
  };

  const handleAdd = async () => {
    if (isAdding) return;
    if (!canAdd) {
      setError(t("admin.productForm.media.maxFiles", { max: maxFiles }));
      return;
    }
    const parsed = parseExternalVideoUrl(url);
    if (!parsed) {
      setError(t("admin.productForm.media.videoUrlInvalid"));
      return;
    }
    setError(null);
    setIsAdding(true);
    // Vimeo thumbnails need an oEmbed lookup; a failure still adds the video,
    // it just renders with a generic play tile.
    const thumbnailUrl =
      parsed.thumbnailUrl ?? (await fetchVimeoThumbnailUrl(parsed.url)) ?? undefined;
    onAdd({
      _id: crypto.randomUUID(),
      type: "external_video",
      url: parsed.url,
      mimeType: `external/${parsed.provider}`,
      provider: parsed.provider,
      embedId: parsed.embedId,
      thumbnailUrl,
    });
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("admin.productForm.media.embedVideo")}</DialogTitle>
          <DialogDescription>
            {t("admin.productForm.media.embedVideoHelp")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="https://www.youtube.com/watch?v=…"
            autoFocus
          />
          {error && (
            <p className="flex items-center gap-1 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={isAdding || !url.trim()}
          >
            {isAdding && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {t("admin.productForm.media.addVideo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaTypeIcon({ type }: { type: UploadedMedia["type"] }) {
  if (type === "video" || type === "external_video")
    return <Video className="h-3.5 w-3.5" />;
  if (type === "model") return <Box className="h-3.5 w-3.5" />;
  return <ImageIcon className="h-3.5 w-3.5" />;
}

function MediaThumb({
  media,
  fit = "cover",
  className,
}: {
  media: UploadedMedia;
  fit?: "cover" | "contain";
  className?: string;
}) {
  const objectFitClass = fit === "contain" ? "object-contain" : "object-cover";

  if (media.type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- uploader tiles show blob: previews and any storage host, and measure natural size
      <img
        src={media.url}
        alt={media.alt || ""}
        className={cn("h-full w-full", objectFitClass, className)}
      />
    );
  }
  if (media.type === "video") {
    return (
      <video
        src={media.url}
        muted
        playsInline
        className={cn("h-full w-full", objectFitClass, className)}
      />
    );
  }
  if (media.type === "external_video") {
    return (
      <div className={cn("relative h-full w-full bg-muted", className)}>
        {media.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploader tiles show blob: previews and any storage host, and measure natural size
          <img
            src={media.thumbnailUrl}
            alt={media.alt || ""}
            className={cn("h-full w-full", objectFitClass)}
          />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/85 shadow-sm">
            <Play className="ml-px h-4 w-4 fill-current" />
          </span>
        </span>
      </div>
    );
  }
  // 3D model — interactive viewer.
  return (
    <ModelViewer
      src={media.url}
      alt={media.alt || media.filename || "3D model"}
      className={className}
      // In the small grid tile, show preview without forcing user interaction.
      autoRotate
      cameraControls={false}
    />
  );
}

function SortableTile({
  media,
  isCover,
  isSelected,
  onToggleSelect,
  onOpen,
  onRemove,
  onSetCover,
  onEditWithAi,
  previewAspectRatio,
  previewFit,
  previewTileClassName,
  showCoverBadge,
}: {
  media: UploadedMedia;
  isCover: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onRemove: () => void;
  onSetCover: () => void;
  onEditWithAi?: (media: UploadedMedia) => void;
  previewAspectRatio?: string;
  previewFit: "cover" | "contain";
  previewTileClassName?: string;
  showCoverBadge: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: media._id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    aspectRatio: previewAspectRatio,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted",
        !previewAspectRatio && "aspect-square",
        isDragging && "z-10 opacity-60 shadow-lg",
        isSelected && "ring-2 ring-primary",
        previewTileClassName,
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 h-full w-full"
        aria-label="Open media details"
      >
        <MediaThumb media={media} fit={previewFit} />
      </button>

      {/* Drag handle (top-right, only on hover so it doesn't fight checkbox) */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute right-2 top-2 z-10 cursor-grab rounded bg-background/80 p-1 opacity-0 backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100 active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Selection checkbox (top-left) */}
      <label
        className={cn(
          "absolute left-2 top-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded border bg-background/80 backdrop-blur-sm transition-opacity",
          isSelected
            ? "border-primary opacity-100"
            : "border-input opacity-0 group-hover:opacity-100",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          className="peer sr-only"
        />
        {isSelected && (
          <svg
            viewBox="0 0 12 12"
            className="h-3 w-3 fill-none stroke-primary stroke-[2]"
          >
            <path d="M2 6.5l3 3 5-7" strokeLinecap="round" />
          </svg>
        )}
      </label>

      {/* Cover badge (bottom-left, persistent) */}
      {showCoverBadge && isCover && (
        <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1 rounded bg-foreground/85 px-1.5 py-0.5 text-[10px] font-medium text-background backdrop-blur-sm">
          <Star className="h-3 w-3 fill-current" />
          Cover
        </div>
      )}

      {/* Type badge (bottom-right) */}
      <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] backdrop-blur-sm">
        <MediaTypeIcon type={media.type} />
      </div>

      {/* Quick actions row — appears on hover, doesn't block click-to-open */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center gap-1 bg-gradient-to-b from-black/50 to-transparent px-2 py-2 opacity-0 transition-opacity group-hover:opacity-100">
        {onEditWithAi && media.type === "image" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditWithAi(media);
            }}
            className="pointer-events-auto flex items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium hover:bg-background"
            aria-label="Edit with AI"
          >
            <Wand2 className="h-3 w-3" />
            Edit
          </button>
        )}
        {!isCover && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetCover();
            }}
            className="pointer-events-auto rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium hover:bg-background"
          >
            Set as cover
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="pointer-events-auto rounded bg-destructive/90 px-1 py-0.5 text-destructive-foreground hover:bg-destructive"
          aria-label="Delete"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function PendingTile({
  pending,
  onRetry,
  onDismiss,
  previewAspectRatio,
  previewFit,
  previewTileClassName,
}: {
  pending: PendingUpload;
  onRetry: () => void;
  onDismiss: () => void;
  previewAspectRatio?: string;
  previewFit: "cover" | "contain";
  previewTileClassName?: string;
}) {
  const isError = pending.status === "error";
  return (
    <div
      style={{ aspectRatio: previewAspectRatio }}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-muted",
        !previewAspectRatio && "aspect-square",
        isError && "border-destructive",
        previewTileClassName,
      )}
    >
      {pending.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- uploader tiles show blob: previews and any storage host, and measure natural size
        <img
          src={pending.previewUrl}
          alt=""
          className={cn(
            "h-full w-full opacity-60",
            previewFit === "contain" ? "object-contain" : "object-cover",
          )}
        />
      ) : pending.kind === "video" ? (
        <video
          src={pending.previewUrl}
          muted
          playsInline
          className={cn(
            "h-full w-full opacity-60",
            previewFit === "contain" ? "object-contain" : "object-cover",
          )}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Box className="h-12 w-12 text-muted-foreground" />
        </div>
      )}

      <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-[1px]">
        {!isError ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="mt-2 text-xs font-medium">
              {typeof pending.progress === "number"
                ? `Uploading… ${pending.progress}%`
                : "Uploading…"}
            </p>
            <p className="mt-0.5 truncate px-2 text-[10px] text-muted-foreground">
              {pending.file.name}
            </p>
            {typeof pending.progress === "number" && (
              <div
                role="progressbar"
                aria-valuenow={pending.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Uploading ${pending.file.name}`}
                className="mt-2 h-1 w-3/4 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${pending.progress}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="mt-2 text-xs font-medium">Upload failed</p>
            <p className="mt-0.5 truncate px-2 text-[10px] text-muted-foreground">
              {pending.error}
            </p>
            <div className="mt-2 flex gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={onRetry}
              >
                <RefreshCw className="mr-1 h-3 w-3" /> Retry
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={onDismiss}
              >
                Dismiss
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MediaDetailModal({
  media,
  onClose,
  onUpdateAlt,
  onUpdateFit,
  onDelete,
  onSetCover,
  onEditWithAi,
  onGenerateAlt,
  canSetCover,
}: {
  media: UploadedMedia | null;
  onClose: () => void;
  onUpdateAlt: (id: string, alt: string) => void;
  onUpdateFit?: (id: string, fit: NonNullable<UploadedMedia["fit"]>) => void;
  onDelete: (id: string) => void;
  onSetCover: (id: string) => void;
  onEditWithAi?: (media: UploadedMedia) => void;
  onGenerateAlt?: (media: UploadedMedia) => Promise<string | null>;
  canSetCover: boolean;
}) {
  const [naturalDims, setNaturalDims] = useState<{
    mediaId: string;
    w: number;
    h: number;
  } | null>(null);
  const [generatingAlt, setGeneratingAlt] = useState(false);

  const generateAlt = async (target: UploadedMedia) => {
    if (!onGenerateAlt || generatingAlt) return;
    setGeneratingAlt(true);
    try {
      const alt = await onGenerateAlt(target);
      if (alt) onUpdateAlt(target._id, alt);
    } finally {
      setGeneratingAlt(false);
    }
  };

  if (!media) return null;

  const currentNaturalDims =
    naturalDims?.mediaId === media._id ? naturalDims : null;

  return (
    <Dialog open={!!media} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">
            {media.filename || "Media details"}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted">
            {media.type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- uploader tiles show blob: previews and any storage host, and measure natural size
              <img
                src={media.url}
                alt={media.alt || ""}
                onLoad={(e) =>
                  setNaturalDims({
                    mediaId: media._id,
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
                className="max-h-full max-w-full object-contain"
              />
            ) : media.type === "video" ? (
              <video
                src={media.url}
                controls
                className="max-h-full max-w-full"
              />
            ) : media.type === "external_video" &&
              media.provider &&
              media.embedId ? (
              <div className="relative h-full w-full">
                <ExternalVideoPlayer
                  provider={media.provider}
                  embedId={media.embedId}
                  title={media.alt || media.filename || "External video"}
                  thumbnailUrl={media.thumbnailUrl}
                />
              </div>
            ) : (
              // Full interactive 3D viewer in the modal — drag to rotate,
              // scroll to zoom.
              <ModelViewer
                src={media.url}
                alt={media.alt || media.filename || "3D model"}
                autoRotate
                cameraControls
              />
            )}
          </div>

          <div className="space-y-4">
            {media.type === "image" && (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Alt text
                  </label>
                  {onGenerateAlt ? (
                    <button
                      type="button"
                      disabled={generatingAlt}
                      onClick={() => generateAlt(media)}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-60"
                    >
                      {generatingAlt ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Sparkles className="h-3 w-3" />
                      )}
                      Write with AI
                    </button>
                  ) : null}
                </div>
                <textarea
                  value={media.alt || ""}
                  onChange={(e) => onUpdateAlt(media._id, e.target.value)}
                  placeholder="Describe this image for screen readers and SEO"
                  rows={3}
                  className="mt-1 w-full rounded-md border bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                {!media.alt && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Alt text helps screen readers and search engines.
                  </p>
                )}
              </div>
            )}

            {onUpdateFit && media.type === "image" ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  Fit on the product page
                </p>
                <div
                  role="radiogroup"
                  aria-label="Fit on the product page"
                  className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1"
                >
                  {(
                    [
                      { value: "auto", label: "Auto" },
                      { value: "contain", label: "Fit" },
                      { value: "cover", label: "Fill" },
                    ] as const
                  ).map((option) => {
                    const selected = (media.fit ?? "auto") === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onUpdateFit(media._id, option.value)}
                        className={cn(
                          "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                          selected
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {media.fit === "cover"
                    ? "Fills the frame edge to edge — for lifestyle and model shots."
                    : media.fit === "contain"
                      ? "Floats inside the frame with padding — for cut-outs on a transparent background."
                      : "Follows the product page's Image fit setting."}
                </p>
              </div>
            ) : null}

            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Type</dt>
                <dd className="font-medium capitalize">{media.type}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Format</dt>
                <dd className="font-medium uppercase">
                  {media.mimeType.split("/")[1] || "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Size</dt>
                <dd className="font-medium">{formatBytes(media.size)}</dd>
              </div>
              {(currentNaturalDims || (media.width && media.height)) && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Dimensions</dt>
                  <dd className="font-medium">
                    {currentNaturalDims
                      ? `${currentNaturalDims.w} × ${currentNaturalDims.h}`
                      : `${media.width} × ${media.height}`}
                  </dd>
                </div>
              )}
            </dl>

            <div className="space-y-2 pt-2">
              {onEditWithAi && media.type === "image" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onEditWithAi(media)}
                >
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                  Edit with AI
                </Button>
              )}
              {canSetCover && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onSetCover(media._id)}
                >
                  <Star className="mr-1.5 h-3.5 w-3.5" />
                  Set as cover
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={() => onDelete(media._id)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
