/**
 * Store-page identity vocabulary.
 *
 * Every StorePage document is addressed by ONE canonical `key`:
 *
 *   template:<templateType>:<variant>   e.g. template:home:default
 *   landing:<handle>                    e.g. landing:summer-sale
 *   group:<header|footer>               (P8 — shared section groups)
 *
 * The key is the unique index and the only identity other code should query
 * by; `kind`/`templateType`/`handle` are denormalized from it at write time
 * (`buildStorePageIdentity` in the model). URL handles remain a landing-page
 * concern only — templates and groups are not URL-addressed.
 *
 * This module is imported by CLIENT components (the create dialog previews
 * the slug), so it must stay free of server imports — the constants are
 * canonical here and re-exported by the StorePage model for its server
 * consumers.
 */

/**
 * Page templates the engine knows. Every entry here has a storefront
 * renderer AND a Customize editor — a type without both would let the API
 * create ghost StorePage documents nothing ever reads (a "search" template
 * lived here once and did exactly that; add it back only alongside its
 * renderer).
 */
export const STORE_TEMPLATE_TYPES = [
  "home",
  "product",
  "products",
  "category",
  "collection",
  "cart",
] as const;
export type StoreTemplateType = (typeof STORE_TEMPLATE_TYPES)[number];

/** Shared storefront section groups (P8). */
export const STORE_GROUP_TYPES = ["header", "footer"] as const;
export type StoreGroupType = (typeof STORE_GROUP_TYPES)[number];

export type StorePageKind = "template" | "landing" | "group";

const DEFAULT_TEMPLATE_VARIANT = "default";

/** Admin URL / API path segment for the home template (kept human-friendly). */
export const HOME_PAGE_HANDLE = "home";

const PAGE_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;

export function isValidPageHandle(handle: unknown): handle is string {
  return typeof handle === "string" && PAGE_HANDLE_PATTERN.test(handle);
}

/** Same slug rules the menus API applies. */
export function slugifyPageHandle(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 100);
}

export function isReservedPageHandle(handle: string): boolean {
  // "preview" and "saved-sections" are static siblings of the
  // /api/admin/store-pages/[handle] routes — a landing page named either
  // could never reach its own API. "template" and "group" are the
  // /draft/template/* and /draft/group/* preview namespaces.
  return (
    handle === HOME_PAGE_HANDLE ||
    handle === "preview" ||
    handle === "saved-sections" ||
    handle === "template" ||
    handle === "group"
  );
}

export function buildTemplateKey(
  type: StoreTemplateType,
  variant: string = DEFAULT_TEMPLATE_VARIANT,
): string {
  return `template:${type}:${variant}`;
}

export function buildLandingKey(handle: string): string {
  return `landing:${handle}`;
}

export function buildGroupKey(group: StoreGroupType): string {
  return `group:${group}`;
}

export const HOME_TEMPLATE_KEY = buildTemplateKey("home");

export type ParsedStorePageKey =
  | { kind: "template"; templateType: StoreTemplateType; variant: string }
  | { kind: "landing"; handle: string }
  | { kind: "group"; group: StoreGroupType };

function isTemplateType(value: string): value is StoreTemplateType {
  return (STORE_TEMPLATE_TYPES as readonly string[]).includes(value);
}

function isGroupType(value: string): value is StoreGroupType {
  return (STORE_GROUP_TYPES as readonly string[]).includes(value);
}

/** Strict parse of a canonical key. Returns null on anything malformed. */
export function parseStorePageKey(key: unknown): ParsedStorePageKey | null {
  if (typeof key !== "string") return null;
  const [kind, ...rest] = key.split(":");
  if (kind === "template") {
    const [templateType, variant] = rest;
    if (
      rest.length !== 2 ||
      !isTemplateType(templateType) ||
      !PAGE_HANDLE_PATTERN.test(variant)
    ) {
      return null;
    }
    return { kind: "template", templateType, variant };
  }
  if (kind === "landing") {
    const [handle] = rest;
    if (rest.length !== 1 || !isValidPageHandle(handle)) return null;
    return { kind: "landing", handle };
  }
  if (kind === "group") {
    const [group] = rest;
    if (rest.length !== 1 || !isGroupType(group)) return null;
    return { kind: "group", group };
  }
  return null;
}

/** Inverse of `parseStorePageKey` — the one place key strings are assembled. */
export function buildStorePageKey(parsed: ParsedStorePageKey): string {
  switch (parsed.kind) {
    case "template":
      return buildTemplateKey(parsed.templateType, parsed.variant);
    case "landing":
      return buildLandingKey(parsed.handle);
    case "group":
      return buildGroupKey(parsed.group);
  }
}

export interface AdminPageRef {
  key: string;
  parsed: ParsedStorePageKey;
}

/**
 * Resolve an /api/admin/store-pages/[handle] path segment to a page key.
 * The segment is a page REF, not necessarily a URL handle: "home", a
 * landing handle, or a template ref — "template:<type>" (default variant)
 * or a full "template:<type>:<variant>" key.
 */
export function resolveAdminPageRef(param: unknown): AdminPageRef | null {
  if (typeof param !== "string") return null;
  if (param === HOME_PAGE_HANDLE) {
    return {
      key: HOME_TEMPLATE_KEY,
      parsed: {
        kind: "template",
        templateType: "home",
        variant: DEFAULT_TEMPLATE_VARIANT,
      },
    };
  }
  if (param.startsWith("template:")) {
    const candidate =
      param.split(":").length === 2
        ? `${param}:${DEFAULT_TEMPLATE_VARIANT}`
        : param;
    const parsed = parseStorePageKey(candidate);
    if (parsed?.kind !== "template") return null;
    return { key: buildStorePageKey(parsed), parsed };
  }
  if (param.startsWith("group:")) {
    const parsed = parseStorePageKey(param);
    if (parsed?.kind !== "group") return null;
    return { key: param, parsed };
  }
  if (isValidPageHandle(param) && !isReservedPageHandle(param)) {
    return { key: buildLandingKey(param), parsed: { kind: "landing", handle: param } };
  }
  return null;
}
