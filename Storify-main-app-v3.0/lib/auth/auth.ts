import { expo } from "@better-auth/expo";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import { connectDB, mongoose } from "@/lib/db";
import {
  appConfig,
  USER_ACCOUNT_STATUS,
  USER_ROLES,
  type UserAccountStatus,
  type UserRole,
} from "@/config/app.config";
import { ObjectId, type Db, type MongoClient } from "mongodb";
import {
  forceCustomerRoleForOAuthUser,
  isOAuthCallbackPath,
  assertOAuthCustomerOnlySession,
} from "@/lib/auth/auth-oauth-guards";
import { buildSocialProviders } from "@/lib/auth/social-providers";
import { readLiveSessionUser } from "@/lib/auth/live-session";
import { CLIENT_IP_HEADER } from "@/lib/api/client-ip";
import { resolveAuthBaseUrl } from "@/lib/auth/oauth-callback";
import { isPrivateNetworkHost } from "@/lib/app-url";
import { assertAuthSecret } from "@/lib/auth/auth-secret";
import {
  DEFAULT_PASSWORD_POLICY,
  normalizePasswordPolicy,
  type PasswordPolicy,
} from "@/lib/auth/password-policy";
import {
  resolveEmailVerificationStatus,
  type EmailVerificationStatus,
} from "@/lib/auth/email-verification-policy";
import { isCurrentSmtpConfigurationVerified } from "@/lib/email/smtp-verification";
import { RECENT_SIGN_IN_MS } from "@/lib/auth/recent-sign-in";
import {
  auditAccountSelfDeleted,
  auditTwoFactorToggle,
  contextOfRequest,
  isAuthAuditPath,
  recordAuthEvent,
  type AuthHookContext,
} from "@/lib/auth/auth-audit";
import {
  appOriginsFromSettings,
  isExpectedClient,
  NO_APP_ORIGINS,
  resolveSessionClient,
  sessionClientOf,
  trustedAppOrigins,
  type AppOrigins,
  type SessionClient,
  type SessionExpectation,
} from "@/lib/auth/session-audience";
import {
  DEFAULT_SESSION_MAX_AGE_DAYS,
  MAX_SESSION_MAX_AGE_DAYS,
  MIN_SESSION_MAX_AGE_DAYS,
} from "@/lib/security-limits";
import type { ISettings } from "@/models/settings.model";
import type { CreatedUser } from "@/lib/auth/user-created";

/**
 * Better Auth Server Configuration
 * Handles authentication with MongoDB adapter
 * Supports OAuth, 2FA, and dynamic settings from database
 */

/**
 * Clamp the configured session lifetime.
 *
 * Better Auth turns this straight into a JWT `expiresIn`, so a zero or negative
 * value does not read as "no limit" — it means every session in the store is
 * already expired, including the one belonging to the admin who saved it. The
 * settings API rejects anything outside the range; this is what keeps a store
 * that already holds a bad value able to log in at all.
 */
export function normalizeSessionMaxAgeDays(value: unknown): number {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SESSION_MAX_AGE_DAYS;
  return Math.min(
    MAX_SESSION_MAX_AGE_DAYS,
    Math.max(MIN_SESSION_MAX_AGE_DAYS, Math.floor(raw)),
  );
}

// Types for settings that can affect auth configuration
interface AuthSecuritySettings {
  sessionMaxAgeDays: number;
  passwordPolicy: PasswordPolicy;
  emailVerificationRequired: boolean;
  emailVerificationForVendors: boolean;
  emailVerificationRequiredSince?: Date;
  emailVerificationForVendorsSince?: Date;
  emailDeliveryReady: boolean;
  googleOAuthEnabled: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  facebookOAuthEnabled: boolean;
  facebookAppId?: string;
  facebookAppSecret?: string;
}

// Default security settings (used before DB settings are loaded)
const defaultSecuritySettings: AuthSecuritySettings = {
  sessionMaxAgeDays: DEFAULT_SESSION_MAX_AGE_DAYS,
  passwordPolicy: DEFAULT_PASSWORD_POLICY,
  emailVerificationRequired: false,
  emailVerificationForVendors: false,
  emailDeliveryReady: false,
  googleOAuthEnabled: false,
  facebookOAuthEnabled: false,
};

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = Math.min(2, local.length);
  const maskedLocal = `${local.slice(0, visible)}${"*".repeat(
    Math.max(3, local.length - visible),
  )}`;
  return `${maskedLocal}@${domain}`;
}

