import { ValidationError } from "@/lib/api/errors";

import type { HeroBannerRequest } from "./types";

const OPERATIONS = new Set(["generate", "edit"]);
const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("Invalid hero banner payload");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, label: string): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim();
  if (clean.length > max) {
    throw new ValidationError(`${label} must not exceed ${max} characters`);
  }
  return clean || undefined;
}

export function isHeroBannerEnabled(
  env: Partial<NodeJS.ProcessEnv> = process.env,
): boolean {
  return env.AI_HERO_BANNER_ENABLED?.trim().toLowerCase() === "true";
}

export function normalizeHeroBannerRequest(input: unknown): HeroBannerRequest {
  const source = record(input);
  if ("targetField" in source) {
    throw new ValidationError("Hero banner target is fixed");
  }
  if ("width" in source || "height" in source || "options" in source) {
    throw new ValidationError("Hero banner dimensions are fixed");
  }
  const operation = text(source.operation, 20, "Hero banner operation");
  if (!operation || !OPERATIONS.has(operation)) {
    throw new ValidationError("Unsupported hero banner operation");
  }
  const prompt = text(source.prompt, 2000, "Hero banner prompt");
  if (!prompt) throw new ValidationError("Hero banner prompt is required");
  const locale = text(source.locale, 20, "Hero banner locale") || "en";
  if (!LOCALE_RE.test(locale)) {
    throw new ValidationError("Invalid hero banner locale");
  }
  const sourceUrl = text(source.sourceUrl, 2000, "Hero banner source URL");
  if (operation === "edit" && !sourceUrl) {
    throw new ValidationError("A source image is required to edit a hero banner");
  }
  return {
    operation: operation as HeroBannerRequest["operation"],
    locale,
    prompt,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}
