/**
 * Demo account credentials — the one source every seeded login is built from.
 *
 * Three copies of this list used to exist independently: `scripts/seed.mjs`
 * (the full demo store), `scripts/seed-users.mjs` (accounts only) and the
 * DEMO_MODE quick-login card in `components/auth/login-form.tsx`. They drifted,
 * and the drift was invisible until login failed: `pnpm db:full-reset` seeds
 * from `seed.mjs`, so the `@storify.com` accounts the login card and the README
 * advertise were never created and every one of those sign-ins was rejected.
 *
 * Changing an email or password here changes it for both seeders and for the
 * card at once. Nothing else may hard-code a demo login.
 */

interface DemoAccount {
  /**
   * User document `name`. Brand-free: emails greet the recipient by it, so a
   * seeded store renamed in Settings would still say "Hi Storify Admin".
   * The vendor's *store* name comes from the catalog.
   */
  name: string;
  email: string;
  password: string;
  phone: string;
}

type DemoRole = "admin" | "vendor" | "staff" | "customer";

export const DEMO_ACCOUNTS = {
  admin: {
    name: "Store Admin",
    email: "admin@storify.com",
    password: "Admin@123",
    phone: "+1 555-0100",
  },
  vendor: {
    name: "Store Vendor",
    email: "vendor@storify.com",
    password: "Vendor@123",
    phone: "+1 555-0200",
  },
  staff: {
    name: "Store Staff",
    email: "staff@storify.com",
    password: "Staff@123",
    phone: "+1 555-0300",
  },
  customer: {
    name: "Store Customer",
    email: "customer@storify.com",
    password: "Customer@123",
    phone: "+1 555-0400",
  },
} as const satisfies Record<DemoRole, DemoAccount>;

interface TemplateVendorAccount {
  /** The store's slug in that template's snapshot (`seed-data/<id>/vendors.json`). */
  slug: string;
  email: string;
  password: string;
}

/**
 * The showcase seller of each template's demo store, keyed by template id
 * (`essential` is the gallery's Classic). The quick-login card's Vendor row
 * offers the active theme's seller instead of the house store's `vendor`
 * login, which sells nothing of its own; a theme with no entry here (such as
 * women-fashion) keeps that login. `scripts/seed.mjs` gives the snapshot
 * vendor with the matching slug this login rather than the generic
 * `<slug>@example.com` one.
 */
export const DEMO_TEMPLATE_VENDORS: Readonly<
  Record<string, TemplateVendorAccount>
> = {
  electronics: {
    slug: "electronica-xr",
    email: "electronicaxr@storify.com",
    password: "vendor@12",
  },
  essential: {
    slug: "veloura",
    email: "veloura@storify.com",
    password: "vendor@12",
  },
  furniture: {
    slug: "urbannest-furniture",
    email: "urbannest@storify.com",
    password: "vendor@12",
  },
};

/**
 * Order the quick-login card lists the accounts in — most-privileged first,
 * which is the order a reviewer clicks through them.
 */
export const DEMO_LOGIN_ORDER = [
  "admin",
  "vendor",
  "customer",
  "staff",
] as const satisfies readonly DemoRole[];

/** Human label for each row of the quick-login card. */
export const DEMO_ROLE_LABELS = {
  admin: "Admin",
  vendor: "Vendor",
  staff: "Staff",
  customer: "Customer",
} as const satisfies Record<DemoRole, string>;
