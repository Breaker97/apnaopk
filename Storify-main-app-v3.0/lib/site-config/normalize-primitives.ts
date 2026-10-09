/**
 * The four readers every settings normalizer is built from. A stored document
 * is untrusted input: each reader returns the typed value when the field is
 * well-formed and the caller's fallback when it is missing or malformed, so
 * a tampered or outdated document can only ever produce values the schema
 * describes. Shared so the header studio, the announcement bar and the
 * sliders cannot drift on what "a number in range" means.
 */

export function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * A finite number clamped to `[min, max]`, rounded to `decimals` places (the
 * header studio stores 2 so a dragged slider does not persist float noise;
 * `undefined` keeps the value as given).
 */
export function readNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  decimals?: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded =
    decimals === undefined
      ? parsed
      : Math.round(parsed * 10 ** decimals) / 10 ** decimals;
  return Math.min(max, Math.max(min, rounded));
}

/** One of a closed list, or the fallback. */
export function readOneOf<T extends readonly string[]>(
  value: unknown,
  options: T,
  fallback: T[number],
): T[number] {
  return options.includes(value as string) ? (value as T[number]) : fallback;
}
