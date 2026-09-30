"use client";

import { useSession as useBetterAuthSession } from "@/lib/auth/auth-client";
import { useParams } from "next/navigation";
import { useRouter } from "@/hooks/use-locale-navigation";
import { useEffect } from "react";
import type { UserRole } from "@/config/app.config";
import { appConfig } from "@/config/app.config";
import { buildLoginUrl, currentBrowserPath } from "@/lib/auth/return-path";

/**
 * Custom hook for authentication with role-based access control
 */
export function useAuth(options?: {
  required?: boolean;
  requiredRole?: UserRole | UserRole[];
  redirectTo?: string;
}) {
  const { data: session, isPending, error } = useBetterAuthSession();
  const router = useRouter();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "";
  const { required = false, requiredRole, redirectTo } = options || {};

  useEffect(() => {
    if (isPending) return;

    // Redirect if authentication is required but user is not logged in.
    // Unless the caller chose a target, sign in and come back right here.
    if (required && !session?.user) {
      router.push(
        redirectTo ??
          (locale
            ? buildLoginUrl(locale, currentBrowserPath())
            : appConfig.urls.login),
      );
      return;
    }

    // Check role-based access
    if (session?.user && requiredRole) {
      const userRole = (session.user as { role?: UserRole }).role;
      const allowedRoles = Array.isArray(requiredRole)
        ? requiredRole
        : [requiredRole];

      if (!userRole || !allowedRoles.includes(userRole)) {
        router.push(appConfig.urls.home);
      }
    }
  }, [isPending, session, required, requiredRole, redirectTo, router, locale]);

  // Define the extended user type
  type ExtendedUser = {
    id: string;
    name: string;
    email: string;
    image?: string | null;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
    role?: UserRole;
    phone?: string;
  };

  // The avatar comes straight off the session. Both avatar uploaders end
  // with `authClient.updateUser({ image })`, which re-issues the session
  // cookie cache and wakes every `useSession` subscriber, so the header
  // follows a new picture with no read of its own. A root provider used to
  // overlay it from `/api/user/profile` on every page load — three database
  // round trips for a field the session already carried.
  const user = (session?.user as ExtendedUser | null | undefined) ?? null;

  return {
    user,
    session: session?.session,
    isLoading: isPending,
    isAuthenticated: !!session?.user,
    error,
  };
}
