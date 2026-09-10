/**
 * Two-Source Credential Resolution
 *
 * Integration credentials (payments, OAuth, SMTP, storage, analytics) can be
 * supplied from two sources: the admin Settings page (persisted in the DB) and
 * the `.env` file. This module owns the single, consistent merge rule:
 *
 *   DB value wins; the matching env var is the per-field fallback.
 *
 * An empty / whitespace-only value counts as "unset" and falls through to env.
 * The DB value is returned verbatim when present (never trimmed/mutated) so
 * stored secrets are not altered.
 */

import type {
  IStripeSettings,
  IPayPalSettings,
  IRazorpaySettings,
  IPaystackSettings,
  IPesapalSettings,
  IIotecSettings,
  IOrangeMoneySettings,
  IMtnMomoSettings,
  ISecuritySettings,
  IStorageSettings,
  IR2StorageCredentials,
  IS3StorageCredentials,
  IMinioStorageCredentials,
  IDigitalOceanStorageCredentials,
  IAnalyticsSettings,
  IShippoCarrierSettings,
  IShiprocketCarrierSettings,
  ISettings,
} from "@/models/settings.model";
import type { PayPalMode } from "@/lib/payments/paypal";
import type { CarrierMode } from "@/lib/shipping/carrier-config";

/**
 * Env var names, declared once so the resolvers and `getCredentialEnvSources`
 * stay in sync.
 */
const ENV = {
  stripeSecretKey: ["STRIPE_SECRET_KEY"],
  stripePublishableKey: ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
  stripeWebhookSecret: ["STRIPE_WEBHOOK_SECRET"],

  paypalClientId: ["PAYPAL_CLIENT_ID"],
  paypalClientSecret: ["PAYPAL_CLIENT_SECRET"],
  paypalWebhookId: ["PAYPAL_WEBHOOK_ID"],

  razorpayKeyId: ["RAZORPAY_KEY_ID", "NEXT_PUBLIC_RAZORPAY_KEY_ID"],
  razorpayKeySecret: ["RAZORPAY_KEY_SECRET"],
  razorpayWebhookSecret: ["RAZORPAY_WEBHOOK_SECRET"],

  paystackSecretKey: ["PAYSTACK_SECRET_KEY"],
  paystackPublicKey: ["PAYSTACK_PUBLIC_KEY", "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY"],

  pesapalConsumerKey: ["PESAPAL_CONSUMER_KEY"],
  pesapalConsumerSecret: ["PESAPAL_CONSUMER_SECRET"],
  pesapalMode: ["PESAPAL_MODE"],
  pesapalIpnId: ["PESAPAL_IPN_ID"],

  iotecClientId: ["IOTEC_CLIENT_ID"],
  iotecClientSecret: ["IOTEC_CLIENT_SECRET"],
  iotecWalletId: ["IOTEC_WALLET_ID"],
  iotecMode: ["IOTEC_MODE"],

  orangeMoneyClientId: ["ORANGE_MONEY_CLIENT_ID"],
  orangeMoneyClientSecret: ["ORANGE_MONEY_CLIENT_SECRET"],
  orangeMoneyMerchantKey: ["ORANGE_MONEY_MERCHANT_KEY"],
  orangeMoneyCountry: ["ORANGE_MONEY_COUNTRY"],
  orangeMoneyMode: ["ORANGE_MONEY_MODE"],

  mtnMomoSubscriptionKey: ["MTN_MOMO_SUBSCRIPTION_KEY"],
  mtnMomoApiUser: ["MTN_MOMO_API_USER"],
  mtnMomoApiKey: ["MTN_MOMO_API_KEY"],
  mtnMomoTargetEnvironment: ["MTN_MOMO_TARGET_ENVIRONMENT"],
  mtnMomoCallbackHost: ["MTN_MOMO_CALLBACK_HOST"],
  mtnMomoMode: ["MTN_MOMO_MODE"],

  googleClientId: ["GOOGLE_CLIENT_ID"],
  googleClientSecret: ["GOOGLE_CLIENT_SECRET"],
  facebookAppId: ["FACEBOOK_APP_ID"],
  facebookAppSecret: ["FACEBOOK_APP_SECRET"],

  smtpHost: ["SMTP_HOST"],
  smtpPort: ["SMTP_PORT"],
  smtpUser: ["SMTP_USER"],
  smtpPass: ["SMTP_PASS"],
  smtpFrom: ["SMTP_FROM"],

  storageAccessKeyId: ["STORAGE_ACCESS_KEY_ID"],
  storageSecretAccessKey: ["STORAGE_SECRET_ACCESS_KEY"],
  storageAccountId: ["STORAGE_ACCOUNT_ID"],
  storageEndpoint: ["STORAGE_ENDPOINT"],
  storageRegion: ["STORAGE_REGION"],
  storageBucket: ["STORAGE_BUCKET"],
  storagePublicUrl: ["STORAGE_PUBLIC_URL", "CLOUDFLARE_R2_PUBLIC_URL"],

  gaId: ["NEXT_PUBLIC_GA_ID"],
  gtmId: ["NEXT_PUBLIC_GTM_ID"],
  facebookPixelId: ["NEXT_PUBLIC_FACEBOOK_PIXEL_ID"],
  tiktokPixelId: ["NEXT_PUBLIC_TIKTOK_PIXEL_ID"],
  plausibleApiKey: ["PLAUSIBLE_API_KEY"],

  openaiApiKey: ["OPENAI_API_KEY"],

  shippoTestToken: ["SHIPPO_TEST_TOKEN"],
  shippoLiveToken: ["SHIPPO_LIVE_TOKEN"],
  shippoMode: ["SHIPPO_MODE"],
  shippoWebhookSecret: ["SHIPPO_WEBHOOK_SECRET"],

  shiprocketEmail: ["SHIPROCKET_EMAIL"],
  shiprocketPassword: ["SHIPROCKET_PASSWORD"],
  shiprocketPickupLocation: ["SHIPROCKET_PICKUP_LOCATION"],
  shiprocketWebhookToken: ["SHIPROCKET_WEBHOOK_TOKEN"],
} as const;

