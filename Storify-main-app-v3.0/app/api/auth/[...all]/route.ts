import { buildLocalePath, LOCALE_COOKIE_NAME } from "@/lib/i18n/locale-prefix";
import { getLocaleRouting } from "@/lib/i18n/locale-routing";
import { auth, getActivePasswordPolicy } from "@/lib/auth/auth";
import { isValidLocale } from "@/config/i18n.config";
import { checkPasswordPolicy } from "@/lib/auth/password-policy";
import { getClientIP } from "@/lib/api/rate-limit-middleware";
import { auditFailedPasswordSignIn } from "@/lib/auth/auth-audit";
import { readAuthRequestBody } from "@/lib/auth/auth-request-body";
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
 * not an email sign-in. JSON or form-encoded, as Better Auth reads it.
 */
async function readSignInEmail(request: NextRequest): Promise<string | null> {
  if (request.nextUrl.pathname !== SIGN_IN_PATH) return null;

  const email = (await readAuthRequestBody(request))?.email;
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
 * null to let the request continue. JSON or form-encoded, as Better Auth
 * reads it; a body it cannot turn into fields it refuses itself.
 */
async function enforcePasswordPolicy(
  request: NextRequest,
): Promise<Response | null> {
  const entry = PASSWORD_ENTRY_POINTS.find(
    ({ path }) => request.nextUrl.pathname === path,
  );
  if (!entry) return null;

  const password = (await readAuthRequestBody(request))?.[entry.field];
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

async function fallbackErrorURL(request: NextRequest): Promise<string> {
  const { storeDefault } = await getLocaleRouting();
  const rawLocale = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  const locale =
    rawLocale && isValidLocale(rawLocale) ? rawLocale : storeDefault;
  return buildLocalePath(locale, "/login", storeDefault);
}

/**
 * A callback that failed with JSON instead of a redirect left the shopper
 * staring at a raw error body. Better Auth redirects the errors that carry a
 * code itself; what still answers in JSON is an APIError without one (our
 * session hook's "Authentication failed.") — sent back to the sign-in page
 * the flow started from, like every other OAuth failure.
 */
async function redirectOAuthCallbackErrors(
  request: NextRequest,
  response: Response,
): Promise<Response> {
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/api/auth/callback/")) return response;
  if (response.ok) return response;
  // Better Auth's own error redirects are labelled JSON too, and already say
  // where to go and why.
  if (response.headers.has("location")) return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.clone().json();
    if (typeof parsed === "object" && parsed !== null) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // An unreadable body still gets the generic message on the login page.
  }
  const readField = (key: string) => {
    const value = body[key];
    return typeof value === "string" ? value.trim() : "";
  };

  const baseErrorURL =
    (await getOAuthErrorRedirectBaseURL(request)) ||
    (await fallbackErrorURL(request));
  const redirectURL = new URL(baseErrorURL, request.url);
  redirectURL.searchParams.set("error", readField("code") || "oauth_failed");
  // The role-conflict refusal names the account it collided with.
  const role = readField("role");
  const email = readField("email");
  if (role) redirectURL.searchParams.set("role", role);
  if (email) redirectURL.searchParams.set("email", email);

  const redirectResponse = NextResponse.redirect(redirectURL, 303);
  for (const setCookie of extractSetCookieHeaders(response.headers)) {
    redirectResponse.headers.append("set-cookie", setCookie);
  }
  redirectResponse.headers.set("cache-control", "no-store");
  return redirectResponse;
}

const ERROR_PAGE_PATH = "/api/auth/error";

/**
 * Better Auth's own error page — an unbranded English screen in development,
 * a bare `/?error=…` bounce to the home page in production. It is where an
 * OAuth failure lands when the state cookie is gone, because the cookie is
 * what carried the login page's `errorCallbackURL`. The themed sign-in page
 * says what went wrong instead, in the visitor's language
 * (describeOAuthError). Only the code travels: the description is Better
 * Auth's English, and the page never shows it.
 */
async function redirectErrorPageToLogin(
  request: NextRequest,
): Promise<Response> {
  const code = request.nextUrl.searchParams.get("error")?.trim() ?? "";
  const redirectURL = new URL(await fallbackErrorURL(request), request.url);
  redirectURL.searchParams.set(
    "error",
    /^[A-Za-z0-9_'-]{1,64}$/.test(code) ? code : "oauth_failed",
  );
  const response = NextResponse.redirect(redirectURL, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(request: NextRequest): Promise<Response> {
  if (request.nextUrl.pathname === ERROR_PAGE_PATH) {
    return redirectErrorPageToLogin(request);
  }
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
      // A wrong password on a team account goes in the Activity Log. This is
      // the attempt that tripped a lock, if it did: the ones refused while the
      // lock holds returned above and are not logged.
      await auditFailedPasswordSignIn({
        request,
        email: signInEmail,
        attemptsRemaining: lockout.attemptsRemaining,
        locked: lockout.locked,
        retryAfterSeconds: lockout.retryAfterSeconds,
      });
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
