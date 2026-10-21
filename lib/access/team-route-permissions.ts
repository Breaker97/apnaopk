import {
  ADMIN_AREA_PERMISSIONS as A,
  STAFF_RESOURCE_ANY as ANY,
  STAFF_RESOURCE_WRITE as WRITE,
} from "@/config/team-permissions.config";
import { STAFF_PERMISSIONS as S } from "@/config/permissions.config";

/**
 * Where team permissions are enforced: which permissions open each admin API
 * path and each admin dashboard area. A member holding ANY one of a rule's
 * permissions passes; the Owner and unrestricted administrators pass
 * everything (lib/access/team-permissions.ts).
 *
 * - `read` answers GET/HEAD, `write` every other method; `methods` names one
 *   method's own list. A rule without the list for a method leaves that
 *   method unchecked (the public reads of blog posts, brands …).
 * - A prefix matches whole path segments; `*` matches any one segment. The
 *   longest matching prefix wins.
 * - Under `/api/admin`, a path no rule names is refused to a restricted
 *   member (tests/team-route-permissions.test.ts keeps every route named).
 *
 * The same staff strings a staff member needs open the same records here, so
 * one grant means the same in both dashboards.
 */

type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TeamRouteRule {
  prefix: string;
  read?: readonly string[];
  write?: readonly string[];
  methods?: Partial<Record<Method, readonly string[]>>;
}

const view = (...permissions: string[]) => permissions;

/** Whoever works on the team in any way sees it. */
const TEAM_READ = view(
  A.VIEW_TEAM,
  A.MANAGE_TEAM,
  A.CREATE_TEAM_MEMBERS,
  A.ASSIGN_TEAM_ROLES,
  A.EDIT_MEMBER_PERMISSIONS,
  A.MANAGE_ROLES,
);

const areas = {
  vendors: { read: view(A.VIEW_VENDORS, A.MANAGE_VENDORS), write: view(A.MANAGE_VENDORS) },
  finance: { read: view(A.VIEW_FINANCE, A.MANAGE_FINANCE), write: view(A.MANAGE_FINANCE) },
  payouts: { read: view(A.VIEW_PAYOUTS, A.MANAGE_PAYOUTS), write: view(A.MANAGE_PAYOUTS) },
  payments: { read: view(A.VIEW_PAYMENTS, A.MANAGE_PAYMENTS), write: view(A.MANAGE_PAYMENTS) },
  quotes: { read: view(A.VIEW_QUOTES, A.MANAGE_QUOTES), write: view(A.MANAGE_QUOTES) },
  returns: { read: view(A.VIEW_RETURNS, A.MANAGE_RETURNS), write: view(A.MANAGE_RETURNS) },
  marketing: { read: view(A.VIEW_MARKETING, A.MANAGE_MARKETING), write: view(A.MANAGE_MARKETING) },
  boosts: { read: view(A.VIEW_BOOSTS, A.MANAGE_BOOSTS), write: view(A.MANAGE_BOOSTS) },
  onlineStore: { read: view(A.VIEW_ONLINE_STORE, A.MANAGE_ONLINE_STORE), write: view(A.MANAGE_ONLINE_STORE) },
  content: { read: view(A.VIEW_CONTENT, A.MANAGE_CONTENT), write: view(A.MANAGE_CONTENT) },
  aiAgent: { read: view(A.VIEW_AI_AGENT, A.MANAGE_AI_AGENT), write: view(A.MANAGE_AI_AGENT) },
  users: { read: view(A.VIEW_USERS, A.MANAGE_USERS), write: view(A.MANAGE_USERS) },
  settings: { read: view(A.VIEW_SETTINGS, A.MANAGE_SETTINGS, A.MANAGE_SENSITIVE_SETTINGS), write: view(A.MANAGE_SETTINGS) },
  sensitive: { read: view(A.MANAGE_SENSITIVE_SETTINGS), write: view(A.MANAGE_SENSITIVE_SETTINGS) },
  team: { read: TEAM_READ, write: view(A.MANAGE_TEAM) },
  roles: { read: TEAM_READ, write: view(A.MANAGE_ROLES) },
};

const staff = (resource: keyof typeof ANY) => ({
  read: ANY[resource],
  write: WRITE[resource] ?? ANY[resource],
});