function envValue(keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = process.env[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return undefined;
}

/** DB value wins (returned verbatim); first non-empty env var is the fallback. */
function pick(
  dbValue: string | undefined | null,
  envKeys: readonly string[],
): string | undefined {
  if (typeof dbValue === "string" && dbValue.trim() !== "") return dbValue;
  return envValue(envKeys);
}

/** True when at least one of the given env vars holds a non-empty value. */
function envSet(keys: readonly string[]): boolean {
  return envValue(keys) !== undefined;
}

/**
 * Build a non-reversible "preview" of a saved secret for the admin UI so an
 * operator can confirm the right value is stored without exposing it. Keeps the
 * first 3 and last 2 characters around a fixed-width `xxxx` mask — fixed so the
 * hint reveals nothing about the secret's length.
 *
 * Short values are fully masked (no revealing characters) to avoid leaking a
 * meaningful fraction of a small secret: anything with 5 or fewer characters
 * becomes the bare mask. Returns `undefined` for empty/whitespace-only input.
 *
 * Examples:
 *   "TDpigBOOhs+zAI8cwH2FI82jJGyD8xev" -> "TDpxxxxev"
 *   "abcd"                             -> "xxxx"
 */
export function maskSecretHint(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const VISIBLE_START = 3;
  const VISIBLE_END = 2;
  const MASK = "xxxx";
  if (trimmed.length <= VISIBLE_START + VISIBLE_END) {
    return MASK;
  }
  const start = trimmed.slice(0, VISIBLE_START);
  const end = trimmed.slice(-VISIBLE_END);
  return `${start}${MASK}${end}`;
}

// ============================================
// Payment
// ============================================

interface ResolvedStripeCredentials {
  secretKey?: string;
  publishableKey?: string;
  webhookSecret?: string;
}

export function resolveStripeCredentials(
  stripe?: Partial<IStripeSettings> | null,
): ResolvedStripeCredentials {
  return {
    secretKey: pick(stripe?.secretKey, ENV.stripeSecretKey),
    publishableKey: pick(stripe?.publishableKey, ENV.stripePublishableKey),
    webhookSecret: pick(stripe?.webhookSecret, ENV.stripeWebhookSecret),
  };
}

interface ResolvedPayPalCredentials {
  clientId?: string;
  clientSecret?: string;
  mode: PayPalMode;
  webhookId?: string;
}

export function resolvePayPalCredentials(
  paypal?: Partial<IPayPalSettings> | null,
): ResolvedPayPalCredentials {
  return {
    clientId: pick(paypal?.clientId, ENV.paypalClientId),
    clientSecret: pick(paypal?.clientSecret, ENV.paypalClientSecret),
    mode: (paypal?.mode || "sandbox") as PayPalMode,
    webhookId: pick(paypal?.webhookId, ENV.paypalWebhookId),
  };
}

interface ResolvedRazorpayCredentials {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}

export function resolveRazorpayCredentials(
  razorpay?: Partial<IRazorpaySettings> | null,
): ResolvedRazorpayCredentials {
  return {
    keyId: pick(razorpay?.keyId, ENV.razorpayKeyId),
    keySecret: pick(razorpay?.keySecret, ENV.razorpayKeySecret),
    webhookSecret: pick(razorpay?.webhookSecret, ENV.razorpayWebhookSecret),
  };
}

interface ResolvedPaystackCredentials {
  secretKey?: string;
  publicKey?: string;
}

export function resolvePaystackCredentials(
  paystack?: Partial<IPaystackSettings> | null,
): ResolvedPaystackCredentials {
  return {
    secretKey: pick(paystack?.secretKey, ENV.paystackSecretKey),
    publicKey: pick(paystack?.publicKey, ENV.paystackPublicKey),
  };
}

interface ResolvedPesapalCredentials {
  consumerKey?: string;
  consumerSecret?: string;
  mode: "sandbox" | "live";
  ipnId?: string;
}

export function resolvePesapalCredentials(
  pesapal?: Partial<IPesapalSettings> | null,
): ResolvedPesapalCredentials {
  const configuredMode = pick(pesapal?.mode, ENV.pesapalMode);
  return {
    consumerKey: pick(pesapal?.consumerKey, ENV.pesapalConsumerKey),
    consumerSecret: pick(
      pesapal?.consumerSecret,
      ENV.pesapalConsumerSecret,
    ),
    mode: configuredMode === "live" ? "live" : "sandbox",
    ipnId: pick(pesapal?.ipnId, ENV.pesapalIpnId),
  };
}

interface ResolvedIotecCredentials {
  clientId?: string;
  clientSecret?: string;
  walletId?: string;
  mode: "sandbox" | "live";
}

export function resolveIotecCredentials(
  iotec?: Partial<IIotecSettings> | null,
): ResolvedIotecCredentials {
  const configuredMode = pick(iotec?.mode, ENV.iotecMode);
  return {
    clientId: pick(iotec?.clientId, ENV.iotecClientId),
    clientSecret: pick(iotec?.clientSecret, ENV.iotecClientSecret),
    walletId: pick(iotec?.walletId, ENV.iotecWalletId),
    mode: configuredMode === "live" ? "live" : "sandbox",
  };
}

interface ResolvedOrangeMoneyCredentials {
  clientId?: string;
  clientSecret?: string;
  merchantKey?: string;
  country?: string;
  mode: "sandbox" | "live";
}

export function resolveOrangeMoneyCredentials(
  orangeMoney?: Partial<IOrangeMoneySettings> | null,
): ResolvedOrangeMoneyCredentials {
  const configuredMode = pick(orangeMoney?.mode, ENV.orangeMoneyMode);
  return {
    clientId: pick(orangeMoney?.clientId, ENV.orangeMoneyClientId),
    clientSecret: pick(orangeMoney?.clientSecret, ENV.orangeMoneyClientSecret),
    merchantKey: pick(orangeMoney?.merchantKey, ENV.orangeMoneyMerchantKey),
    country: pick(orangeMoney?.country, ENV.orangeMoneyCountry),
    mode: configuredMode === "live" ? "live" : "sandbox",
  };
}

interface ResolvedMtnMomoCredentials {
  subscriptionKey?: string;
  apiUser?: string;
  apiKey?: string;
  targetEnvironment?: string;
  callbackHost?: string;
  mode: "sandbox" | "live";
}

export function resolveMtnMomoCredentials(
  mtnMomo?: Partial<IMtnMomoSettings> | null,
): ResolvedMtnMomoCredentials {
  const configuredMode = pick(mtnMomo?.mode, ENV.mtnMomoMode);
  return {
    subscriptionKey: pick(mtnMomo?.subscriptionKey, ENV.mtnMomoSubscriptionKey),
    apiUser: pick(mtnMomo?.apiUser, ENV.mtnMomoApiUser),
    apiKey: pick(mtnMomo?.apiKey, ENV.mtnMomoApiKey),
    targetEnvironment: pick(
      mtnMomo?.targetEnvironment,
      ENV.mtnMomoTargetEnvironment,
    ),
    callbackHost: pick(mtnMomo?.callbackHost, ENV.mtnMomoCallbackHost),
    mode: configuredMode === "live" ? "live" : "sandbox",
  };
}

// ============================================
// OAuth / Social login
// ============================================

// ============================================
// Shipping carriers
// ============================================

interface ResolvedShippoCredentials {
  /** The token for the selected mode — the only one a call should ever use. */
  token?: string;
  mode: CarrierMode;
  webhookSecret?: string;
}

/**
 * Shippo has no mode field of its own: a test token and a live token are
 * different strings against the same endpoints. Resolving the pair down to one
 * token here is what stops a caller from reaching for the wrong one and
 * quietly buying a real label from a staging box.
 */
export function resolveShippoCredentials(
  shippo?: Partial<IShippoCarrierSettings> | null,
): ResolvedShippoCredentials {
  const configuredMode = pick(shippo?.mode, ENV.shippoMode);
  const mode: CarrierMode = configuredMode === "live" ? "live" : "test";
  return {
    token:
      mode === "live"
        ? pick(shippo?.liveToken, ENV.shippoLiveToken)
        : pick(shippo?.testToken, ENV.shippoTestToken),
    mode,
    webhookSecret: pick(shippo?.webhookSecret, ENV.shippoWebhookSecret),
  };
}

interface ResolvedShiprocketCredentials {
  email?: string;
  password?: string;
  pickupLocationName?: string;
  webhookToken?: string;
}

export function resolveShiprocketCredentials(
  shiprocket?: Partial<IShiprocketCarrierSettings> | null,
): ResolvedShiprocketCredentials {
  return {
    email: pick(shiprocket?.email, ENV.shiprocketEmail),
    password: pick(shiprocket?.password, ENV.shiprocketPassword),
    pickupLocationName: pick(
      shiprocket?.pickupLocationName,
      ENV.shiprocketPickupLocation,
    ),
    webhookToken: pick(shiprocket?.webhookToken, ENV.shiprocketWebhookToken),
  };
}

interface ResolvedOAuthCredentials {
  google: { clientId?: string; clientSecret?: string };
  facebook: { appId?: string; appSecret?: string };
}

export function resolveOAuthCredentials(
  security?: Partial<ISecuritySettings> | null,
): ResolvedOAuthCredentials {
  return {
    google: {
      clientId: pick(security?.googleClientId, ENV.googleClientId),
      clientSecret: pick(security?.googleClientSecret, ENV.googleClientSecret),
    },
    facebook: {
      appId: pick(security?.facebookAppId, ENV.facebookAppId),
      appSecret: pick(security?.facebookAppSecret, ENV.facebookAppSecret),
    },
  };
}

// ============================================
// SMTP / Email
// ============================================

export interface ResolvedSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string };
  tls: { minVersion: "TLSv1.2" };
}

