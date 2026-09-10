import { auth, getActivePasswordPolicy } from "@/lib/auth/auth";
import { defaultLocale, isValidLocale } from "@/config/i18n.config";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { getClientIP } from "@/lib/api/rate-limit-middleware";
import {
  clearLoginLockout,
  describeLockout,
  getLoginLockout,
  recordFailedLogin,
  type LockoutState,
} from "@/lib/auth/login-lockout";
import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse, type NextRequest } from "next/server";

const inner = toNextJsHandler(auth);

const SIGN_IN_PATH = "/api/auth/sign-in/email";

/**
 * Better Auth answers 401 for every credential rejection — unknown address,
 * wrong password, no password account — so this is the one status that means
 * "someone guessed and missed". The 403s raised by our own session hook
 * (unverified email, banned account) are deliberately excluded: those users
 * will retry, and counting them would lock people out of accounts whose
 * password they know perfectly well.
 */
const CREDENTIAL_REJECTED = 401;

/** What a failed lockout lookup degrades to: no lock, nothing to warn about. */
const UNLOCKED_FALLBACK: LockoutState = {
  locked: false,
  retryAfterSeconds: 0,
  attemptsRemaining: null,
};

/**
 * `retryAfterSeconds` travels in the body as well as the header so the sign-in
 * form can say how long the wait is in the visitor's own language. `message`
 * stays as the English fallback for anything that is not our UI.
 */
function lockedResponse(state: LockoutState): Response {
  return NextResponse.json(
    {
      code: "ACCOUNT_LOCKED",
      message: describeLockout(state),
      retryAfterSeconds: state.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(state.retryAfterSeconds),
        "cache-control": "no-store",
      },
    },
  );
}

/**
 * Re-emit Better Auth's rejection with the number of tries left attached.
 *
 * Being told "wrong password" five times and then finding the account locked
 * reads as a broken login. The count is only added in the final stretch, and
 * the original body and status are otherwise passed through untouched — the
 * form still sees the `code` it branches on.
 */
async function withAttemptsRemaining(
  response: Response,
  attemptsRemaining: number,
): Promise<Response> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (typeof body !== "object" || body === null) return response;

  const headers = new Headers(response.headers);
  // The body is being rebuilt, so anything describing the old bytes has to go —
  // an inherited length is merely wrong, but an inherited encoding would tell
  // the browser to gunzip plain JSON.
  headers.delete("content-length");
  headers.delete("content-encoding");

  return NextResponse.json(
    { ...(body as Record<string, unknown>), attemptsRemaining },
    { status: response.status, headers },
  );
}

/**
 * The address a sign-in is being attempted for, or null when this request is
 * not an email sign-in. Read from a clone so the original stream stays intact
 * for Better Auth.
 */
async function readSignInEmail(request: NextRequest): Promise<string | null> {
  if (request.nextUrl.pathname !== SIGN_IN_PATH) return null;

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }

  const email =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).email
      : undefined;
  return typeof email === "string" && email.trim() ? email : null;
}

/**
 * Lockout bookkeeping must never be the reason nobody can log in. Every call
 * runs through here so a database blip degrades to "no lockout this request"
 * instead of a store-wide sign-in outage — and Better Auth shares the same
 * database anyway, so a fault here means authentication was already failing.
 */
async function withoutFailing<T>(
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error("Login lockout check failed:", error);
    return fallback;
  }
}

/**
 * Better Auth endpoints that accept a new password. It enforces the minimum
 * length we hand it, but the admin's uppercase/number/special-character rules
 * are ours to apply — so they are checked here, before the request reaches it.
 */
const PASSWORD_ENTRY_POINTS: Array<{ path: string; field: string }> = [
  { path: "/api/auth/sign-up/email", field: "password" },
  { path: "/api/auth/change-password", field: "newPassword" },
  { path: "/api/auth/reset-password", field: "newPassword" },
];

/**
 * Returns a 400 when the submitted password breaks the configured policy, or
 * null to let the request continue. The body is re-read from a clone so the
 * original request stream stays intact for Better Auth.
 */
async function enforcePasswordPolicy(
  request: NextRequest,
): Promise<Response | null> {
  const entry = PASSWORD_ENTRY_POINTS.find(
    ({ path }) => request.nextUrl.pathname === path,
  );
  if (!entry) return null;

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    // Not JSON — Better Auth will reject it with its own validation error.
    return null;
  }

  const password =
    body && typeof body === "object"
      ? (body as Record<string, unknown>)[entry.field]
      : undefined;
  if (typeof password !== "string") return null;

  const error = checkPasswordPolicy(password, await getActivePasswordPolicy());
  if (!error) return null;

  return NextResponse.json(
    { code: "PASSWORD_POLICY", message: error },
    { status: 400 },
  );
}

function extractSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as unknown as { getSetCookie?: () => string[] })
    .getSetCookie;
  if (typeof getSetCookie === "function") {
    return (getSetCookie as unknown as (this: Headers) => string[]).call(
      headers,
    );
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function getOAuthStateCookieValue(request: NextRequest): string | undefined {
  const cookies = request.cookies.getAll();
  const direct =
    cookies.find((c) => c.name.endsWith("better-auth.oauth_state"))?.value ||
    cookies.find((c) => c.name.endsWith("better-auth.state"))?.value;
  return direct;
}

async function getOAuthErrorRedirectBaseURL(
  request: NextRequest,
): Promise<string> {
  const stateCookie = getOAuthStateCookieValue(request);
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!stateCookie || !secret) return "";

  try {
    const { symmetricDecrypt } =
      (await import("better-auth/crypto")) as unknown as {
        symmetricDecrypt: (args: {
          key: string;
          data: string;
        }) => Promise<string>;
      };
    const decrypted = await symmetricDecrypt({
      key: secret,
      data: stateCookie,
    });
    const parsed = JSON.parse(decrypted) as { errorURL?: string };
    return typeof parsed?.errorURL === "string" ? parsed.errorURL : "";
  } catch {
    return "";
  }
}

function fallbackErrorURL(request: NextRequest): string {
  const rawLocale = request.cookies.get("NEXT_LOCALE")?.value;
  const locale =
    rawLocale && isValidLocale(rawLocale) ? rawLocale : defaultLocale;
  return `/${locale}/login`;
}

async function redirectOAuthCallbackErrors(
  request: NextRequest,
  response: Response,
): Promise<Response> {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/api/auth/callback/")) return response;
  if (response.ok) return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  const code =
    typeof body === "object" && body !== null && "code" in body
      ? String((body as { code: unknown }).code)
      : "";
  if (
    code !== "OAUTH_SIGNIN_IS_ONLY_AVAILABLE_FOR_CUSTOMERS" &&
    code !== "OAUTH_ACCOUNT_ROLE_CONFLICT"
  ) {
    return response;
  }

  const baseErrorURL =
    (await getOAuthErrorRedirectBaseURL(request)) || fallbackErrorURL(request);
  const redirectURL = new URL(baseErrorURL, request.url);

  if (code === "OAUTH_ACCOUNT_ROLE_CONFLICT") {
    redirectURL.searchParams.set("error", "oauth_account_role_conflict");
    const role =
      typeof body === "object" && body !== null && "role" in body
        ? String((body as { role: unknown }).role)
        : "";
    const email =
      typeof body === "object" && body !== null && "email" in body
        ? String((body as { email: unknown }).email)
        : "";
    if (role) redirectURL.searchParams.set("role", role);
    if (email) redirectURL.searchParams.set("email", email);
  } else {
    redirectURL.searchParams.set("error", "oauth_customer_only");
  }

  const redirectResponse = NextResponse.redirect(redirectURL, 303);
  for (const setCookie of extractSetCookieHeaders(response.headers)) {
    redirectResponse.headers.append("set-cookie", setCookie);
  }
  redirectResponse.headers.set("cache-control", "no-store");
  return redirectResponse;
}

export async function GET(request: NextRequest): Promise<Response> {
  const response = await inner.GET(request);
  return redirectOAuthCallbackErrors(request, response);
}

export async function POST(request: NextRequest): Promise<Response> {
  const policyError = await enforcePasswordPolicy(request);
  if (policyError) return policyError;

  // Checked before the request reaches Better Auth so a locked-out attacker
  // stops costing a password hash per guess.
  const signInEmail = await readSignInEmail(request);
  const clientIp = signInEmail ? getClientIP(request) : "";

  if (signInEmail) {
    const lockout = await withoutFailing(
      () => getLoginLockout(signInEmail, clientIp),
      UNLOCKED_FALLBACK,
    );
    if (lockout.locked) return lockedResponse(lockout);
  }

  const response = await inner.POST(request);

  if (signInEmail) {
    // A 200 here means the password was right, including when two-factor is on
    // and the response is a `twoFactorRedirect` rather than a session.
    if (response.ok) {
      await withoutFailing(
        () => clearLoginLockout(signInEmail, clientIp),
        undefined,
      );
    } else if (response.status === CREDENTIAL_REJECTED) {
      const lockout = await withoutFailing(
        () => recordFailedLogin(signInEmail, clientIp),
        UNLOCKED_FALLBACK,
      );
      // Say so on the attempt that tripped it, rather than letting them find
      // out on the next one.
      if (lockout.locked) return lockedResponse(lockout);
      if (lockout.attemptsRemaining !== null) {
        return withAttemptsRemaining(response, lockout.attemptsRemaining);
      }
    }
  }

  return redirectOAuthCallbackErrors(request, response);
}
