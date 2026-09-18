import { z } from "zod";
import { locales } from "@/config/i18n.config";
import { isIsoCurrencyCode } from "@/lib/intl/iso-currencies";
import {
  MAX_ALLOWED_PASSWORD_LENGTH,
  MIN_ALLOWED_PASSWORD_LENGTH,
} from "@/lib/auth/password-policy";

/**
 * The install wizard's one-shot payload, validated as PURE data so the rule
 * set is unit-testable without the route's DB context. Password POLICY
 * (admin-configurable strength) is enforced separately in the route — this
 * schema only guards shape and hard bounds.
 */

/**
 * Media storage, asked once during setup so the buyer's first product photo
 * has somewhere to go. Every backend is S3-compatible, so bucket + key pair
 * are always required and only the field that locates the account differs —
 * the same split `IStorageSettings` makes with one credential block per
 * provider. A discriminated union states that per-provider requirement here
 * rather than leaving the wizard to enforce it in the browser alone.
 */
const storageCommonFields = {
  bucketName: z.string().trim().min(1).max(200),
  accessKeyId: z.string().trim().min(1).max(200),
  secretAccessKey: z.string().trim().min(1).max(400),
  /**
   * The domain media is SERVED from. Optional because most providers can
   * derive one, and a buyer who has not pointed a CDN at the bucket yet must
   * still be able to finish — the admin Storage tab tests it properly later.
   */
  publicUrl: z
    .string()
    .trim()
    .max(300)
    .refine((value) => value === "" || /^https?:\/\/\S+$/.test(value), {
      message: "Public URL must start with http:// or https://",
    })
    .optional(),
} as const;

export const installStorageSchema = z.discriminatedUnion("provider", [
  // R2 derives its endpoint from the account, and has exactly one region.
  z.object({
    provider: z.literal("cloudflare_r2"),
    accountId: z.string().trim().min(1).max(100),
    ...storageCommonFields,
  }),
  // Real AWS: the SDK builds the endpoint from the region, so it is required.
  z.object({
    provider: z.literal("s3"),
    region: z.string().trim().min(1).max(60),
    ...storageCommonFields,
  }),
  // Spaces: the region slug IS the endpoint (<region>.digitaloceanspaces.com).
  z.object({
    provider: z.literal("digitalocean"),
    region: z.string().trim().min(1).max(60),
    ...storageCommonFields,
  }),
  // Self-hosted: the host is unknowable, so it is typed in full.
  z.object({
    provider: z.literal("minio"),
    endpoint: z
      .string()
      .trim()
      .max(300)
      .regex(/^https?:\/\/\S+$/, "Endpoint must start with http:// or https://"),
    region: z.string().trim().max(60).optional(),
    ...storageCommonFields,
  }),
]);

export const installPayloadSchema = z.object({
  admin: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z
      .string()
      .min(MIN_ALLOWED_PASSWORD_LENGTH)
      .max(MAX_ALLOWED_PASSWORD_LENGTH),
  }),
  store: z.object({
    name: z.string().trim().min(1).max(120),
    language: z
      .string()
      .refine((value) => (locales as readonly string[]).includes(value), {
        message: "Unsupported language",
      }),
    /** A real ISO 4217 code — the wizard offers a picker of exactly these. */
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine(isIsoCurrencyCode, { message: "Unsupported currency" }),
    multiVendor: z.boolean(),
    /** Master switch for in-person selling; `pos.enabled` in settings. */
    pos: z.boolean(),
  }),
  /**
   * `null` = "later". Storage is the one setup item a buyer may genuinely
   * not have yet (the bucket is made on someone else's dashboard), and the
   * install writes no media of its own — so refusing to install over it
   * would strand them, while the admin Storage tab asks again anyway.
   */
  storage: installStorageSchema.nullable(),
  template: z.string().min(1).max(40),
  sampleData: z.boolean(),
});

export type InstallPayload = z.infer<typeof installPayloadSchema>;

/**
 * The lock rule, stated once: the wizard is dead the moment the store has an
 * admin OR the finish step has stamped the settings document. Both signals
 * count — a half-finished run that created the admin must still lock.
 */
export function isInstallLocked(state: {
  adminExists: boolean;
  installedAt: Date | null | undefined;
}): boolean {
  return state.adminExists || Boolean(state.installedAt);
}

/**
 * How long one wizard run holds the install. Only the store-basics write,
 * the password hash and the User insert happen under the lease, so this is
 * generous by an order of magnitude — long enough that a slow host never
 * double-claims, short enough that a run killed mid-flight reopens the
 * wizard on its own instead of needing a manual database edit.
 */
export const INSTALL_CLAIM_LEASE_MS = 2 * 60_000;

