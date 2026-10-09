/** Who is reading the log: it decides which screens a row may link to. */
export type ActivityLogArea = "admin" | "vendor";

/**
 * Which page a log row's record opens.
 *
 * Only a page that is *about that record* counts: a resource whose screen is a
 * list with no page of its own (coupons, reviews, locations, ...) is plain text,
 * so a click never lands somewhere that is not the thing the row names. A deleted
 * record, an id that is not a database id (a media key, a settings section) and
 * a resource this map has never heard of are plain text too.
 *
 * Hrefs carry no locale prefix: the dashboards' `Link` adds it.
 */

/** What the map needs to know about a row. Both `ActivityLogRow` and an entry fit. */
export interface ResourceLinkSubject {
  action?: string;
  resource: string;
  resourceId?: string;
  resourceName?: string;
  /** The actor, which is also the record's subject when someone changes their own account. */
  userId?: string;
  userRole?: string;
  actorVendorId?: string;
  /** The role of the user the row is about, when the full entry says so (`after.role`). */
  targetRole?: string;
}

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Roles whose page is the team screen. `seller` is the legacy name for staff. */
const TEAM_ROLES = new Set(["admin", "staff", "seller"]);

const ADMIN_TARGETS: Record<string, (id: string) => string> = {
  vendor: (id) => `/admin/vendors/${id}`,
  product: (id) => `/admin/products/${id}/edit`,
  order: (id) => `/admin/orders/${id}`,
  category: (id) => `/admin/categories/${id}/edit`,
  brand: (id) => `/admin/brands/${id}/edit`,
  collection: (id) => `/admin/collections/${id}`,
  transfer: (id) => `/admin/transfers/${id}`,
  payout: (id) => `/admin/payouts/${id}`,
  vendorPlan: (id) => `/admin/vendors/plans/${id}/edit`,
  boostCampaign: (id) => `/admin/boosts/${id}`,
  menu: (id) => `/admin/online-store/menus/${id}/edit`,
  blogPost: (id) => `/admin/content/blog-posts/${id}/edit`,
  blogCategory: (id) => `/admin/content/blog-categories/${id}/edit`,
};

/** A vendor's own screens. Never an admin route: the vendor area would bounce them. */
const VENDOR_TARGETS: Record<string, (id: string) => string> = {
  product: (id) => `/vendor/products/${id}/edit`,
  order: (id) => `/vendor/orders/${id}`,
  brand: (id) => `/vendor/brands/${id}/edit`,
  transfer: (id) => `/vendor/transfers/${id}`,
  payout: (id) => `/vendor/payouts/${id}`,
  boostCampaign: (id) => `/vendor/boosts/${id}`,
};

/**
 * The role of the user a `user` row is about.
 *
 * The list does not load before/after, so it only knows what the row itself
 * says: when someone acts on their own account (a password change, turning on
 * two-factor), actor and target are the same person. The detail sheet has the
 * record and passes `targetRole`.
 */
function targetRoleOf(subject: ResourceLinkSubject): string | undefined {
  if (subject.targetRole) return subject.targetRole;
  if (subject.userId && subject.resourceId === subject.userId) return subject.userRole;
  return undefined;
}

function userHref(subject: ResourceLinkSubject, id: string, area: ActivityLogArea): string | null {
  const role = targetRoleOf(subject);
  if (!role) return null;

  if (area === "vendor") {
    // A vendor's staff have a page; the owner's own account does not.
    return TEAM_ROLES.has(role) && role !== "admin" ? `/vendor/staff/${id}` : null;
  }

  if (TEAM_ROLES.has(role)) return `/admin/staff/${id}`;

  // A customer's page is keyed by their profile, not by the account the row
  // names, so the closest honest link is the customers list narrowed to them.
  if (role === "customer" && subject.resourceName?.includes("@")) {
    return `/admin/customers?search=${encodeURIComponent(subject.resourceName)}`;
  }
  return null;
}

/** The page a row's record opens, or null when it is plain text. */
export function resourceHref(
  subject: ResourceLinkSubject,
  area: ActivityLogArea,
): string | null {
  const id = subject.resourceId;
  if (!id || subject.action === "DELETE") return null;

  if (subject.resource === "user") {
    return OBJECT_ID.test(id) ? userHref(subject, id, area) : null;
  }

  if (area === "vendor" && subject.resource === "vendor") {
    // The store's own settings, and only for the store itself.
    return id === subject.actorVendorId ? "/vendor/settings" : null;
  }

  if (!OBJECT_ID.test(id)) return null;
  const build = (area === "vendor" ? VENDOR_TARGETS : ADMIN_TARGETS)[subject.resource];
  return build ? build(id) : null;
}