/**
 * Resolve SMTP transport config from DB settings with per-field env fallback.
 * Returns null when no usable user/password can be resolved.
 *
 * Usable when the DB has SMTP enabled, OR env SMTP credentials are present
 * (so an env-only deployment works without touching the Settings page).
 */
export function resolveSmtpConfig(
  settings?: Pick<ISettings, "email"> | null,
): ResolvedSmtpConfig | null {
  const email = settings?.email;
  const provider = email?.provider ?? "smtp";
  const dbEnabledSmtp = Boolean(email?.enabled) && provider === "smtp";
  const envHasCreds = envSet(ENV.smtpUser) && envSet(ENV.smtpPass);

  if (!dbEnabledSmtp && !envHasCreds) return null;

  const host = pick(email?.smtp?.host, ENV.smtpHost) || "smtp.gmail.com";
  const portStr =
    pick(
      email?.smtp?.port ? String(email.smtp.port) : undefined,
      ENV.smtpPort,
    ) || "587";
  const port = parseInt(portStr, 10) || 587;
  const user = pick(email?.smtp?.user, ENV.smtpUser);
  const pass = pick(email?.smtp?.password, ENV.smtpPass);

  if (!user || !pass) return null;

  return {
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    tls: { minVersion: "TLSv1.2" },
  };
}

