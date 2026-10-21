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
      return typeof result === "string" && result !== key
        ? result
        : fill(fallback, values);
    } catch {
      return fill(fallback, values);
    }
  };
}

/** The English fallback with its `{placeholders}` filled, as next-intl would. */
function fill(text: string, values?: Record<string, string | number>): string {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

export type TSafe = ReturnType<typeof createTSafe>;
