import { toFile } from "openai";

import { assertOwnStorageUrl } from "@/lib/ai-authoring/media";
import { createAIAuthoringOpenAIClient } from "@/lib/ai-authoring/openai";

import { buildHeroBannerVisualPrompt } from "./prompt";
import type { HeroBannerBrief, HeroBannerRequest } from "./types";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

type HeroImageResponse = {
  data?: Array<{ b64_json?: string }>;
};

function sourceExtension(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

export async function ownedSourceFile(
  sourceUrl: string,
  fetcher: typeof fetch = fetch,
  assertUrl: typeof assertOwnStorageUrl = assertOwnStorageUrl,
) {
  const url = await assertUrl(sourceUrl);
  const response = await fetcher(url.toString(), {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Hero banner source image must not redirect");
  }
  if (!response.ok) {
    throw new Error("Could not load the hero banner source image");
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Hero banner source is not an image");
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    throw new Error("Hero banner source image is too large");
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SOURCE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Hero banner source image is too large");
      }
      chunks.push(Buffer.from(value));
    }
  } else {
    const bytes = await response.arrayBuffer();
    totalBytes = bytes.byteLength;
    if (totalBytes > MAX_SOURCE_BYTES) {
      throw new Error("Hero banner source image is too large");
    }
    chunks.push(Buffer.from(bytes));
  }
  return toFile(
    Buffer.concat(chunks, totalBytes),
    `hero-source.${sourceExtension(contentType)}`,
    { type: contentType },
  );
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
