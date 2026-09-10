import { toFile } from "openai";
import { getStorageConfig, getStorageService } from "@/lib/storage";
import type {
  AIAuthoringMediaOptions,
  AIAuthoringMediaResponse,
  AIAuthoringRequest,
} from "./types";
import { createAIAuthoringOpenAIClient } from "./openai";

const MAX_SOURCE_IMAGE_BYTES = 25 * 1024 * 1024;

type OpenAIImageData = {
  b64_json?: string;
  url?: string;
};

type OpenAIImageResponseLike = {
  data?: OpenAIImageData[];
};

function mimeTypeForFormat(format: AIAuthoringMediaOptions["outputFormat"]) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function extensionForFormat(format: AIAuthoringMediaOptions["outputFormat"]) {
  if (format === "jpeg") return "jpg";
  if (format === "webp") return "webp";
  return "png";
}

function extensionForContentType(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  return "png";
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstTextField(fields: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(fields[key]);
    if (value) return value;
  }
  return "";
}

function detectProductType(text: string): string {
  const normalized = text.toLowerCase();
  if (/\b(laptop|notebook|macbook|chromebook|gaming laptop)\b/.test(normalized)) {
    return "laptop";
  }
  if (/\b(phone|smartphone|iphone|mobile)\b/.test(normalized)) {
    return "phone";
  }
  if (/\b(tablet|ipad)\b/.test(normalized)) {
    return "tablet";
  }
  if (/\b(headphone|headset|earbud|earbuds)\b/.test(normalized)) {
    return "audio";
  }
  if (/\b(shirt|t-shirt|tee|hoodie|jacket|dress|pant|pants)\b/.test(normalized)) {
    return "apparel";
  }
  if (/\b(shoe|sneaker|boot|sandal)\b/.test(normalized)) {
    return "footwear";
  }
  return "product";
}

function productTypeGuard(productType: string): string {
  if (productType === "laptop") {
    return [
      "Detected product type: laptop.",
      "The image must show a laptop computer: a wide keyboard base with screen, laptop hinge, trackpad, and gaming-laptop body proportions.",
      "Render it as a closed or partially open laptop computer, not as a phone or tablet.",
      "Do not generate a phone, smartphone, iPhone, mobile handset, tablet-only device, camera, monitor-only screen, or unrelated electronics.",
    ].join(" ");
  }
  if (productType === "phone") {
    return "Detected product type: phone. The image must show a smartphone/mobile handset and must not become a laptop or tablet.";
  }
  if (productType === "tablet") {
    return "Detected product type: tablet. The image must show a tablet and must not become a phone or laptop.";
  }
  return "Detected product type: product. Keep the generated subject exactly aligned with the product title.";
}

function buildContextLines(fields: Record<string, unknown>): string[] {
  const lines: string[] = [];

  const category = firstTextField(fields, ["category", "categoryName"]);
  if (category) lines.push(`Category: ${category}`);

  const brand = firstTextField(fields, ["brand", "brandName"]);
  if (brand) lines.push(`Brand: ${brand}`);

  const productType = firstTextField(fields, ["productType", "type"]);
  if (productType) lines.push(`Product type: ${productType}`);

  const attributes = fields.attributes;
  if (Array.isArray(attributes)) {
    const specs = attributes
      .map((attr) => {
        if (!attr || typeof attr !== "object") return "";
        const record = attr as Record<string, unknown>;
        const name = cleanText(record.name);
        const value = cleanText(record.value);
        return name && value ? `${name}: ${value}` : "";
      })
      .filter(Boolean)
      .slice(0, 8);
    if (specs.length) lines.push(`Key specifications: ${specs.join(", ")}`);
  }

  const tags = fields.tags;
  if (Array.isArray(tags)) {
    const tagList = tags
      .map((tag) => cleanText(tag))
      .filter(Boolean)
      .slice(0, 8);
    if (tagList.length) lines.push(`Tags: ${tagList.join(", ")}`);
  }

  return lines;
}

