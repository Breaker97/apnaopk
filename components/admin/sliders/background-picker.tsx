"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast-notification";
import { uploadImageFile } from "@/components/ai-authoring/upload-image";
import type { SlideBackground } from "@/lib/sliders/types";
import { ColorPickerPanel } from "./color-picker";
import { DEFAULT_GRADIENT, GradientPickerPanel } from "./gradient-picker";

/**
 * The background editor for one slide (the design's Frames 527/575/604):
 * Solid | Gradient | Image, switched by the segmented control on top. Values
 * for every mode are kept side-by-side on the background object, so flipping
 * between tabs never loses what was configured under another one.
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
  };
  /**
   * Which fills this surface can take. A FOREGROUND drops "image" — text
   * and glyphs paint a colour or a gradient, and offering a photo would
   * promise something no fill can render.
   */
  modes?: readonly SlideBackground["type"][];
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadImageFile(file);
      onChange({ ...value, type: "image", image: uploaded.url });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Image upload failed",
      );
    } finally {
      setUploading(false);
    }
  };

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
            {labels[mode]}
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
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-[8px] bg-primary text-primary-foreground transition hover:bg-primary/90"
            >
              {uploading ? (
                <Loader2 className="h-8 w-8 animate-spin" />
              ) : (
                <ImagePlus className="h-8 w-8" />
              )}
              <span className="text-sm font-medium">{labels.upload}</span>
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
