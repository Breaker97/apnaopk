"use client";

import { useAdminSettingsContext } from "./admin-settings-context";
import type { Settings } from "./types";
import { normalizeColorToHex } from "@/lib/site-config/appearance-colors";

/**
 * Saving the brand touches TWO settings sections: assets live under
 * `general.*` (every storefront/admin consumer reads them there) while colors
 * and the default appearance live under `appearance.*`. The Branding tab
 * (Online Store → Themes → Branding) edits both, so on save it persists
 * whichever of the two is dirty — and only the general keys it owns, so an
 * unrelated half-edited General form can never ride along.
 */
const GENERAL_SAVE_KEYS: Array<keyof Settings["general"]> = [
  "storeName",
  "storeDescription",
  "storeEmail",
  "storePhone",
  "storeDomain",
  "storeAddress",
  "logoUrl",
  "darkModeLogoUrl",
  "faviconUrl",
  "appIconUrl",
  "defaultLanguage",
  "defaultCurrency",
  "supportedLanguages",
  "supportedCurrencies",
  "timezone",
];

function pickGeneralForSave(general: Settings["general"]) {
  const out: Record<string, unknown> = {};
  for (const key of GENERAL_SAVE_KEYS) {
    out[key] = general?.[key];
  }
  return out;
}

/**
 * Fold any rgb()/rgba() or shorthand hex the color fields may still hold into
 * a canonical hex before persisting (blur normalizes too, but a save fired
 * before blur could otherwise store a raw rgb string the color pipeline
 * can't read).
 */
export function normalizeAppearanceForSave(
  appearance: Settings["appearance"],
) {
  const normalize = (value: string | undefined) =>
    normalizeColorToHex(value) ?? value;
  return {
    ...appearance,
    primaryColor: normalize(appearance?.primaryColor),
    secondaryColor: normalize(appearance?.secondaryColor),
    accentColor: normalize(appearance?.accentColor),
  };
}

/** Dirty state + a save that writes exactly the sections the brand touched. */
export function useBrandingSave() {
  const { isSaving, dirtySections, saveSection, saveSections } =
    useAdminSettingsContext();

  const isDirty =
    dirtySections.has("appearance") || dirtySections.has("general");

  const save = (settings: Settings): Promise<boolean> => {
    const generalDirty = dirtySections.has("general");
    const appearanceDirty = dirtySections.has("appearance");

    // Only one section touched → single-section save (keeps the general
    // tab's currency/vendor side effects intact when relevant).
    if (appearanceDirty && !generalDirty) {
      return saveSection(
        "appearance",
        normalizeAppearanceForSave(settings.appearance),
      );
    }
    if (generalDirty && !appearanceDirty) {
      return saveSection("general", pickGeneralForSave(settings.general));
    }
    if (generalDirty && appearanceDirty) {
      return saveSections({
        general: pickGeneralForSave(settings.general),
        appearance: normalizeAppearanceForSave(settings.appearance),
      });
    }
    return Promise.resolve(true);
  };

  return { isDirty, isSaving, save };
}