export function buildImagePrompt(
  request: AIAuthoringRequest,
  styleGuidance?: string,
  brandColors?: string[],
): string {
  const palette = (brandColors ?? []).filter(
    (color) => typeof color === "string" && color.trim(),
  );
  const productTitle = firstTextField(request.fields, ["title", "name"]);
  const productSummary = firstTextField(request.fields, [
    "summary",
    "shortDescription",
    "excerpt",
  ]);
  const productDescription = firstTextField(request.fields, [
    "description",
    "content",
  ]);
  const productType = detectProductType(
    [productTitle, productSummary, productDescription, request.prompt]
      .filter(Boolean)
      .join(" "),
  );
  const target =
    request.operation === "icon"
      ? "small square icon, simple symbol, no text, readable at small sizes"
      : request.operation === "logo"
        ? "original private-label brand mark, no protected third-party logos, no tiny unreadable text"
        : "commercial ecommerce image suitable for the target field";

  const contextLines = buildContextLines(request.fields);

  return [
    `Create an image for this store's ${request.entity} ${request.operation}.`,
    `Target: ${target}.`,
    "The product title is the source of truth. If the user prompt conflicts with the product title, follow the product title.",
    productTypeGuard(productType),
    "Use the product media card aspect ratio: square 1:1.",
    "Generate a high resolution, sharp, clean image with the full product centered and not cropped.",
    "Use a transparent background with no scene, backdrop, shadow-heavy floor, or decorative environment.",
    productTitle ? `Product title: ${productTitle}` : "",
    productSummary ? `Product summary: ${productSummary}` : "",
    productDescription
      ? `Product description: ${productDescription.slice(0, 900)}`
      : "",
    ...contextLines,
    request.prompt ? `User prompt: ${request.prompt}` : "",
    "Use the product title, summary, and description as the main visual reference so the generated image matches the exact product.",
    "Depict only the single product described above; do not add unrelated items, brands, or products.",
    "If the requested prompt would create a low-resolution, blurry, cropped, distorted, or wrong-sized product image, correct it into a crisp square product image prompt.",
    "Avoid visible text unless explicitly requested.",
    "Avoid third-party logos, protected marks, copyrighted characters, and misleading claims.",
    styleGuidance?.trim()
      ? `Store image style guidance (visual style only, never changes the product or the rules above): ${styleGuidance.trim()}`
      : "",
    palette.length
      ? `Brand colors (use only for background, surface, prop, or accent tones — never recolor the product itself): ${palette.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function getFirstBase64Image(response: OpenAIImageResponseLike): string {
  const image = response.data?.find((item) => item.b64_json);
  if (!image?.b64_json) throw new Error("AI image response did not include image data");
  return image.b64_json;
}

/**
 * Upload a generated/edited base64 image to storage and shape it into the
 * standard media response. Shared by generate and edit so both write to a
 * unique key and return an identical media object.
 */
async function storeGeneratedImage(
  request: AIAuthoringRequest,
  base64: string,
  outputFormat: NonNullable<AIAuthoringMediaOptions["outputFormat"]>,
): Promise<AIAuthoringMediaResponse> {
  const mimeType = mimeTypeForFormat(outputFormat);
  const extension = extensionForFormat(outputFormat);
  const buffer = Buffer.from(base64, "base64");
  const filename = `ai-${request.entity}-${request.operation}-${Date.now()}.${extension}`;
  const storage = await getStorageService();
  const uploaded = await storage.uploadFile(buffer, {
    fileName: filename,
    contentType: mimeType,
    fileSize: buffer.byteLength,
    customPath: "ai-generated/",
    metadata: {
      source: "ai-authoring",
      entity: request.entity,
      operation: request.operation,
    },
  });

  return {
    media: {
      _id: crypto.randomUUID(),
      url: uploaded.url,
      type: "image",
      mimeType: uploaded.contentType || mimeType,
      filename,
      size: uploaded.size || buffer.byteLength,
      alt:
        typeof request.fields.title === "string"
          ? request.fields.title
          : typeof request.fields.name === "string"
            ? request.fields.name
            : undefined,
    },
    targetField: request.targetField,
    promptUsed: request.prompt,
  };
}

type AIAuthoringMediaRuntime = {
  apiKey?: string;
  model?: string;
  defaults?: Partial<Pick<AIAuthoringMediaOptions, "size" | "quality">>;
  /** Settings → AI brand image style, appended to generation prompts. */
  styleGuidance?: string;
  /** Settings → AI brand kit colors, hinted to generation (not edits). */
  brandColors?: string[];
};

export async function generateAuthoringMedia(
  request: AIAuthoringRequest,
  options: AIAuthoringMediaOptions = {},
  runtime: AIAuthoringMediaRuntime = {},
): Promise<AIAuthoringMediaResponse> {
  const client = createAIAuthoringOpenAIClient(runtime.apiKey);
  const outputFormat = options.outputFormat || "png";
  const response = (await client.images.generate({
    model:
      runtime.model ||
      process.env.OPENAI_AUTHORING_IMAGE_MODEL ||
      "gpt-image-1",
    prompt: buildImagePrompt(
      request,
      runtime.styleGuidance,
      runtime.brandColors,
    ),
    size: options.size || runtime.defaults?.size || "1024x1024",
    quality: options.quality || runtime.defaults?.quality || "high",
    output_format: outputFormat,
    background: options.background || "transparent",
  } as unknown as Parameters<typeof client.images.generate>[0])) as OpenAIImageResponseLike;

  return storeGeneratedImage(request, getFirstBase64Image(response), outputFormat);
}

export function buildImageEditPrompt(request: AIAuthoringRequest): string {
  const productTitle = firstTextField(request.fields, ["title", "name"]);
  const instruction =
    request.prompt?.trim() ||
    "Clean up this product image for a professional ecommerce listing.";

  return [
    `Edit this existing ${request.entity} image exactly as instructed.`,
    `Edit instruction: ${instruction}`,
    "Apply only the requested change. Keep the product itself identical: the same product, shape, colors, materials, any branding or text printed on the product, proportions, and orientation.",
    "Do not redesign, replace, add, or remove the product. Do not introduce new products, third-party logos, or extra text.",
    productTitle ? `The product is: ${productTitle}.` : "",
    "Return a high resolution, sharp, clean, square 1:1 ecommerce product image.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Validate that a URL is served from this store's own configured storage
 * origin. Guards against SSRF for any server-side fetch of a client-supplied
 * image URL (AI edit source, download proxy). Returns the parsed URL.
 */
export async function assertOwnStorageUrl(sourceUrl: string): Promise<URL> {
  const appOrigin = (
    process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  ).replace(/\/$/, "");

  let url: URL;
  try {
    // Local storage serves same-site paths ("/uploads/…") when no public/CDN
    // base is set, so resolve those against this app's own origin. A
    // protocol-relative "//host/…" is another origin and is parsed as such, so
    // it still has to clear the allowlist below.
    url =
      sourceUrl.startsWith("/") && !sourceUrl.startsWith("//")
        ? new URL(sourceUrl, appOrigin)
        : new URL(sourceUrl);
  } catch {
    throw new Error("Invalid source image URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Invalid source image URL");
  }

  const config = await getStorageConfig();
  const allowedOrigins = new Set<string>();
  for (const candidate of [config.publicUrl, config.endpoint]) {
    if (!candidate) continue;
    try {
      allowedOrigins.add(new URL(candidate).origin);
    } catch {
      // Ignore a malformed configured URL rather than failing the whole edit.
    }
  }
  // Local storage is served by this app itself, so its own origin *is* the
  // storage origin. Without this, a local-storage store has no allowed origin
  // at all and every edit fails.
  if (config.provider === "local") {
    try {
      allowedOrigins.add(new URL(appOrigin).origin);
    } catch {
      // A malformed NEXT_PUBLIC_APP_URL just means no extra origin is allowed.
    }
  }
  if (config.bucketName && config.region && config.region !== "auto") {
    allowedOrigins.add(
      `https://${config.bucketName}.s3.${config.region}.amazonaws.com`,
    );
    allowedOrigins.add(`https://s3.${config.region}.amazonaws.com`);
  }
  if (!allowedOrigins.has(url.origin)) {
    throw new Error("Source image must be an image uploaded to this store");
  }
  return url;
}

