import { DEFAULT_STORE_NAME } from "@/config/branding.config";

/**
 * The words of a text message, apart from sending it: how a notification
 * becomes one, and how many texts Twilio bills it as.
 *
 * Free of server imports, so Settings → SMS can show an admin the text a
 * customer gets, built the way `lib/sms/sms.ts` builds it.
 */

/** Twilio refuses longer bodies outright (error 21617). */
export const TWILIO_MAX_BODY_LENGTH = 1600;

/** The name a text opens with: the store's, else the app's. */
export function smsStoreName(storeName?: string | null): string {
  return storeName?.trim() || process.env.NEXT_PUBLIC_APP_NAME || DEFAULT_STORE_NAME;
}

/**
 * "Store: message link" — the store name first because a text arrives from a
 * bare number or a sender ID the shopper may not recognise.
 */
export function buildNotificationSmsBody(params: {
  storeName: string;
  message: string;
  link?: string;
}): string {
  const text = `${params.storeName.trim()}: ${params.message}`
    .replace(/\s+/g, " ")
    .trim();
  return (params.link ? `${text} ${params.link}` : text).slice(
    0,
    TWILIO_MAX_BODY_LENGTH,
  );
}

/** GSM 03.38's basic set: each character takes one of a text's 160 places. */
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Its extension table: each takes two places, an escape and the character. */
const GSM_EXTENDED = "^{}\\[~]|€\f";

/**
 * Look-alike punctuation Twilio swaps for its GSM twin before counting, since
 * every send sets SmartEncoded (`sendTwilioMessage`). One curly quote would
 * otherwise turn the whole text into UCS-2.
 */
const SMART_ENCODED: Readonly<Record<string, string>> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  "…": "...",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  " ": " ",
  "​": "",
};

export type SmsTextMeasure = {
  /** Places the text takes: an extension character counts twice in GSM-7. */
  characters: number;
  /** How many texts it is billed as. */
  segments: number;
  /** UCS-2 as soon as one character is outside GSM-7: a text then holds 70, not 160. */
  encoding: "GSM-7" | "UCS-2";
};

/**
 * How Twilio bills a body: one text up to 160 GSM-7 places (153 a part past
 * that, the rest go to the header that joins the parts), or 70 UCS-2 units
 * (67 a part) once any character needs Unicode.
 */
export function measureSmsText(text: string): SmsTextMeasure {
  const encoded = Array.from(text, (char) => SMART_ENCODED[char] ?? char).join("");
  let places = 0;
  for (const char of encoded) {
    if (GSM_BASIC.includes(char)) places += 1;
    else if (GSM_EXTENDED.includes(char)) places += 2;
    else {
      // UCS-2 counts UTF-16 units, so an emoji takes two.
      const units = encoded.length;
      return {
        characters: units,
        segments: units <= 70 ? 1 : Math.ceil(units / 67),
        encoding: "UCS-2",
      };
    }
  }
  return {
    characters: places,
    segments: places <= 160 ? 1 : Math.ceil(places / 153),
    encoding: "GSM-7",
  };
}
