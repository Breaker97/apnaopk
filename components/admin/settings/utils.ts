import type { Settings } from "./types";
import { isPlainObject } from "@/lib/utils";

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

export function getSectionIdFromPath(path: string): keyof Settings | null {
  const root = path.split(".")[0];
  if (!root) return null;
  return (root as keyof Settings) || null;
}