/** Every admin API path, and the other paths an administrator's role reaches through. */
export const TEAM_API_RULES: readonly TeamRouteRule[] = [
  // --- /api/admin --------------------------------------------------------
  { prefix: "/api/admin/abandoned-checkouts", ...staff("abandoned") },
  { prefix: "/api/admin/access-requests", ...areas.vendors },
  // Vendors' tax change requests, answered from Settings → Tax Settings → Vendors.
  { prefix: "/api/admin/tax-requests", ...areas.vendors },
  { prefix: "/api/admin/ai-authoring", read: view(A.USE_AI_STUDIO), write: view(A.USE_AI_STUDIO) },
  { prefix: "/api/admin/ai-sales-agent", ...areas.aiAgent },
  { prefix: "/api/admin/analytics", read: ANY.analytics, write: ANY.analytics },
  { prefix: "/api/admin/audit-logs", read: view(A.VIEW_ACTIVITY_LOG) },
  { prefix: "/api/admin/boosts", ...areas.boosts },
  { prefix: "/api/admin/brands", ...staff("brands") },
  { prefix: "/api/admin/campaign-banners", ...staff("banners") },
  { prefix: "/api/admin/categories", ...staff("categories") },
  { prefix: "/api/admin/collections", ...staff("products") },
  { prefix: "/api/admin/coupons", ...areas.marketing },
  { prefix: "/api/admin/customers", ...staff("customers") },
  { prefix: "/api/admin/digital-assets", ...staff("products") },
  { prefix: "/api/admin/email-deliveries", ...areas.settings },
  { prefix: "/api/admin/finance", ...areas.finance },
  { prefix: "/api/admin/global-variants", ...staff("products") },
  { prefix: "/api/admin/inventory", ...staff("inventory") },
  // What stock cost: the books' numbers, changed by the books' people.
  { prefix: "/api/admin/inventory/valuation-changes", ...areas.finance },
  { prefix: "/api/admin/inventory/cost-sources", ...areas.finance },
  { prefix: "/api/admin/inventory/receipts", ...areas.finance },
  { prefix: "/api/admin/inventory/receipt-corrections", ...areas.finance },
  { prefix: "/api/admin/locations", ...staff("inventory") },
  { prefix: "/api/admin/messaging", read: ANY.inbox, write: view(S.MANAGE_INBOX) },
  { prefix: "/api/admin/meta-catalog", ...areas.marketing },
  { prefix: "/api/admin/orders", ...staff("orders") },
  { prefix: "/api/admin/orders/*/chargebacks", ...areas.payments },
  { prefix: "/api/admin/payments", ...areas.payments },
  { prefix: "/api/admin/payouts", ...areas.payouts },
  { prefix: "/api/admin/preorders", ...staff("orders") },
  { prefix: "/api/admin/products", ...staff("products") },
  { prefix: "/api/admin/quotes", ...areas.quotes },
  { prefix: "/api/admin/returns", ...areas.returns },
  { prefix: "/api/admin/reviews", ...staff("reviews") },
  { prefix: "/api/admin/security", ...areas.users },
  // One route saves every section; the handler holds each save to its
  // section's area (lib/settings/sensitive-settings.ts settingsSavePermissions),
  // so the route admits anyone who may save one. Its answer has no secrets.
  {
    prefix: "/api/admin/settings",
    read: [...areas.settings.read, ...areas.onlineStore.read, ...areas.aiAgent.read, ...areas.boosts.read, ...areas.vendors.read],
    write: view(A.MANAGE_SETTINGS, A.MANAGE_SENSITIVE_SETTINGS, A.MANAGE_ONLINE_STORE, A.MANAGE_AI_AGENT, A.MANAGE_BOOSTS, A.MANAGE_VENDORS),
  },
  { prefix: "/api/admin/settings/notifications", ...areas.settings },
  // Each test talks to an outside service with the store's credentials.
  { prefix: "/api/admin/settings/test-payment", ...areas.sensitive },
  { prefix: "/api/admin/settings/test-storage", ...areas.sensitive },
  { prefix: "/api/admin/settings/test-oauth", ...areas.sensitive },
  { prefix: "/api/admin/settings/test-email", ...areas.sensitive },
  { prefix: "/api/admin/settings/test-sms", ...areas.sensitive },
  { prefix: "/api/admin/settings/test-ai", ...areas.sensitive },
  { prefix: "/api/admin/settings/test-carrier", ...areas.sensitive },
  { prefix: "/api/admin/settings/carriers", ...areas.sensitive },
  { prefix: "/api/admin/settings/pesapal", ...areas.sensitive },
  { prefix: "/api/admin/sliders", ...areas.onlineStore },
  { prefix: "/api/admin/sms-deliveries", ...areas.settings },
  // Adding a member, changing one, and the rest (invite, notes, remove) are
  // separate grants; a save that changes a role or permissions is held to
  // that grant in the handler (lib/access/team-member-roles.ts TEAM_DUTIES).
  { prefix: "/api/admin/staff", ...areas.team, methods: { POST: view(A.CREATE_TEAM_MEMBERS) } },
  {
    prefix: "/api/admin/staff/*",
    ...areas.team,
    methods: { PUT: view(A.MANAGE_TEAM, A.ASSIGN_TEAM_ROLES, A.EDIT_MEMBER_PERMISSIONS) },
  },
  { prefix: "/api/admin/storage", ...areas.settings },
  { prefix: "/api/admin/store-pages", ...areas.onlineStore },
  { prefix: "/api/admin/team-roles", ...areas.roles },
  // Printable designs: Settings → Invoice Settings.
  { prefix: "/api/admin/invoice-templates", ...areas.settings },
  { prefix: "/api/admin/theme-settings", ...areas.onlineStore },
  { prefix: "/api/admin/transfers", ...staff("inventory") },
  { prefix: "/api/admin/users", ...areas.users },
  { prefix: "/api/admin/vendors", ...areas.vendors },
  { prefix: "/api/admin/vendors/*/finance", ...areas.finance },
  { prefix: "/api/admin/vendors/*/repayments", ...areas.finance },

  // --- Writes outside /api/admin that only the store's team may make ------
  // Their reads are the storefront's and stay open.
  { prefix: "/api/blog-posts", write: areas.content.write },
  { prefix: "/api/blog-categories", write: areas.content.write },
  { prefix: "/api/blog-comments", write: areas.content.write },
  { prefix: "/api/menus", write: areas.onlineStore.write },
  { prefix: "/api/brands", write: WRITE.brands },
  { prefix: "/api/categories", write: WRITE.categories },

  // --- The store's inbox, as an administrator reads it -------------------
  { prefix: "/api/chat", read: ANY.inbox, write: WRITE.inbox },

  // --- The till ----------------------------------------------------------
  { prefix: "/api/pos", read: ANY.pos, write: ANY.pos },

  // --- The house store, which an administrator runs through the vendor routes
  { prefix: "/api/vendor", ...areas.vendors },
  { prefix: "/api/vendor/products", ...staff("products") },
  { prefix: "/api/vendor/orders", ...staff("orders") },
  { prefix: "/api/vendor/preorders", ...staff("orders") },
  { prefix: "/api/vendor/returns", ...areas.returns },
  { prefix: "/api/vendor/finance", ...areas.finance },
  { prefix: "/api/vendor/ai-authoring", read: view(A.USE_AI_STUDIO), write: view(A.USE_AI_STUDIO) },
  { prefix: "/api/vendor/boosts", ...areas.boosts },
];

