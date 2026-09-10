"use client";

/**
 * AI Image Studio — a full-screen image editor. Opened from a product's Media
 * card, and from single-image fields (a category image/icon, a brand logo, …)
 * via `AiStudioImageField`. It is an overlay (not a route) on purpose: the form
 * behind it holds unsaved state, and saving from the studio must land in that
 * in-memory value without a navigation losing everything.
 *
 * It is entity-agnostic. Anything surface-specific arrives as a prop rather
 * than being branched on here: `generateDefaults` (what a field needs from a
 * from-scratch generation), `breadcrumbLeaf` / `savedMessage` / `subjectNoun`
 * (copy), and `cardPreview` / `onDelete` (product-gallery-only affordances,
 * hidden when omitted).
 *
 * Every generation goes through the existing ai-authoring media endpoint via
 * the `onGenerate` prop, so permissions, rate limits, prompt guards, and
 * storage behave exactly like the older AI image dialogs.
 *
 * This file is the composition shell: state lives in `useStudioSession`
 * (draft-persisted work), `useStudioViewport` (canvas view), and
 * `useStudioActions` (AI operations); the panels are separate components.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Globe, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast-notification";
import type {
  AIAuthoringMediaOptions,
  AIAuthoringMediaResponse,
  AIAuthoringRequest,
} from "@/lib/ai-authoring/types";
import type { UploadedImage } from "@/components/ai-authoring/upload-image";
import { uploadImageFile } from "@/components/ai-authoring/upload-image";
import {
  HERO_BANNER_PROMPT_CATEGORIES,
  QUICK_PROMPT_CATEGORIES,
  STUDIO_TOOL_PROMPTS,
} from "@/components/ai-authoring/studio-presets";
import type { AiStudioSurface } from "@/components/ai-authoring/studio-surface";
import type {
  SocialExportMode,
  SocialExportRequest,
  SocialExportSizeKey,
} from "@/lib/ai-authoring/social-export/types";
import type { StudioPreviewProduct } from "@/components/ai-authoring/storefront-card-preview";
import {
  buildEffectFilter,
  hasActiveEffects,
  NEUTRAL_EFFECTS,
  renderEffectsToBlob,
  sharpenAmount,
  SHARPEN_FILTER_ID,
  vignetteBackground,
  type EffectKey,
  type EffectValues,
} from "@/components/ai-authoring/studio-effects";
import { SCRATCH_KEY, type StudioImage } from "./types";
import { useStudioSession } from "./use-studio-session";
import { useStudioViewport } from "./use-studio-viewport";
import { useStudioActions } from "./use-studio-actions";
import { StudioCanvasCard } from "./studio-canvas";
import { StudioPromptBar } from "./studio-prompt-bar";
import { StudioMediaGrid } from "./studio-media-panel";
import { StudioSidePanelBody } from "./studio-side-panel";
import { useStudioStrings } from "./use-studio-strings";
import { useHydrated } from "@/hooks/use-client-value";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

type AiImageStudioProps = {
  open: boolean;
  /** Product images the studio can edit (the form's media grid, images only). */
  images: StudioImage[];
  /** Image to preselect when the studio opens. Falls back to the first image. */
  initialMediaId?: string | null;
  /** Root label of the breadcrumb, e.g. "Add product" or "Edit product". */
  breadcrumbRoot?: string;
  /** Where the header POS button links, matching the vendor header. Hidden when
   *  omitted (e.g. admin, or a vendor without POS access). */
  posHref?: string;
  /** Where the header "Browse Website" button links (storefront). Hidden when
   *  omitted. Opens in a new tab. */
  browseHref?: string;
  /** Base request for "image_edit" operations (entity/locale/fields). */
  editRequest: AIAuthoringRequest;
  /** Base request for from-scratch "image" generation. */
  generateRequest: AIAuthoringRequest;
  onOpenChange: (open: boolean) => void;
  onGenerate: (
    request: AIAuthoringRequest,
    options: AIAuthoringMediaOptions,
  ) => Promise<AIAuthoringMediaResponse | null>;
  /** Transform a fresh generation/edit result before it becomes an on-stage
   *  version — e.g. a ratio-locked surface crops and re-uploads it. Omit to use
   *  results as-is. */
  postProcessResult?: (
    response: AIAuthoringMediaResponse,
  ) => Promise<AIAuthoringMediaResponse>;
  /** Export the current image to an exact social size (deterministic sharp
   *  render — no AI cost). Omit to hide the studio's Export action. */
  onExport?: (request: SocialExportRequest) => void | Promise<void>;
  /** Called when an image is uploaded inside the studio so the parent tracks
   *  it in the media grid immediately (never an orphaned storage object). */
  onUpload: (media: UploadedImage) => void;
  /** Remove a grid image from the parent's media set. Omit to hide the studio's
   *  delete action; scratch (from-scratch) images are always removable. */
  onDelete?: (mediaId: string) => void;
  /** Save the current result. `sourceId` is the grid image it replaces, or
   *  null when the image was generated from scratch (add as new). */
  onSave: (
    response: AIAuthoringMediaResponse,
    sourceId: string | null,
  ) => boolean | void;
  /** Product fields for the storefront-card preview, read fresh when the
   *  preview is toggled on. Omit on non-product surfaces to hide the action. */
  cardPreview?: () => StudioPreviewProduct | null;
  /** Stable id for autosaving the working draft (prompt + edited versions) to
   *  localStorage so a page reload doesn't lose it. Omit to disable autosave. */
  persistKey?: string;
  /** Media options merged into from-scratch generation, letting a surface state
   *  what it actually needs — e.g. an icon field asks for a transparent
   *  background so the very first result is already usable. */
  generateDefaults?: AIAuthoringMediaOptions;
  /** Second breadcrumb crumb, naming the field being edited ("Icon", "Image"). */
  breadcrumbLeaf?: string;
  /** Toast shown after a successful Save. */
  savedMessage?: string;
  /** What the image depicts, used in the prompt hint: "Your ___ stays unchanged". */
  subjectNoun?: string;
  /** Explicit editor layout profile. Existing callers retain default media. */
  surface?: AiStudioSurface;
  /** Label for the primary save/apply action. */
  saveLabel?: string;
  /** Surface-specific prompt guidance. */
  promptPlaceholder?: string;
};

