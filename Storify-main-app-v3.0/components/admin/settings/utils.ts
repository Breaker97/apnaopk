import type { Settings } from "./types";
import { isPlainObject } from "@/lib/utils";
import { CREDENTIAL_FIELD_PATHS } from "@/lib/settings/credential-fields";

export function setNestedValue<T extends Record<string, unknown>>(
  root: T,
  dotPath: string,
  value: unknown,
): T {
  const parts = dotPath.split(".").filter(Boolean);
  if (parts.length === 0) return root;

  const out: Record<string, unknown> = { ...root };
  let current: Record<string, unknown> = out;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const existing = current[key];
    const next = isPlainObject(existing) ? { ...existing } : {};
    current[key] = next;
    current = next;
  }

  current[parts[parts.length - 1]!] = value;
  return out as T;
}

/**
 * A secret's Remove writes `null` to its path, but the stored value never
 * reaches the browser, so `null` compares equal to what was loaded and the
 * removal read as no change at all. The draft's `_meta` presence flag is what
 * actually moves: it drops the field back to "not set" on screen and makes
 * the section dirty (see `getEffectiveDirtySections`).
 */
export function withCredentialCleared(settings: Settings, path: string): Settings {
  if (!CREDENTIAL_FIELD_PATHS.includes(path)) return settings;
  return {
    ...settings,
    _meta: {
      ...settings._meta,
      credentials: { ...settings._meta?.credentials, [path]: { set: false } },
    },
  };
}

export function getSectionIdFromPath(path: string): keyof Settings | null {
  const root = path.split(".")[0];
  if (!root) return null;
  return (root as keyof Settings) || null;
}

