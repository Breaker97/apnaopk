"use client";

import { usePathname } from "@/hooks/use-locale-navigation";
import { useSession } from "@/lib/auth/auth-client";
import {
  isStorefrontPreviewRoute,
  isVendorSignupAudience,
} from "@/lib/vendors/vendor-signup-links";

/**
 * Whether this visitor should see "Become a Vendor" links and sections — see
 * lib/vendors/vendor-signup-links.ts.
 *
 * True until the session has loaded, which is also what the cached HTML
 * shows, so hydration never disagrees with the server. An admin, vendor or
 * staff member sees the invitation leave once their session arrives.
 */
export function useVendorSignupVisible(): boolean {
  const { data } = useSession();
  const pathname = usePathname();
  if (isStorefrontPreviewRoute(pathname)) return true;
  return isVendorSignupAudience(
    (data?.user as { role?: string } | undefined)?.role,
  );
}
