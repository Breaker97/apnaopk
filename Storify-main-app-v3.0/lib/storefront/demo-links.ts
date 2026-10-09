import "server-only";

/**
 * Cross-links between the template demo DEPLOYMENTS. Every template demo is
 * its own install — subdomain + separate database with that template active
 * over its own sample catalogue — so the demo switcher navigates BETWEEN
 * hosts instead of rendering sibling templates in-process (one process can
 * only serve one database).
 *
 * The map is a server env set ONLY on our demo hosts (never a buyer
 * install), so the shipped source carries no demo domains:
 *
 *   DEMO_TEMPLATE_URLS={"electronics":"https://…","essential":"https://…"}
 *
 * Keys are theme manifest ids; values absolute origins. Malformed JSON or
 * non-http entries degrade to "no link" rather than a broken card.
 */
export function getDemoTemplateUrls(): Record<string, string> {
  const raw = process.env.DEMO_TEMPLATE_URLS;
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const urls: Record<string, string> = {};
  for (const [id, url] of Object.entries(parsed)) {
    if (typeof url === "string" && /^https?:\/\//.test(url)) {
      urls[id] = url.replace(/\/+$/, "");
    }
  }
  return urls;
}