/**
 * `@better-auth/expo` with only the part the shopper app's email sign-in
 * needs: it copies the app's `expo-origin` header into `Origin`, so the
 * cookie-bearing requests after sign-in (two-factor, sign-out, the account's
 * own changes) pass Better Auth's origin check. React Native sends no Origin
 * of its own.
 *
 * The plugin's other two parts serve a browser-based OAuth sign-in from the
 * app, which this store does not offer (native sign-in with Google and Apple
 * is planned instead), and both are harmful without it:
 * - `/expo-authorization-proxy` redirects to any https address and can plant
 *   an `oauth_state` cookie on the store's domain on the way: an open
 *   redirect, and a login-CSRF building block.
 * - its after-hook puts the session cookie into the redirect after an OAuth
 *   callback when that redirect is an app scheme. Any Android app can claim a
 *   scheme, so a crafted sign-in link would hand a web session to whichever
 *   app answered.
 */
function shopAppTransport() {
  const { endpoints: _proxy, hooks: _cookieHandoff, ...plugin } = expo();
  return plugin;
}

/**
 * The sign-in side of the Activity Log (lib/auth/auth-audit.ts): sign-ins, wrong
 * codes at the second step, sign-outs, and the built-in password and session
 * endpoints.
 *
 * A plugin, and listed after `twoFactor()`, because hooks run in that order and
 * the two-factor plugin's after-hook is what turns a password-only sign-in into
 * a pending challenge: it deletes the session it was just handed and clears
 * `newSession`. A `hooks.after` of our own runs before every plugin's, so it
 * would see that half-made session and log a sign-in that never happened.
 */
function activityLog(): BetterAuthPlugin {
  return {
    id: "activity-log",
    hooks: {
      // Sign-out finds its session from the cookie and deletes it, so the user
      // is only known to the after-hook if the session is read first.
      before: [
        {
          matcher: (ctx) => ctx.path === "/sign-out",
          handler: createAuthMiddleware(async (ctx) => {
            await getSessionFromCtx(ctx).catch(() => null);
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => isAuthAuditPath(ctx.path),
          handler: createAuthMiddleware(async (ctx) => {
            await recordAuthEvent(ctx as unknown as AuthHookContext);
          }),
        },
      ],
    },
  };
}

/**
 * "Create account" and "Resend verification email" for an account the store
 * made with no password (an imported customer): answered like a sign-up that
 * waits on an email, and the email is the invite that sets the password
 * (lib/auth/passwordless-sign-up.ts). Every other request goes on as before.
 */
function passwordlessCustomerAccess(): BetterAuthPlugin {
  return {
    id: "passwordless-customer-access",
    hooks: {
      before: [
        {
          matcher: (ctx) =>
            ctx.path === "/sign-up/email" || ctx.path === "/send-verification-email",
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as {
              email?: unknown;
              name?: unknown;
              password?: unknown;
              callbackURL?: unknown;
            };
            if (ctx.path === "/sign-up/email") {
              // Better Auth checks the password before it looks the email up;
              // one it would refuse is left for it to refuse.
              const password = typeof body.password === "string" ? body.password : "";
              const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
              if (password.length < minPasswordLength || password.length > maxPasswordLength) {
                return;
              }
            }
            const { inviteInsteadOfSignUp, localeOfAuthRequest } = await import(
              "@/lib/auth/passwordless-sign-up"
            );
            const answered = await inviteInsteadOfSignUp({
              email: body.email,
              locale: localeOfAuthRequest(body.callbackURL, ctx.request?.headers ?? ctx.headers),
            });
            if (!answered) return;

            if (ctx.path === "/send-verification-email") return ctx.json({ status: true });
            // The work a real sign-up does, so the answer takes as long.
            await ctx.context.password.hash(String(body.password));
            const now = new Date();
            return ctx.json({
              token: null,
              user: {
                id: new ObjectId().toHexString(),
                email: String(body.email).trim().toLowerCase(),
                name: typeof body.name === "string" ? body.name : "",
                image: null,
                emailVerified: false,
                createdAt: now,
                updatedAt: now,
              },
            });
          }),
        },
      ],
    },
  };
}

