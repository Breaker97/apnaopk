"use client";

import { useMemo, useState } from "react";

import { toast } from "@/components/ui/toast-notification";
import type {
  AIAuthoringMediaResponse,
  AIAuthoringRequest,
} from "@/lib/ai-authoring/types";
import {
  HERO_BANNER_HEIGHT,
  HERO_BANNER_TARGET_FIELD,
  HERO_BANNER_WIDTH,
  type HeroBannerResponse,
} from "@/lib/ai-authoring/hero-banner/types";

import { AiImageStudio, type StudioImage } from "./ai-image-studio";
import { AiStudioMenu } from "./ai-studio-menu";
import { clearAiStudioDraftsByPersistKeyPrefix } from "./studio-drafts";
import type { UploadedImage } from "./upload-image";
import { isRecord } from "@/lib/utils";

type Props = {
  locale: string;
  slideIdentity: string;
  value: string;
  alt: string;
  onChange: (url: string, alt: string) => void;
};

const CURRENT_ID = "hero-current";

type ApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
};

function isHeroBannerResponse(value: unknown): value is HeroBannerResponse {
  if (!isRecord(value) || !isRecord(value.media) || !isRecord(value.banner)) {
    return false;
  }
  const { media, banner } = value;
  return (
    value.targetField === HERO_BANNER_TARGET_FIELD &&
    typeof media._id === "string" &&
    typeof media.url === "string" &&
    media.type === "image" &&
    typeof media.mimeType === "string" &&
    typeof media.filename === "string" &&
    typeof media.size === "number" &&
    Number.isFinite(media.size) &&
    media.size >= 0 &&
    (media.alt === undefined || typeof media.alt === "string") &&
    media.width === HERO_BANNER_WIDTH &&
    media.height === HERO_BANNER_HEIGHT &&
    banner.width === HERO_BANNER_WIDTH &&
    banner.height === HERO_BANNER_HEIGHT &&
    typeof banner.alt === "string" &&
    typeof banner.textApplied === "boolean" &&
    (value.warning === undefined || typeof value.warning === "string")
  );
}

function valueHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function clearHeroBannerStudioDrafts(slideIdentity: string): void {
  clearAiStudioDraftsByPersistKeyPrefix(
    `home-hero-slide-${slideIdentity}-`,
  );
}

export function isApplicableHeroBannerResult(
  result: AIAuthoringMediaResponse,
): boolean {
  return (
    result.targetField === HERO_BANNER_TARGET_FIELD &&
    result.media.width === HERO_BANNER_WIDTH &&
    result.media.height === HERO_BANNER_HEIGHT
  );
}

export async function requestHeroBanner(
  request: AIAuthoringRequest,
  fetcher: typeof fetch = fetch,
): Promise<AIAuthoringMediaResponse> {
  const response = await fetcher("/api/admin/ai-authoring/hero-banner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operation: request.operation === "image_edit" ? "edit" : "generate",
      locale: request.locale,
      prompt: request.prompt,
      ...(request.sourceUrl ? { sourceUrl: request.sourceUrl } : {}),
    }),
  });
  const payload = (await response
    .json()
    .catch(() => ({}))) as ApiEnvelope<HeroBannerResponse>;
  if (!response.ok || payload.success !== true || !payload.data) {
    throw new Error(
      payload.message || payload.error || "Hero banner generation failed",
    );
  }
  const result = payload.data;
  if (!isHeroBannerResponse(result)) {
    throw new Error("The generated banner did not match the Hero contract");
  }
  return {
    media: result.media,
    targetField: result.targetField,
    warning: result.warning,
  };
}

export function HeroBannerAiStudio(props: Props) {
  return <HeroBannerAiStudioInstance key={props.slideIdentity} {...props} />;
}

function HeroBannerAiStudioInstance({
  locale,
  slideIdentity,
  value,
  alt,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [sessionImages, setSessionImages] = useState<StudioImage[]>([]);

  const images = useMemo<StudioImage[]>(() => {
    const current = value
      ? [{ _id: CURRENT_ID, url: value, alt }]
      : [];
    return [
      ...current,
      ...sessionImages.filter((image) => image.url !== value),
    ];
  }, [value, alt, sessionImages]);

  const requestBase = {
    entity: "content_page" as const,
    locale,
    targetField: HERO_BANNER_TARGET_FIELD,
    fields: { section: "home.hero" },
  };

  const generate = async (
    request: AIAuthoringRequest,
  ): Promise<AIAuthoringMediaResponse | null> => {
    try {
      const response = await requestHeroBanner(request);
      if (response.warning) toast.warning(response.warning);
      return response;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Hero banner generation failed",
      );
      return null;
    }
  };

  const trackUpload = (media: UploadedImage) => {
    setSessionImages((current) =>
      current.some((image) => image._id === media._id)
        ? current
        : [...current, { _id: media._id, url: media.url, alt: media.alt }],
    );
  };

  return (
    <>
      <AiStudioMenu
        label="Open AI Studio for this Hero slide"
        subjectNoun="hero banner"
        onOpenStudio={() => setOpen(true)}
      />
      <AiImageStudio
        open={open}
        images={images}
        initialMediaId={value ? CURRENT_ID : null}
        surface="hero_banner"
        breadcrumbRoot="Home page"
        breadcrumbLeaf="Hero banner"
        savedMessage="Hero banner applied"
        saveLabel="Use banner"
        subjectNoun="hero banner"
        promptPlaceholder={'Describe a 1360 x 314 banner. Add labelled text such as Headline: "Summer Sale" or Button: "Shop now".'}
        persistKey={`home-hero-slide-${slideIdentity}-${valueHash(value)}`}
        editRequest={{ ...requestBase, operation: "image_edit" }}
        generateRequest={{ ...requestBase, operation: "image" }}
        generateDefaults={{
          size: "1536x1024",
          quality: "high",
          outputFormat: "png",
          background: "opaque",
        }}
        onOpenChange={setOpen}
        onGenerate={(request) => generate(request)}
        onUpload={trackUpload}
        onSave={(result) => {
          if (!isApplicableHeroBannerResult(result)) {
            toast.error("The generated banner did not match the Hero contract");
            return false;
          }
          onChange(
            result.media.url,
            result.media.alt || "Promotional hero banner",
          );
          setSessionImages([]);
          return true;
        }}
      />
    </>
  );
}