/** The admin dashboard's areas: the permissions that open each one's screens. */
export const TEAM_PAGE_RULES: readonly { prefix: string; anyOf: readonly string[] }[] = [
  { prefix: "/admin/dashboard", anyOf: view(A.VIEW_DASHBOARD) },
  { prefix: "/admin/orders", anyOf: ANY.orders },
  { prefix: "/admin/preorders", anyOf: ANY.orders },
  { prefix: "/admin/quotes", anyOf: areas.quotes.read },
  { prefix: "/admin/returns", anyOf: areas.returns.read },
  { prefix: "/admin/abandoned-checkouts", anyOf: ANY.abandoned },
  { prefix: "/admin/abandoned-carts", anyOf: ANY.abandoned },
  { prefix: "/admin/products", anyOf: ANY.products },
  { prefix: "/admin/collections", anyOf: ANY.products },
  { prefix: "/admin/global-variants", anyOf: ANY.products },
  { prefix: "/admin/categories", anyOf: ANY.categories },
  { prefix: "/admin/brands", anyOf: ANY.brands },
  { prefix: "/admin/reviews", anyOf: ANY.reviews },
  { prefix: "/admin/inventory", anyOf: ANY.inventory },
  { prefix: "/admin/inventory/finance", anyOf: areas.finance.read },
  { prefix: "/admin/locations", anyOf: ANY.inventory },
  { prefix: "/admin/transfers", anyOf: ANY.inventory },
  { prefix: "/admin/purchase-orders", anyOf: ANY.inventory },
  { prefix: "/admin/customers", anyOf: ANY.customers },
  { prefix: "/admin/users", anyOf: areas.users.read },
  { prefix: "/admin/vendors", anyOf: areas.vendors.read },
  { prefix: "/admin/access-requests", anyOf: areas.vendors.read },
  { prefix: "/admin/payouts", anyOf: areas.payouts.read },
  { prefix: "/admin/payments", anyOf: areas.payments.read },
  { prefix: "/admin/finance", anyOf: areas.finance.read },
  { prefix: "/admin/discounts", anyOf: areas.marketing.read },
  { prefix: "/admin/gift-cards", anyOf: areas.marketing.read },
  { prefix: "/admin/marketing", anyOf: areas.marketing.read },
  { prefix: "/admin/markets", anyOf: areas.marketing.read },
  { prefix: "/admin/boosts", anyOf: areas.boosts.read },
  { prefix: "/admin/online-store", anyOf: areas.onlineStore.read },
  { prefix: "/admin/online-store/campaign-banners", anyOf: ANY.banners },
  { prefix: "/admin/content", anyOf: areas.content.read },
  { prefix: "/admin/inbox", anyOf: ANY.inbox },
  { prefix: "/admin/ai-sales-agent", anyOf: areas.aiAgent.read },
  { prefix: "/admin/ai-studio", anyOf: view(A.USE_AI_STUDIO) },
  { prefix: "/admin/analytics", anyOf: ANY.analytics },
  { prefix: "/admin/pos", anyOf: ANY.pos },
  // The settings shell opens to anyone who reaches one of its pages; each
  // page then holds to its own rule.
  { prefix: "/admin/settings", anyOf: [...areas.settings.read, A.VIEW_ACTIVITY_LOG] },
  { prefix: "/admin/settings/*", anyOf: areas.settings.read },
  { prefix: "/admin/settings/activity-log", anyOf: view(A.VIEW_ACTIVITY_LOG) },
  { prefix: "/admin/staff", anyOf: areas.team.read },
  { prefix: "/admin/staff/new", anyOf: view(A.CREATE_TEAM_MEMBERS) },
  { prefix: "/admin/invoice-templates", anyOf: areas.settings.read },
  { prefix: "/admin/staff/roles/new", anyOf: view(A.MANAGE_ROLES) },
  // Every member reaches their own profile.
  { prefix: "/admin/profile", anyOf: [] },
];