export function resolveSmtpFromEmail(
  settings?: Pick<ISettings, "email"> | null,
): string | undefined {
  return pick(settings?.email?.fromEmail, ENV.smtpFrom);
}

// ============================================
// Storage
// ============================================

interface ResolvedStorageCredentials {
  accountId?: string;
  endpoint?: string;
  region?: string;
  bucketName?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  publicUrl?: string;
}

/** First non-blank value, so an empty block field falls through to the next source. */
function firstSet(
  ...values: (string | undefined | null)[]
): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Flatten the active provider's credential block into the shape the storage
 * runtime expects.
 *
 * Three sources, in order: the provider's own block → the deprecated flat
 * fields (pre-v1.5 documents, until `db:migrate storage-credentials` runs) →
 * the `STORAGE_*` env vars. The env fallback stays provider-agnostic on
 * purpose: a `.env` only ever describes one backend.
 *
 * `provider` is accepted separately because `getStorageConfig` normalizes an
 * unrecognized stored value to `cloudflare_r2`, and the block it reads must
 * match the provider it is about to construct.
 */
/**
 * Which credential block belongs to which provider. Legacy "local" keeps no
 * credentials of its own; pointing it at the R2 block is harmless (the local
 * provider ignores them, and `getStorageConfig` drops publicUrl for it) and
 * saves a branch.
 */
