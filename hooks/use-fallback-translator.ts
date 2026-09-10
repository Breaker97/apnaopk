"use client";

import { useCallback } from "react";

/**
 * Any next-intl translator, namespaced or not. `never` keys let every
 * namespace's translator be passed without the caller casting.
 */
type Translator = ((key: never, values?: never) => string) & {
  has: (key: string) => boolean;
};

/**
 * `t(key)` when the key exists in the loaded messages, the English fallback
 * otherwise. Optional `values` are interpolated into the fallback the same way
 * next-intl fills `{name}` placeholders, so a missing key still reads well.
 *
 * Stable across renders (memoised on `t`), so it can sit in effect and
 * callback dependency arrays without re-running them.
 */
export function useFallbackTranslator(t: Translator) {
  return useCallback(
    (
      key: string,
      fallback: string,
      values?: Record<string, string | number>,
    ): string => {
      if (t.has(key)) return t(key as never, values as never);
      if (!values) return fallback;
      return Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        fallback,
      );
    },
    [t],
  );
}
