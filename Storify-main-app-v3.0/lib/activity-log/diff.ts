/**
 * What an Activity Log entry changed, as the rows of the detail sheet's table.
 *
 * Pure, so the edge cases are testable without a browser. An entry's `before`
 * and `after` are whatever the route chose to record: a handful of fields, or a
 * whole document, or — for a create or a delete — only one side. This turns them
 * into one line per leaf that actually differs.
 */

/** One side of a row: the text to show, and how to show it. */
export interface DiffValue {
  /** Display text. Empty for null and "", which the sheet words itself. */
  text: string;
  /** Null or an empty string: the sheet shows its own "empty" wording, muted. */
  empty: boolean;
  /**
   * `[REDACTED]` or a masked identifier such as `••••1234`. Shown as written,
   * muted: the log never held the real value, so there is nothing to unmask.
   */
  masked: boolean;
}

export type DiffKind = "added" | "removed" | "changed";

export interface DiffRow {
  /** Dotted path from the top of the record: `address.city`. */
  path: string;
  kind: DiffKind;
  /** Leaves. Arrays use `added` and `removed` instead. */
  before?: DiffValue;
  after?: DiffValue;
  /** Arrays: the members that appeared. */
  added?: DiffValue[];
  /** Arrays: the members that went away. */
  removed?: DiffValue[];
  /** Arrays only: the same members in another order. */
  reordered?: boolean;
}

export const REDACTED_MARKER = "[REDACTED]";

const MASKED = /^[•●*]{2,}/;

/** A value the audit write path hid: the redaction marker, or `••••1234`. */
export function isMaskedValue(value: unknown): boolean {
  return typeof value === "string" && (value === REDACTED_MARKER || MASKED.test(value));
}

type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  !(value instanceof Date);

/** JSON with sorted keys, so equal objects compare equal whatever their key order. */
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function toValue(value: unknown): DiffValue {
  if (value === null || value === undefined || value === "") {
    return { text: "", empty: true, masked: false };
  }
  if (value instanceof Date) return { text: value.toISOString(), empty: false, masked: false };
  if (typeof value === "string") {
    return { text: value, empty: false, masked: isMaskedValue(value) };
  }
  if (typeof value === "object") {
    return { text: canonical(value), empty: false, masked: false };
  }
  return { text: String(value), empty: false, masked: false };
}

/** The leaves of a record, keyed by dotted path. Arrays and empty objects are leaves. */
function flatten(value: unknown, prefix: string, out: Map<string, unknown>) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) {
      // `{}` records no change worth a line: the same as the field being absent.
      return;
    }
    for (const key of keys) {
      flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
    }
    return;
  }
  if (prefix) out.set(prefix, value);
}

function diffArrays(path: string, before: unknown[], after: unknown[]): DiffRow | null {
  const remaining = new Map<string, number>();
  for (const item of before) {
    const key = canonical(item);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const added: DiffValue[] = [];
  for (const item of after) {
    const key = canonical(item);
    const left = remaining.get(key) ?? 0;
    if (left > 0) remaining.set(key, left - 1);
    else added.push(toValue(item));
  }

  const removed: DiffValue[] = [];
  for (const item of before) {
    const key = canonical(item);
    const left = remaining.get(key) ?? 0;
    if (left > 0) {
      remaining.set(key, left - 1);
      removed.push(toValue(item));
    }
  }

  if (added.length === 0 && removed.length === 0) {
    const sameOrder = before.every((item, index) => canonical(item) === canonical(after[index]));
    if (sameOrder) return null;
    return { path, kind: "changed", added, removed, reordered: true };
  }

  return {
    path,
    kind: added.length > 0 && removed.length > 0 ? "changed" : added.length > 0 ? "added" : "removed",
    added,
    removed,
  };
}

export interface DiffOptions {
  /**
   * `changes.fields`: the top-level fields the route said changed. Used for one
   * thing — a masked value is the same before and after (`••••1234` twice, or
   * `[REDACTED]` twice), so only the route can say it moved.
   */
  fields?: readonly string[];
}

/**
 * One row per leaf that differs between `before` and `after`.
 *
 * - A create has only `after` and a delete only `before`: every leaf is an
 *   addition, or a removal.
 * - Nested objects flatten to dotted paths (`address.city`).
 * - Arrays say which members were added and removed, not the two lists side by
 *   side: a permission list that gained one entry is one green line.
 * - Leaves that did not change are left out, so a route that recorded a whole
 *   document still shows only what moved.
 */
export function diffChanges(
  before: unknown,
  after: unknown,
  options: DiffOptions = {},
): DiffRow[] {
  const from = new Map<string, unknown>();
  const to = new Map<string, unknown>();
  flatten(before, "", from);
  flatten(after, "", to);

  const reported = new Set(options.fields ?? []);
  const paths = [...new Set([...from.keys(), ...to.keys()])];
  const rows: DiffRow[] = [];

  for (const path of paths) {
    const hadBefore = from.has(path);
    const hasAfter = to.has(path);
    const left = from.get(path);
    const right = to.get(path);

    if ((hadBefore && Array.isArray(left)) || (hasAfter && Array.isArray(right))) {
      const row = diffArrays(
        path,
        Array.isArray(left) ? left : left === undefined || left === null ? [] : [left],
        Array.isArray(right) ? right : right === undefined || right === null ? [] : [right],
      );
      if (row) rows.push(row);
      continue;
    }

    if (hadBefore && hasAfter) {
      if (canonical(left) === canonical(right)) {
        // Masked twice over is the route's word, not ours: see `DiffOptions.fields`.
        if (isMaskedValue(left) && reported.has(path.split(".")[0])) {
          rows.push({ path, kind: "changed", before: toValue(left), after: toValue(right) });
        }
        continue;
      }
      rows.push({ path, kind: "changed", before: toValue(left), after: toValue(right) });
      continue;
    }

    if (hasAfter) {
      // A field that appeared as "" or null is not news.
      if (toValue(right).empty) continue;
      rows.push({ path, kind: "added", after: toValue(right) });
    } else if (hadBefore) {
      if (toValue(left).empty) continue;
      rows.push({ path, kind: "removed", before: toValue(left) });
    }
  }

  return rows;
}
