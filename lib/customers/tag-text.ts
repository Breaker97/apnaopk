/**
 * Customer and order tags travel through the admin forms as one comma
 * separated string, and the tag field works on a list: these two convert.
 */

/** "vip, repeat, vip" → ["vip", "repeat"]: trimmed, each once, in order. */
export function parseTagText(text: string): string[] {
  if (!text.trim()) return [];
  return Array.from(
    new Set(
      text
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

/** ["vip", "repeat"] → "vip, repeat". */
export function joinTagText(tags: readonly string[]): string {
  return tags.join(", ");
}