function createAuth(
  db: Db,
  client?: MongoClient,
  settings?: AuthSecuritySettings,
  appOrigins: AppOrigins = NO_APP_ORIGINS,
) {
  const securitySettings = settings || defaultSecuritySettings;
  const requireCustomerVerification =
    securitySettings.emailDeliveryReady &&
    securitySettings.emailVerificationRequired;
  const requireVendorVerification =
    securitySettings.emailDeliveryReady &&
    securitySettings.emailVerificationForVendors;

  // A weak or placeholder secret lets anyone holding a copy of this codebase
  // forge session cookies, so production refuses to start on one.
  assertAuthSecret();

  // Shared with the admin Settings page, which prints the redirect URI derived
  // from this exact value for the admin to register with Google/Meta.
  const baseURL = resolveAuthBaseUrl();

  // Both env vars are legitimate origins for the same deployment and buyers
  // routinely set only one. Trusting both avoids a same-site request being
  // rejected as cross-origin because the other var carries the real domain.
  // The shopper app's scheme joins them while the store has the app switched
  // on (Settings → Mobile app); see lib/auth/session-audience.ts.
  const configuredOrigins = Array.from(
    new Set(
      [
        baseURL,
        process.env.NEXT_PUBLIC_APP_URL,
        process.env.BETTER_AUTH_URL,
        ...trustedAppOrigins(appOrigins),
      ]
        .map((origin) => (origin || "").trim())
        .filter(Boolean),
    ),
  );

  /**
   * A request the browser made to the very address it is displaying is
   * trusted as well, as long as that address is a private one.
   *
   * Testing a build from a phone or a second computer means opening it at
   * `http://192.168.1.5:3000`, and running it on this machine means
   * `http://localhost:3000` — two origins, only one of which the env vars
   * can name, so the other's sign-in POST was refused as cross-origin even
   * though it reached the right server. Same-origin requests cannot be
   * cross-site forgery by definition, and the check is narrowed further to
   * hosts that are not routable from the internet (RFC 1918, link-local,
   * loopback), so a public deployment behaves exactly as before: it trusts
   * the origins it was configured with and nothing else.
   *
   * Deliberately not gated on NODE_ENV: `next start` on a laptop runs as
   * production, which is precisely the build a merchant tests across
   * devices before shipping.
   */
  const trustedOrigins = (request?: Request) => {
    const origin = request?.headers.get("origin")?.trim();
    if (!origin || configuredOrigins.includes(origin)) return configuredOrigins;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return configuredOrigins;
    }
    if (!isPrivateNetworkHost(url.hostname)) return configuredOrigins;
    // Same-origin only: the Host the request arrived on must be the host
    // the page was served from, so a page on another site cannot borrow it.
    const host = request?.headers.get("host")?.trim().toLowerCase();
    return host && host === url.host.toLowerCase()
      ? [...configuredOrigins, origin]
      : configuredOrigins;
  };

  const socialProviders = buildSocialProviders(securitySettings);

  return betterAuth({
    baseURL,
    // Disable transactions for standalone MongoDB (non-replica set)
    // Enable this in production if using MongoDB Atlas or a replica set
    database: mongodbAdapter(db, {
      client,
      transaction: false,
    }),

    // Email & Password Authentication
    emailAndPassword: {
      enabled: true,
      // Verification is enforced by the role-aware session hook below. Better
      // Auth's global switch cannot distinguish customers from vendors/staff.
      requireEmailVerification: false,
      autoSignIn: true,
      // Length is all Better Auth understands; the uppercase/number/special
      // switches are enforced alongside it in `assertPasswordPolicy`.
      minPasswordLength: securitySettings.passwordPolicy.minPasswordLength,
    },

    // Credential stuffing and TOTP brute force both land on these endpoints,
    // and Better Auth's default memory storage is per-process — useless on the
    // multi-instance hosts these stores deploy to. "database" routes the
    // counters through the same MongoDB adapter configured above, so every
    // instance shares one budget.
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 120,
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 300, max: 5 },
        "/forget-password": { window: 900, max: 5 },
        "/reset-password": { window: 900, max: 5 },
        "/change-password": { window: 900, max: 5 },
        "/change-email": { window: 900, max: 5 },
        "/send-verification-email": { window: 900, max: 5 },
        // 6 digits is 1e6 possibilities; without a dedicated bucket the
        // generic allowance makes an online guessing attack practical.
        "/two-factor/verify-totp": { window: 300, max: 6 },
        "/two-factor/verify-backup-code": { window: 900, max: 5 },
        "/two-factor/send-otp": { window: 900, max: 5 },
        "/two-factor/verify-otp": { window: 300, max: 6 },
      },
    },

    // The rate limits above key on the client's address. Better Auth's own
    // reading of X-Forwarded-For gives up on a chain of more than one address,
    // so behind a CDN and a proxy every visitor shared one sign-in bucket.
    // proxy.ts resolves the address from the right of the chain
    // (lib/api/client-ip.ts) and records it here; every /api/auth request
    // passes through it, and a client-sent value is overwritten.
    advanced: {
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    emailVerification: {
      expiresIn: 60 * 60 * 24,
      sendOnSignUp: requireCustomerVerification || requireVendorVerification,
      sendOnSignIn: false,
      // Off: the link proves the address, not the password. Signing in on it
      // let whoever opened the email — an invited staff member's included —
      // into the account without the password or its second factor. The
      // verified page sends people on to sign in (via /role-redirect).
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        const audience = (user as { emailVerificationAudience?: string })
          .emailVerificationAudience;
        const role = (user as { role?: string }).role;
        // Mirrors `resolveEmailVerificationStatus`: an approved vendor follows
        // the vendor policy, while a customer merely *claiming* vendor intent
        // gets whichever policy is stricter. Deriving it any other way would
        // leave someone blocked on verification with no mail ever sent.
        const verificationRequired =
          role === USER_ROLES.VENDOR
            ? requireVendorVerification
            : audience === USER_ROLES.VENDOR
              ? requireCustomerVerification || requireVendorVerification
              : requireCustomerVerification;
        if (!verificationRequired) return;

        const { sendAccountVerificationEmail } = await import(
          "@/lib/auth/email-verification"
        );
        await sendAccountVerificationEmail({
          user: { id: user.id, email: user.email, name: user.name },
          url,
        });
      },
      afterEmailVerification: async (user) => {
        const { markAccountEmailVerified } = await import(
          "@/lib/auth/email-verification"
        );
        await markAccountEmailVerified({
          id: user.id,
          email: user.email,
          name: user.name,
        });
        // The address is proven now, so the guest history kept under it is
        // theirs — without waiting for a sign-in (see the session hook).
        if ((user as { role?: string }).role === USER_ROLES.CUSTOMER) {
          try {
            const { claimGuestCustomerData } = await import(
              "@/lib/customers/customer"
            );
            await claimGuestCustomerData(user.id, user.email);
          } catch (error) {
            console.error("Failed to claim guest customer data:", error);
          }
        }
      },
    },

    // Session Configuration
    session: {
      expiresIn: 60 * 60 * 24 * securitySettings.sessionMaxAgeDays,
      updateAge: 60 * 60 * 24, // Update session every 24 hours
      // What Better Auth calls a fresh session, which /delete-user accepts in
      // place of the password: the same ten minutes as every other "sign in
      // again first" change here (lib/auth/recent-sign-in.ts). Its default
      // is a day.
      freshAge: RECENT_SIGN_IN_MS / 1000,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
      },
      additionalFields: {
        // The session's audience (lib/auth/session-audience.ts), set by the
        // session hook below. No default: Better Auth applies defaults after
        // the fields it carries over when it re-mints a session (enabling
        // two-factor, changing the password), so one would overwrite it.
        // Not input: /update-session would otherwise let a client rewrite it.
        client: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },

    // User Configuration
    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: USER_ROLES.CUSTOMER,
          input: false,
        },
        roles: {
          type: "string[]",
          required: false,
          defaultValue: [USER_ROLES.CUSTOMER],
          input: false,
        },
        status: {
          type: "string",
          required: false,
          defaultValue: USER_ACCOUNT_STATUS.ACTIVE,
          input: false,
        },
        phone: {
          type: "string",
          required: false,
          input: true,
        },
        twoFactorEnabled: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
        emailVerifiedAt: {
          type: "date",
          required: false,
          input: false,
        },
        emailVerificationRequiredAt: {
          type: "date",
          required: false,
          input: false,
        },
        emailVerificationAudience: {
          type: "string",
          required: false,
          defaultValue: USER_ROLES.CUSTOMER,
          input: true,
        },
      },
      // A shopper deleting their own account (lib/customers/account-deletion.ts).
      // Better Auth asks for the password, or a session younger than
      // `freshAge`, before these run. Loaded on use: that module needs this
      // one.
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          const { findAccountDeletionRefusal } = await import(
            "@/lib/customers/account-deletion"
          );
          const refusal = await findAccountDeletionRefusal(user.id);
          if (refusal) {
            throw new APIError("FORBIDDEN", {
              code:
                refusal.reason === "DEMO_MODE"
                  ? "DEMO_MODE_READ_ONLY"
                  : "ACCOUNT_DELETION_NOT_ALLOWED",
              message: refusal.message,
            });
          }
        },
        afterDelete: async (user, request) => {
          const { cleanUpDeletedAccount } = await import(
            "@/lib/customers/account-deletion"
          );
          await cleanUpDeletedAccount(user.id);
          await auditAccountSelfDeleted(user, contextOfRequest(request));
        },
      },
    },
    socialProviders,
    appName: appConfig.name,
    account: {
      storeStateStrategy: "cookie",
    },
    plugins: [twoFactor(), shopAppTransport(), activityLog(), passwordlessCustomerAccess()],
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const userWithRole = forceCustomerRoleForOAuthUser(user, ctx?.path);
            const emailVerificationAudience = isOAuthCallbackPath(ctx?.path)
              ? USER_ROLES.CUSTOMER
              : (userWithRole as { emailVerificationAudience?: string })
                    .emailVerificationAudience === USER_ROLES.VENDOR
                ? USER_ROLES.VENDOR
                : USER_ROLES.CUSTOMER;
            return {
              data: {
                ...userWithRole,
                emailVerificationAudience,
                status:
                  (userWithRole as { status?: string }).status ||
                  USER_ACCOUNT_STATUS.ACTIVE,
              },
            };
          },
          after: async (user) => {
            // A customer's profile, and word to the admins of a sign-up.
            const { onUserCreated } = await import("@/lib/auth/user-created");
            await onUserCreated(user as CreatedUser);
          },
        },
        update: {
          // Two-factor turned on or off. `twoFactorEnabled` is only ever written
          // by the two-factor plugin's own endpoints, so this is the one place
          // that sees the flag actually flip (see auditTwoFactorToggle).
          after: async (user, ctx) => {
            await auditTwoFactorToggle(
              user as unknown as Parameters<typeof auditTwoFactorToggle>[0],
              ctx,
            );
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            const rawUserId =
              "userId" in session && typeof session.userId === "string"
                ? session.userId
                : undefined;

            if (!rawUserId) {
              throw new APIError("FORBIDDEN", { message: "Authentication failed." });
            }

            const userDoc = await db
              .collection("user")
              .findOne({ _id: new ObjectId(rawUserId) });

            if (!userDoc) {
              throw new APIError("FORBIDDEN", { message: "Authentication failed." });
            }

            const rawRole = (userDoc as { role?: string }).role;
            const role = isKnownUserRole(rawRole)
              ? rawRole
              : USER_ROLES.CUSTOMER;
            const email = (userDoc as { email?: string }).email;
            const status =
              (userDoc as { status?: string }).status ||
              USER_ACCOUNT_STATUS.ACTIVE;

            const emailVerified = Boolean(
              (userDoc as { emailVerified?: boolean }).emailVerified,
            );
            const emailVerificationAudience =
              (userDoc as { emailVerificationAudience?: string })
                .emailVerificationAudience === USER_ROLES.VENDOR
                ? USER_ROLES.VENDOR
                : USER_ROLES.CUSTOMER;
            const verificationStatus = resolveEmailVerificationStatus(
              {
                role,
                audience: emailVerificationAudience,
                emailVerified,
                createdAt:
                  (userDoc as { createdAt?: Date }).createdAt || undefined,
                emailVerificationRequiredAt:
                  (userDoc as { emailVerificationRequiredAt?: Date })
                    .emailVerificationRequiredAt || undefined,
              },
              securitySettings,
            );

            const isEmailSignUp = Boolean(
              ctx?.path && ctx.path.endsWith("/sign-up/email"),
            );
            if (verificationStatus === "blocked_pending" && !isEmailSignUp) {
              throw new APIError("FORBIDDEN", {
                code: "EMAIL_NOT_VERIFIED",
                message: "Please verify your email address before signing in.",
              });
            }

            // Every role, not just storefront ones: a banned admin or staff
            // member must lose their session too, otherwise the only way to
            // lock one out is deleting or demoting the account.
            if (status !== USER_ACCOUNT_STATUS.ACTIVE) {
              throw new APIError("FORBIDDEN", {
                code: "ACCOUNT_INACTIVE_OR_BANNED",
                message:
                  status === USER_ACCOUNT_STATUS.BANNED
                    ? "Your account has been banned. Contact support."
                    : "Your account is inactive. Contact support.",
              });
            }

            // Who the session is for: the shopper app or the business app
            // when the request came from its scheme (the Expo plugin has put
            // `expo-origin` into Origin by now), the web otherwise. Every
            // session is minted here, re-mints included (two-factor, a
            // password change), so every return below carries it.
            const client = resolveSessionClient(
              (ctx?.request?.headers ?? ctx?.headers)?.get("origin"),
              appOrigins,
            );

            // The business app is for the people who run the store. A
            // shopper is refused here, before any session exists, so the app
            // never holds a session that every one of its calls would refuse.
            if (client === "biz-app" && !runsTheStore(role, userDoc)) {
              throw new APIError("FORBIDDEN", {
                code: "BIZ_APP_OPERATORS_ONLY",
                message:
                  "This app is for the people who run the store. Shop with the store's shopping app.",
              });
            }

            // Fold any guest checkout history under this email into the
            // account — the Shopify "account activation" moment: guest orders
            // relink to the user and the email-keyed guest customer row is
            // absorbed. Only once the email is PROVEN, whatever the sign-in
            // policy: a store that does not require verification (or is in
            // its grace period) still admits the session, but anyone can
            // sign up under someone else's address, and the claim handed them
            // that shopper's orders, addresses and points. The login after
            // verification — or the verification itself — claims instead.
            // Never blocks sign-in.
            if (role === USER_ROLES.CUSTOMER && email && emailVerified) {
              try {
                const { claimGuestCustomerData } = await import(
                  "@/lib/customers/customer"
                );
                await claimGuestCustomerData(rawUserId, email);
              } catch (error) {
                console.error("Failed to claim guest customer data:", error);
              }
            }

            const minted = { ...session, client };

            if (!isOAuthCallbackPath(ctx?.path)) return { data: minted };

            if (!assertOAuthCustomerOnlySession(ctx?.path, role)) {
              if (role === USER_ROLES.VENDOR && email) {
                throw new APIError("FORBIDDEN", {
                  code: "OAUTH_ACCOUNT_ROLE_CONFLICT",
                  message:
                    "This email is already registered as a vendor account.",
                  role,
                  email: maskEmail(email),
                });
              }
              throw new APIError("FORBIDDEN", {
                code: "OAUTH_SIGNIN_IS_ONLY_AVAILABLE_FOR_CUSTOMERS",
                message: "OAuth sign-in is only available for customers.",
              });
            }

            return { data: minted };
          },
        },
        // However a session ends — Better Auth's own /sign-out, a revocation,
        // an expired session cleared on read, the account deleted — the app
        // installs it registered for push stop receiving the account's
        // notifications. An app that signs out without unregistering its
        // device first is covered; the sign-out itself never waits on a
        // failure here.
        delete: {
          after: async (session) => {
            try {
              const { deactivateDevicesOfSessions } = await import(
                "@/lib/notifications/push-devices"
              );
              await deactivateDevicesOfSessions([String(session.id)]);
            } catch (error) {
              console.error("Failed to stop push to a signed-out device:", error);
            }
          },
        },
      },
    },

    // Trusted Origins (for CORS)
    trustedOrigins,
  });
}

