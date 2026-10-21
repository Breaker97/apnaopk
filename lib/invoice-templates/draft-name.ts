/**
 * The name an unsaved draft starts with (docs §4.10): `base`, else `base 2`,
 * `base 3` … — the first one `isTaken` does not refuse, kept within the name
 * limit. The server page asks with the owner's existing names, so the first
 * Save rarely meets a duplicate; the API still has the last word.
 *
 * Client-safe.
 */
import { TEMPLATE_LIMITS } from "./types";

/**
 * The name as uniqueness compares it (the model's `nameKey`): trimmed, inner
 * spaces collapsed, lower case. The editor checks a rename against the
 * category's other names with it before the API has its say.
 */
export function templateNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

export function freeTemplateName(base: string, isTaken: (name: string) => boolean): string {
  const limit = TEMPLATE_LIMITS.nameLength;
  const first = base.slice(0, limit).trimEnd();
  if (!isTaken(first)) return first;
  for (let n = 2; n <= TEMPLATE_LIMITS.templatesPerCategory + 1; n++) {
    const suffix = ` ${n}`;
    const candidate = `${base.slice(0, limit - suffix.length).trimEnd()}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
  return first;
}