export const STORAGE_CREDENTIAL_BLOCKS = {
  cloudflare_r2: "r2",
  s3: "s3",
  minio: "minio",
  digitalocean: "digitalocean",
  local: "r2",
} as const satisfies Record<IStorageSettings["provider"], string>;

export function resolveStorageCredentials(
  storage?: Partial<IStorageSettings> | null,
  provider?: IStorageSettings["provider"],
): ResolvedStorageCredentials {
  const active = provider ?? storage?.provider ?? "cloudflare_r2";
  const block = storage?.[STORAGE_CREDENTIAL_BLOCKS[active] ?? "r2"] as
    | Partial<
        IR2StorageCredentials &
          IS3StorageCredentials &
          IMinioStorageCredentials &
          IDigitalOceanStorageCredentials
      >
    | undefined;

  return {
    accountId: pick(
      firstSet(block?.accountId, storage?.accountId),
      ENV.storageAccountId,
    ),
    endpoint: pick(
      firstSet(block?.endpoint, storage?.endpoint),
      ENV.storageEndpoint,
    ),
    region: pick(firstSet(block?.region, storage?.region), ENV.storageRegion),
    bucketName: pick(
      firstSet(block?.bucketName, storage?.bucketName),
      ENV.storageBucket,
    ),
    accessKeyId: pick(
      firstSet(block?.accessKeyId, storage?.accessKeyId),
      ENV.storageAccessKeyId,
    ),
    secretAccessKey: pick(
      firstSet(block?.secretAccessKey, storage?.secretAccessKey),
      ENV.storageSecretAccessKey,
    ),
    publicUrl: pick(
      firstSet(block?.publicUrl, storage?.publicUrl),
      ENV.storagePublicUrl,
    ),
  };
}