type AuthInstance = ReturnType<typeof createAuth>;
type GetSessionArgs = Parameters<AuthInstance["api"]["getSession"]>;
type GetSessionReturn = ReturnType<AuthInstance["api"]["getSession"]>;

let authInstance: AuthInstance | null = null;
let authInitPromise: Promise<AuthInstance> | null = null;
let activeSecuritySettings = defaultSecuritySettings;
let authInstanceBuiltAt = 0;

/**
 * `reloadAuthInstance()` only refreshes the process that served the settings
 * save, so on a multi-instance deployment every other process would keep the
 * old session length, OAuth toggles, and verification rules until it restarted.
 * Expiring the cached instance bounds that drift to a minute.
 */
const AUTH_INSTANCE_TTL_MS = 60_000;

const USER_ROLE_VALUES = Object.values(USER_ROLES) as UserRole[];

function isKnownUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" && USER_ROLE_VALUES.includes(value as UserRole)
  );
}

function normalizeUserRoles(value: unknown, fallbackRole: UserRole): UserRole[] {
  const roles = Array.isArray(value)
    ? value.filter((role): role is UserRole => isKnownUserRole(role))
    : [];

  return roles.length ? Array.from(new Set(roles)) : [fallbackRole];
}

function getPrimaryRole(role: UserRole, roles: UserRole[]): UserRole {
  // Existing admin APIs still read `user.role`, so keep it authoritative when
  // the newer roles array marks the user as an admin.
  if (roles.includes(USER_ROLES.ADMIN)) return USER_ROLES.ADMIN;
  return role;
}

