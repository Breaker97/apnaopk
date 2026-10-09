import type { DemoModeState } from "@/lib/demo-mode-shared";

/**
 * GET /api/user/profile. The profile form and the two-factor card both read
 * it through `useSuspenseResource`, so between them — and between the Profile
 * and Security pages — it is one request, and each write updates the copy the
 * other one shows.
 */
export const USER_PROFILE_URL = "/api/user/profile";

export interface UserProfilePayload {
  demoMode?: DemoModeState;
  user?: {
    name?: string;
    email?: string;
    image?: string | null;
    phone?: string;
    birthday?: string;
    gender?: string;
    twoFactorEnabled?: boolean;
    /** Whether the store offers self-service 2FA to this user's role. */
    twoFactorAvailable?: boolean;
  } | null;
}