// ============================================
// Analytics
// ============================================

interface ResolvedAnalyticsConfig {
  googleAnalyticsId?: string;
  googleTagManagerId?: string;
  facebookPixelId?: string;
  tiktokPixelId?: string;
  plausibleApiKey?: string;
}

export function resolveAnalyticsConfig(
  analytics?: Partial<IAnalyticsSettings> | null,
): ResolvedAnalyticsConfig {
  return {
    googleAnalyticsId: pick(analytics?.googleAnalyticsId, ENV.gaId),
    googleTagManagerId: pick(analytics?.googleTagManagerId, ENV.gtmId),
    facebookPixelId: pick(analytics?.facebookPixelId, ENV.facebookPixelId),
    tiktokPixelId: pick(analytics?.tiktokPixelId, ENV.tiktokPixelId),
    plausibleApiKey: pick(analytics?.plausibleApiKey, ENV.plausibleApiKey),
  };
}

// ============================================
// AI (OpenAI)
// ============================================

interface ResolvedOpenAICredentials {
  apiKey?: string;
}

/**
 * One shared OpenAI credential for every AI feature (authoring/studio and the
 * sales agent). Stored on `settings.aiAuthoring`; `OPENAI_API_KEY` remains the
 * env fallback so existing installs keep working without touching Settings.
 */
export function resolveOpenAICredentials(
  ai?: { apiKey?: string } | null,
): ResolvedOpenAICredentials {
  return {
    apiKey: pick(ai?.apiKey, ENV.openaiApiKey),
  };
}

// ============================================
// Env-source detection (for the admin "Set via environment" indicator)
// ============================================

export interface CredentialEnvSources {
  payment: {
    stripe: {
      publishableKey: boolean;
      secretKey: boolean;
      webhookSecret: boolean;
    };
    paypal: { clientId: boolean; clientSecret: boolean };
    razorpay: { keyId: boolean; keySecret: boolean; webhookSecret: boolean };
    paystack: { publicKey: boolean; secretKey: boolean };
    pesapal: {
      consumerKey: boolean;
      consumerSecret: boolean;
      mode: boolean;
      ipnId: boolean;
    };
    iotec: {
      clientId: boolean;
      clientSecret: boolean;
      walletId: boolean;
      mode: boolean;
    };
    orange_money: {
      clientId: boolean;
      clientSecret: boolean;
      merchantKey: boolean;
      country: boolean;
      mode: boolean;
    };
    mtn_momo: {
      subscriptionKey: boolean;
      apiUser: boolean;
      apiKey: boolean;
      targetEnvironment: boolean;
      callbackHost: boolean;
      mode: boolean;
    };
  };
  security: {
    googleClientId: boolean;
    googleClientSecret: boolean;
    facebookAppId: boolean;
    facebookAppSecret: boolean;
  };
  email: { host: boolean; user: boolean; password: boolean };
  storage: {
    accountId: boolean;
    endpoint: boolean;
    region: boolean;
    bucketName: boolean;
    accessKeyId: boolean;
    secretAccessKey: boolean;
    publicUrl: boolean;
  };
  analytics: {
    googleAnalyticsId: boolean;
    googleTagManagerId: boolean;
    facebookPixelId: boolean;
    tiktokPixelId: boolean;
    plausibleApiKey: boolean;
  };
  ai: {
    apiKey: boolean;
  };
  shipping: {
    shippo: {
      testToken: boolean;
      liveToken: boolean;
      mode: boolean;
      webhookSecret: boolean;
    };
    shiprocket: {
      email: boolean;
      password: boolean;
      pickupLocationName: boolean;
      webhookToken: boolean;
    };
  };
}

/**
 * Reports, per credential field, whether a `.env` fallback value is present.
 * Drives the read-only "Set via environment" hint on the admin Settings page.
 */
