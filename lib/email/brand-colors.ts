import { liveKeyColors } from "@/lib/storefront/themes/key-colors";
import { readableForegroundColor } from "@/lib/theme-colors/contrast";
import { readableTone } from "@/lib/theme-colors/derive";

/** The colours an email paints its button, its header band and its links with. */
export interface EmailBrand {
  /** Button and band fill: the store's brand primary. */
  fill: string;
  /** Text on that fill, by contrast — never white on a light brand. */
  ink: string;
  /** Link text on the white card, darkened when the brand is too light to read. */
  link: string;
}

/**
 * The live theme's primary as an email wears it. Emails used to paint the
 * shipped default blue whatever the merchant chose; Theme settings → Colors
 * says the live theme's colours reach emails, so they do.
 */
export function emailBrand(settings: unknown): EmailBrand {
  const fill = liveKeyColors(settings).primary;
  return {
    fill,
    ink: readableForegroundColor(fill),
    link: readableTone(fill, ["#ffffff"]),
  };
}
