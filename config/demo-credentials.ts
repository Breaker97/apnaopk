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
  /** User document `name`. The vendor's *store* name comes from the catalog. */
  name: string;
  email: string;
  password: string;
  phone: string;
}

type DemoRole = "admin" | "vendor" | "staff" | "customer";

export const DEMO_ACCOUNTS = {
  admin: {
    name: "Storify Admin",
    email: "admin@storify.com",
    password: "Admin@123",
    phone: "+1 555-0100",
  },
  vendor: {
    name: "Storify Vendor",
    email: "vendor@storify.com",
    password: "Vendor@123",
    phone: "+1 555-0200",
  },
  staff: {
    name: "Storify Staff",
    email: "staff@storify.com",
    password: "Staff@123",
    phone: "+1 555-0300",
  },
  customer: {
    name: "Storify Customer",
    email: "customer@storify.com",
    password: "Customer@123",
    phone: "+1 555-0400",
  },
} as const satisfies Record<DemoRole, DemoAccount>;

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
