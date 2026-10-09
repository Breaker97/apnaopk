import type { MetaCatalogItem } from "@/lib/meta-catalog/map-product";

/**
 * The feed's RSS 2.0 document, written a piece at a time so the route can
 * stream it: the head, one `<item>` per catalog item, the tail.
 *
 * Its own writer rather than lib/catalog/csv.ts: that one is for spreadsheets
 * (a BOM, apostrophes in front of formula-looking cells), and either would be
 * read by Meta as part of the value.
 */

/**
 * Characters XML 1.0 forbids outright — most C0 controls, lone surrogates,
 * U+FFFE/U+FFFF. Escaping cannot make them legal, and one of them anywhere
 * makes the whole document unparseable, so they are dropped.
 */
const INVALID_XML_CHARS =
  /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Element name per field, in the order they are written. Meta reads the
 * Google Merchant Center attributes under the `g:` namespace; its own example
 * feed writes `additional_image_link` and `color` without a prefix, and
 * `additional_variant_attribute` is Meta's own, so those three have none.
 */
const FIELDS: ReadonlyArray<[keyof MetaCatalogItem, string]> = [
  ["id", "g:id"],
  ["item_group_id", "g:item_group_id"],
  ["title", "g:title"],
  ["description", "g:description"],
  ["availability", "g:availability"],
  ["condition", "g:condition"],
  ["price", "g:price"],
  ["sale_price", "g:sale_price"],
  ["link", "g:link"],
  ["image_link", "g:image_link"],
  ["additional_image_link", "additional_image_link"],
  ["brand", "g:brand"],
  ["gtin", "g:gtin"],
  ["color", "color"],
  ["size", "g:size"],
  ["additional_variant_attribute", "additional_variant_attribute"],
  ["custom_label_0", "g:custom_label_0"],
];

export function renderFeedHead(channel: {
  title: string;
  link: string;
  description: string;
}): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n' +
    "<channel>\n" +
    `<title>${escapeXml(channel.title)}</title>\n` +
    `<link>${escapeXml(channel.link)}</link>\n` +
    `<description>${escapeXml(channel.description)}</description>\n`
  );
}

export function renderFeedItem(item: MetaCatalogItem): string {
  let xml = "<item>\n";
  for (const [field, tag] of FIELDS) {
    const value = item[field];
    // A list field repeats its element, one value each.
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      if (typeof entry !== "string" || entry === "") continue;
      xml += `<${tag}>${escapeXml(entry)}</${tag}>\n`;
    }
  }
  return `${xml}</item>\n`;
}

export const FEED_TAIL = "</channel>\n</rss>\n";
