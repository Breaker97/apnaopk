"use client";

import { MediaUploader, type UploadedMedia } from "@/components/ui/media-uploader";
import { AiStudioImageField } from "@/components/ai-authoring/ai-studio-image-field";
import { HeroBannerAiStudio } from "@/components/ai-authoring/hero-banner-ai-studio";
import { PROMO_CARD_SLOT_STUDIOS } from "@/components/ai-authoring/promo-card-ai-studio";

export interface ImageFieldContext {
  locale: string;
  sectionType: string;
  sectionId: string;
  blockType?: string;
  blockId?: string;
  blockIndex?: number;
}

/**
 * The single-image control every image field renders, with the right AI
 * Studio wired per context: slideshow slides keep the dedicated hero-banner
 * studio (it also writes alt text), promotion-grid cards keep their
 * slot-shaped studios, everything else gets the generic image studio.
 */
export function SectionImageField({
  value,
  onChange,
  onAltChange,
  context,
  uploadTitle,
  sizeGuide,
  previewAspectRatio = "16 / 6",
}: {
  value: string;
  onChange: (url: string) => void;
  /** Provided when the schema has a sibling alt field the AI can fill. */
  onAltChange?: (alt: string) => void;
  context: ImageFieldContext;
  uploadTitle: string;
  sizeGuide?: string;
  previewAspectRatio?: string;
}) {
  const isHeroSlide =
    context.sectionType === "slideshow" && context.blockType === "slide";
  const promoSlot =
    context.sectionType === "promotion-grid" && context.blockType === "card"
      ? (PROMO_CARD_SLOT_STUDIOS[context.blockIndex ?? 0] ??
        PROMO_CARD_SLOT_STUDIOS[2])
      : null;

  const aiAction = isHeroSlide ? (
    <HeroBannerAiStudio
      locale={context.locale}
      slideIdentity={context.blockId ?? context.sectionId}
      value={value}
      alt=""
      onChange={(url, alt) => {
        onChange(url);
        if (alt) onAltChange?.(alt);
      }}
    />
  ) : (
    <AiStudioImageField
      entity="content_page"
      scope="admin"
      locale={context.locale}
      targetField={`${context.sectionType}Image`}
      audience="shopper"
      getFields={() => ({
        section: context.sectionType,
        ...(context.blockType ? { block: context.blockType } : {}),
      })}
      value={value}
      onChange={(url) => onChange(url)}
      subjectNoun="section image"
      persistKey={`store-page:${context.sectionId}:${context.blockId ?? "settings"}`}
      {...(promoSlot
        ? {
            surface: promoSlot.surface,
            generateDefaults: promoSlot.generateDefaults,
            postProcessResult: promoSlot.postProcessResult,
            promptPlaceholder: promoSlot.promptPlaceholder,
          }
        : {})}
    />
  );

  return (
    <MediaUploader
      maxFiles={1}
      acceptTypes={["image"]}
      uploadTitle={uploadTitle}
      sizeGuide={sizeGuide}
      mediaGridClassName="grid-cols-1 md:grid-cols-1"
      previewAspectRatio={previewAspectRatio}
      previewFit="contain"
      previewTileClassName="bg-muted"
      showCoverBadge={false}
      coverHint={false}
      value={
        value
          ? [
              {
                _id: `${context.sectionId}-${context.blockId ?? "image"}`,
                url: value,
                type: "image",
                mimeType: "image/*",
                position: 0,
              } satisfies UploadedMedia,
            ]
          : []
      }
      onChange={(items) => {
        const image = items.find((item) => item.type === "image");
        onChange(image?.url || "");
      }}
      aiGenerateAction={aiAction}
    />
  );
}
