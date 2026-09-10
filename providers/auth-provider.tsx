"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession as useBetterAuthSession } from "@/lib/auth/auth-client";
import { useApplyOnChange } from "@/hooks/use-apply-on-change";

interface ProfileContextValue {
  profileImage: string | null;
}

const ProfileContext = createContext<ProfileContextValue>({
  profileImage: null,
});

/**
 * AuthProvider fetches the user profile image once and shares it
 * across all components that use useAuth(), preventing duplicate
 * API calls to /api/user/profile.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session } = useBetterAuthSession();
  const [profileImage, setProfileImage] = useState<string | null>(null);

  const userId = (session?.user as { id?: string } | undefined)?.id;

  useApplyOnChange([userId], () => {
    if (!userId) setProfileImage(null);
  });

  useEffect(() => {
    if (!userId) return;

    let isActive = true;

    (async () => {
      try {
        const res = await fetch("/api/user/profile");
        if (!res.ok) return;
        const json = (await res.json()) as {
          success?: boolean;
          data?: { user?: { image?: string | null } };
        };
        if (!json?.success) return;
        const image = json?.data?.user?.image ?? null;
        if (isActive) setProfileImage(image);
      } catch {
        // ignore
      }
    })();

    return () => {
      isActive = false;
    };
  }, [userId]);

  const value = useMemo(() => ({ profileImage }), [profileImage]);

  return (
    <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
  );
}

/**
 * The same context with nothing behind it — for the builder's section
 * preview frames, where a session subscription (and the profile fetch it
 * triggers) would cost two database round trips per frame reload for a
 * document that renders one storefront section with pointer events off.
 */
const STATIC_PROFILE: ProfileContextValue = { profileImage: null };

export function StaticAuthProvider({ children }: { children: ReactNode }) {
  return (
    <ProfileContext.Provider value={STATIC_PROFILE}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfileContext() {
  return useContext(ProfileContext);
}