/**
 * Whether an account runs the store (an administrator, staff, a seller), by
 * the role its sessions are read with: `role`, or an administrator listed in
 * `roles` (getPrimaryRole). Who may sign in to the business app.
 */
function runsTheStore(role: UserRole, userDoc: unknown): boolean {
  const roles = (userDoc as { roles?: unknown }).roles;
  const primary = getPrimaryRole(role, normalizeUserRoles(roles, role));
  return primary !== USER_ROLES.CUSTOMER;
}

/**
 * Anything above a plain shopper. When the DB cannot confirm the current role,
 * these sessions are dropped rather than served from the cookie cache — a
 * five-minute window of stale privileges is a worse failure than an admin
 * having to sign in again after an outage.
 */
function isPrivilegedRole(role: unknown): boolean {
  return typeof role === "string" && role !== USER_ROLES.CUSTOMER;
}

/** The session with its audience settled: the stored row's when it was read. */
function withSessionClient(session: AuthSession, stored?: unknown): AuthSession {
  return {
    ...session,
    session: {
      ...session.session,
      client: sessionClientOf(stored ?? session.session.client),
    },
  };
}

/**
 * Returns the session with role/status/verification re-read from MongoDB, or
 * null when the session must not be honored. Null means "treat as signed out".
 */
async function hydrateSessionUserFromDb(
  session: AuthSession,
): Promise<AuthSession | null> {
  try {
    const db = mongoose.connection.db;
    if (!db || !ObjectId.isValid(session.user.id)) {
      return isPrivilegedRole(session.user.role)
        ? null
        : withSessionClient(session);
    }

    // Also proves the session row still exists, so a revoked session stops
    // here instead of riding the cookie cache — see readLiveSessionUser.
    const userDoc = await readLiveSessionUser(db, {
      userId: session.user.id,
      sessionId: session.session.id,
    });

    if (!userDoc) return null;

    const dbRole = isKnownUserRole(userDoc.role)
      ? userDoc.role
      : session.user.role;
    const roles = normalizeUserRoles(userDoc.roles, dbRole);
    const role = getPrimaryRole(dbRole, roles);
    const status =
      typeof userDoc.status === "string"
        ? (userDoc.status as UserAccountStatus)
        : session.user.status;
    const emailVerified = Boolean(userDoc.emailVerified);
    const createdAt = userDoc.createdAt
      ? new Date(userDoc.createdAt as Date)
      : session.user.createdAt;
    const emailVerificationRequiredAt = userDoc.emailVerificationRequiredAt
      ? new Date(userDoc.emailVerificationRequiredAt as Date)
      : undefined;
    const emailVerificationAudience =
      userDoc.emailVerificationAudience === USER_ROLES.VENDOR
        ? USER_ROLES.VENDOR
        : USER_ROLES.CUSTOMER;
    const emailVerificationStatus = resolveEmailVerificationStatus(
      {
        role,
        audience: emailVerificationAudience,
        emailVerified,
        createdAt,
        emailVerificationRequiredAt,
      },
      activeSecuritySettings,
    );

    return withSessionClient(
      {
        ...session,
        user: {
          ...session.user,
          role,
          roles,
          status,
          emailVerified,
          createdAt,
          emailVerificationRequiredAt,
          emailVerificationAudience,
          emailVerificationStatus,
        },
      },
      userDoc.sessionClient,
    );
  } catch (error) {
    console.error("Failed to hydrate session user from database:", error);
    // Fail closed for privileged roles; a shopper keeps browsing.
    return isPrivilegedRole(session.user.role)
      ? null
      : withSessionClient(session);
  }
}

