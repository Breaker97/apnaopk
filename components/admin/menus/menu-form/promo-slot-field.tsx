"use client";

/**
 * The mega menu's promo image slots.
 *
 * These used to be the generic `ImageUploadField`: a 48px square thumbnail, a
 * URL box and three same-sized buttons crammed into the 330px inspector. None
 * of that told an author the one thing that actually matters here — the
 * storefront draws promo art in two very particular frames (a 3.54:1 letterbox
 * strip under the columns, a 3:5 portrait beside them) and *covers* rather than
 * stretches, so art authored at the wrong ratio quietly loses its edges.
 *
 * So the slot is the frame. Each tile carries its frame's exact aspect ratio,
 * previews with object-cover the way the storefront does, doubles as the drop
 * target, and states in a chip how much cover is about to trim. Everything else
 * steps back: the URL box only appears when it is asked for, and Remove drops
 * to a quiet icon at the far end of the strip so it stops competing with the
 * two controls that create an image.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import { Check, Crop, ImageIcon, ImageUp, Link2, Upload, X } from "lucide-react";
import { AppImage } from "@/components/ui/app-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiStudioImageField } from "@/components/ai-authoring/ai-studio-image-field";
import {
  MEGA_MENU_BOTTOM_PROMO_STUDIO,
  MEGA_MENU_PROMO_STUDIO,
} from "@/components/ai-authoring/mega-menu-promo-ai-studio";
import { MEGA_BOTTOM_PROMO_CARDS } from "@/lib/site-config/menu-depth";
import {
  PROMO_FRAMES,
  getPromoFit,
  type PromoFit,
  type PromoFrame,
} from "@/lib/ai-authoring/mega-menu-promo/fit";
import {
  getMegaPromoImages,
  getPreviewPromoImage,
  pathKey,
  type MenuItem,
} from "@/components/admin/menus/menu-form/helpers";
import { cn } from "@/lib/utils";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

type ImageSize = { width: number; height: number };

/**
 * Natural pixel size of the committed image, probed separately rather than off
 * the rendered `<img>`: `AppImage` owns its own `onLoad`, and next/image may be
 * serving a resized variant anyway. The browser cache makes the second request
 * free in practice.
 */
function useImageSize(url: string): ImageSize | null {
  const [size, setSize] = useState<ImageSize | null>(null);

  useApplyOnChange([url], () => {
    if (!url.trim()) setSize(null);
  });

  useEffect(() => {
    const src = url.trim();
    if (!src) return;

    let live = true;
    const probe = new window.Image();
    probe.onload = () => {
      if (live) {
        setSize({ width: probe.naturalWidth, height: probe.naturalHeight });
      }
    };
    // A URL that cannot load has no ratio to report; the tile's own fallback
    // already tells the author the image is missing.
    probe.onerror = () => {
      if (live) setSize(null);
    };
    probe.src = src;

    return () => {
      live = false;
    };
  }, [url]);

  return size;
}

