import "server-only";

import { getTranslations } from "next-intl/server";

/** The store's own words the home sections print beside the merchant's copy. */
export interface HomeCopy {
  /** The fixed heading over paid placements (`common.sponsored`). */
  sponsored: string;
  /** A collection panel's button when it promotes itself (`common.shopNow`). */
  shopNow: string;
  /** The deals panel's biggest saving (`home.dealsUpTo`). */
  dealsUpTo: (percent: number) => string;
}

/**
 * The words in one language, as the web's sections print them. The locale is
 * passed in, so nothing here reads the request: a static route may call it.
 */
export async function getHomeCopy(locale: string): Promise<HomeCopy> {
  const t = await getTranslations({ locale });
  const say = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
  return {
    sponsored: say("common.sponsored", "Sponsored"),
    shopNow: say("common.shopNow", "Shop now"),
    dealsUpTo: (percent) =>
      t.has("home.dealsUpTo") ? t("home.dealsUpTo", { percent }) : `Up to ${percent}% off`,
  };
}