/**
 * Whether the lease is available: never taken, or taken so long ago that
 * the run holding it is gone. `claimInstall` (status.ts) expresses exactly
 * this rule as a Mongo filter so the take is one atomic update — the rule
 * lives here so it can be pinned without a database.
 */
export function isInstallClaimFree(
  claimedAt: Date | null | undefined,
  now: Date,
  leaseMs: number = INSTALL_CLAIM_LEASE_MS,
): boolean {
  if (!claimedAt) return true;
  return now.getTime() - claimedAt.getTime() >= leaseMs;
}

/**
 * Which preflight failures STOP the install rather than merely warn.
 *
 * Node below the floor and an unreachable database are not advisories: the
 * finish step writes settings, hashes a password and inserts a user, so a
 * red tick on either means the buyer gets four steps in and then eats a
 * failure at the last click, with no clue which check predicted it. The app
 * URL stays a warning on purpose — it is read at sign-in and in emails, not
 * during the install, and a buyer who has not decided their domain yet must
 * still be able to stand the store up.
 *
 * Absent preflight (the status call itself failed) blocks too: the wizard
 * cannot reach its own API, so nothing it reports can be trusted.
 */
export function isPreflightBlocking(
  preflight:
    | {
        nodeOk: boolean;
        databaseOk: boolean;
        authSecretProblem: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!preflight) return true;
  return (
    !preflight.nodeOk ||
    !preflight.databaseOk ||
    Boolean(preflight.authSecretProblem)
  );
}

/**
 * The Node release the app supports — `engines` in package.json, the README
 * and UPGRADE.md all name 22.12.0, so "any 22" would pass 22.0–22.11.
 */
export const NODE_VERSION_FLOOR = "22.12.0";

/** Whether `version`, as `process.version` prints it ("v22.12.0"), meets the floor. */
export function meetsNodeVersionFloor(
  version: string,
  floor: string = NODE_VERSION_FLOOR,
): boolean {
  const parse = (value: string) =>
    value
      .replace(/^v/, "")
      .split(".")
      .map((part) => Number.parseInt(part, 10));
  const actual = parse(version);
  const minimum = parse(floor);
  for (let index = 0; index < 3; index += 1) {
    const have = actual[index];
    const need = minimum[index] ?? 0;
    if (!Number.isFinite(have)) return false;
    if (have !== need) return have > need;
  }
  return true;
}

/**
 * What the browser's auth client calls when NEXT_PUBLIC_APP_URL is unset —
 * the fallback in `lib/auth/auth-client.ts`.
 */
const APP_URL_FALLBACK = "http://localhost:3000";

export type AppUrlProblem =
  | { kind: "missing"; pageOrigin: string }
  | {
      kind: "invalid";
      variable: "NEXT_PUBLIC_APP_URL" | "BETTER_AUTH_URL";
      value: string;
      pageOrigin: string;
    }
  | {
      kind: "mismatch";
      variable: "NEXT_PUBLIC_APP_URL" | "BETTER_AUTH_URL";
      value: string;
      pageOrigin: string;
    };

function httpOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether signing in will work on the address the installer is open on.
 *
 * "Is it set" is no check at all: `.env.example` ships both variables filled
 * with http://localhost:3000, so a store deployed to its real domain passed
 * while its sign-in form posted to the buyer's own machine. The browser's auth
 * client calls NEXT_PUBLIC_APP_URL (inlined at build time), and the server
 * trusts only the configured origins and builds email links and OAuth
 * callbacks from BETTER_AUTH_URL — so each must be the origin in use.
 *
 * `authUrl` is BETTER_AUTH_URL alone; unset, the server follows `publicUrl`.
 */
export function findAppUrlProblem(input: {
  publicUrl: string | null | undefined;
  authUrl: string | null | undefined;
  pageOrigin: string;
}): AppUrlProblem | null {
  const { pageOrigin } = input;
  const publicUrl = input.publicUrl?.trim();
  if (!publicUrl) {
    return httpOrigin(APP_URL_FALLBACK) === httpOrigin(pageOrigin)
      ? null
      : { kind: "missing", pageOrigin };
  }

  const configured = [
    { variable: "NEXT_PUBLIC_APP_URL" as const, value: publicUrl },
    ...(input.authUrl?.trim()
      ? [{ variable: "BETTER_AUTH_URL" as const, value: input.authUrl.trim() }]
      : []),
  ];
  for (const { variable, value } of configured) {
    const origin = httpOrigin(value);
    if (!origin) return { kind: "invalid", variable, value, pageOrigin };
    if (origin !== httpOrigin(pageOrigin)) {
      return { kind: "mismatch", variable, value, pageOrigin };
    }
  }
  return null;
}
