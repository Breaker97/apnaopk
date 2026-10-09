import { randomUUID } from "node:crypto";

import { getStorageService } from "@/lib/storage";
import type { UploadOptions } from "@/lib/storage/types";

import {
  interpretHeroBannerPrompt,
  type HeroBannerRuntime,
} from "./brief";
import { generateHeroBannerVisual } from "./generate";
import { renderHeroBanner } from "./render";
import {
  HERO_BANNER_HEIGHT,
  HERO_BANNER_TARGET_FIELD,
  HERO_BANNER_WIDTH,
  type HeroBannerRequest,
  type HeroBannerResponse,
} from "./types";

type HeroBannerUploadResult = {
  url: string;
  contentType?: string;
  size?: number;
};

export type HeroBannerServiceDependencies = {
  interpret: typeof interpretHeroBannerPrompt;
  generateVisual: typeof generateHeroBannerVisual;
  render: typeof renderHeroBanner;
  upload: (
    buffer: Buffer,
    options: UploadOptions,
  ) => Promise<HeroBannerUploadResult>;
  now: () => number;
  id: () => string;
};

async function defaults(): Promise<HeroBannerServiceDependencies> {
  const storage = await getStorageService();
  return {
    interpret: interpretHeroBannerPrompt,
    generateVisual: generateHeroBannerVisual,
    render: renderHeroBanner,
    upload: storage.uploadFile.bind(storage),
    now: Date.now,
    id: randomUUID,
  };
}

export async function createHeroBanner(
  request: HeroBannerRequest,
  injected?: HeroBannerServiceDependencies,
  runtime: HeroBannerRuntime = {},
): Promise<HeroBannerResponse> {
  const deps = injected || (await defaults());
  const interpreted = await deps.interpret(request, runtime);
  const intermediate = await deps.generateVisual(
    request,
    interpreted.brief,
    runtime,
  );
  const rendered = await deps.render(intermediate, interpreted.brief);
  if (
    rendered.width !== HERO_BANNER_WIDTH ||
    rendered.height !== HERO_BANNER_HEIGHT
  ) {
    throw new Error("Hero banner processor returned invalid dimensions");
  }
  const filename = `ai-hero-banner-${deps.now()}.png`;
  const uploaded = await deps.upload(rendered.buffer, {
    fileName: filename,
    contentType: "image/png",
    fileSize: rendered.buffer.length,
    customPath: "ai-generated/hero-banners/",
    metadata: {
      source: "ai-authoring",
      entity: "home-hero",
      operation: request.operation,
    },
  });
  const warning =
    [interpreted.warning, rendered.warning].filter(Boolean).join(" ") ||
    undefined;
  return {
    targetField: HERO_BANNER_TARGET_FIELD,
    media: {
      _id: deps.id(),
      url: uploaded.url,
      type: "image",
      mimeType: uploaded.contentType || "image/png",
      filename,
      size: uploaded.size || rendered.buffer.length,
      alt: interpreted.brief.alt,
      width: HERO_BANNER_WIDTH,
      height: HERO_BANNER_HEIGHT,
    },
    banner: {
      width: HERO_BANNER_WIDTH,
      height: HERO_BANNER_HEIGHT,
      alt: interpreted.brief.alt,
      textApplied: rendered.textApplied,
    },
    ...(warning ? { warning } : {}),
  };
}
