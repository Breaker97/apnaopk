/**
 * Specification labels and values the catalogue already uses, offered back
 * while a product's specifications are typed — so "Battery" is picked, not
 * retyped as "battery", "Battery " and "Batery" across a hundred products.
 *
 * Pure: the database query (attribute-suggestions-query.ts) hands over raw
 * label/value counts and this decides what a suggestion is.
 */

export interface AttributeSuggestion {
  /** The spelling most products use. */
  name: string;
  /** How many products carry the label, across every spelling of it. */
  count: number;
  /** The label's values, most used first, one entry per spelling-insensitive value. */
  values: string[];
}

export interface AttributeCountRow {
  name: string;
  value: string;
  count: number;
}

/** Past this a datalist is a scroll, not a suggestion. */
export const MAX_ATTRIBUTE_SUGGESTIONS = 200;
export const MAX_VALUES_PER_ATTRIBUTE = 25;

interface Tally {
  count: number;
  spellings: Map<string, number>;
}

function mostUsed(spellings: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [spelling, count] of spellings) {
    // Ties go to the alphabetically first spelling, so the answer is stable.
    if (count > bestCount || (count === bestCount && spelling < best)) {
      best = spelling;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Raw (label, value, count) rows → one suggestion per label.
 *
 * Labels are grouped ignoring case and surrounding space — "Battery" and
 * "battery " are one label — and shown in the spelling most products use.
 * Values are grouped the same way under their label. Blank labels are not
 * suggestions; blank values are simply not offered.
 */
export function mergeAttributeSuggestions(
  rows: AttributeCountRow[],
): AttributeSuggestion[] {
  const labels = new Map<string, Tally & { values: Map<string, Tally> }>();

  for (const row of rows) {
    const name = row.name.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const count = Number.isFinite(row.count) && row.count > 0 ? row.count : 1;
    const labelKey = name.toLowerCase();
    const label = labels.get(labelKey) ?? {
      count: 0,
      spellings: new Map<string, number>(),
      values: new Map<string, Tally>(),
    };
    label.count += count;
    label.spellings.set(name, (label.spellings.get(name) ?? 0) + count);

    const value = row.value.trim().replace(/\s+/g, " ");
    if (value) {
      const valueKey = value.toLowerCase();
      const tally = label.values.get(valueKey) ?? {
        count: 0,
        spellings: new Map<string, number>(),
      };
      tally.count += count;
      tally.spellings.set(value, (tally.spellings.get(value) ?? 0) + count);
      label.values.set(valueKey, tally);
    }
    labels.set(labelKey, label);
  }

  return [...labels.values()]
    .map((label) => ({
      name: mostUsed(label.spellings),
      count: label.count,
      values: [...label.values.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_VALUES_PER_ATTRIBUTE)
        .map((tally) => mostUsed(tally.spellings)),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MAX_ATTRIBUTE_SUGGESTIONS);
}

/**
 * The labels still worth offering on a product: everything the catalogue
 * uses except what this product already has, so "Brand" is not suggested a
 * second time. The row being edited keeps its own label in the list.
 */
export function remainingAttributeSuggestions(
  suggestions: AttributeSuggestion[],
  usedNames: string[],
  editingName = "",
): AttributeSuggestion[] {
  const editing = editingName.trim().toLowerCase();
  const used = new Set(
    usedNames
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name && name !== editing),
  );
  return suggestions.filter((entry) => !used.has(entry.name.toLowerCase()));
}

/** The known values for a label, matched the way labels are grouped. */
export function valuesForAttribute(
  suggestions: AttributeSuggestion[],
  name: string,
): string[] {
  const key = name.trim().replace(/\s+/g, " ").toLowerCase();
  if (!key) return [];
  return suggestions.find((entry) => entry.name.toLowerCase() === key)?.values ?? [];
}