function fileNameFrom(url: string) {
  const trimmed = url.trim();
  // A data URI has no name, and its payload would fill the strip with base64.
  if (trimmed.startsWith("data:")) return "Pasted image";
  const path = trimmed.split(/[?#]/)[0];
  const last = path.split("/").pop() || "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

type UploadResponse = {
  success?: boolean;
  message?: unknown;
  data?: unknown;
};

type UploadedFile = { url?: unknown };

/**
 * One promo slot: the frame, and the strip of controls under it.
 *
 * `aiStudio` is a node rather than a prop bundle so the caller keeps ownership
 * of the studio wiring (each frame generates at a different size and crops to a
 * different ratio) while the slot decides where the launcher sits.
 */
function PromoSlotField({
  frame,
  label,
  index,
  value,
  onChange,
  alt,
  emptyHint,
  aiStudio,
  disabled,
}: {
  frame: PromoFrame;
  /** Accessible name for the slot's controls, e.g. "Card 1 image". */
  label: string;
  /** 1-based badge drawn on the tile; omitted when the frame is alone. */
  index?: number;
  value: string;
  onChange: (value: string) => void;
  alt: string;
  /** What the empty tile invites the author to do. */
  emptyHint: string;
  aiStudio?: ReactNode;
  disabled?: boolean;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef<XMLHttpRequest | null>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);

  const size = useImageSize(value);
  const fit = getPromoFit(size, frame);
  const isUploading = progress !== null;
  const isBusy = Boolean(disabled) || isUploading;

  // An in-flight upload holds a reference to this component's state setters, so
  // it has to be dropped when the inspector switches to another item.
  useEffect(() => {
    return () => requestRef.current?.abort();
  }, []);

  const uploadFile = useCallback(
    (file: File) => {
      const looksLikeImage =
        file.type.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.name);
      if (!looksLikeImage) {
        setError("That is not an image file. Pick a JPG, PNG or WebP.");
        return;
      }

      setError(null);
      setProgress(0);

      const body = new FormData();
      body.append("files", file);

      // XHR rather than fetch: the tile shows real progress, which is the whole
      // reason an author can tell a slow upload from a stuck one.
      const request = new XMLHttpRequest();
      requestRef.current = request;

      request.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        setProgress(Math.round((event.loaded / event.total) * 100));
      });

      request.addEventListener("load", () => {
        requestRef.current = null;
        setProgress(null);

        let payload: UploadResponse | null = null;
        try {
          payload = JSON.parse(request.responseText) as UploadResponse;
        } catch {
          payload = null;
        }

        if (payload?.success !== true) {
          setError(
            typeof payload?.message === "string" && payload.message
              ? payload.message
              : "Upload failed. Try another file.",
          );
          return;
        }

        const items = Array.isArray(payload.data)
          ? (payload.data as UploadedFile[])
          : [];
        const url = typeof items[0]?.url === "string" ? items[0].url : "";
        if (!url) {
          setError("Upload failed. Try another file.");
          return;
        }
        onChange(url);
      });

      request.addEventListener("error", () => {
        requestRef.current = null;
        setProgress(null);
        setError("Upload failed. Check the connection and try again.");
      });

      request.addEventListener("abort", () => {
        requestRef.current = null;
        setProgress(null);
      });

      request.open("POST", "/api/upload");
      request.send(body);
    },
    [onChange],
  );

  const pickFile = (files: FileList | null) => {
    const file = files?.[0];
    if (file) uploadFile(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const openPicker = () => fileRef.current?.click();

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isBusy) return;
    const file = event.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const commitUrl = () => {
    const next = (urlDraft || "").trim();
    setUrlDraft(null);
    if (next) {
      setError(null);
      onChange(next);
    }
  };

  const hasImage = Boolean(value.trim());
  const showsErrorInFrame = Boolean(error) && !hasImage && !isUploading;

  const fileInput = (
    <input
      ref={fileRef}
      id={inputId}
      type="file"
      accept="image/*"
      className="hidden"
      disabled={isBusy}
      aria-label={label}
      onChange={(event) => pickFile(event.target.files)}
    />
  );

  const tile = (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!isBusy) setIsDragging(true);
      }}
      onDragLeave={(event) => {
        // Leaving for a child element still fires here; ignore those.
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setIsDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        "group/frame relative w-full overflow-hidden bg-muted",
        frame === "card" ? "aspect-[1296/366]" : "aspect-[1080/1800]",
        showsErrorInFrame && "bg-destructive/10",
        isDragging && "bg-primary/10",
      )}
    >
      {hasImage ? (
        <AppImage
          src={value}
          alt={alt}
          fill
          sizes="330px"
          // cover, because that is what the storefront does — an author has to
          // see the crop here or they will not see it until it ships.
          className={cn(
            "object-cover",
            isUploading && "saturate-50 brightness-75",
          )}
        />
      ) : null}

      {!hasImage || isDragging || showsErrorInFrame ? (
        <button
          type="button"
          disabled={isBusy}
          onClick={openPicker}
          className={cn(
            "absolute inset-1.5 flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-2 text-center transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            hasImage && "bg-background/90",
            isDragging
              ? "border-2 border-primary text-primary"
              : showsErrorInFrame
                ? "border-destructive/50 text-destructive"
                : "border-border text-muted-foreground hover:border-primary/50",
          )}
        >
          {isDragging ? (
            <>
              <ImageUp className="h-4 w-4" />
              <span className="text-xs font-medium">Release to upload</span>
              <span className="font-mono text-[10px]">jpg · png · webp</span>
            </>
          ) : showsErrorInFrame ? (
            <span className="text-xs font-medium leading-snug">{error}</span>
          ) : (
            <>
              <ImageIcon className="h-4 w-4" />
              <span className="text-xs font-medium text-foreground/80">
                {emptyHint}
              </span>
              <span className="font-mono text-[10px]">
                {PROMO_FRAMES[frame].width} × {PROMO_FRAMES[frame].height}
              </span>
            </>
          )}
        </button>
      ) : null}

      {typeof index === "number" ? (
        <span className="absolute left-1.5 top-1.5 z-[2] inline-flex h-[19px] items-center rounded-full border bg-background px-2 font-mono text-[10px] font-semibold text-muted-foreground">
          {index}
        </span>
      ) : null}

      {hasImage && fit && !isUploading ? (
        <span
          className={cn(
            "absolute right-1.5 top-1.5 z-[2] inline-flex h-[19px] items-center gap-1 rounded-full border px-2 text-[10px] font-semibold",
            fit.exact
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-400"
              : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
          )}
        >
          {fit.exact ? (
            <>
              <Check className="h-2.5 w-2.5" />
              Exact fit
            </>
          ) : (
            <>
              <Crop className="h-2.5 w-2.5" />
              Trims {Math.round(fit.trimmed * 100)}%
            </>
          )}
        </span>
      ) : null}

      {/* A banner is too narrow for a legible strip, and its own column already
          carries the name and size, so only a card scrims them over the art. */}
      {hasImage && !isUploading && frame === "card" ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-white">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
            {fileNameFrom(value) || "Promo image"}
          </span>
          {size ? (
            <span className="font-mono text-[10px] tabular-nums opacity-80">
              {size.width} × {size.height}
            </span>
          ) : null}
        </div>
      ) : null}

      {isUploading ? (
        <>
          <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center gap-1 bg-background/70">
            <span className="text-xs font-semibold">Uploading</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              {progress}%
            </span>
          </div>
          <div
            className="absolute inset-x-0 bottom-0 z-[3] h-[3px] bg-border"
            role="progressbar"
            aria-valuenow={progress ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Uploading ${label}`}
          >
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      ) : null}
    </div>
  );

  // `spread` pushes the trailing control to the far end, away from the two that
  // create an image. A wrapped banner row has no far end, so it opts out.
  const removeButton = (className?: string) => (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        "h-7 w-7 px-0 text-muted-foreground hover:text-destructive",
        className,
      )}
      aria-label={`Remove ${label}`}
      disabled={isBusy}
      onClick={() => {
        setError(null);
        onChange("");
      }}
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  );

  // `withRemove` is off for the banner, whose narrow column has no room for a
  // third control on the line — it puts Remove up beside the file name instead.
  const renderActions = (spread: boolean, withRemove = true) =>
    isUploading ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[11px]"
        onClick={() => requestRef.current?.abort()}
      >
        Cancel upload
      </Button>
    ) : (
      <>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          disabled={isBusy}
          onClick={openPicker}
        >
          <Upload className="h-3 w-3" />
          {hasImage ? "Replace" : "Upload"}
        </Button>
        {aiStudio}
        {hasImage ? (
          withRemove ? (
            removeButton(spread ? "ms-auto" : undefined)
          ) : null
        ) : (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => setUrlDraft(value)}
            className={cn(
              "inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-primary hover:decoration-primary/50",
              spread && "ms-auto",
            )}
          >
            <Link2 className="h-3 w-3" />
            Paste a URL
          </button>
        )}
      </>
    );

  const urlRow = (
    <>
      <Input
        autoFocus
        value={urlDraft || ""}
        onChange={(event) => setUrlDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitUrl();
          }
          if (event.key === "Escape") setUrlDraft(null);
        }}
        placeholder="https://…"
        aria-label={`${label} URL`}
        className="h-7 min-w-0 flex-1 font-mono text-[11px]"
      />
      <Button
        type="button"
        size="sm"
        className="h-7 px-2.5 text-[11px]"
        onClick={commitUrl}
      >
        Use
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-7 px-0"
        aria-label="Cancel"
        onClick={() => setUrlDraft(null)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </>
  );

  // A banner is a tall portrait; full-width it would push everything else out
  // of the panel, so it sits narrow with its controls alongside — the field
  // takes the shape of the frame it feeds, the same way the card does.
  if (frame === "banner") {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-stretch gap-2.5">
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            {tile}
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-2">
            {hasImage ? (
              <div className="min-w-0 space-y-0.5">
                {/* Remove rides the file name rather than the button row: it
                    is about this file, and the row below is only wide enough
                    for the two controls that put an image there. */}
                <div className="flex items-start gap-1">
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {fileNameFrom(value) || "Promo image"}
                  </p>
                  {removeButton("-mt-1 h-6 w-6 shrink-0")}
                </div>
                {size ? (
                  <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                    {size.width} × {size.height}
                    <br />
                    frame wants {PROMO_FRAMES.banner.width} × {PROMO_FRAMES.banner.height}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                A tall portrait beside the link columns.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {renderActions(false, false)}
            </div>
          </div>
        </div>

        {urlDraft !== null ? (
          <div className="flex items-center gap-1.5">{urlRow}</div>
        ) : null}

        {fileInput}
        <SlotNotes
          error={error}
          onDismissError={() => setError(null)}
          fit={hasImage && !isUploading ? fit : null}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm transition-colors hover:border-primary/40">
        {tile}
        <div
          className={cn(
            "flex items-center gap-1.5 border-t p-1.5",
            urlDraft !== null ? "bg-muted/40" : "bg-background",
          )}
        >
          {urlDraft !== null ? urlRow : renderActions(true)}
        </div>
      </div>
      {fileInput}
      <SlotNotes
        error={error}
        onDismissError={() => setError(null)}
        fit={hasImage && !isUploading ? fit : null}
      />
    </div>
  );
}

/** Errors and crop maths, said in full under the tile they belong to. */
function SlotNotes({
  error,
  onDismissError,
  fit,
}: {
  error: string | null;
  onDismissError: () => void;
  fit: PromoFit | null;
}) {
  return (
    <>
      {error ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="font-medium underline underline-offset-2"
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {fit && !fit.exact ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {fit.edges === "sides" ? "Wider" : "Taller"} than the frame, so about{" "}
          <b>{Math.round((fit.trimmed / 2) * 100)}%</b> comes off{" "}
          {fit.edges === "sides" ? "each side" : "the top and the bottom"}. The
          preview shows the part that survives — generate in AI Studio for an
          exact fit.
        </p>
      ) : null}
    </>
  );
}

/**
 * The whole promo block for a category: header, slots, and the notes that say
 * what the storefront will do with what is there. A pair of bottom cards is one
 * decision, not two form fields, so it gets one header and one counter.
 */
export function MegaPromoSlots({
  item,
  path,
  locale,
  mode,
  onChange,
}: {
  item: MenuItem;
  path: number[];
  locale: string;
  mode: "side" | "bottom";
  onChange: (patch: Partial<MenuItem>) => void;
}) {
  const key = pathKey(path);
  const categoryName = item.label.trim() || "Category";

  if (mode === "side") {
    const image = item.image || "";
    return (
      <div className="space-y-2.5">
        <SlotGroupHead mode="side" title="Side banner" filled={image ? 1 : 0} total={1} />

        <PromoSlotField
          frame="banner"
          label="Banner image"
          value={image}
          onChange={(value) => onChange({ image: value })}
          alt={`${categoryName} promo banner`}
          emptyHint="Drop a banner image"
          aiStudio={
            <AiStudioImageField
              entity="content_page"
              scope="admin"
              locale={locale}
              targetField="megaMenuPromoImage"
              audience="shopper"
              getFields={() => ({
                section: "Header mega menu side promo banner",
                category: item.label,
                linkUrl: item.url,
              })}
              value={image}
              onChange={(url) => onChange({ image: url })}
              breadcrumbRoot="Mega menu"
              breadcrumbLeaf="Promo image"
              subjectNoun="promo image"
              surface={MEGA_MENU_PROMO_STUDIO.surface}
              generateDefaults={MEGA_MENU_PROMO_STUDIO.generateDefaults}
              postProcessResult={MEGA_MENU_PROMO_STUDIO.postProcessResult}
              promptPlaceholder={MEGA_MENU_PROMO_STUDIO.promptPlaceholder}
              persistKey={`mega-menu-promo:${key}`}
              triggerHeight={22}
            />
          }
        />

        {getPreviewPromoImage(item) ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Its height follows the link columns beside it, so this frame breathes
            between <span className="font-mono tabular-nums">269</span> and{" "}
            <span className="font-mono tabular-nums">377</span> pixels tall.
          </p>
        ) : (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            No image yet, so the storefront skips the banner and gives the links
            the full four columns instead.
          </p>
        )}
      </div>
    );
  }

  const promoImages = getMegaPromoImages(item);
  const filled = promoImages.filter(Boolean).length;

  const setPromoImage = (index: number, value: string) => {
    const next = Array.from(
      { length: MEGA_BOTTOM_PROMO_CARDS },
      (_, slot) => promoImages[slot] || "",
    );
    next[index] = value;
    onChange({ promoImages: next });
  };

  return (
    <div className="space-y-2.5">
      <SlotGroupHead
        mode="bottom"
        title="Bottom cards"
        filled={filled}
        total={MEGA_BOTTOM_PROMO_CARDS}
      />

      {Array.from({ length: MEGA_BOTTOM_PROMO_CARDS }, (_, index) => (
        <PromoSlotField
          key={index}
          frame="card"
          index={index + 1}
          label={`Card ${index + 1} image`}
          value={promoImages[index] || ""}
          onChange={(value) => setPromoImage(index, value)}
          alt={`${categoryName} promo card ${index + 1}`}
          emptyHint={`Drop an image for card ${index + 1}`}
          aiStudio={
            <AiStudioImageField
              entity="content_page"
              scope="admin"
              locale={locale}
              targetField="megaMenuPromoImage"
              audience="shopper"
              getFields={() => ({
                section: `Header mega menu bottom promo card ${index + 1}`,
                category: item.label,
                linkUrl: item.url,
              })}
              value={promoImages[index] || ""}
              onChange={(url) => setPromoImage(index, url)}
              breadcrumbRoot="Mega menu"
              breadcrumbLeaf={`Promo card ${index + 1}`}
              subjectNoun="promo card image"
              surface={MEGA_MENU_BOTTOM_PROMO_STUDIO.surface}
              generateDefaults={MEGA_MENU_BOTTOM_PROMO_STUDIO.generateDefaults}
              postProcessResult={MEGA_MENU_BOTTOM_PROMO_STUDIO.postProcessResult}
              promptPlaceholder={MEGA_MENU_BOTTOM_PROMO_STUDIO.promptPlaceholder}
              persistKey={`mega-menu-bottom-promo-${index}:${key}`}
              triggerHeight={22}
            />
          }
        />
      ))}

      {/* The storefront draws whatever is filled, so a lone card is a layout
          choice rather than a mistake — say which one it is. */}
      {filled === 1 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          Only one card is set, so it{" "}
          <b>stretches across the whole row.</b> Add the second to split it in
          two.
        </p>
      ) : null}

      {filled === 0 ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          No images yet, so the storefront skips the card row entirely.
        </p>
      ) : null}

      {item.url ? (
        <p className="flex flex-wrap items-baseline gap-1.5 text-[11px] text-muted-foreground">
          <span>Both cards open</span>
          <span className="truncate font-mono">{item.url}</span>
        </p>
      ) : null}
    </div>
  );
}

/** Title, a map of where these slots land in the flyout, and a filled counter. */
function SlotGroupHead({
  mode,
  title,
  filled,
  total,
}: {
  mode: "side" | "bottom";
  title: string;
  filled: number;
  total: number;
}) {
  const bar = "block rounded-[1px] bg-border";

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "grid h-[18px] w-[26px] flex-none gap-[2px] rounded-[4px] bg-muted p-[2px]",
          mode === "bottom"
            ? "grid-cols-2 grid-rows-[1fr_5px]"
            : "grid-cols-[1fr_1fr_7px]",
        )}
      >
        <i className={bar} />
        <i className={bar} />
        <i
          className={cn(
            "block rounded-[1px]",
            filled > 0 ? "bg-primary" : "ring-1 ring-inset ring-border",
            mode === "side" && "row-span-full",
          )}
        />
        {mode === "bottom" ? (
          <i
            className={cn(
              "block rounded-[1px]",
              filled > 1 ? "bg-primary" : "ring-1 ring-inset ring-border",
            )}
          />
        ) : null}
      </span>

      <span className="text-xs font-semibold text-muted-foreground">
        {title}
      </span>

      <span className="ms-auto font-mono text-[11px] tabular-nums text-muted-foreground">
        <b
          className={cn(
            "font-semibold",
            filled < total ? "text-amber-700 dark:text-amber-400" : "text-foreground",
          )}
        >
          {filled}
        </b>{" "}
        / {total} set
      </span>
    </div>
  );
}
