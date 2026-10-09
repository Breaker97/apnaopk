/**
 * Dependency-free string helpers shared by route handlers, lib modules and
 * client components alike. Nothing here may import from `lib/` or `components/`
 * so it stays safe to pull into any bundle.
 */

/**
 * Latin letters NFD leaves whole — they are letters of their own, not a base
 * letter plus an accent — spelled the way their languages write them in ASCII.
 */
const ASCII_SPELLINGS: Record<string, string> = {
  ı: "i",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  ø: "o",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
  ħ: "h",
};
const UNSPELLED_LETTERS = new RegExp(
  `[${Object.keys(ASCII_SPELLINGS).join("")}]`,
  "g",
);

/**
 * Lower-case text with its Latin letters folded to ASCII, the form every slug
 * is cut from: accents dropped ("Ürün" → "urun", "İ" → "i") and the letters
 * with no accent to drop spelled out ("ı" → "i", "ß" → "ss"). Without it a
 * slug filter that keeps only `a-z0-9` turns "Test Ürünü" into "test-r-n".
 * Other scripts pass through for the caller's filter to drop.
 */
export function foldForSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(UNSPELLED_LETTERS, (letter) => ASCII_SPELLINGS[letter]);
}

/**
 * URL-safe slug from free text: lower-case ASCII letters and digits, any run
 * of other characters collapsed to a single "-", no leading or trailing dash.
 * `slugify("Summer Sale 2026!")` → `"summer-sale-2026"`,
 * `slugify("Test Ürünü")` → `"test-urunu"`.
 */
export function slugify(value: string): string {
  return foldForSlug(value)
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * The slug `slugify` gave before it folded accents, when every non-ASCII
 * letter became a separator ("Ürün" → "r-n"). Rows saved then still carry it,
 * so a lookup by name tries this form too; a new slug never uses it.
 */
export function legacySlugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Escape `value` so it matches itself literally inside a `RegExp`. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Named entities rich-text editors actually emit. Anything else named is left
 * as written rather than guessed at; numeric references are decoded in full.
 */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
};

/** Phrasing elements: text runs straight through them. */
const INLINE_TAG =
  /<\/?(?:a|abbr|b|bdi|bdo|cite|code|data|dfn|em|font|i|kbd|mark|q|s|samp|small|span|strike|strong|sub|sup|time|u|var)\b[^>]*>/gi;

function decodeCodePoint(code: number): string | null {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

/**
 * Plain text from a fragment of HTML: a product description for a meta tag,
 * structured data or a shopping feed.
 *
 * Scripts, styles and comments go with their contents. Inline tags vanish
 * (`<strong>lamp</strong>.` reads "lamp."); every other tag becomes a space,
 * so `<p>One</p><p>Two</p>` reads "One Two" rather than "OneTwo".
 * Entities are decoded in ONE pass, so an escaped entity stays escaped once:
 * `&amp;lt;` is the text "&lt;", never "<". Whitespace collapses to single
 * spaces.
 */
export function htmlToPlainText(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(INLINE_TAG, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (entity, body: string) => {
      if (body[0] === "#") {
        const hex = body[1] === "x" || body[1] === "X";
        const decoded = decodeCodePoint(
          Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10),
        );
        return decoded ?? entity;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}
