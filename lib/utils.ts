import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Truncate a string to a maximum number of words, appending "..." when
 * the input exceeds the limit. Useful for fitting long product names
 * inside narrow UI panels (e.g. the POS checkout sidebar).
 *
 * @example
 * truncateByWords("Apple iPhone 15 Pro Max 256GB Blue Titanium", 5)
 * // => "Apple iPhone 15 Pro Max..."
 */
export function truncateByWords(text: string, maxWords: number): string {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return "";
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return trimmed;
  return `${words.slice(0, maxWords).join(" ")}...`;
}

/** A non-null, non-array object — the shape every normalizer reads keys off. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `isRecord`, minus class instances, Dates, Maps and friends: only a literal
 * `{}` (or `Object.create(null)`) passes. What a JSON body can contain.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}
