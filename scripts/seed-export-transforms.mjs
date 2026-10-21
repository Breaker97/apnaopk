/**
 * What `pnpm db:seed:export` does to a live store's documents on top of the
 * integrity audit (`scripts/seed-audit.mjs`): the rules that keep a re-export
 * from quietly undoing decisions that were once made by hand in the JSON.
 *
 * Three snapshot fixes landed as hand edits after the first export — variant
 * `taxable` dropped (33a1768c), outbound shop links unwrapped (8e6f8cb7),
 * retired settings fields removed (bc146f9f) — and a fourth (theme colour
 * references, e5657df3) is a per-template rule in `seed-export-rules.mjs`. The
 * source store still holds the old values, so every export brought them back.
 * They live here now, as code, so the export applies them every time.
 *
 * Every function is pure over plain objects: `tests/seed-export-transforms.test.ts`
 * pins them without a database.
 */

/**
 * Settings fields the app no longer has. A live store keeps them from before
 * the change; a snapshot that re-exported them would seed configuration
 * nothing honours. Mostly bc146f9f ("settings save what they show"):
 * dashboard preferences that now live in each person's browser, and values
 * nothing read.
 */
export const RETIRED_SETTINGS_PATHS = [
  "general.supportedCurrencies",
  "general.timezone",
  // The regex search mode, replaced by the indexed search in 2.1.
  "general.productSearchMode",
  "appearance.contrast",
  "appearance.rtl",
  "appearance.collapsedSidebar",
  "appearance.navLayout",
  "appearance.navColor",
  "pos.language",
  // POS settings became one switch and four cards (7594183c).
  "pos.checkout.offlinePaymentsEnabled",
  "vendorConfig.autoApprove",
  "vendorConfig.freeTrialDays",
];

/** Variant fields the product model dropped (33a1768c: `taxable`, which nothing read). */
export const RETIRED_VARIANT_FIELDS = ["taxable"];

/** Product fields whose HTML ships to a buyer's storefront verbatim. */
const PRODUCT_HTML_FIELDS = ["description", "shortDescription"];

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !value._bsontype;

function splitPath(dotPath) {
  return dotPath.split(".").filter(Boolean);
}

/** Read a dot path; undefined when any step is missing. */
export function getPath(root, dotPath) {
  let node = root;
  for (const key of splitPath(dotPath)) {
    if (node == null || typeof node !== "object") return undefined;
    node = node[key];
  }
  return node;
}

/** Write a dot path, creating plain objects on the way. */
export function setPath(root, dotPath, value) {
  const keys = splitPath(dotPath);
  let node = root;
  for (const key of keys.slice(0, -1)) {
    if (!isPlainObject(node[key])) node[key] = {};
    node = node[key];
  }
  node[keys[keys.length - 1]] = value;
}

/** Delete a dot path; true when something was there to delete. */
export function deletePath(root, dotPath) {
  const keys = splitPath(dotPath);
  const parent = getPath(root, keys.slice(0, -1).join("."));
  const last = keys[keys.length - 1];
  if (!isPlainObject(parent) || !(last in parent)) return false;
  delete parent[last];
  return true;
}

/** Drop the retired settings fields from an exported settings snapshot. */
export function stripRetiredSettings(settings) {
  const notes = [];
  for (const dotPath of RETIRED_SETTINGS_PATHS) {
    if (deletePath(settings, dotPath)) {
      notes.push(`settings: dropped retired field ${dotPath}`);
    }
  }
  return notes;
}

/** Drop retired fields from every variant. Returns one summary note per field. */
export function stripRetiredVariantFields(products) {
  const notes = [];
  for (const field of RETIRED_VARIANT_FIELDS) {
    let count = 0;
    for (const product of products) {
      for (const variant of product.variants ?? []) {
        if (variant && field in variant) {
          delete variant[field];
          count += 1;
        }
      }
    }
    if (count > 0) {
      notes.push(`products: dropped retired variant field "${field}" from ${count} variant(s)`);
    }
  }
  return notes;
}