export function getCredentialEnvSources(): CredentialEnvSources {
  return {
    payment: {
      stripe: {
        publishableKey: envSet(ENV.stripePublishableKey),
        secretKey: envSet(ENV.stripeSecretKey),
        webhookSecret: envSet(ENV.stripeWebhookSecret),
      },
      paypal: {
        clientId: envSet(ENV.paypalClientId),
        clientSecret: envSet(ENV.paypalClientSecret),
      },
      razorpay: {
        keyId: envSet(ENV.razorpayKeyId),
        keySecret: envSet(ENV.razorpayKeySecret),
        webhookSecret: envSet(ENV.razorpayWebhookSecret),
      },
      paystack: {
        publicKey: envSet(ENV.paystackPublicKey),
        secretKey: envSet(ENV.paystackSecretKey),
      },
      pesapal: {
        consumerKey: envSet(ENV.pesapalConsumerKey),
        consumerSecret: envSet(ENV.pesapalConsumerSecret),
        mode: envSet(ENV.pesapalMode),
        ipnId: envSet(ENV.pesapalIpnId),
      },
      iotec: {
        clientId: envSet(ENV.iotecClientId),
        clientSecret: envSet(ENV.iotecClientSecret),
        walletId: envSet(ENV.iotecWalletId),
        mode: envSet(ENV.iotecMode),
      },
      orange_money: {
        clientId: envSet(ENV.orangeMoneyClientId),
        clientSecret: envSet(ENV.orangeMoneyClientSecret),
        merchantKey: envSet(ENV.orangeMoneyMerchantKey),
        country: envSet(ENV.orangeMoneyCountry),
        mode: envSet(ENV.orangeMoneyMode),
      },
      mtn_momo: {
        subscriptionKey: envSet(ENV.mtnMomoSubscriptionKey),
        apiUser: envSet(ENV.mtnMomoApiUser),
        apiKey: envSet(ENV.mtnMomoApiKey),
        targetEnvironment: envSet(ENV.mtnMomoTargetEnvironment),
        callbackHost: envSet(ENV.mtnMomoCallbackHost),
        mode: envSet(ENV.mtnMomoMode),
      },
    },
    security: {
      googleClientId: envSet(ENV.googleClientId),
      googleClientSecret: envSet(ENV.googleClientSecret),
      facebookAppId: envSet(ENV.facebookAppId),
      facebookAppSecret: envSet(ENV.facebookAppSecret),
    },
    email: {
      host: envSet(ENV.smtpHost),
      user: envSet(ENV.smtpUser),
      password: envSet(ENV.smtpPass),
    },
    storage: {
      accountId: envSet(ENV.storageAccountId),
      endpoint: envSet(ENV.storageEndpoint),
      region: envSet(ENV.storageRegion),
      bucketName: envSet(ENV.storageBucket),
      accessKeyId: envSet(ENV.storageAccessKeyId),
      secretAccessKey: envSet(ENV.storageSecretAccessKey),
      publicUrl: envSet(ENV.storagePublicUrl),
    },
    analytics: {
      googleAnalyticsId: envSet(ENV.gaId),
      googleTagManagerId: envSet(ENV.gtmId),
      facebookPixelId: envSet(ENV.facebookPixelId),
      tiktokPixelId: envSet(ENV.tiktokPixelId),
      plausibleApiKey: envSet(ENV.plausibleApiKey),
    },
    ai: {
      apiKey: envSet(ENV.openaiApiKey),
    },
    shipping: {
      shippo: {
        testToken: envSet(ENV.shippoTestToken),
        liveToken: envSet(ENV.shippoLiveToken),
        mode: envSet(ENV.shippoMode),
        webhookSecret: envSet(ENV.shippoWebhookSecret),
      },
      shiprocket: {
        email: envSet(ENV.shiprocketEmail),
        password: envSet(ENV.shiprocketPassword),
        pickupLocationName: envSet(ENV.shiprocketPickupLocation),
        webhookToken: envSet(ENV.shiprocketWebhookToken),
      },
    },
  };
}
