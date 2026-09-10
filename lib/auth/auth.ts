import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError } from "better-auth/api";
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
import { resolveOAuthCredentials } from "@/lib/settings/credentials";
import { resolveAuthBaseUrl } from "@/lib/auth/oauth-callback";
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
import {
  DEFAULT_SESSION_MAX_AGE_DAYS,
  MAX_SESSION_MAX_AGE_DAYS,
  MIN_SESSION_MAX_AGE_DAYS,
} from "@/lib/security-limits";
import type { ISettings } from "@/models/settings.model";

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

function createAuth(
  db: Db,
  client?: MongoClient,
  settings?: AuthSecuritySettings,
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
  const trustedOrigins = Array.from(
    new Set(
      [baseURL, process.env.NEXT_PUBLIC_APP_URL, process.env.BETTER_AUTH_URL]
        .map((origin) => (origin || "").trim())
        .filter(Boolean),
    ),
  );

  const socialProviders: Record<
    string,
    { clientId: string; clientSecret: string }
  > = {};

  // Resolve OAuth credentials from two sources: DB settings win, .env is the
  // per-field fallback. The admin toggle is the single source of truth for
  // whether a provider is active — .env only supplies credentials, it never
  // auto-enables the provider (otherwise the admin could not disable it).
  const oauth = resolveOAuthCredentials(securitySettings);

  if (
    oauth.google.clientId &&
    oauth.google.clientSecret &&
    securitySettings.googleOAuthEnabled
  ) {
    socialProviders.google = {
      clientId: oauth.google.clientId,
      clientSecret: oauth.google.clientSecret,
    };
  }

  if (
    oauth.facebook.appId &&
    oauth.facebook.appSecret &&
    securitySettings.facebookOAuthEnabled
  ) {
    socialProviders.facebook = {
      clientId: oauth.facebook.appId,
      clientSecret: oauth.facebook.appSecret,
    };
  }

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

    emailVerification: {
      expiresIn: 60 * 60 * 24,
      sendOnSignUp: requireCustomerVerification || requireVendorVerification,
      sendOnSignIn: false,
      autoSignInAfterVerification: true,
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
      },
    },

    // Session Configuration
    session: {
      expiresIn: 60 * 60 * 24 * securitySettings.sessionMaxAgeDays,
      updateAge: 60 * 60 * 24, // Update session every 24 hours
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes
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
    },
    socialProviders,
    appName: appConfig.name,
    account: {
      storeStateStrategy: "cookie",
    },
    plugins: [twoFactor()],
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
            // Auto-create customer profile for customer roles
            const role = (user as { role?: string }).role;
            if (!role || role === USER_ROLES.CUSTOMER) {
              try {
                const { ensureCustomerProfile } = await import(
                  "@/lib/customers/customer"
                );
                const userId =
                  (user as { id?: string }).id ||
                  (user as { _id?: { toString(): string } })._id?.toString();
                if (userId) {
                  await ensureCustomerProfile(userId);
                }
              } catch (error) {
                console.error("Failed to create customer profile:", error);
              }
            }
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

            // Fold any guest checkout history under this email into the
            // account — the Shopify "account activation" moment: guest orders
            // relink to the user and the email-keyed guest customer row is
            // absorbed. Gated on the same verification decision that admitted
            // the session, with one exception: the courtesy session a
            // verification-required signup gets (blocked_pending) has not
            // proven the email yet, so its claim waits for the login that
            // follows verification. Never blocks sign-in.
            if (
              role === USER_ROLES.CUSTOMER &&
              email &&
              verificationStatus !== "blocked_pending"
            ) {
              try {
                const { claimGuestCustomerData } = await import(
                  "@/lib/customers/customer"
                );
                await claimGuestCustomerData(rawUserId, email);
              } catch (error) {
                console.error("Failed to claim guest customer data:", error);
              }
            }

            if (!isOAuthCallbackPath(ctx?.path)) return { data: session };

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

            return { data: session };
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
 * Anything above a plain shopper. When the DB cannot confirm the current role,
 * these sessions are dropped rather than served from the cookie cache — a
 * five-minute window of stale privileges is a worse failure than an admin
 * having to sign in again after an outage.
 */
function isPrivilegedRole(role: unknown): boolean {
  return typeof role === "string" && role !== USER_ROLES.CUSTOMER;
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
      return isPrivilegedRole(session.user.role) ? null : session;
    }

    const userDoc = await db.collection("user").findOne(
      { _id: new ObjectId(session.user.id) },
      {
        projection: {
          role: 1,
          roles: 1,
          status: 1,
          emailVerified: 1,
          createdAt: 1,
          emailVerificationRequiredAt: 1,
          emailVerificationAudience: 1,
        },
      },
    );

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

    return {
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
    };
  } catch (error) {
    console.error("Failed to hydrate session user from database:", error);
    // Fail closed for privileged roles; a shopper keeps browsing.
    return isPrivilegedRole(session.user.role) ? null : session;
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

      const db = mongoose.connection.db as unknown as Db | undefined;
      if (!db) {
        throw new Error("MongoDB is not connected");
      }

      const client = mongoose.connection.getClient() as unknown as
        | MongoClient
        | undefined;

      // Try to load security settings from database
      let securitySettings: AuthSecuritySettings | undefined;
      try {
        const settingsCollection = db.collection("settings");
        const settings = await settingsCollection.findOne({});
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

      authInstance = createAuth(db, client, securitySettings);
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
  };
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
    async getRegistrationSession(
      ...args: GetSessionArgs
    ): Promise<AuthSession | null> {
      const instance = (await getAuthInstance()) as unknown as {
        api: { getSession: (...innerArgs: unknown[]) => GetSessionReturn };
      };
      const session = await instance.api.getSession(...(args as unknown[]));
      const typedSession = session as unknown as AuthSession | null;
      if (!typedSession) return null;

      const hydratedSession = await hydrateSessionUserFromDb(typedSession);
      if (!hydratedSession) return null;

      const status = hydratedSession.user.status || USER_ACCOUNT_STATUS.ACTIVE;
      if (status !== USER_ACCOUNT_STATUS.ACTIVE) return null;

      return hydratedSession;
    },
    async getSession(...args: GetSessionArgs): Promise<AuthSession | null> {
      const instance = (await getAuthInstance()) as unknown as {
        api: { getSession: (...innerArgs: unknown[]) => GetSessionReturn };
      };
      const session = await instance.api.getSession(...(args as unknown[]));
      // Cast to our typed session which includes custom fields
      const typedSession = session as unknown as AuthSession | null;
      if (!typedSession) return null;
      const hydratedSession = await hydrateSessionUserFromDb(typedSession);
      if (!hydratedSession) return null;

      // Banned or deactivated accounts lose their session whatever their role,
      // so an admin can lock out staff and other admins without deleting them.
      const status = hydratedSession.user.status || USER_ACCOUNT_STATUS.ACTIVE;
      if (status !== USER_ACCOUNT_STATUS.ACTIVE) return null;

      if (
        hydratedSession.user.emailVerificationStatus === "blocked_pending"
      ) {
        return null;
      }

      return hydratedSession;
    },
  },
};