/** Bare host of an absolute or protocol-relative URL, without `www.`; null otherwise. */
export function urlHost(url) {
  const match = String(url ?? "")
    .trim()
    .match(/^(?:https?:)?\/\/([^/?#:\s]+)/i);
  return match ? match[1].toLowerCase().replace(/^www\./, "") : null;
}

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const HREF = /\bhref\s*=\s*(["'])([\s\S]*?)\1/i;

/**
 * Unwrap every link to another site, keeping the text it wrapped.
 *
 * Product copy drafted from a retailer's page arrives with the brand name in
 * the first sentence linked to that retailer (`<a href="https://www.
 * applegadgetsbd.com/brands/samsung"><strong><u>Samsung</u></strong></a>`).
 * A buyer seeding the demo would ship a storefront that sends its own
 * shoppers to someone else's shop. The editor underlines link text with
 * `<u>`, so the underline goes with the link: `<strong>Samsung</strong>` —
 * exactly what 8e6f8cb7 wrote by hand.
 *
 * Relative links and links to `ownHosts` (the source store's own domain,
 * rewritten to relative on export) stay.
 *
 * @param {any} html
 * @param {{ ownHosts?: string[] }} [options]
 */
export function unwrapOutboundLinks(html, { ownHosts = [] } = {}) {
  if (typeof html !== "string" || !/<a\b/i.test(html)) {
    return { html, count: 0 };
  }
  const own = ownHosts
    .map((host) => String(host).toLowerCase().replace(/^www\./, ""))
    .filter(Boolean);
  let count = 0;
  const out = html.replace(ANCHOR, (whole, attrs, inner) => {
    const host = urlHost(attrs.match(HREF)?.[2]);
    if (!host || own.some((h) => host === h || host.endsWith(`.${h}`))) {
      return whole;
    }
    count += 1;
    return inner.replace(/<\/?u\s*>/gi, "");
  });
  return { html: out, count };
}

/**
 * Unwrap outbound links in every product's storefront HTML.
 *
 * @param {Record<string, any>[]} products
 * @param {{ ownHosts?: string[] }} [options]
 */
export function unwrapProductOutboundLinks(products, { ownHosts = [] } = {}) {
  let links = 0;
  let touched = 0;
  for (const product of products) {
    let changed = false;
    for (const field of PRODUCT_HTML_FIELDS) {
      const { html, count } = unwrapOutboundLinks(product[field], { ownHosts });
      if (count > 0) {
        product[field] = html;
        links += count;
        changed = true;
      }
    }
    if (changed) touched += 1;
  }
  return links > 0
    ? [`products: unwrapped ${links} outbound link(s) in ${touched} description(s)`]
    : [];
}

/** Does `doc` match every field of `when` (compared as strings)? */
function matches(doc, when) {
  if (!when) return true;
  return Object.entries(when).every(
    ([field, expected]) => String(getPath(doc, field)) === String(expected),
  );
}

/** Depth-first search for the object carrying `id` under `root`. */
export function findById(root, id) {
  if (Array.isArray(root)) {
    for (const entry of root) {
      const found = findById(entry, id);
      if (found) return found;
    }
    return null;
  }
  if (!isPlainObject(root)) return null;
  if (root.id === id) return root;
  for (const value of Object.values(root)) {
    const found = findById(value, id);
    if (found) return found;
  }
  return null;
}

/**
 * Apply one template's export rules (see `seed-export-rules.mjs`) to the
 * audited snapshot. Mutates `data` and `settings`; returns notes for the
 * manifest, and warnings for rules that no longer find their target. A rule
 * aimed at something the store has since deleted is moot rather than wrong,
 * but it must say so out loud, so somebody removes it.
 */
export function applyExportRules({ data, settings }, rules = {}) {
  const { notes, warnings } = excludeDocuments(data, rules);

  for (const [dotPath, value] of Object.entries(rules.settings ?? {})) {
    const before = JSON.stringify(getPath(settings, dotPath) ?? null);
    setPath(settings, dotPath, structuredClone(value));
    if (before !== JSON.stringify(value)) notes.push(`rule: settings.${dotPath} set`);
  }

  for (const { root, id, set } of rules.settingsItems ?? []) {
    const item = findById(getPath(settings, root), id);
    if (!item) {
      warnings.push(`rule skipped: no item with id "${id}" under settings.${root}`);
      continue;
    }
    for (const [dotPath, value] of Object.entries(set)) {
      const before = JSON.stringify(getPath(item, dotPath) ?? null);
      setPath(item, dotPath, structuredClone(value));
      if (before !== JSON.stringify(value)) {
        notes.push(`rule: settings.${root} item ${id}: ${dotPath} set`);
      }
    }
  }

  for (const [key, byId] of Object.entries(rules.documents ?? {})) {
    const docs = data[key];
    if (!Array.isArray(docs)) {
      warnings.push(`rule skipped: unknown snapshot collection "${key}"`);
      continue;
    }
    for (const [id, { when, set }] of Object.entries(byId)) {
      const doc = docs.find((entry) => String(entry._id) === id);
      if (!doc) {
        warnings.push(`rule skipped: ${key} has no document ${id}`);
        continue;
      }
      if (!matches(doc, when)) continue;
      for (const [dotPath, value] of Object.entries(set)) {
        setPath(doc, dotPath, structuredClone(value));
      }
      notes.push(`rule: ${key} ${id}: set ${Object.keys(set).join(", ")}`);
    }
  }

  return { notes, warnings };
}

/** Is `doc` named in `list`, by id or by slug? */
function isListed(doc, list = []) {
  const listed = new Set(list.map(String));
  return (
    listed.has(String(doc._id)) || (doc.slug != null && listed.has(String(doc.slug)))
  );
}

/** Vendors a template's rules exclude, by slug or by id. */
export function isExcludedVendor(vendor, rules = {}) {
  return isListed(vendor, rules.excludeVendors);
}

/** Products a template's rules exclude, by slug or by id. */
export function isExcludedProduct(product, rules = {}) {
  return isListed(product, rules.excludeProducts);
}

/** Entries of an exclusion list that name none of `docs`: rules to clean up. */
export function staleExclusions(docs, list = []) {
  return list.filter((entry) => !docs.some((doc) => isListed(doc, [entry])));
}

/**
 * Drop the documents a template's rules exclude (`excludeDocuments`), for
 * snapshot collections nothing else in the snapshot points at — a test plan,
 * say. Vendors are excluded before the audit instead (`excludeVendors`), so
 * their products and locations go with them.
 */
export function excludeDocuments(data, rules = {}) {
  const notes = [];
  const warnings = [];
  for (const [key, list] of Object.entries(rules.excludeDocuments ?? {})) {
    const docs = data[key];
    if (!Array.isArray(docs)) {
      warnings.push(`rule skipped: unknown snapshot collection "${key}"`);
      continue;
    }
    const kept = docs.filter((doc) => !isListed(doc, list));
    for (const doc of docs.filter((d) => !kept.includes(d))) {
      notes.push(`rule: left out ${key} "${doc.name ?? doc.title ?? doc.slug ?? doc._id}"`);
    }
    for (const entry of list) {
      if (!docs.some((doc) => isListed(doc, [entry]))) {
        warnings.push(`rule skipped: ${key} has no document "${entry}" to leave out`);
      }
    }
    data[key] = kept;
  }
  return { notes, warnings };
}

// ---- Internal links ----------------------------------------------------

/**
 * Storefront links that name a document by slug: `/products/<slug>`,
 * `/categories/<slug>`, `/collections/<slug>`, `/brands/<slug>`,
 * `/vendors/<slug>`, `/blog/<slug>`, and the `?category=`, `?brand=`,
 * `?collection=` filters on any of them. An optional locale segment is allowed.
 */
const LINK = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(products|categories|collections|brands|vendors|blog)(?:\/([^?#/]+))?\/?(?:\?([^#]*))?/i;

const ROUTE_KIND = {
  products: "product",
  categories: "category",
  collections: "collection",
  brands: "brand",
  vendors: "vendor",
  blog: "blogPost",
};

const QUERY_KIND = { category: "category", brand: "brand", collection: "collection" };

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Every slug reference a storefront link makes, as [kind, slug] pairs. */
export function linkTargets(url, { storeDomain = "" } = {}) {
  let path = String(url ?? "").trim();
  if (storeDomain && path.startsWith(storeDomain)) {
    path = path.slice(storeDomain.length) || "/";
  }
  const match = path.match(LINK);
  if (!match) return [];
  const [, route, slug, query] = match;
  const targets = [];
  if (slug && route.toLowerCase() !== "blog") {
    targets.push([ROUTE_KIND[route.toLowerCase()], safeDecode(slug)]);
  } else if (slug && !/^(category|categories|tag|tags|page)$/i.test(slug)) {
    targets.push(["blogPost", safeDecode(slug)]);
  }
  for (const [key, value] of new URLSearchParams(query ?? "")) {
    if (QUERY_KIND[key] && value) targets.push([QUERY_KIND[key], value]);
  }
  return targets;
}

/**
 * Walk a tree of section/settings/menu data and report every string that is
 * a storefront link to a document the snapshot does not have. A link under an
 * object switched off with `visible: false` renders nowhere, so it is reported
 * as hidden — a warning, not a reason to refuse the export.
 */
function walkLinks(value, where, path, known, options, hidden, out) {
  if (typeof value === "string") {
    for (const [kind, slug] of linkTargets(value, options)) {
      if (!known[kind]?.has(slug)) {
        out.push({ where, path, kind, slug, url: value, hidden });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      walkLinks(entry, where, `${path}[${index}]`, known, options, hidden, out),
    );
    return;
  }
  if (!isPlainObject(value)) return;
  const nowHidden = hidden || value.visible === false;
  for (const [key, child] of Object.entries(value)) {
    if (key === "history") continue;
    walkLinks(child, where, path ? `${path}.${key}` : key, known, options, nowHidden, out);
  }
}

/**
 * Check every storefront link in the exported design against the exported
 * catalog. The menu rule in the audit only knows `?category=` in menus; a
 * category renamed in the admin leaves its old slug in header tags, banners
 * and section links too, and the demo then ships links to empty pages.
 */
export function findBrokenInternalLinks(snapshot, { storeDomain = "" } = {}) {
  const slugs = (docs) => new Set((docs ?? []).map((doc) => doc.slug).filter(Boolean));
  const known = {
    product: slugs(snapshot.products),
    category: slugs(snapshot.categories),
    collection: slugs(snapshot.collections),
    brand: slugs(snapshot.brands),
    vendor: slugs(snapshot.vendors),
    blogPost: slugs(snapshot.blogPosts),
  };
  const out = [];
  const options = { storeDomain };
  walkLinks(snapshot.settings ?? {}, "settings", "", known, options, false, out);
  for (const page of snapshot.storePages ?? []) {
    walkLinks(page, `store page ${page.key}`, "", known, options, false, out);
  }
  for (const page of snapshot.vendorStorePages ?? []) {
    walkLinks(page, `vendor page ${page.vendorId}`, "", known, options, false, out);
  }
  for (const slider of snapshot.sliders ?? []) {
    walkLinks(slider, `slider ${slider.handle}`, "", known, options, false, out);
  }
  for (const menu of snapshot.menus ?? []) {
    walkLinks(menu, `menu ${menu.handle ?? menu.name}`, "", known, options, false, out);
  }
  return out;
}
