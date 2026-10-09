import { USER_ROLES } from "@/config/app.config";
import { isStaffRole } from "@/lib/access/staff-role";
import { splitLocalePath } from "@/lib/i18n/locale-prefix";
import type { HeaderMenuItem } from "@/lib/site-config/header-config";
import type {
  HeaderLayout,
  HeaderLayoutItem,
  HeaderNavLink,
} from "@/lib/site-config/header-layout";

/**
 * Who the storefront's "Become a Vendor" invitation is for, and which links
 * are that invitation.
 *
 * It is for guests and shoppers. An admin, a vendor or a staff member already
 * works on the store side — each has a dashboard of their own
 * (getRoleDashboardPath) — and inviting them to apply reads as a broken
 * storefront. The pages carrying the invitation are served from the cache to
 * every visitor, so the server never knows who is looking: the links are
 * dropped in the browser, once the session has loaded (useVendorSignupVisible).
 *
 * Client-safe: no server-only imports.
 */

const VENDOR_SIGNUP_ROUTE = "/become-vendor";

/**
 * The storefront route a link points at — no language prefix, query, hash or
 * trailing slash. An absolute URL is read for its path. Null for anything
 * that is not a path (a relative link, `mailto:`, an empty value).
 */
export function storefrontRouteOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let path = value.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  path = path.split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/")) return null;
  return splitLocalePath(path).rest.replace(/(.)\/+$/, "$1");
}

/** Whether a link leads to the vendor application (`/become-vendor`). */
export function isVendorSignupHref(value: unknown): boolean {
  const route = storefrontRouteOf(value);
  return (
    route === VENDOR_SIGNUP_ROUTE ||
    Boolean(route?.startsWith(`${VENDOR_SIGNUP_ROUTE}/`))
  );
}

/** A guest or a shopper: someone with no dashboard of their own. */
export function isVendorSignupAudience(role?: string | null): boolean {
  return (
    role !== USER_ROLES.ADMIN &&
    role !== USER_ROLES.VENDOR &&
    !isStaffRole(role)
  );
}

/**
 * The admin's preview of the storefront (`/draft`, `/section-preview`). The
 * admin looking at it is reviewing what shoppers will see, so the invitation
 * stays in.
 */
export function isStorefrontPreviewRoute(pathname: string | null): boolean {
  const route = storefrontRouteOf(pathname);
  return ["/draft", "/section-preview"].some(
    (preview) => route === preview || Boolean(route?.startsWith(`${preview}/`)),
  );
}

/** A header menu tree without its vendor-signup entries, at any depth. */
export function withoutVendorSignupMenuItems(
  items: HeaderMenuItem[],
): HeaderMenuItem[] {
  return items.flatMap((item) =>
    isVendorSignupHref(item.href)
      ? []
      : [
          {
            ...item,
            children: item.children
              ? withoutVendorSignupMenuItems(item.children)
              : item.children,
          },
        ],
  );
}

function withoutVendorSignupNavLinks(links: HeaderNavLink[]): HeaderNavLink[] {
  return links.flatMap((link) =>
    isVendorSignupHref(link.url)
      ? []
      : [{ ...link, children: withoutVendorSignupNavLinks(link.children) }],
  );
}

/**
 * The Header Studio layout without its vendor-signup links and buttons. An
 * item left with nothing to show leaves too, so a lone "Become a Vendor"
 * button does not stay behind as an empty padded box.
 */
export function withoutVendorSignupInHeaderLayout(
  layout: HeaderLayout,
): HeaderLayout {
  const pruneItem = (item: HeaderLayoutItem): HeaderLayoutItem[] => {
    if (item.type === "nav") {
      const links = withoutVendorSignupNavLinks(item.links);
      return links.length > 0 || item.links.length === 0
        ? [{ ...item, links }]
        : [];
    }
    if (item.type === "buttons") {
      const buttons = item.buttons.filter(
        (button) => !isVendorSignupHref(button.url),
      );
      return buttons.length > 0 || item.buttons.length === 0
        ? [{ ...item, buttons }]
        : [];
    }
    return [item];
  };

  return {
    ...layout,
    rows: layout.rows.map((row) => ({
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        items: column.items.flatMap(pruneItem),
      })),
    })),
  };
}
