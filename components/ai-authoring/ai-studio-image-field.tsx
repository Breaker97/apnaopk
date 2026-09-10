"use client";

/**
 * Drop-in AI Image Studio for a single-image field (a brand logo, a category
 * image/icon, a collection cover, a blog featured image — anywhere the form
 * stores one image URL instead of a gallery).
 *
 * It renders a trigger and the studio overlay, keeps its own small list of the
 * images uploaded/generated during a session so the studio's Media panel has
 * something to show, and commits the chosen result straight back to the field
 * through `onChange`. All studio behavior comes from the shared `useAiStudio`
 * hook, so upgrades reach this and the product gallery alike.
 *
 * The default trigger is the same hover-preview `AiStudioMenu` the product
 * gallery uses, so a single-image field launches the studio the way merchants
 * have already learned it.
 */

import { useMemo, useState, type ReactNode } from "react";
import { AiStudioMenu } from "@/components/ai-authoring/ai-studio-menu";
import {
  useAiStudio,
  type AiStudioScope,
  type StudioImage,
} from "@/components/ai-authoring/use-ai-studio";
import type { UploadedImage } from "@/components/ai-authoring/upload-image";
import type { AiStudioSurface } from "@/components/ai-authoring/studio-surface";
import type {
  AIAuthoringAudience,
  AIAuthoringEntity,
  AIAuthoringMediaOptions,
  AIAuthoringMediaResponse,
} from "@/lib/ai-authoring/types";

const CURRENT_ID = "current-image";

type AiStudioImageFieldProps = {
  entity: AIAuthoringEntity;
  scope: AiStudioScope;
  locale: string;
  targetField?: string;
  audience?: AIAuthoringAudience;
  /** Context the model uses (name, description, …), read fresh at generate time. */
  getFields: () => Record<string, unknown>;
  /** The image URL bound to this field ("" when unset). */
  value: string;
  /** Alt text for the current image, if any. */
  alt?: string;
  /** Commit a chosen/edited image back to the field. */
  onChange: (url: string, alt?: string) => void;
  breadcrumbRoot?: string;
  posHref?: string;
  browseHref?: string;
  /**
   * Stable id for autosaving the studio's working draft across a reload. Must
   * be unique per field — a form with both an image and an icon mounts two
   * studios, and a shared key would let one clobber the other's draft.
   */
  persistKey?: string;
  /**
   * Media options merged into from-scratch generation. Use it to state what the
   * field needs — an icon slot, for instance, wants a transparent background so
   * the first generated result is already usable.
   */
  generateDefaults?: AIAuthoringMediaOptions;
  /** Second breadcrumb crumb, naming the field being edited ("Icon", "Image"). */
  breadcrumbLeaf?: string;
  /** Toast shown after a successful Save. */
  savedMessage?: string;
  /** What the image depicts, used in the prompt hint: "Your ___ stays unchanged". */
  subjectNoun?: string;
  /**
   * Editor layout profile. A ratio-locked surface (e.g. "blog_featured") fixes
   * the artboard to a set ratio and hides the tools that would change it; pair
   * it with `postProcessResult` to clamp every result to that exact ratio. Omit
   * for the default square media surface.
   */
  surface?: AiStudioSurface;
  /**
   * Transform a fresh generation/edit result before it is applied — a
   * ratio-locked surface crops and re-uploads it to its exact frame so the
   * committed image already matches the surface's ratio.
   */
  postProcessResult?: (
    response: AIAuthoringMediaResponse,
  ) => Promise<AIAuthoringMediaResponse>;
  /** Surface-specific prompt guidance shown in the composer. */
  promptPlaceholder?: string;
  /**
   * Trigger accessible name / tooltip (default "AI Studio"). Ignored when
   * `children` is given.
   */
  label?: string;
  className?: string;
  disabled?: boolean;
  /** Rendered height of the default branded trigger, in px. */
  triggerHeight?: number;
  /** Custom trigger; receives an `open` callback. Replaces the default button. */
  children?: (open: () => void) => ReactNode;
};

export function AiStudioImageField({
  entity,
  scope,
  locale,
  targetField,
  audience,
  getFields,
  value,
  alt,
  onChange,
  breadcrumbRoot,
  posHref,
  browseHref,
  persistKey,
  generateDefaults,
  breadcrumbLeaf,
  savedMessage,
  subjectNoun,
  surface,
  postProcessResult,
  promptPlaceholder,
  label,
  className,
  disabled,
  triggerHeight,
  children,
}: AiStudioImageFieldProps) {
  // Images uploaded/generated in this session that aren't the committed value
  // yet — kept so the studio's Media panel can show and switch between them.
  const [sessionImages, setSessionImages] = useState<StudioImage[]>([]);

  const images = useMemo<StudioImage[]>(() => {
    const list: StudioImage[] = [];
    if (value) list.push({ _id: CURRENT_ID, url: value, alt });
    for (const image of sessionImages) {
      if (image.url !== value) list.push(image);
    }
    return list;
  }, [value, alt, sessionImages]);

  const { openStudio, studio } = useAiStudio({
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
    persistKey,
    generateDefaults,
    breadcrumbLeaf,
    savedMessage,
    subjectNoun,
    surface,
    postProcessResult,
    promptPlaceholder,
    onUpload: (media: UploadedImage) =>
      setSessionImages((prev) =>
        prev.some((image) => image._id === media._id)
          ? prev
          : [...prev, { _id: media._id, url: media.url, alt: media.alt }],
      ),
    // Without this the studio hides its delete action entirely, leaving a
    // mistaken upload stuck in the Media panel with no way out.
    onDelete: (mediaId: string) => {
      // The grid holds one committed tile (the field's current image) plus this
      // session's uploads. Removing the committed one clears the field, matching
      // how deleting from the product studio drops the image from that gallery —
      // both mutate unsaved form state, not the server.
      if (mediaId === CURRENT_ID) {
        onChange("");
        return;
      }
      setSessionImages((prev) => prev.filter((image) => image._id !== mediaId));
    },
    onSave: (response: AIAuthoringMediaResponse) => {
      onChange(response.media.url, response.media.alt);
      setSessionImages([]);
    },
  });

  const open = () => openStudio(value ? CURRENT_ID : null);

  return (
    <>
      {children ? (
        children(open)
      ) : (
        <AiStudioMenu
          label={label}
          subjectNoun={subjectNoun}
          className={className}
          disabled={disabled}
          height={triggerHeight}
          onOpenStudio={open}
        />
      )}
      {studio}
    </>
  );
}