function segments(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean);
}

function prefixMatches(prefix: string[], path: string[]): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((part, index) => part === "*" || part === path[index]);
}

/** The most specific rule for a path: the longest prefix, an exact segment beating `*`. */
function longestMatch<T extends { prefix: string }>(rules: readonly T[], pathname: string): T | null {
  const path = segments(pathname);
  let best: T | null = null;
  let bestScore = -1;
  for (const rule of rules) {
    const prefix = segments(rule.prefix);
    if (!prefixMatches(prefix, path)) continue;
    const exact = prefix.filter((part) => part !== "*").length;
    const score = prefix.length * 100 + exact;
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

/** The locale prefix a dashboard path may carry (`/bn/admin/orders`). */
function withoutLocale(pathname: string): string {
  const [first, ...rest] = segments(pathname);
  if (first === "admin" || first === undefined) return pathname;
  return /^[a-z]{2}(-[a-z]{2,4})?$/i.test(first) && rest[0] === "admin" ? `/${rest.join("/")}` : pathname;
}

export type TeamRouteRequirement =
  /** No rule speaks to this path and method. */
  | { kind: "none" }
  /** A rule names the permissions, any one of which opens it. */
  | { kind: "anyOf"; permissions: readonly string[] };

/** What an API request needs from a restricted member of the team. */
export function teamApiRequirement(pathname: string, method: string): TeamRouteRequirement {
  const rule = longestMatch(TEAM_API_RULES, pathname);
  if (!rule) return { kind: "none" };
  const upper = method.toUpperCase() as Method;
  const own = rule.methods?.[upper];
  const list = own ?? (upper === "GET" || upper === "HEAD" ? rule.read : rule.write);
  return list ? { kind: "anyOf", permissions: list } : { kind: "none" };
}

/** What a dashboard page needs; null when no area rule names it. */
export function teamPageRequirement(pathname: string): readonly string[] | null {
  const rule = longestMatch(TEAM_PAGE_RULES, withoutLocale(pathname));
  return rule ? rule.anyOf : null;
}

/** Whether a path is one of the admin API's own (refused to a restricted member when no rule names it). */
export function isAdminApiPath(pathname: string): boolean {
  const [first, second] = segments(pathname);
  return first === "api" && second === "admin";
}
