const TestProviderSchema = z.object({ provider: z.string().max(40).optional() });

/**
 * POST /api/admin/settings/test-oauth
 * Verify the stored Google / Facebook OAuth credentials (admin only).
 *
 * Neither provider offers a "validate these credentials" endpoint, but both
 * answer differently to a client that authenticates than to one that does not,
 * and that difference is enough to tell an admin whether the ID/secret pair
 * they pasted is real — without signing anybody in. Checking it any other way
 * would mean running the actual sign-in flow, which would replace the admin's
 * own session with a customer one (OAuth logins are customer-only here).
 *
 * What this cannot check is whether the redirect URI has been registered in the
 * provider's console: both providers only evaluate that during a real
 * authorization request. The UI says so next to the button.
 */

import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { connectDB } from "@/lib/db";
import { getSettings } from "@/models/settings.model";
import { USER_ROLES } from "@/config/app.config";
import { resolveOAuthCredentials } from "@/lib/settings/credentials";
import { getDemoModeMutationResponse } from "@/lib/demo-mode";
import {
  buildOAuthCallbackUrl,
  isOAuthProviderId,
  resolveAuthBaseUrl,
  type OAuthProviderId,
} from "@/lib/auth/oauth-callback";
import { z } from "zod";

/** A provider that is slow to answer must not hold an admin request open. */
const TIMEOUT_MS = 10_000;

interface CheckResult {
  ok: boolean;
  message: string;
}

/**
 * Google authenticates the client before it looks at the authorization code, so
 * a deliberately bogus code separates the two failures cleanly:
 *   - bad client id/secret  -> `invalid_client`
 *   - good client, bad code -> `invalid_grant`  (what we want to see)
 */
async function checkGoogle(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<CheckResult> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: "storify-credential-check",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    error_description?: string;
  } | null;

  if (response.ok) {
    return { ok: true, message: "Google credentials are valid" };
  }

  const error = payload?.error;
  const description = payload?.error_description;

  if (error === "invalid_grant") {
    return {
      ok: true,
      message:
        "Google accepted the client ID and secret. Finish by adding the redirect URI above to the same OAuth client.",
    };
  }

  if (error === "invalid_client") {
    return {
      ok: false,
      message: `Google rejected the credentials${
        description ? `: ${description}` : ""
      }. Check the client ID and secret, and that the OAuth client has not been deleted.`,
    };
  }

  return {
    ok: false,
    message: `Google returned ${error || response.status}${
      description ? `: ${description}` : ""
    }`,
  };
}

/**
 * Meta's app access token grant is a direct credential check: it succeeds only
 * for a real app ID + secret pair. The follow-up name lookup is a nicety — it
 * lets the admin confirm they wired up the app they meant to.
 */
async function checkFacebook(
  appId: string,
  appSecret: string,
): Promise<CheckResult> {
  // Deliberately version-less. This endpoint is stable across Graph versions,
  // and pinning one here would start failing the day that version is retired —
  // on a screen a buyer only visits when something is already broken.
  const tokenUrl = new URL("https://graph.facebook.com/oauth/access_token");
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("grant_type", "client_credentials");

  const response = await fetch(tokenUrl, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => null)) as {
    access_token?: string;
    error?: { message?: string; code?: number };
  } | null;

  if (!response.ok || !payload?.access_token) {
    const message = payload?.error?.message;
    return {
      ok: false,
      message: `Facebook rejected the credentials${
        message ? `: ${message}` : ""
      }. Check the App ID and App Secret in Meta → App settings → Basic.`,
    };
  }

  const appName = await fetchFacebookAppName(appId, payload.access_token);
  return {
    ok: true,
    message: appName
      ? `Facebook accepted the credentials for app "${appName}". Make sure the app is Live and the redirect URI above is registered.`
      : "Facebook accepted the App ID and secret. Make sure the app is Live and the redirect URI above is registered.",
  };
}

/** Best-effort: a failed lookup must not turn a passing check into a failure. */
async function fetchFacebookAppName(
  appId: string,
  accessToken: string,
): Promise<string | undefined> {
  try {
    const url = new URL(`https://graph.facebook.com/${appId}`);
    url.searchParams.set("fields", "name");
    url.searchParams.set("access_token", accessToken);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { name?: string };
    return typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return NextResponse.json(
        { success: false, message: "Authentication required" },
        { status: 401 },
      );
    }
    if (session.user.role !== USER_ROLES.ADMIN) {
      return NextResponse.json(
        { success: false, message: "Admin access required" },
        { status: 403 },
      );
    }
    const demoBlock = getDemoModeMutationResponse();
    if (demoBlock) return demoBlock;

    const body = TestProviderSchema.parse(await request.json().catch(() => ({})));
    const provider: unknown = body?.provider;
    if (!isOAuthProviderId(provider)) {
      return NextResponse.json(
        { success: false, message: "Unknown OAuth provider" },
        { status: 400 },
      );
    }

    // Credentials never reach the browser, so the form cannot send them back.
    // Resolve what is actually stored — DB first, then .env — which is also the
    // pair Better Auth will use at sign-in time.
    await connectDB();
    const settings = await getSettings();
    const resolved = resolveOAuthCredentials(settings.security);

    const result = await runCheck(provider, resolved);
    return NextResponse.json(
      { success: result.ok, message: result.message },
      { status: result.ok ? 200 : 400 },
    );
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "The provider did not respond in time. Try again."
        : error instanceof Error && error.message
          ? error.message
          : "Failed to verify the OAuth credentials";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

async function runCheck(
  provider: OAuthProviderId,
  resolved: ReturnType<typeof resolveOAuthCredentials>,
): Promise<CheckResult> {
  const callbackUrl = buildOAuthCallbackUrl(resolveAuthBaseUrl(), provider);

  if (provider === "google") {
    const { clientId, clientSecret } = resolved.google;
    if (!clientId || !clientSecret) {
      return {
        ok: false,
        message: "Save a Google client ID and client secret first",
      };
    }
    return checkGoogle(clientId, clientSecret, callbackUrl);
  }

  const { appId, appSecret } = resolved.facebook;
  if (!appId || !appSecret) {
    return {
      ok: false,
      message: "Save a Facebook App ID and App Secret first",
    };
  }
  return checkFacebook(appId, appSecret);
}
