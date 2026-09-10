import type { useTranslations } from "next-intl";

type Translator = ReturnType<typeof useTranslations>;

/**
 * next-intl lookup that prints the shipped English copy instead of the raw key
 * when a locale — or `en` itself — is missing the message. Shared by the home
 * page builder shell and the section editor it code-splits away, which would
 * otherwise carry a byte-identical copy of this closure each.
 */
export function createTSafe(t: Translator) {
  return (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ) => {
    try {
      const translate = t as unknown as (
        k: string,
        v?: Record<string, string | number>,
      ) => string;
      const result = translate(key, values);
      return typeof result === "string" && result !== key ? result : fallback;
    } catch {
      return fallback;
    }
  };
}

export type TSafe = ReturnType<typeof createTSafe>;
