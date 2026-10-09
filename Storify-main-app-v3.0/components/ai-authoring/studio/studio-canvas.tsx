"use client";

import type { CSSProperties } from "react";
import {
  EyeOff,
  ImagePlus,
  Loader2,
  Minus,
  Plus,
  Scan,
  Sparkles,
  SquareSplitHorizontal,
  Store,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  getStudioArtboard,
  type AiStudioSurface,
} from "@/components/ai-authoring/studio-surface";
import {
  StorefrontCardPreview,
  type StudioPreviewProduct,
} from "@/components/ai-authoring/storefront-card-preview";
import { type StudioViewportApi } from "./use-studio-viewport";
import { useStudioStrings } from "./use-studio-strings";

const CHECKERBOARD: CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, #d4d4d8 25%, transparent 25%), linear-gradient(-45deg, #d4d4d8 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d4d4d8 75%), linear-gradient(-45deg, transparent 75%, #d4d4d8 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
  backgroundColor: "#fafafa",
};

/**
 * The canvas card: the toolbar (zoom, fit, compare, peek, storefront preview,
 * delete, sheet openers, Cancel/Save) over the stage (empty state, storefront
 * card preview, compare slider, or the pannable artboard, with the busy
 * overlay). All view state comes from `useStudioViewport` via `view`.
 */
