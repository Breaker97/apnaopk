import { ValidationError } from "@/lib/api/errors";
import {
  AI_AUTHORING_AUDIENCES,
  AI_AUTHORING_ENTITIES,
  AI_AUTHORING_MODES,
  AI_AUTHORING_OPERATIONS,
  AI_AUTHORING_TONES,
  type AIAuthoringConstraints,
  type AIAuthoringAudience,
  type AIAuthoringMediaOptions,
  type AIAuthoringRequest,
  type AIAuthoringTone,
} from "./types";
import { isPlainObject } from "@/lib/utils";

const ENTITY_SET = new Set<string>(AI_AUTHORING_ENTITIES);
const OPERATION_SET = new Set<string>(AI_AUTHORING_OPERATIONS);
const MODE_SET = new Set<string>(AI_AUTHORING_MODES);
const TONE_SET = new Set<string>(AI_AUTHORING_TONES);
const AUDIENCE_SET = new Set<string>(AI_AUTHORING_AUDIENCES);
const IMAGE_SIZES = new Set(["auto", "1024x1024", "1024x1536", "1536x1024"]);
const IMAGE_QUALITIES = new Set(["auto", "medium", "high"]);
const IMAGE_FORMATS = new Set(["png", "jpeg", "webp"]);
const IMAGE_BACKGROUNDS = new Set(["auto", "transparent", "opaque"]);

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function cleanFields(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  return value;
}

/**
 * A same-site path like "/uploads/2025/07/x.png" — the URL shape local storage
 * serves when no public/CDN base is configured. A protocol-relative "//host/x"
 * points at another origin, so it is deliberately not same-site.
 */
function isSameSiteRelative(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

function cleanConstraints(value: unknown): AIAuthoringConstraints | undefined {
  if (!isPlainObject(value)) return undefined;

  const constraints: AIAuthoringConstraints = {};
  if (value.maxLength !== undefined) {
    const maxLength = Number(value.maxLength);
    if (Number.isFinite(maxLength) && maxLength > 0) {
      constraints.maxLength = Math.min(Math.round(maxLength), 5000);
    }
  }
  if (value.html !== undefined) constraints.html = Boolean(value.html);
  if (typeof value.tone === "string" && TONE_SET.has(value.tone)) {
    constraints.tone = value.tone as AIAuthoringTone;
  }
  if (typeof value.audience === "string" && AUDIENCE_SET.has(value.audience)) {
    constraints.audience = value.audience as AIAuthoringAudience;
  }

  return Object.keys(constraints).length ? constraints : undefined;
}

export function normalizeAIAuthoringRequest(input: unknown): AIAuthoringRequest {
  if (!isPlainObject(input)) throw new ValidationError("Invalid AI authoring payload");

  const entity = cleanString(input.entity, 60);
  if (!entity || !ENTITY_SET.has(entity)) {
    throw new ValidationError("Unsupported AI authoring entity");
  }

  const operation = cleanString(input.operation, 60);
  if (!operation || !OPERATION_SET.has(operation)) {
    throw new ValidationError("Unsupported AI authoring operation");
  }

  const mode = cleanString(input.mode, 30);
  if (mode && !MODE_SET.has(mode)) {
    throw new ValidationError("Unsupported AI authoring mode");
  }

  const request: AIAuthoringRequest = {
    entity: entity as AIAuthoringRequest["entity"],
    operation: operation as AIAuthoringRequest["operation"],
    locale: cleanString(input.locale, 20) || "en",
    fields: cleanFields(input.fields),
  };

  if (mode) request.mode = mode as AIAuthoringRequest["mode"];
  const targetField = cleanString(input.targetField, 100);
  if (targetField) request.targetField = targetField;
  const entityId = cleanString(input.entityId, 100);
  if (entityId) request.entityId = entityId;
  const prompt = cleanString(input.prompt, 2000);
  if (prompt) request.prompt = prompt;
  const sourceUrl = cleanString(input.sourceUrl, 2000);
  if (sourceUrl) {
    if (isSameSiteRelative(sourceUrl)) {
      // No origin to parse against here — keep the path as stored and let
      // assertOwnStorageUrl resolve it against this app's origin and run the
      // SSRF origin check before anything fetches it.
      request.sourceUrl = sourceUrl;
    } else {
      let parsed: URL | null = null;
      try {
        parsed = new URL(sourceUrl);
      } catch {
        parsed = null;
      }
      if (
        !parsed ||
        (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      ) {
        throw new ValidationError("Invalid source image URL");
      }
      request.sourceUrl = parsed.toString();
    }
  }
  const constraints = cleanConstraints(input.constraints);
  if (constraints) request.constraints = constraints;

  return request;
}

export function validateMediaOptions(input: unknown): AIAuthoringMediaOptions {
  if (!isPlainObject(input)) return {};
  const options: AIAuthoringMediaOptions = {};

  const size = cleanString(input.size, 20);
  if (size) {
    if (!IMAGE_SIZES.has(size)) throw new ValidationError("Invalid image size");
    options.size = size as AIAuthoringMediaOptions["size"];
  }

  const quality = cleanString(input.quality, 20);
  if (quality) {
    if (!IMAGE_QUALITIES.has(quality)) {
      throw new ValidationError("Invalid image quality");
    }
    options.quality = quality as AIAuthoringMediaOptions["quality"];
  }

  const outputFormat = cleanString(input.outputFormat, 20);
  if (outputFormat) {
    if (!IMAGE_FORMATS.has(outputFormat)) {
      throw new ValidationError("Invalid image output format");
    }
    options.outputFormat =
      outputFormat as AIAuthoringMediaOptions["outputFormat"];
  }

  const background = cleanString(input.background, 20);
  if (background) {
    if (!IMAGE_BACKGROUNDS.has(background)) {
      throw new ValidationError("Invalid image background");
    }
    options.background = background as AIAuthoringMediaOptions["background"];
  }

  return options;
}
