import { createHash } from "node:crypto";
import { ConflictError } from "@/lib/api/errors";

/**
 * A short fingerprint per settings section, computed from what the admin
 * form is shown (the sanitised section, secrets already stripped). The form
 * hands the fingerprints back with a save; a section whose fingerprint moved
 * in between was changed by someone else, and the save is refused with a 409
 * instead of silently overwriting their work.
 *
 * Content-based rather than a document timestamp so two admins editing
 * different sections never conflict with each other.
 */
type SectionVersions = Record<string, string>;

export const SETTINGS_CONFLICT_CODE = "SETTINGS_CONFLICT";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sectionVersion(section: unknown): string {
  return createHash("sha1").update(stableStringify(section)).digest("hex").slice(0, 16);
}

export function computeSectionVersions(
  sanitized: Record<string, unknown>,
  sections: readonly string[],
): SectionVersions {
  const versions: SectionVersions = {};
  for (const section of sections) {
    versions[section] = sectionVersion(sanitized[section]);
  }
  return versions;
}

/**
 * Refuses a save whose expected fingerprints no longer match. Only the
 * sections the caller vouched for are checked, so a client that sends none
 * (the header builder, the appearance drawer) keeps last-write-wins.
 */
export function assertSectionVersions(
  current: SectionVersions,
  expected: Record<string, unknown> | undefined,
): void {
  if (!expected) return;
  for (const [section, version] of Object.entries(expected)) {
    if (typeof version !== "string" || !(section in current)) continue;
    if (current[section] !== version) {
      const error = new ConflictError(
        "These settings were changed by someone else since you opened them. Reload to see the latest, or save again to overwrite.",
        { section },
      );
      error.code = SETTINGS_CONFLICT_CODE;
      throw error;
    }
  }
}