export function StudioCanvasCard({
  view,
  surface,
  busy,
  uploading,
  displayedUrl,
  currentUrl,
  originalUrl,
  transparent,
  alt,
  canCompare,
  cardPreviewEnabled,
  previewProduct,
  onTogglePreview,
  canDeleteSelected,
  onDeleteSelected,
  onUploadClick,
  onOpenMediaSheet,
  onOpenPresetsSheet,
  onCancel,
  onSave,
  saveLabel,
  saveDisabled,
  previewFilter,
  vignetteBg,
}: {
  view: StudioViewportApi;
  surface: AiStudioSurface;
  busy: string | null;
  uploading: boolean;
  displayedUrl: string | null;
  currentUrl: string | null;
  originalUrl: string | undefined;
  transparent: boolean;
  alt: string | undefined;
  canCompare: boolean;
  cardPreviewEnabled: boolean;
  previewProduct: StudioPreviewProduct | null;
  onTogglePreview: () => void;
  canDeleteSelected: boolean;
  onDeleteSelected: () => void;
  onUploadClick: () => void;
  onOpenMediaSheet: () => void;
  onOpenPresetsSheet: () => void;
  onCancel: () => void;
  onSave: () => void;
  saveLabel: string;
  saveDisabled: boolean;
  previewFilter: string | undefined;
  vignetteBg: string | undefined;
}) {
  const {
    zoom,
    pan,
    dims,
    compare,
    setCompare,
    comparePos,
    peek,
    setPeek,
    showCompare,
    artboard,
    fitScale,
    viewportRef,
    compareBoxRef,
    recordDims,
  } = view;
  const strings = useStudioStrings();
  const zoomDisabled = !dims || !!busy;
  // Cap for the transient "measuring" fallback image, before natural dimensions
  // are known. Per-surface via its artboard so a wide surface (hero, blog)
  // doesn't render as a tiny square; default media keeps the 320px cap.
  const fallbackCap = getStudioArtboard(surface, { w: 1, h: 1 }).maxDisplayWidth;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border bg-card shadow-sm">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 overflow-x-auto px-2.5">
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center rounded-lg border bg-card">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-r-none"
              disabled={zoomDisabled}
              onClick={view.zoomOut}
              aria-label={strings.zoomOut}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-12 select-none text-center text-xs font-medium tabular-nums">
              {dims ? `${Math.round(zoom * 100)}%` : "—"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-l-none"
              disabled={zoomDisabled}
              onClick={view.zoomIn}
              aria-label={strings.zoomIn}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            disabled={zoomDisabled}
            onClick={view.fitToScreen}
          >
            <Scan className="h-4 w-4" />
            {strings.fit}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5",
              compare &&
                canCompare &&
                "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            )}
            disabled={!canCompare || !!busy}
            onClick={() => setCompare(!compare)}
            aria-pressed={compare && canCompare}
          >
            <SquareSplitHorizontal className="h-4 w-4" />
            {strings.compare}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={!canCompare || !!busy}
            onPointerDown={() => setPeek(true)}
            onPointerUp={() => setPeek(false)}
            onPointerLeave={() => setPeek(false)}
            onPointerCancel={() => setPeek(false)}
            title={strings.holdToViewOriginal}
            aria-label={strings.holdToViewOriginal}
          >
            <EyeOff className="h-4 w-4" />
          </Button>
          {cardPreviewEnabled ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn(
                    "h-8 w-8",
                    previewProduct &&
                      "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                  )}
                  disabled={!currentUrl || !!busy}
                  onClick={onTogglePreview}
                  aria-pressed={!!previewProduct}
                  aria-label={strings.previewAsCard}
                >
                  <Store className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent
                side="bottom"
                sideOffset={6}
                className="flex max-w-[240px] flex-col gap-1 px-3 py-2.5"
              >
                <span className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Store className="h-3.5 w-3.5 shrink-0" />
                  {previewProduct ? strings.exitPreview : strings.previewAsCard}
                </span>
                <span className="text-[11px] leading-snug text-background/70">
                  {strings.previewCardHint}
                </span>
              </TooltipContent>
            </Tooltip>
          ) : null}
          {canDeleteSelected ? (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              disabled={!!busy}
              onClick={onDeleteSelected}
              title={strings.deleteImage}
              aria-label={strings.deleteImage}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 lg:hidden"
            onClick={onOpenMediaSheet}
            aria-label={strings.openMediaPanel}
            title={strings.mediaTitle}
          >
            <ImagePlus className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 lg:hidden"
            onClick={onOpenPresetsSheet}
            aria-label={strings.openQuickPrompts}
            title={strings.quickPromptTitle}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-4"
            onClick={onCancel}
          >
            {strings.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 px-5"
            disabled={saveDisabled}
            onClick={onSave}
          >
            {saveLabel}
          </Button>
        </div>
      </div>

      {/* Stage */}
      <div
        ref={viewportRef}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden bg-muted",
          !showCompare &&
            !previewProduct &&
            dims &&
            "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={view.onCanvasPointerDown}
        onPointerMove={view.onCanvasPointerMove}
        onPointerUp={view.onCanvasPointerUp}
        onPointerCancel={view.onCanvasPointerUp}
      >
        {!displayedUrl ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border bg-card text-muted-foreground">
              <ImagePlus className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium">{strings.noImageTitle}</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                {strings.noImageBody}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={uploading}
              onClick={onUploadClick}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
              {strings.uploadImageAction}
            </Button>
          </div>
        ) : previewProduct ? (
          // Storefront-card preview — the current image inside a real product
          // card, driven by the product being edited, so the vendor sees
          // exactly how their card will look. Hover reveals the same actions
          // (Add to Cart / Choose options + Quick view).
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto bg-white p-6">
            <div className="w-full max-w-[260px]">
              <StorefrontCardPreview
                imageUrl={displayedUrl}
                alt={alt}
                product={previewProduct}
              />
            </div>
          </div>
        ) : showCompare && dims && originalUrl ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div
              ref={compareBoxRef}
              className="relative touch-none select-none overflow-hidden rounded-md shadow-md ring-1 ring-black/5"
              style={{
                width: Math.max(1, (artboard?.w || 1) * fitScale),
                height: Math.max(1, (artboard?.h || 1) * fitScale),
              }}
              onPointerDown={view.onComparePointerDown}
              onPointerMove={view.onComparePointerMove}
              onPointerUp={view.onComparePointerUp}
              onPointerCancel={view.onComparePointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the editor measures naturalWidth/Height of blob: and data: URLs */}
              <img
                src={currentUrl ?? undefined}
                alt="Edited result"
                draggable={false}
                onLoad={recordDims(currentUrl)}
                className="h-full w-full bg-white object-contain"
                style={transparent ? CHECKERBOARD : undefined}
              />
              <div
                className="absolute inset-0"
                style={{
                  clipPath: `inset(0 ${100 - comparePos}% 0 0)`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- the editor measures naturalWidth/Height of blob: and data: URLs */}
                <img
                  src={originalUrl}
                  alt="Original"
                  draggable={false}
                  onLoad={recordDims(originalUrl)}
                  className="h-full w-full bg-white object-contain"
                />
              </div>
              <span className="absolute left-2 top-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-background">
                {strings.before}
              </span>
              <span className="absolute right-2 top-2 rounded bg-foreground/80 px-1.5 py-0.5 text-[10px] font-medium text-background">
                {strings.after}
              </span>
              <div
                className="absolute bottom-0 top-0 z-10 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)]"
                style={{ left: `${comparePos}%` }}
              >
                <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border bg-white text-foreground shadow-md">
                  <SquareSplitHorizontal className="h-3.5 w-3.5" />
                </div>
              </div>
            </div>
          </div>
        ) : dims ? (
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: Math.max(1, (artboard?.w || 1) * zoom),
              height: Math.max(1, (artboard?.h || 1) * zoom),
              transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
            }}
          >
            <div
              className="relative h-full w-full bg-white shadow-md ring-1 ring-black/5"
              style={transparent && !peek ? CHECKERBOARD : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the editor measures naturalWidth/Height of blob: and data: URLs */}
              <img
                src={displayedUrl}
                alt={alt || "Image"}
                draggable={false}
                onLoad={recordDims(displayedUrl)}
                className="h-full w-full select-none object-contain"
                style={previewFilter ? { filter: previewFilter } : undefined}
              />
              {vignetteBg ? (
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{ background: vignetteBg }}
                />
              ) : null}
            </div>
          </div>
        ) : (
          // Dimensions unknown yet — render fitted while we measure.
          <div className="absolute inset-0 flex items-center justify-center p-8">
            {/* eslint-disable-next-line @next/next/no-img-element -- the editor measures naturalWidth/Height of blob: and data: URLs */}
            <img
              src={displayedUrl}
              alt={alt || "Image"}
              draggable={false}
              onLoad={recordDims(displayedUrl)}
              className="max-h-full max-w-full select-none bg-white object-contain shadow-md ring-1 ring-black/5"
              style={{
                maxWidth: fallbackCap,
                maxHeight: fallbackCap,
                filter: previewFilter,
              }}
            />
          </div>
        )}

        {peek && displayedUrl ? (
          <span className="absolute left-3 top-3 rounded-md bg-foreground/80 px-2 py-1 text-[11px] font-medium text-background">
            {strings.original}
          </span>
        ) : null}

        {busy ? (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/60 backdrop-blur-[2px]">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card shadow-md">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </span>
            <div className="text-center">
              <p className="text-sm font-medium">{busy}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {strings.busyHint}
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
