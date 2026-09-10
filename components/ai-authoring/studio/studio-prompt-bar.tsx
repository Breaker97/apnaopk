"use client";

import { useState, type RefObject } from "react";
import {
  ArrowUp,
  ChevronUp,
  Download,
  Eraser,
  Expand,
  ImageMinus,
  ImageUpscale,
  Loader2,
  Scaling,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  STUDIO_SIZE_OPTIONS,
  type StudioSizeOption,
} from "@/components/ai-authoring/studio-presets";
import { SOCIAL_EXPORT_SIZES } from "@/lib/ai-authoring/social-export/presets";
import type {
  SocialExportMode,
  SocialExportSizeKey,
} from "@/lib/ai-authoring/social-export/types";
import {
  isRatioLockedSurface,
  type AiStudioSurface,
} from "@/components/ai-authoring/studio-surface";
import { useStudioStrings } from "./use-studio-strings";

const TOOL_BUTTON_CLASS =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50";

/**
 * The prompt composer: the tool chip row (Remove Background, Enhance, Upscale,
 * Erase Object, Resize, Expand) over the free-text prompt with its submit
 * button, inside the soft pastel glow border — cyan (top) → pink (bottom-left)
 * → yellow (bottom-right), matching the design. The hero-banner surface hides
 * the tools that would break its fixed 1360×314 contract.
 */
