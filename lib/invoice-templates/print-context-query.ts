import { ValidationError } from "@/lib/api/errors";
import { TEMPLATE_CATEGORIES, TEMPLATE_LOCALES, type TemplateCategory, type TemplateLocale } from "./types";

/** The query string both print-context routes take (§4.9). */

export function parseCategory(value: string | null): TemplateCategory {
  if (value && (TEMPLATE_CATEGORIES as readonly string[]).includes(value)) return value as TemplateCategory;
  throw new ValidationError(`category must be one of ${TEMPLATE_CATEGORIES.join(", ")}`);
}

export function parseLocale(value: string | null): TemplateLocale | undefined {
  if (value && (TEMPLATE_LOCALES as readonly string[]).includes(value)) return value as TemplateLocale;
  return undefined;
}
