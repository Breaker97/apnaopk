"use client";

/**
 * Reusable wiring for the AI Image Studio.
 *
 * The studio component (`AiImageStudio`) is entity-agnostic — it only knows how
 * to edit a set of images and hand results back through callbacks. This hook is
 * the single place that assembles everything a page needs to drive it: the
 * open/target state, the per-area API endpoints, the `image`/`image_edit`
 * request objects, the generate handler, and the rendered overlay.
 *
 * A page supplies only its own data binding — the `images` to edit and what to
 * do `onSave`/`onUpload` — and drops `studio` into its tree. Upgrades to the
 * studio flow live here and reach every consumer at once.
 */

import { useCallback, useState } from "react";
import {
  AiImageStudio,
  type StudioImage,
} from "@/components/ai-authoring/ai-image-studio";
import type { AiStudioSurface } from "@/components/ai-authoring/studio-surface";
import type { StudioPreviewProduct } from "@/components/ai-authoring/storefront-card-preview";
import { useAiAuthoring } from "@/components/ai-authoring/use-ai-authoring";
import { downloadAiImage } from "@/components/ai-authoring/download-image";
import type { UploadedImage } from "@/components/ai-authoring/upload-image";
import type { SocialExportRequest } from "@/lib/ai-authoring/social-export/types";
import type {
  AIAuthoringAudience,
  AIAuthoringEntity,
  AIAuthoringMediaOptions,
  AIAuthoringMediaResponse,
  AIAuthoringRequest,
} from "@/lib/ai-authoring/types";

export type { StudioImage } from "@/components/ai-authoring/ai-image-studio";

/** Which set of authoring API endpoints to call. */
export type AiStudioScope = "admin" | "vendor";

type UseAiStudioOptions = {
  /** The authoring entity, e.g. "product" | "category" | "brand" | "collection". */
  entity: AIAuthoringEntity;
  /** Endpoint scope — vendor area vs admin/staff area. */
  scope: AiStudioScope;
  locale: string;
  /** The field the result targets, e.g. "media" | "image" | "logo". */
  targetField?: string;
  /** Audience hint passed to the model. */
  audience?: AIAuthoringAudience;
  /**
   * Context the model uses (title, description, category, …). A function so the
   * newest form values are read at generate time, not captured stale.
   */
  getFields: () => Record<string, unknown>;
  /** Editable images shown in the studio's Media panel. */
  images: StudioImage[];
  /** Breadcrumb root label, e.g. "Add product" / "Edit category". */
  breadcrumbRoot?: string;
  /** Optional header links, mirroring the surrounding app header. */
  posHref?: string;
  browseHref?: string;
  /**
   * An image was uploaded inside the studio. Track it so it is never an
   * orphaned storage object and can be selected/edited.
   */
  onUpload: (media: UploadedImage) => void;
  /**
   * Remove a grid image from the entity's media set. Omit to hide the studio's
   * delete action for grid images.
   */
  onDelete?: (mediaId: string) => void;
  /**
   * Commit a result. `sourceId` is the grid image it replaces, or null when the
   * image was generated from scratch (add as new).
   */
  onSave: (response: AIAuthoringMediaResponse, sourceId: string | null) => void;
  /**
   * Product fields for the studio's storefront-card preview, read fresh when
   * the preview is toggled on. Omit on non-product surfaces to hide the action.
   */
  cardPreview?: () => StudioPreviewProduct | null;
  /**
   * Stable id for autosaving the studio's working draft to localStorage so a
   * page reload doesn't lose it. Omit to disable autosave for this surface.
   * Must be unique per field — two studios on one page (e.g. a category's image
   * and its icon) would otherwise share, and clobber, one draft.
   */
  persistKey?: string;
  /**
   * Media options merged into from-scratch generation, so a surface can state
   * what it needs (e.g. an icon field wants a transparent background).
   */
  generateDefaults?: AIAuthoringMediaOptions;
  /** Second breadcrumb crumb, naming the field being edited ("Icon", "Image"). */
  breadcrumbLeaf?: string;
  /** Toast shown after a successful Save. */
  savedMessage?: string;
  /** What the image depicts, used in the prompt hint: "Your ___ stays unchanged". */
  subjectNoun?: string;
  /** Editor layout profile — a ratio-locked surface fixes the artboard and hides
   *  ratio-changing tools. Omit for the default square media surface. */
  surface?: AiStudioSurface;
  /** Transform a fresh generation/edit result before it becomes a version — e.g.
   *  a ratio-locked surface crops and re-uploads it to its exact frame. */
  postProcessResult?: (
    response: AIAuthoringMediaResponse,
  ) => Promise<AIAuthoringMediaResponse>;
  /** Surface-specific prompt guidance shown in the composer. */
  promptPlaceholder?: string;
};