async function getAuthInstance(): Promise<AuthInstance> {
  if (authInstance && Date.now() - authInstanceBuiltAt < AUTH_INSTANCE_TTL_MS) {
    return authInstance;
  }
  if (authInstance) {
    // Expired: drop it and rebuild from current settings.
    authInstance = null;
    authInitPromise = null;
  }
  if (!authInitPromise) {
    authInitPromise = (async () => {
      await connectDB();

      const db = mongoose.connection.db;
      if (!db) {
        throw new Error("MongoDB is not connected");
      }

      const client = mongoose.connection.getClient();

      // Try to load security settings from database
      let securitySettings: AuthSecuritySettings | undefined;
      let appOrigins = NO_APP_ORIGINS;
      try {
        const settingsCollection = db.collection("settings");
        const settings = await settingsCollection.findOne({});
        appOrigins = appOriginsFromSettings(settings?.mobileApp);
        if (settings?.security) {
          const now = new Date();
          const verificationMigration: Record<string, Date> = {};
          if (
            settings.security.emailVerificationRequired &&
            !settings.security.emailVerificationRequiredSince
          ) {
            settings.security.emailVerificationRequiredSince = now;
            verificationMigration["security.emailVerificationRequiredSince"] = now;
          }
          if (
            settings.security.emailVerificationForVendors &&
            !settings.security.emailVerificationForVendorsSince
          ) {
            settings.security.emailVerificationForVendorsSince = now;
            verificationMigration["security.emailVerificationForVendorsSince"] = now;
          }
          if (Object.keys(verificationMigration).length > 0) {
            await settingsCollection.updateOne(
              { _id: settings._id },
              { $set: verificationMigration },
            );
          }
          securitySettings = {
            // Clamped, not `|| 7`: that catches 0 but passes -1 straight into
            // the JWT lifetime and expires every session in the store.
            sessionMaxAgeDays: normalizeSessionMaxAgeDays(
              settings.security.sessionMaxAgeDays,
            ),
            passwordPolicy: normalizePasswordPolicy(settings.security),
            emailVerificationRequired:
              settings.security.emailVerificationRequired || false,
            emailVerificationForVendors:
              settings.security.emailVerificationForVendors ?? false,
            emailVerificationRequiredSince:
              settings.security.emailVerificationRequiredSince,
            emailVerificationForVendorsSince:
              settings.security.emailVerificationForVendorsSince,
            emailDeliveryReady: isCurrentSmtpConfigurationVerified(
              settings as unknown as ISettings,
            ),
            googleOAuthEnabled: settings.security.googleOAuthEnabled || false,
            googleClientId: settings.security.googleClientId,
            googleClientSecret: settings.security.googleClientSecret,
            facebookOAuthEnabled:
              settings.security.facebookOAuthEnabled || false,
            facebookAppId: settings.security.facebookAppId,
            facebookAppSecret: settings.security.facebookAppSecret,
          };
        }
      } catch (error) {
        console.warn(
          "Could not load security settings from DB, using defaults:",
          error,
        );
      }

      authInstance = createAuth(db, client, securitySettings, appOrigins);
      activeSecuritySettings = securitySettings || defaultSecuritySettings;
      authInstanceBuiltAt = Date.now();
      return authInstance;
    })();
  }
  return authInitPromise;
}

