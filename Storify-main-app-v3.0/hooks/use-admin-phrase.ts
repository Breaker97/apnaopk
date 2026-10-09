import { useCallback } from "react";
import { useTranslations } from "next-intl";

/**
 * Turn an English admin phrase into its `admin.phrases.*` key: lower-case,
 * runs of anything but letters and digits collapsed to "_", no edge "_".
 * `adminPhraseKey("Failed to delete customer")` → `"failed_to_delete_customer"`.
 */
function adminPhraseKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * `tr(en)` — translate an English admin phrase through `admin.phrases.*`,
 * falling back to the English text when the key is missing (next-intl echoes
 * the key back for unknown ids, and throws on malformed ones).
 *
 * The same four-line helper used to be declared inside each admin table
 * component, unmemoised — so every `useMemo`/`useCallback` that called it
 * either listed a function that changed on every render or, in practice, left
 * it out and tripped `react-hooks/exhaustive-deps`. Returned from a hook it is
 * stable for the lifetime of the translator, and safe to list as a dependency.
 *
 * The unused second parameter keeps the old `tr(en, bn)` call shape: the
 * Bengali literal is still written next to the English at every call site,
 * even though the translation now comes from the locale files.
 */
export function useAdminPhrase() {
  const t = useTranslations();
  return useCallback(
    (en: string, _bn?: string) => {
      const key = `admin.phrases.${adminPhraseKey(en)}`;
      try {
        const translated = t(key as never);
        return translated === key ? en : translated;
      } catch {
        return en;
      }
    },
    [t],
  );
}
