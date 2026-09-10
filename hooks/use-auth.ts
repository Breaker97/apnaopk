"use client";

import { useSession as useBetterAuthSession } from "@/lib/auth/auth-client";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import type { UserRole } from "@/config/app.config";
import { appConfig } from "@/config/app.config";
import { buildLoginUrl, currentBrowserPath } from "@/lib/auth/return-path";
import { useProfileContext } from "@/providers/auth-provider";

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

  const { profileImage } = useProfileContext();

  const mergedUser = useMemo(() => {
    const user = session?.user as ExtendedUser | null | undefined;
    if (!user) return null;
    if (!profileImage) return user;
    return { ...user, image: profileImage };
  }, [session?.user, profileImage]);

  return {
    user: mergedUser,
    session: session?.session,
    isLoading: isPending,
    isAuthenticated: !!session?.user,
    error,
  };
}