export async function getAuthContext(): Promise<AuthInstance["$context"]> {
  const instance = await getAuthInstance();
  return await instance.$context;
}

// Function to reload auth instance when settings change
export async function reloadAuthInstance(): Promise<void> {
  authInstance = null;
  authInitPromise = null;
  authInstanceBuiltAt = 0;
  await getAuthInstance();
}

/** Password rules currently in force, for the entry points that validate. */
export async function getActivePasswordPolicy(): Promise<PasswordPolicy> {
  await getAuthInstance();
  return activeSecuritySettings.passwordPolicy;
}

export async function requestEmailVerification(
  email: string,
  callbackURL: string,
) {
  const instance = await getAuthInstance();
  return instance.api.sendVerificationEmail({
    body: { email, callbackURL },
  });
}

// Custom user type with all additional fields
interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Custom fields
  role: UserRole;
  roles?: UserRole[];
  status?: UserAccountStatus;
  phone?: string;
  twoFactorEnabled?: boolean;
  emailVerifiedAt?: Date;
  emailVerificationRequiredAt?: Date;
  emailVerificationAudience?: "customer" | "vendor";
  emailVerificationStatus?: EmailVerificationStatus;
}

// Custom session type with typed user
interface AuthSession {
  user: AuthUser;
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    /** When this sign-in happened; see lib/auth/recent-sign-in.ts. */
    createdAt?: Date;
    /** Where the session may be used; see lib/auth/session-audience.ts. */
    client: SessionClient;
  };
}