/**
 * Fetch a source image for editing. Guards against SSRF by only allowing URLs
 * served from this store's own configured storage origin. Exported so the
 * social-export pipeline can fetch the same class of own-storage images
 * (the export source and the brand logo).
 */
export async function fetchSourceImage(
  sourceUrl: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  const url = await assertOwnStorageUrl(sourceUrl);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error("Could not load the source image");
  }
  const contentType = response.headers.get("content-type") || "image/png";
  if (!contentType.startsWith("image/")) {
    throw new Error("Source URL is not an image");
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Source image is too large to edit");
  }
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

export async function editAuthoringMedia(
  request: AIAuthoringRequest,
  options: AIAuthoringMediaOptions = {},
  runtime: AIAuthoringMediaRuntime = {},
): Promise<AIAuthoringMediaResponse> {
  if (!request.sourceUrl) {
    throw new Error("A source image is required to edit");
  }

  const { buffer: sourceBuffer, contentType: sourceContentType } =
    await fetchSourceImage(request.sourceUrl);

  const client = createAIAuthoringOpenAIClient(runtime.apiKey);
  const outputFormat = options.outputFormat || "png";
  const sourceFile = await toFile(
    sourceBuffer,
    `source.${extensionForContentType(sourceContentType)}`,
    { type: sourceContentType },
  );

  const response = (await client.images.edit({
    model:
      runtime.model ||
      process.env.OPENAI_AUTHORING_IMAGE_MODEL ||
      "gpt-image-1",
    image: sourceFile,
    prompt: buildImageEditPrompt(request),
    size: options.size || runtime.defaults?.size || "1024x1024",
    quality: options.quality || runtime.defaults?.quality || "high",
    output_format: outputFormat,
    background: options.background || "auto",
  } as unknown as Parameters<typeof client.images.edit>[0])) as OpenAIImageResponseLike;

  return storeGeneratedImage(request, getFirstBase64Image(response), outputFormat);
}