export function StudioPromptBar({
  surface,
  toolsDisabled,
  busy,
  uploading,
  hasCurrentVersion,
  activeTool,
  prompt,
  promptPlaceholder,
  subjectNoun,
  textareaRef,
  onPromptChange,
  onSubmit,
  onRemoveBackground,
  onEnhance,
  onUpscale,
  onToggleErase,
  onResize,
  onExpand,
  onExport,
  exporting,
}: {
  surface: AiStudioSurface;
  toolsDisabled: boolean;
  busy: boolean;
  uploading: boolean;
  hasCurrentVersion: boolean;
  activeTool: "erase" | null;
  prompt: string;
  promptPlaceholder?: string;
  subjectNoun: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onRemoveBackground: () => void;
  onEnhance: () => void;
  onUpscale: () => void;
  onToggleErase: () => void;
  onResize: (option: StudioSizeOption) => void;
  onExpand: (option: StudioSizeOption) => void;
  /** Export the current image to a social size. Omit to hide the action. */
  onExport?: (opts: {
    sizeKey: SocialExportSizeKey;
    mode: SocialExportMode;
    useLogo: boolean;
  }) => void;
  exporting?: boolean;
}) {
  const strings = useStudioStrings();
  const [withLogo, setWithLogo] = useState(false);
  // Ratio-locked surfaces hide the tools that would change the frame.
  const showRatioTools = !isRatioLockedSurface(surface);
  return (
    <div className="h-45 min-w-0 shrink-0 rounded-[12px] bg-[conic-gradient(from_0deg_at_50%_50%,#22d3ee_0deg,#2dd4bf_45deg,#fbbf24_100deg,#facc15_135deg,#fcd34d_165deg,#f9a8d4_182deg,#ec4899_225deg,#d946ef_270deg,#38bdf8_315deg,#22d3ee_360deg)] p-[2px] pb-3 shadow-sm">
      <div className="flex h-full min-h-0 flex-col rounded-[10px] bg-card p-2.5">
        <div className="flex h-[38px] shrink-0 items-center gap-1 overflow-x-auto">
          {showRatioTools ? (
            <button
              type="button"
              className={TOOL_BUTTON_CLASS}
              disabled={toolsDisabled}
              onClick={onRemoveBackground}
            >
              <ImageMinus className="h-4 w-4" />
              {strings.removeBackground}
            </button>
          ) : null}
          <button
            type="button"
            className={TOOL_BUTTON_CLASS}
            disabled={toolsDisabled}
            onClick={onEnhance}
          >
            <Sparkles className="h-4 w-4" />
            {strings.enhance}
          </button>
          <button
            type="button"
            className={TOOL_BUTTON_CLASS}
            disabled={toolsDisabled}
            onClick={onUpscale}
          >
            <ImageUpscale className="h-4 w-4" />
            {strings.upscale}
          </button>
          <button
            type="button"
            className={cn(
              TOOL_BUTTON_CLASS,
              activeTool === "erase" &&
                "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
            )}
            disabled={toolsDisabled}
            onClick={onToggleErase}
            aria-pressed={activeTool === "erase"}
          >
            <Eraser className="h-4 w-4" />
            {strings.eraseObject}
          </button>
          {showRatioTools ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={toolsDisabled}>
                  <button type="button" className={TOOL_BUTTON_CLASS}>
                    <Scaling className="h-4 w-4" />
                    {strings.resize}
                    <ChevronUp className="h-3.5 w-3.5 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="top"
                  className="z-[60] w-48"
                >
                  {STUDIO_SIZE_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.key}
                      onSelect={() => onResize(option)}
                    >
                      {strings.sizeLabel(option.key, option.label)}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {option.ratio}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild disabled={toolsDisabled}>
                  <button type="button" className={TOOL_BUTTON_CLASS}>
                    <Expand className="h-4 w-4" />
                    {strings.expand}
                    <ChevronUp className="h-3.5 w-3.5 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="top"
                  className="z-[60] w-48"
                >
                  {STUDIO_SIZE_OPTIONS.map((option) => (
                    <DropdownMenuItem
                      key={option.key}
                      onSelect={() => onExpand(option)}
                    >
                      {strings.sizeLabel(option.key, option.label)}
                      <span className="ml-auto text-xs text-muted-foreground">
                        {option.ratio}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {onExport ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    asChild
                    disabled={toolsDisabled || !!exporting}
                  >
                    <button type="button" className={TOOL_BUTTON_CLASS}>
                      {exporting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {strings.exportButton}
                      <ChevronUp className="h-3.5 w-3.5 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    className="z-[60] w-60"
                  >
                    <DropdownMenuCheckboxItem
                      checked={withLogo}
                      onCheckedChange={(value) => setWithLogo(!!value)}
                      onSelect={(event) => event.preventDefault()}
                    >
                      {strings.exportIncludeLogo}
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{strings.exportFill}</DropdownMenuLabel>
                    {SOCIAL_EXPORT_SIZES.map((size) => (
                      <DropdownMenuItem
                        key={`cover-${size.key}`}
                        onSelect={() =>
                          onExport({
                            sizeKey: size.key,
                            mode: "cover",
                            useLogo: withLogo,
                          })
                        }
                      >
                        {strings.exportSizeLabel(size.key, size.label)}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {size.width}×{size.height}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{strings.exportFit}</DropdownMenuLabel>
                    {SOCIAL_EXPORT_SIZES.map((size) => (
                      <DropdownMenuItem
                        key={`pad-${size.key}`}
                        onSelect={() =>
                          onExport({
                            sizeKey: size.key,
                            mode: "pad",
                            useLogo: withLogo,
                          })
                        }
                      >
                        {strings.exportSizeLabel(size.key, size.label)}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {size.width}×{size.height}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="relative mt-1 min-h-0 flex-1">
          <Textarea
            ref={textareaRef}
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                onSubmit();
              }
            }}
            rows={3}
            placeholder={
              promptPlaceholder ||
              (activeTool === "erase"
                ? strings.placeholderErase
                : hasCurrentVersion
                  ? strings.placeholderEdit(subjectNoun)
                  : strings.placeholderGenerate)
            }
            className="h-full min-h-0 field-sizing-fixed resize-none border-0 bg-transparent px-1 pr-10 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            type="button"
            size="icon"
            disabled={!prompt.trim() || busy || uploading}
            onClick={onSubmit}
            className="absolute bottom-1 right-1 h-7 w-7 rounded-full bg-foreground text-background hover:bg-foreground/80"
            aria-label={hasCurrentVersion ? strings.applyEdit : strings.generateImage}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