type SessionReadArgs = GetSessionArgs[0] & {
  /**
   * The audiences this read accepts (lib/auth/session-audience.ts). The web
   * unless said otherwise, so every page and `withApi` route refuses a
   * session from an app without asking for it.
   */
  expect?: SessionExpectation;
};

async function readBetterAuthSession(
  args: GetSessionArgs[0],
): Promise<AuthSession | null> {
  const instance = (await getAuthInstance()) as unknown as {
    api: { getSession: (...innerArgs: unknown[]) => GetSessionReturn };
  };
  const session = await instance.api.getSession(args);
  // Cast to our typed session which includes custom fields
  return session as unknown as AuthSession | null;
}

/**
 * A session read: the session, or none — and, when the session is good but
 * held back for something its holder can put right, why. That is one thing
 * today: the store requires a verified email address and theirs is not yet
 * (`blocked_pending`). Sign-up still mints the session (the session hook lets
 * /sign-up/email through), and Better Auth's own /get-session keeps answering
 * it, so the shopper app has to be told why it is refused, or it takes the
 * refusal for a lost session. Any other refusal is simply no session.
 */
interface SessionVerdict {
  session: AuthSession | null;
  hold?: "email_not_verified";
}

async function readSessionVerdict({
  expect = "web",
  ...args
}: SessionReadArgs): Promise<SessionVerdict> {
  const typedSession = await readBetterAuthSession(args);
  if (!typedSession) return { session: null };
  const hydratedSession = await hydrateSessionUserFromDb(typedSession);
  if (!hydratedSession) return { session: null };

  // A session from another client is no session here: an app's cookie on
  // the web, or a browser's on the mobile API.
  if (!isExpectedClient(hydratedSession.session.client, expect)) {
    return { session: null };
  }

  // Banned or deactivated accounts lose their session whatever their role,
  // so an admin can lock out staff and other admins without deleting them.
  const status = hydratedSession.user.status || USER_ACCOUNT_STATUS.ACTIVE;
  if (status !== USER_ACCOUNT_STATUS.ACTIVE) return { session: null };

  if (hydratedSession.user.emailVerificationStatus === "blocked_pending") {
    return { session: null, hold: "email_not_verified" };
  }

  return { session: hydratedSession };
}

export const auth = {
  async handler(request: Request): Promise<Response> {
    const instance = (await getAuthInstance()) as unknown as {
      handler?: (request: Request) => Promise<Response>;
      (request: Request): Promise<Response>;
    };
    return "handler" in instance
      ? instance.handler!(request)
      : instance(request);
  },
  api: {
    async getRegistrationSession({
      expect = "web",
      ...args
    }: SessionReadArgs): Promise<AuthSession | null> {
      const typedSession = await readBetterAuthSession(args);
      if (!typedSession) return null;

      const hydratedSession = await hydrateSessionUserFromDb(typedSession);
      if (!hydratedSession) return null;
      if (!isExpectedClient(hydratedSession.session.client, expect)) return null;

      const status = hydratedSession.user.status || USER_ACCOUNT_STATUS.ACTIVE;
      if (status !== USER_ACCOUNT_STATUS.ACTIVE) return null;

      return hydratedSession;
    },
    async getSession(args: SessionReadArgs): Promise<AuthSession | null> {
      return (await readSessionVerdict(args)).session;
    },
    /** `getSession`, saying why a good session is held back (`SessionVerdict`). */
    getSessionVerdict: readSessionVerdict,
  },
};

