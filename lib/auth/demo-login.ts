import "server-only";

import {
  DEMO_ACCOUNTS,
  DEMO_LOGIN_ORDER,
  DEMO_ROLE_LABELS,
  DEMO_TEMPLATE_VENDORS,
} from "@/config/demo-credentials";
import { isDemoModeEnabled } from "@/lib/demo-mode";
import type { DemoCredential } from "@/components/auth/login-form";

/**
 * The demo quick-login card's accounts — on a DEMO_MODE deployment, and
 * nowhere else. Built on the server and handed to the login page as a prop,
 * so a store that is not a demo never ships them to a browser at all.
 *
 * Derived from `config/demo-credentials.ts`, the one list the seeders use too:
 * a copy kept beside the card drifted from them once, and the card offered a
 * quick login for an account that did not exist.
 *
 * The Vendor row signs in as the active theme's showcase seller, whose
 * catalog is the one the storefront shows; a theme without one keeps the
 * house store's vendor login.
 */
export function demoLoginCredentials(themeId?: string): DemoCredential[] {
  if (!isDemoModeEnabled()) return [];
  const themeVendor = themeId ? DEMO_TEMPLATE_VENDORS[themeId] : undefined;
  return DEMO_LOGIN_ORDER.map((role) => {
    const account =
      role === "vendor" && themeVendor ? themeVendor : DEMO_ACCOUNTS[role];
    return {
      role,
      label: DEMO_ROLE_LABELS[role],
      email: account.email,
      password: account.password,
    };
  });
}
