import sanitize from "sanitize-html";

/**
 * Sanitizes untrusted HTML before it is injected via dangerouslySetInnerHTML.
 *
 * Rich-text content (blog posts, content pages, product descriptions,
 * storefront sections) can be authored by vendors or admins and is rendered on
 * the public storefront, so it must be sanitized to prevent stored XSS. The
 * allow-list mirrors the formatting the TipTap editor produces — headings,
 * lists, links, basic inline formatting, images, tables — and strips anything
 * that can execute: `<script>`, event handlers, `javascript:` and `data:` URLs,
 * and inline `style`.
 *
 * ## Why not DOMPurify
 *
 * This used to run DOMPurify through `isomorphic-dompurify`, which means jsdom
 * on the server: a ~30MB dependency, pulled in to parse a paragraph of markup.
 * Beyond the size, jsdom is a poor fit for a bundled/serverless deployment —
 * it resolves files relative to its own package at runtime, so whether it works
 * depends on whether the platform's file tracer happened to copy the right
 * tree, and a caret bump to `isomorphic-dompurify` can swap the jsdom major
 * (and its supported Node range) underneath a working install. Both are how
 * this became a 500 on every content page of a deployment that built fine.
 *
 * `sanitize-html` is a tokenizer plus an allow-list: pure JavaScript, no DOM,
 * no native bindings, and it never reads from disk. It behaves the same in the
 * browser as on the server, so the editor's paste path and the storefront
 * render share one implementation rather than two that can drift.
 *
 * Behaviour is pinned by `tests/sanitize-html.test.ts`, written against the
 * DOMPurify implementation before the swap. Change the allow-list only with
 * those tests in front of you.
 */

/**
 * Schemes a link or image may use.
 *
 * `data:` is absent deliberately: a `data:text/html` href executes in the
 * document's own origin, and a `data:image/svg+xml` can carry script. Anything
 * outside this list, and any scheme-relative `//host` URL, is dropped along
 * with the attribute.
 */
const ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"];

const ALLOWED_TAGS = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
];

const ALLOWED_ATTRIBUTES = [
  "href",
  "src",
  "alt",
  "title",
  "target",
  "rel",
  "class",
  "colspan",
  "rowspan",
  "width",
  "height",
];

/** Drops an attribute whose value is empty after trimming. */
function withoutBlank(
  attribs: Record<string, string>,
  name: string,
): Record<string, string> {
  if (name in attribs && !attribs[name]?.trim()) {
    const next = { ...attribs };
    delete next[name];
    return next;
  }
  return attribs;
}

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";

  return sanitize(dirty, {
    allowedTags: ALLOWED_TAGS,
    // Applied to every element rather than per tag, matching the flat
    // allow-list this replaced. An `href` on a `<p>` is inert; the scheme
    // check below is what actually matters.
    allowedAttributes: { "*": ALLOWED_ATTRIBUTES },
    allowedSchemes: ALLOWED_SCHEMES,
    allowedSchemesAppliedToAttributes: ["href", "src"],
    // `//evil.com` inherits the page's scheme and is a real navigation target,
    // so it must not pass as a "relative" URL.
    allowProtocolRelative: false,
    // Discard the *content* of these, not just the tags. Without this the
    // body of a `<script>` would survive as visible page text.
    nonTextTags: ["script", "style", "textarea", "option", "noscript"],
    // Anything not on the allow-list has its tags removed while its text is
    // kept, so stripping a stray `<div>` cannot silently delete a paragraph.
    disallowedTagsMode: "discard",
    transformTags: {
      a: (tagName, attribs) => {
        let next = withoutBlank(attribs, "href");
        if (next.target === "_blank") {
          // Without this the opened page can reach back through
          // `window.opener` and navigate the storefront tab.
          next = { ...next, rel: "noopener noreferrer" };
        }
        return { tagName, attribs: next };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: withoutBlank(attribs, "src"),
      }),
    },
  });
}
