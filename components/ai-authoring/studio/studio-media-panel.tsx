"use client";

import type { ReactNode } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SCRATCH_KEY, type StudioImage, type StudioSession } from "./types";
import { useStudioStrings } from "./use-studio-strings";
import { AppImage } from "@/components/ui/app-image";

/**
 * The Media panel body: upload tile, the scratch (AI-generated) image when one
 * exists, and the grid images with an "Edited" badge on touched sessions.
 * Rendered in the desktop left column and reused verbatim in the below-lg
 * sheet so behavior stays identical.
 */
export function StudioMediaGrid({
  images,
  sessions,
  selectedKey,
  scratchUrl,
  busy,
  uploading,
  onUploadClick,
  onSelect,
}: {
  images: StudioImage[];
  sessions: Record<string, StudioSession>;
  selectedKey: string | null;
  scratchUrl: string | null;
  busy: boolean;
  uploading: boolean;
  onUploadClick: () => void;
  onSelect: (key: string, url: string) => void;
}) {
  const strings = useStudioStrings();
  return (
    <div className="grid grid-cols-2 content-start gap-3">
      <button
        type="button"
        disabled={uploading || busy}
        onClick={onUploadClick}
        className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-[8px] border bg-muted/30 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <ImagePlus className="h-5 w-5 text-primary" />
        )}
        <span className="px-1 text-[10px] font-medium leading-tight">
          {strings.uploadImage}
        </span>
      </button>
      {scratchUrl ? (
        <MediaTile
          url={scratchUrl}
          alt="AI generated image"
          selected={selectedKey === SCRATCH_KEY}
          badge={strings.badgeAi}
          disabled={busy}
          onClick={() => onSelect(SCRATCH_KEY, scratchUrl)}
        />
      ) : null}
      {images.map((image) => (
        <MediaTile
          key={image._id}
          url={image.url}
          alt={image.alt || ""}
          selected={selectedKey === image._id}
          badge={
            (sessions[image._id]?.versions.length ?? 0) > 1
              ? strings.badgeEdited
              : undefined
          }
          disabled={busy}
          onClick={() => onSelect(image._id, image.url)}
        />
      ))}
    </div>
  );
}

function MediaTile({
  url,
  alt,
  selected,
  badge,
  disabled,
  onClick,
}: {
  url: string;
  alt: string;
  selected: boolean;
  badge?: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        "relative aspect-square overflow-hidden rounded-[8px] border bg-white transition-all disabled:pointer-events-none disabled:opacity-60 dark:bg-muted",
        selected
          ? "border-2 border-primary"
          : "hover:border-muted-foreground/40",
      )}
    >
      <AppImage
        src={url}
        alt={alt}
        fill
        sizes="160px"
        draggable={false}
        className="object-contain p-1"
      />
      {badge ? (
        <span className="absolute bottom-1 left-1 rounded bg-primary px-1.5 py-0.5 text-[9px] font-semibold text-primary-foreground">
          {badge}
        </span>
      ) : null}
    </button>
  );
}