export function AiImageStudio({
  open,
  images,
  initialMediaId,
  breadcrumbRoot = "Add product",
  posHref,
  browseHref,
  editRequest,
  generateRequest,
  onOpenChange,
  onGenerate,
  postProcessResult,
  onExport,
  onUpload,
  onDelete,
  onSave,
  cardPreview,
  persistKey,
  generateDefaults,
  breadcrumbLeaf = "Media",
  savedMessage = "Saved",
  subjectNoun = "product",
  surface = "default_media",
  saveLabel = "Save",
  promptPlaceholder,
}: AiImageStudioProps) {
  const strings = useStudioStrings();
  const promptCategories =
    surface === "hero_banner"
      ? HERO_BANNER_PROMPT_CATEGORIES
      : QUICK_PROMPT_CATEGORIES;
  const mounted = useHydrated();
  const [activeTool, setActiveTool] = useState<"erase" | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Below lg the side panels live in sheets instead of grid columns.
  const [mediaSheetOpen, setMediaSheetOpen] = useState(false);
  const [presetsSheetOpen, setPresetsSheetOpen] = useState(false);
  // Non-null while the stage shows the storefront-card preview instead of the
  // editing artboard; holds the product fields snapshotted when it opened.
  const [previewProduct, setPreviewProduct] =
    useState<StudioPreviewProduct | null>(null);
  // Non-AI photo adjustments (Effects tab), previewed live and baked on apply.
  const [effects, setEffects] = useState<EffectValues>(NEUTRAL_EFFECTS);
  const [applyingEffects, setApplyingEffects] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const session = useStudioSession({
    open,
    images,
    initialMediaId,
    persistKey,
    promptCategories,
  });
  const view = useStudioViewport({
    open,
    mounted,
    surface,
    currentUrl: session.currentUrl,
    originalUrl: session.originalUrl,
    canCompare: session.canCompare,
  });

  /** Select an image and leave any per-image transient modes. */
  const selectImage = (key: string, url: string) => {
    session.selectKey(key, url);
    setActiveTool(null);
    view.resetCompare();
  };

  const actions = useStudioActions({
    open,
    editRequest,
    generateRequest,
    generateDefaults,
    onGenerate,
    postProcessResult,
    onUpload,
    session,
    onVersionShown: view.resetCompare,
    onSelectImage: selectImage,
  });
  const { busy, uploading } = actions;

  const [exporting, setExporting] = useState(false);
  /** Export the on-stage image to a social size; brand pad/logo come from
   *  settings, so the UI only picks the size, fit mode, and logo toggle. */
  const runExport = async (opts: {
    sizeKey: SocialExportSizeKey;
    mode: SocialExportMode;
    useLogo: boolean;
  }) => {
    const source = session.currentVersion;
    if (!onExport || !source || exporting) return;
    setExporting(true);
    try {
      await onExport({
        sourceUrl: source.url,
        sizeKey: opts.sizeKey,
        mode: opts.mode,
        format: "png",
        useLogo: opts.useLogo,
      });
    } finally {
      setExporting(false);
    }
  };

  // Reset the shell's own transient state each time the studio opens.
  useApplyOnChange([open], () => {
    if (!open) return;
    setActiveTool(null);
    setConfirmDiscard(false);
    setMediaSheetOpen(false);
    setPresetsSheetOpen(false);
    setPreviewProduct(null);
    setEffects(NEUTRAL_EFFECTS);
    setApplyingEffects(false);
  });

  // Lock page scroll while the studio covers the screen.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const { currentVersion, currentUrl, originalUrl, selectedKey } = session;
  const displayedUrl = view.peek && originalUrl ? originalUrl : currentUrl;
  // Delete is offered only when an image is on the stage, and only when it can
  // actually be removed: scratch images clear locally, grid images need the
  // parent's onDelete to drop them from the product's media set.
  const canDeleteSelected =
    !!currentVersion && (selectedKey === SCRATCH_KEY || !!onDelete);

  // Mirror into a ref so the stable Escape handler can read the latest value.
  // Pending (unbaked) slider adjustments count as unsaved work too.
  const effectsActive = hasActiveEffects(effects);
  const hasAnyEditsRef = useRef(false);
  useEffect(() => {
    hasAnyEditsRef.current = session.hasAnyEdits || !!busy || effectsActive;
  }, [session.hasAnyEdits, busy, effectsActive]);

  // Escape asks to close (Radix menus preventDefault their own Escape).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (hasAnyEditsRef.current) setConfirmDiscard(true);
      else onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // A different image/version is on the stage now — clear pending slider
  // adjustments, which belonged to the image that was showing before.
  useApplyOnChange([currentUrl], () => {
    setEffects(NEUTRAL_EFFECTS);
  });

  const { stepHistory: stepSessionHistory } = session;
  const { setPeek } = view;
  const stepHistory = useCallback(
    (delta: number) => {
      if (busy) return;
      stepSessionHistory(delta);
      setPeek(false);
    },
    [busy, stepSessionHistory, setPeek],
  );

  // Undo / redo through the version history. The design has no toolbar buttons
  // for it, so it lives on the keyboard only; ignored while typing in the
  // prompt so Ctrl+Z keeps editing text there.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      const isUndo = key === "z" && !event.shiftKey;
      const isRedo = (key === "z" && event.shiftKey) || key === "y";
      if (!isUndo && !isRedo) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "TEXTAREA" || target.tagName === "INPUT")
      ) {
        return;
      }
      event.preventDefault();
      stepHistory(isUndo ? -1 : 1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, stepHistory]);

  // Remove the selected image: drop its local session and, for grid images,
  // ask the parent to remove it from the product's media set. Selection falls
  // back to the next remaining image (or the scratch image, or nothing).
  const deleteSelected = () => {
    if (!selectedKey || !!busy) return;
    const key = selectedKey;
    const isScratch = key === SCRATCH_KEY;
    const remaining = images.filter((image) => image._id !== key);

    let nextKey: string | null = null;
    let nextUrl: string | null = null;
    if (remaining[0]) {
      nextKey = remaining[0]._id;
      nextUrl = remaining[0].url;
    } else if (!isScratch && session.scratchSession && session.scratchUrl) {
      nextKey = SCRATCH_KEY;
      nextUrl = session.scratchUrl;
    }

    session.dropSession(key);
    if (!isScratch) onDelete?.(key);

    if (nextKey && nextUrl) {
      selectImage(nextKey, nextUrl);
    } else {
      session.setSelectedKey(null);
      setActiveTool(null);
      view.resetCompare();
    }
  };

  const submitPrompt = async (overrideText?: string) => {
    if (busy || uploading) return;
    const text = (
      typeof overrideText === "string" ? overrideText : session.prompt
    ).trim();
    if (!text) {
      textareaRef.current?.focus();
      return;
    }
    if (!currentVersion) {
      await actions.runGenerateFromScratch(text);
      return;
    }
    const isErase = activeTool === "erase";
    const response = await actions.runEdit(
      isErase ? STUDIO_TOOL_PROMPTS.erase(text) : text,
      {},
      isErase ? "Erasing object…" : "Applying your edit…",
    );
    if (response) {
      session.setPrompt("");
      setActiveTool(null);
    }
  };

  const toggleErase = () => {
    if (actions.toolsDisabled) return;
    setActiveTool((tool) => (tool === "erase" ? null : "erase"));
    textareaRef.current?.focus();
  };

  const handleSave = () => {
    if (!currentVersion?.response || !selectedKey || busy) return;
    const accepted = onSave(
      currentVersion.response,
      selectedKey === SCRATCH_KEY ? null : selectedKey,
    );
    if (accepted === false) return;
    toast.success(savedMessage);
    onOpenChange(false);
  };

  const requestClose = () => {
    if (hasAnyEditsRef.current) setConfirmDiscard(true);
    else onOpenChange(false);
  };

  // Bake the live Effects adjustments onto the current image and add the result
  // as a new version — uploaded through the same media pipeline as everything
  // else, so it Saves into the product exactly like an AI edit.
  const applyEffectsToCurrent = async () => {
    if (
      !currentVersion ||
      !selectedKey ||
      busy ||
      applyingEffects ||
      !effectsActive
    ) {
      return;
    }
    const key = selectedKey;
    const source = currentVersion;
    setApplyingEffects(true);
    try {
      const blob = await renderEffectsToBlob(source.url, effects);
      const file = new File([blob], `effects-${Date.now()}.png`, {
        type: "image/png",
      });
      const media = await uploadImageFile(file);
      if (!actions.openRef.current) return;
      // Entities name their headline field differently — "title" on a product,
      // "name" on a category/brand — so fall back across both.
      const alt =
        source.response?.media.alt ??
        (typeof editRequest.fields.title === "string"
          ? editRequest.fields.title
          : typeof editRequest.fields.name === "string"
            ? editRequest.fields.name
            : undefined);
      session.pushVersion(key, {
        url: media.url,
        transparent: source.transparent,
        response: {
          media: {
            _id: media._id,
            url: media.url,
            type: "image",
            mimeType: media.mimeType || "image/png",
            filename: file.name,
            size: media.size ?? blob.size,
            alt,
            width: media.width,
            height: media.height,
          },
          targetField: editRequest.targetField,
        },
      });
      setEffects(NEUTRAL_EFFECTS);
      view.resetCompare();
      toast.success("Effects applied");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not apply effects",
      );
    } finally {
      setApplyingEffects(false);
    }
  };

  if (!open || !mounted) return null;

  // Live Effects preview — hidden while peeking at the original.
  const showEffectsPreview = effectsActive && !view.peek;
  const previewFilter = showEffectsPreview
    ? buildEffectFilter(effects, { includeSharpen: true })
    : undefined;
  const vignetteBg = showEffectsPreview
    ? vignetteBackground(effects.vignette)
    : undefined;
  const sharpenKernel = showEffectsPreview
    ? sharpenAmount(effects.sharpness)
    : 0;

  // Shared panel bodies — rendered in the desktop grid columns and reused
  // verbatim inside the below-lg sheets so behavior stays identical.
  const mediaGrid = (
    <StudioMediaGrid
      images={images}
      sessions={session.sessions}
      selectedKey={selectedKey}
      scratchUrl={session.scratchUrl ?? null}
      busy={!!busy}
      uploading={uploading}
      onUploadClick={() => fileInputRef.current?.click()}
      onSelect={selectImage}
    />
  );

  const sidePanelBody = (
    <StudioSidePanelBody
      activeTab={session.activeTab}
      onTabChange={session.setActiveTab}
      promptCategories={promptCategories}
      quickCategory={session.quickCategory}
      onQuickCategoryChange={session.setQuickCategory}
      busy={!!busy}
      uploading={uploading}
      onPresetSelect={(preset) => {
        // One click: show the preset text and start generating.
        session.setPrompt(preset);
        setActiveTool(null);
        void submitPrompt(preset);
      }}
      effects={effects}
      effectsDisabled={!currentVersion}
      applyingEffects={applyingEffects}
      onEffectChange={(key: EffectKey, value: number) =>
        setEffects((prev) => ({ ...prev, [key]: value }))
      }
      onEffectsReset={() => setEffects(NEUTRAL_EFFECTS)}
      onEffectsApply={applyEffectsToCurrent}
    />
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Top bar — mirrors the vendor header: breadcrumb (left), POS + Browse
          Website (center). Back navigates into the product form. The bar itself
          spans full width; its content is centered inside the studio container
          so it lines up with the body columns below. */}
      <div className="shrink-0 border-b bg-card">
        <div className="mx-auto grid h-[50px] w-full max-w-[1440px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 shrink-0"
              onClick={requestClose}
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <nav className="flex min-w-0 items-center gap-1.5 text-sm">
              <button
                type="button"
                onClick={requestClose}
                className="truncate text-muted-foreground transition-colors hover:text-foreground"
              >
                {breadcrumbRoot}
              </button>
              <span className="text-muted-foreground/50">/</span>
              <button
                type="button"
                onClick={requestClose}
                className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
              >
                {breadcrumbLeaf}
              </button>
              <span className="hidden text-muted-foreground/50 sm:inline">
                /
              </span>
              <span className="truncate font-semibold">
                {strings.breadcrumbTitle}
              </span>
            </nav>
          </div>

          <div className="hidden items-center justify-center gap-2 justify-self-center sm:flex">
            {posHref ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 rounded-xl border-primary/30 text-primary hover:bg-primary/5 dark:border-border dark:text-foreground dark:hover:bg-accent dark:hover:text-accent-foreground"
                asChild
              >
                <Link href={posHref}>
                  <ShoppingCart className="h-4 w-4" />
                  <span className="hidden sm:inline">POS</span>
                </Link>
              </Button>
            ) : null}
            {browseHref ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 rounded-xl"
                asChild
              >
                <a href={browseHref} target="_blank" rel="noopener noreferrer">
                  <Globe className="h-4 w-4" />
                  <span className="hidden sm:inline">Browse Website</span>
                </a>
              </Button>
            ) : null}
          </div>

          <div className="hidden sm:block" />
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.length) {
            actions.handleUploadFiles(event.target.files);
          }
          event.target.value = "";
        }}
      />

      {/* Body — full-width editor backdrop wrapping a centered, max-width
          container that holds the three-column grid: Media | editor | Quick
          Prompt. Only the side panels scroll internally; below lg the side
          panels move into sheets. */}
      <div className="h-[calc(100dvh-50px)] overflow-hidden bg-[#f6f6f7] dark:bg-background">
        <div className="mx-auto grid h-full min-h-0 w-full max-w-[1440px] grid-cols-1 gap-2.5 p-3 lg:grid-cols-[220px_minmax(0,1fr)_290px] xl:grid-cols-[248px_minmax(0,1fr)_324px]">
          {/* Left — Media */}
          <aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden rounded-[12px] border bg-card shadow-sm lg:flex">
            <p className="shrink-0 px-4 pb-3 pt-4 text-sm font-semibold">
              {strings.mediaTitle}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              {mediaGrid}
            </div>
          </aside>

          {/* Center — canvas card (toolbar + stage) over the fixed-height prompt
            composer: the flex equivalent of rows minmax(0,1fr) / 176px. */}
          <div className="flex min-h-0 min-w-0 flex-col gap-2.5">
            <StudioCanvasCard
              view={view}
              surface={surface}
              busy={busy}
              uploading={uploading}
              displayedUrl={displayedUrl}
              currentUrl={currentUrl}
              originalUrl={originalUrl}
              transparent={!!currentVersion?.transparent}
              alt={currentVersion?.response?.media.alt}
              canCompare={session.canCompare}
              cardPreviewEnabled={!!cardPreview}
              previewProduct={previewProduct}
              onTogglePreview={() =>
                setPreviewProduct((value) =>
                  value ? null : (cardPreview?.() ?? {}),
                )
              }
              canDeleteSelected={canDeleteSelected}
              onDeleteSelected={deleteSelected}
              onUploadClick={() => fileInputRef.current?.click()}
              onOpenMediaSheet={() => setMediaSheetOpen(true)}
              onOpenPresetsSheet={() => setPresetsSheetOpen(true)}
              onCancel={requestClose}
              onSave={handleSave}
              saveLabel={saveLabel}
              saveDisabled={!currentVersion?.response || !!busy}
              previewFilter={previewFilter}
              vignetteBg={vignetteBg}
            />

            <StudioPromptBar
              surface={surface}
              toolsDisabled={actions.toolsDisabled}
              busy={!!busy}
              uploading={uploading}
              hasCurrentVersion={!!currentVersion}
              activeTool={activeTool}
              prompt={session.prompt}
              promptPlaceholder={promptPlaceholder}
              subjectNoun={subjectNoun}
              textareaRef={textareaRef}
              onPromptChange={session.setPrompt}
              onSubmit={() => void submitPrompt()}
              onRemoveBackground={() => void actions.runRemoveBackground()}
              onEnhance={() => void actions.runEnhance()}
              onUpscale={() => void actions.runUpscale()}
              onToggleErase={toggleErase}
              onResize={(option) => void actions.runResize(option)}
              onExpand={(option) => void actions.runExpand(option)}
              onExport={onExport ? (opts) => void runExport(opts) : undefined}
              exporting={exporting}
            />
          </div>

          {/* Right — Quick Prompt / Effects */}
          <aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden rounded-[12px] border bg-card shadow-sm lg:flex">
            {sidePanelBody}
          </aside>
        </div>
      </div>

      {/* Sharpen convolution for the live Effects preview (the bake replays it
          on canvas). Rebuilt from the current amount so it stays in sync. */}
      {sharpenKernel > 0 ? (
        <svg
          aria-hidden
          className="pointer-events-none absolute h-0 w-0"
          width="0"
          height="0"
        >
          <filter id={SHARPEN_FILTER_ID}>
            <feConvolveMatrix
              order="3"
              preserveAlpha="true"
              kernelMatrix={`0 ${-sharpenKernel} 0 ${-sharpenKernel} ${
                1 + 4 * sharpenKernel
              } ${-sharpenKernel} 0 ${-sharpenKernel} 0`}
            />
          </filter>
        </svg>
      ) : null}

      {/* Below-lg side panels, in the app's standard sheets */}
      <Sheet open={mediaSheetOpen} onOpenChange={setMediaSheetOpen}>
        <SheetContent
          side="left"
          className="w-[280px] gap-0 p-0 sm:max-w-[280px]"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-sm">{strings.mediaTitle}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{mediaGrid}</div>
        </SheetContent>
      </Sheet>
      <Sheet open={presetsSheetOpen} onOpenChange={setPresetsSheetOpen}>
        <SheetContent
          side="right"
          className="w-[300px] gap-0 p-0 sm:max-w-[300px]"
        >
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-sm">
              {strings.quickPromptTitle}
            </SheetTitle>
          </SheetHeader>
          {sidePanelBody}
        </SheetContent>
      </Sheet>

      {/* Discard confirmation */}
      {confirmDiscard ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/60 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-xl border bg-card p-5 shadow-lg">
            <p className="text-base font-semibold">{strings.discardTitle}</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {strings.discardBody}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmDiscard(false)}
              >
                {strings.keepEditing}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => {
                  setConfirmDiscard(false);
                  onOpenChange(false);
                }}
              >
                {strings.discard}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
