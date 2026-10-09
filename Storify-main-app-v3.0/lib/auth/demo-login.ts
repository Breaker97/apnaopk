import "server-only";

import {
  DEMO_ACCOUNTS,
  DEMO_LOGIN_ORDER,
  DEMO_ROLE_LABELS,
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
 */
export function demoLoginCredentials(): DemoCredential[] {
  if (!isDemoModeEnabled()) return [];
  return DEMO_LOGIN_ORDER.map((role) => ({
    role,
    label: DEMO_ROLE_LABELS[role],
    email: DEMO_ACCOUNTS[role].email,
    password: DEMO_ACCOUNTS[role].password,
  }));
}
