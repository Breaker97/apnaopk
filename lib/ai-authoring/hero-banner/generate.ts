import { toFile } from "openai";

import { fetchSourceImage } from "@/lib/ai-authoring/media";
import { createAIAuthoringOpenAIClient } from "@/lib/ai-authoring/openai";

import { buildHeroBannerVisualPrompt } from "./prompt";
import type { HeroBannerBrief, HeroBannerRequest } from "./types";

type HeroImageResponse = {
  data?: Array<{ b64_json?: string }>;
};

function sourceExtension(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

async function ownedSourceFile(sourceUrl: string) {
  const { buffer, contentType } = await fetchSourceImage(sourceUrl);
  return toFile(buffer, `hero-source.${sourceExtension(contentType)}`, {
    type: contentType,
  });
}

export async function generateHeroBannerVisual(
  request: HeroBannerRequest,
  brief: HeroBannerBrief,
  runtime: { apiKey?: string; imageModel?: string } = {},
): Promise<Buffer> {
  const client = createAIAuthoringOpenAIClient(runtime.apiKey);
  const prompt = buildHeroBannerVisualPrompt(request, brief);
  const common = {
    model:
      runtime.imageModel ||
      process.env.OPENAI_AUTHORING_IMAGE_MODEL ||
      "gpt-image-1",
    prompt,
    size: "1536x1024",
    quality: "high",
    output_format: "png",
    background: "opaque",
  } as const;
  const response = (request.operation === "edit"
    ? await client.images.edit({
        ...common,
        image: await ownedSourceFile(request.sourceUrl!),
      } as never)
    : await client.images.generate(common as never)) as HeroImageResponse;
  const encoded = response.data?.find((item) => item.b64_json)?.b64_json;
  if (!encoded) {
    throw new Error("AI hero banner response did not include image data");
  }
  return Buffer.from(encoded, "base64");
}
