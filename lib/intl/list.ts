/**
 * "3 and 5", in the locale's own words.
 *
 * A browser with no list data for a locale does not fail: it formats in its
 * own language. Chrome has none for Hausa, Igbo, Xhosa, Yoruba or Zulu, and
 * wrote an English "and" into the middle of their sentences. Those get a plain
 * comma list, which reads the same in any language.
 */
export function formatList(items: readonly string[], locale: string): string {
  if (Intl.ListFormat.supportedLocalesOf(locale).length === 0) {
    return items.join(", ");
  }
  return new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(items);
}
