/**
 * Immutably set a dot-separated `path` on a cloned copy of `source`.
 * Numeric path segments address array indices; missing intermediate
 * containers are created as arrays (when the next segment is numeric)
 * or plain objects.
 */
export function setNestedValue<T>(source: T, path: string, value: unknown): T {
  const next = structuredClone(source) as unknown;
  const parts = path.split(".");
  let cursor = next as Record<string, unknown> | unknown[];

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    const key = Array.isArray(cursor) ? Number(part) : part;
    const child = (cursor as Record<string, unknown>)[key as string];
    if (typeof child !== "object" || child === null) {
      const nextPart = parts[index + 1];
      (cursor as Record<string, unknown>)[key as string] = /^\d+$/.test(nextPart)
        ? []
        : {};
    }
    cursor = (cursor as Record<string, unknown>)[key as string] as
      | Record<string, unknown>
      | unknown[];
  }

  const finalPart = parts[parts.length - 1];
  const finalKey = Array.isArray(cursor) ? Number(finalPart) : finalPart;
  (cursor as Record<string, unknown>)[finalKey as string] = value;
  return next as T;
}