type UseAiStudioResult = {
  /** Whether the studio overlay is open. */
  isOpen: boolean;
  /** Open the studio, optionally starting on a specific image id. */
  openStudio: (startId?: string | null) => void;
  /** Close the studio programmatically. */
  closeStudio: () => void;
  /** The studio overlay, ready to render anywhere in the page. */
  studio: React.ReactNode;
};

export function useAiStudio(options: UseAiStudioOptions): UseAiStudioResult {
  const {
    entity,
    scope,
    locale,
    targetField,
    audience,
    getFields,
    images,
    breadcrumbRoot,
    posHref,
    browseHref,
    onUpload,
    onDelete,
    onSave,
    cardPreview,
    persistKey,
    generateDefaults,
    breadcrumbLeaf,
    savedMessage,
    subjectNoun,
    surface,
    postProcessResult,
    promptPlaceholder,
  } = options;

  const [open, setOpen] = useState(false);
  const [startId, setStartId] = useState<string | null>(null);

  const aiAuthoring = useAiAuthoring({
    contentEndpoint: `/api/${scope}/ai-authoring/content`,
    mediaEndpoint: `/api/${scope}/ai-authoring/media`,
    socialExportEndpoint: `/api/${scope}/ai-authoring/social-export`,
  });

  const openStudio = useCallback((initialId?: string | null) => {
    setStartId(initialId ?? null);
    setOpen(true);
  }, []);

  const closeStudio = useCallback(() => {
    setOpen(false);
    setStartId(null);
  }, []);

  // Plain objects rebuilt each render so `getFields()` is always fresh; the
  // studio only reads them at generate time, so identity churn is harmless.
  const constraints = audience ? { audience } : undefined;
  const editRequest: AIAuthoringRequest = {
    entity,
    operation: "image_edit",
    locale,
    ...(targetField ? { targetField } : {}),
    fields: getFields(),
    ...(constraints ? { constraints } : {}),
  };
  const generateRequest: AIAuthoringRequest = {
    entity,
    operation: "image",
    locale,
    ...(targetField ? { targetField } : {}),
    fields: getFields(),
    ...(constraints ? { constraints } : {}),
  };

  const studio = (
    <AiImageStudio
      open={open}
      images={images}
      initialMediaId={startId}
      breadcrumbRoot={breadcrumbRoot}
      posHref={posHref}
      browseHref={browseHref}
      editRequest={editRequest}
      generateRequest={generateRequest}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setStartId(null);
      }}
      onGenerate={(request, mediaOptions) =>
        aiAuthoring.generateMedia("ai-studio", request, mediaOptions)
      }
      postProcessResult={postProcessResult}
      surface={surface}
      promptPlaceholder={promptPlaceholder}
      onExport={async (request: SocialExportRequest) => {
        const result = await aiAuthoring.exportSocial("ai-studio-export", request);
        if (result) downloadAiImage(result.media.url, result.media.filename);
      }}
      onUpload={onUpload}
      onDelete={onDelete}
      onSave={onSave}
      cardPreview={cardPreview}
      persistKey={persistKey}
      generateDefaults={generateDefaults}
      breadcrumbLeaf={breadcrumbLeaf}
      savedMessage={savedMessage}
      subjectNoun={subjectNoun}
    />
  );

  return { isOpen: open, openStudio, closeStudio, studio };
}
