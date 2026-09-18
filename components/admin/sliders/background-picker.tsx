"use client";

import { useRef, useState } from "react";
import { Film, FolderOpen, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { FocalPointPicker } from "./focal-point-picker";
import { MediaPickerDialog, type MediaPickerLabels } from "./media-picker-dialog";
import { UnitField } from "@/components/admin/unit-field";
import {
  MAX_BACKGROUND_BLUR,
  MAX_BACKGROUND_OVERLAY,
  SLIDE_BACKGROUND_HOVERS,
  SLIDE_BACKGROUND_MOTIONS,
  SLIDE_OVERLAY_EDGES,
  type SlideBackgroundHover,
  type SlideBackgroundMotion,
} from "@/lib/sliders/types";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast-notification";
import { uploadMediaAsset } from "@/components/ai-authoring/upload-image";
import type { SlideBackground } from "@/lib/sliders/types";
import { ColorPickerPanel } from "./color-picker";
import { DEFAULT_GRADIENT, GradientPickerPanel } from "./gradient-picker";

/**
 * The background editor for one slide (the design's Frames 527/575/604):
 * Solid | Gradient | Image, switched by the segmented control on top. Values
 * for every mode are kept side-by-side on the background object, so flipping
 * between tabs never loses what was configured under another one.
 *
 * A surface that lays a playing background under its content adds "video" to
 * `modes`. The tab is opt-in because offering it elsewhere would promise a
 * background the page never renders.
 */

const MODES = ["solid", "gradient", "image"] as const;

export function BackgroundPicker({
  value,
  onChange,
  labels,
  modes = MODES,
}: {
  value: SlideBackground;
  onChange: (background: SlideBackground) => void;
  labels: {
    solid: string;
    gradient: string;
    image: string;
    upload: string;
    direction: string;
    /** Offers the darkening control under artwork; absent = none. */
    darken?: string;
    /** Needed wherever `modes` carries "video". */
    video?: string;
    uploadVideo?: string;
    poster?: string;
    videoHint?: string;
    /** Offers the hover effect; absent = none (a header row has no hover). */
    hover?: string;
    hoverOptions?: Record<SlideBackgroundHover, string>;
    /** Offers the focal point under a picture or a video; absent = none. */
    focal?: string;
    /** The darkening's shape, edge, tint, the blur and the motion; absent = the plain darkening only. */
    overlayKind?: string;
    overlayKinds?: Record<"flat" | "gradient", string>;
    overlayFrom?: string;
    overlayEdges?: Record<(typeof SLIDE_OVERLAY_EDGES)[number], string>;
    tint?: string;
    blur?: string;
    motion?: string;
    motionOptions?: Record<SlideBackgroundMotion, string>;
    /** Offers picking from the media library; absent = upload only. */
    library?: string;
    libraryDialog?: MediaPickerLabels;
  };
  /**
   * Which fills this surface can take. A FOREGROUND drops "image" — text
   * and glyphs paint a colour or a gradient, and offering a photo would
   * promise something no fill can render. A surface that plays a background
   * adds "video".
   */
  modes?: readonly SlideBackground["type"][];
}) {
  const [uploading, setUploading] = useState<"image" | "video" | null>(null);
  const [library, setLibrary] = useState<"image" | "video" | "poster" | null>(null);
  const [showTint, setShowTint] = useState(false);
  const imageRef = useRef<HTMLInputElement | null>(null);
  const posterRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);

  // Seed the mode's value on the way in. Without this a slide switched to
  // Gradient carries `type: "gradient"` with no gradient — the canvas keeps
  // painting the solid colour, and the write-path normalizer (which refuses a
  // mode with nothing to render) silently downgrades it back to solid on save.
  const setMode = (type: SlideBackground["type"]) =>
    onChange({
      ...value,
      type,
      ...(type === "solid" && !value.color ? { color: "#f1f1f1" } : {}),
      ...(type === "gradient" && !value.gradient
        ? { gradient: DEFAULT_GRADIENT }
        : {}),
    });

  /**
   * An uploaded file into its slot. A picture chosen in the Video tab is the
   * POSTER — the still the video starts from, and what a visitor who asked for
   * less motion keeps — so it fills `image` without leaving the video mode.
   */
  const handleFile = async (
    file: File | undefined,
    slot: "image" | "video",
    keepMode = false,
  ) => {
    if (!file) return;
    setUploading(slot);
    try {
      const uploaded = await uploadMediaAsset(file, slot);
      onChange({
        ...value,
        type: keepMode ? value.type : slot,
        [slot]: uploaded.url,
        ...(slot === "image" && !keepMode && uploaded.width
          ? { imageWidth: uploaded.width }
          : {}),
        ...(slot === "video" && uploaded.size ? { videoSize: uploaded.size } : {}),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  };

  /** Picking from the media library instead of uploading. */
  const libraryButton = (slot: "image" | "video" | "poster") => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 w-full gap-1.5 text-xs"
      onClick={() => setLibrary(slot)}
    >
      <FolderOpen className="h-3.5 w-3.5" />
      {labels.library}
    </Button>
  );

  const row = (label: string, control: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 pt-1">
      <span className="text-sm text-foreground">{label}</span>
      {control}
    </div>
  );

  /**
   * The darkening laid over artwork, shared by the Image and Video tabs —
   * and, where the surface offers them, its shape (a flat wash or a scrim
   * from an edge), its tint, the picture's blur and its motion.
   */
  const darkenRow = labels.darken ? (
    <>
      {row(
        labels.darken,
        <UnitField
          ariaLabel={labels.darken}
          value={value.overlay ?? 0}
          unit="%"
          max={MAX_BACKGROUND_OVERLAY}
          onChange={(overlay) =>
            onChange({ ...value, overlay: overlay > 0 ? overlay : undefined })
          }
          className="w-24"
        />,
      )}
      {value.overlay && labels.overlayKind && labels.overlayKinds
        ? row(
            labels.overlayKind,
            <NativeSelect
              value={value.overlayKind ?? "flat"}
              aria-label={labels.overlayKind}
              onChange={(event) => {
                const next = { ...value };
                if (event.target.value === "gradient") next.overlayKind = "gradient";
                else delete next.overlayKind;
                onChange(next);
              }}
              className="h-8 w-32 text-xs"
            >
              <option value="flat">{labels.overlayKinds.flat}</option>
              <option value="gradient">{labels.overlayKinds.gradient}</option>
            </NativeSelect>,
          )
        : null}
      {value.overlay && value.overlayKind === "gradient" && labels.overlayFrom && labels.overlayEdges
        ? row(
            labels.overlayFrom,
            <NativeSelect
              value={value.overlayFrom ?? "bottom"}
              aria-label={labels.overlayFrom}
              onChange={(event) =>
                onChange({
                  ...value,
                  overlayFrom: event.target.value as (typeof SLIDE_OVERLAY_EDGES)[number],
                })
              }
              className="h-8 w-32 text-xs"
            >
              {SLIDE_OVERLAY_EDGES.map((edge) => (
                <option key={edge} value={edge}>
                  {labels.overlayEdges?.[edge]}
                </option>
              ))}
            </NativeSelect>,
          )
        : null}
      {value.overlay && labels.tint
        ? row(
            labels.tint,
            <button
              type="button"
              onClick={() => setShowTint((open) => !open)}
              className={cn(
                "h-8 w-14 rounded-md border shadow-sm transition",
                showTint ? "border-primary ring-2 ring-primary/30" : "border-border",
              )}
              style={{ backgroundColor: value.overlayColor ?? "#000000" }}
              aria-label={labels.tint}
            />,
          )
        : null}
      {value.overlay && showTint ? (
        <ColorPickerPanel
          value={value.overlayColor ?? "#000000"}
          onChange={(hex) => onChange({ ...value, overlayColor: hex })}
        />
      ) : null}
      {labels.blur
        ? row(
            labels.blur,
            <UnitField
              ariaLabel={labels.blur}
              value={value.blur ?? 0}
              unit="px"
              max={MAX_BACKGROUND_BLUR}
              onChange={(blur) => onChange({ ...value, blur: blur > 0 ? blur : undefined })}
              className="w-24"
            />,
          )
        : null}
      {labels.motion && labels.motionOptions
        ? row(
            labels.motion,
            <NativeSelect
              value={value.motion ?? "none"}
              aria-label={labels.motion}
              onChange={(event) => {
                const next = { ...value };
                const motion = event.target.value as SlideBackgroundMotion;
                if (motion === "none") delete next.motion;
                else next.motion = motion;
                onChange(next);
              }}
              className="h-8 w-32 text-xs"
            >
              {SLIDE_BACKGROUND_MOTIONS.map((motion) => (
                <option key={motion} value={motion}>
                  {labels.motionOptions?.[motion]}
                </option>
              ))}
            </NativeSelect>,
          )
        : null}
    </>
  ) : null;

  return (
    <div className="w-72 space-y-4">
      {/* Segmented mode switch */}
      <div
        className="grid gap-1 rounded-[6px] border border-border bg-muted/40 p-1"
        style={{
          gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))`,
        }}
      >
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setMode(mode)}
            className={cn(
              "rounded-[4px] px-2 py-1.5 text-xs font-semibold capitalize transition",
              value.type === mode
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {labels[mode] ?? mode}
          </button>
        ))}
      </div>

      {value.type === "solid" ? (
        <ColorPickerPanel
          value={value.color ?? "#f1f1f1"}
          onChange={(hex) => onChange({ ...value, type: "solid", color: hex })}
        />
      ) : null}

      {value.type === "gradient" ? (
        <GradientPickerPanel
          value={value.gradient ?? DEFAULT_GRADIENT}
          onChange={(gradient) =>
            onChange({ ...value, type: "gradient", gradient })
          }
          directionLabel={labels.direction}
        />
      ) : null}

      {value.type === "image" ? (
        <div className="space-y-2">
          {value.image ? (
            <div className="relative overflow-hidden rounded-[8px] border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value.image}
                alt=""
                className="aspect-video w-full object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-2 top-2 h-7 w-7"
                onClick={() => onChange({ ...value, image: undefined })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => imageRef.current?.click()}
              disabled={uploading !== null}
              className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-[8px] bg-primary text-primary-foreground transition hover:bg-primary/90"
            >
              {uploading === "image" ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <ImagePlus className="h-8 w-8" />
              )}
              <span className="text-sm font-medium">{labels.upload}</span>
            </button>
          )}
          {value.image && labels.focal ? (
            <div className="space-y-1.5 pt-1">
              <span className="text-sm text-foreground">{labels.focal}</span>
              <FocalPointPicker
                src={value.image}
                value={value.focal}
                onChange={(focal) => onChange({ ...value, focal })}
                label={labels.focal}
              />
            </div>
          ) : null}
          {value.image ? darkenRow : null}
          {!value.image && labels.library ? libraryButton("image") : null}
          <input
            ref={imageRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0], "image");
              event.target.value = "";
            }}
          />
        </div>
      ) : null}

      {value.type === "video" ? (
        <div className="space-y-2">
          {value.video ? (
            <div className="relative overflow-hidden rounded-[8px] border border-border">
              <video
                src={value.video}
                poster={value.image || undefined}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-muted object-cover"
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-2 top-2 h-7 w-7"
                onClick={() => onChange({ ...value, video: undefined })}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => videoRef.current?.click()}
              disabled={uploading !== null}
              className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-[8px] bg-primary text-primary-foreground transition hover:bg-primary/90"
            >
              {uploading === "video" ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <Film className="h-8 w-8" />
              )}
              <span className="text-sm font-medium">
                {labels.uploadVideo ?? labels.upload}
              </span>
            </button>
          )}

          {/*
            The poster. It paints before the file has loaded and stands in for
            a visitor who asked their system to reduce motion, so a video
            background without one opens on an empty plate.
          */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="text-sm text-foreground">
              {labels.poster ?? labels.image}
            </span>
            <div className="flex items-center gap-1.5">
              {value.image ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={value.image}
                    alt=""
                    className="h-7 w-10 rounded-[4px] border border-border object-cover"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={labels.poster ?? labels.image}
                    onClick={() => onChange({ ...value, image: undefined })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-xs"
                  disabled={uploading !== null}
                  onClick={() => posterRef.current?.click()}
                >
                  {uploading === "image" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                  {labels.upload}
                </Button>
              )}
            </div>
          </div>

          {!value.video && labels.library ? libraryButton("video") : null}
          {value.image && labels.focal ? (
            <div className="space-y-1.5 pt-1">
              <span className="text-sm text-foreground">{labels.focal}</span>
              <FocalPointPicker
                src={value.image}
                value={value.focal}
                onChange={(focal) => onChange({ ...value, focal })}
                label={labels.focal}
              />
            </div>
          ) : null}
          {value.video ? darkenRow : null}

          {labels.videoHint ? (
            <p className="text-xs leading-snug text-muted-foreground">
              {labels.videoHint}
            </p>
          ) : null}

          <input
            ref={videoRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0], "video");
              event.target.value = "";
            }}
          />
          <input
            ref={posterRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              // Stays in the Video tab: this picture is the poster.
              void handleFile(event.target.files?.[0], "image", true);
              event.target.value = "";
            }}
          />
        </div>
      ) : null}

      {labels.library && labels.libraryDialog ? (
        <MediaPickerDialog
          open={library !== null}
          onOpenChange={(open) => {
            if (!open) setLibrary(null);
          }}
          kind={library === "video" ? "video" : "image"}
          labels={labels.libraryDialog}
          onPick={(media) => {
            if (library === "video") {
              onChange({
                ...value,
                type: "video",
                video: media.url,
                ...(media.size ? { videoSize: media.size } : {}),
              });
            } else if (library === "poster") {
              onChange({ ...value, image: media.url });
            } else {
              onChange({
                ...value,
                type: "image",
                image: media.url,
                ...(media.width ? { imageWidth: media.width } : {}),
              });
            }
            setLibrary(null);
          }}
        />
      ) : null}

      {/* What the plate does under the pointer. Zoom only where there is a
          picture to zoom into — a colour scaled up is the same colour. */}
      {labels.hover && labels.hoverOptions ? (
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="text-sm text-foreground">{labels.hover}</span>
          <NativeSelect
            value={value.hover ?? "none"}
            aria-label={labels.hover}
            onChange={(event) => {
              const next = event.target.value as SlideBackgroundHover;
              const { hover: _hover, ...rest } = value;
              onChange(next === "none" ? rest : { ...rest, hover: next });
            }}
            className="h-8 w-32 text-xs"
          >
            {SLIDE_BACKGROUND_HOVERS.filter(
              (option) =>
                option !== "zoom" ||
                value.type === "image" ||
                value.type === "video",
            ).map((option) => (
              <option key={option} value={option}>
                {labels.hoverOptions?.[option]}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </div>
  );
}
