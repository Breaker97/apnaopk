"use client";

import type { ComponentType } from "react";
import {
  BarChart3,
  Bell,
  Boxes,
  CreditCard,
  HardDrive,
  History,
  KeyRound,
  Link2,
  Lock,
  Mail,
  MessageSquareText,
  MessagesSquare,
  Monitor,
  Package,
  Palette,
  Rocket,
  Rss,
  Search,
  Shield,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Store,
  Truck,
  Wrench,
} from "lucide-react";
import type { CredentialMetaMap } from "@/lib/settings/credential-fields";
import type {
  CheckoutGatewayId,
  CheckoutGatewayReadiness,
} from "@/lib/payments/checkout-gateways";
import { STORAGE_CREDENTIAL_BLOCKS } from "@/lib/settings/credentials";
import {
  isStorageConfigured,
  type StorageReadinessField,
} from "@/lib/storage/storage-readiness";
import {
  countChannelNotifications,
  hasAnySmsNotification,
  type NotificationSettings,
} from "@/lib/notifications/notification-settings";

export type AdminSettingsSectionId =
  | "general"
  | "appearance"
  | "marketplace"
  | "activityLog"
  | "products"
  | "boosting"
  | "pos"
  | "mobileApp"
  | "twoFactor"
  | "oauth"
  | "security"
  | "payment"
  | "email"
  | "sms"
  | "notifications"
  | "messaging"
  | "orders"
  | "shipping"
  | "seo"
  | "social"
  | "analytics"
  | "metaCatalog"
  | "maintenance"
  | "storage"
  | "aiAuthoring";

type AdminSettingsGroupId =
  | "store"
  | "commerce"
  | "salesTools"
  | "communication"
  | "authentication"
  | "growth"
  | "advanced";

type AdminSettingsSection = {
  id: AdminSettingsSectionId;
  /** The URL segment under `/admin/settings/`. */
  path: string;
  group: AdminSettingsGroupId;
  labelKey: string;
  defaultLabel: string;
  icon: ComponentType<{ className?: string }>;
};

// Sidebar group headers. Group order comes from ADMIN_SETTINGS_SECTIONS
// (sections of one group must stay contiguous there); this map only names
// the groups.
export const ADMIN_SETTINGS_GROUPS: Record<
  AdminSettingsGroupId,
  { labelKey: string; defaultLabel: string }
> = {
  store: {
    labelKey: "admin.settings.groups.store",
    defaultLabel: "Store",
  },
  commerce: {
    labelKey: "admin.settings.groups.commerce",
    defaultLabel: "Commerce",
  },
  salesTools: {
    labelKey: "admin.settings.groups.salesTools",
    defaultLabel: "Sales Tools",
  },
  communication: {
    labelKey: "admin.settings.groups.communication",
    defaultLabel: "Communication",
  },
  // "Authentication", not "Security" — the header would otherwise stutter
  // against its own "Security & Access Control" child, and everything in the
  // group (OAuth, 2FA, password/lockout/session policy) is sign-in related.
  authentication: {
    labelKey: "admin.settings.groups.authentication",
    defaultLabel: "Authentication",
  },
  growth: {
    labelKey: "admin.settings.groups.growth",
    defaultLabel: "Growth",
  },
  advanced: {
    labelKey: "admin.settings.groups.advanced",
    defaultLabel: "Advanced",
  },
};

// Ordered as a setup journey: store identity first, then the money path a
// new store cannot launch without, then optional selling features,
// communication, set-once security, growth tooling, and infrastructure last.
// Sections sharing a group must stay contiguous — the sidebar derives its
// group headers from transitions in this list.
export const ADMIN_SETTINGS_SECTIONS: AdminSettingsSection[] = [
  {
    id: "general",
    path: "general",
    group: "store",
    labelKey: "admin.settings.general.title",
    defaultLabel: "General",
    icon: Store,
  },
  {
    id: "appearance",
    path: "appearance",
    group: "store",
    labelKey: "admin.settings.appearance.title",
    defaultLabel: "Branding",
    icon: Palette,
  },
  {
    id: "marketplace",
    path: "marketplace",
    group: "store",
    labelKey: "admin.settings.security.multiVendor.label",
    defaultLabel: "Multi-Vendor Management",
    icon: ShoppingBag,
  },
  // Not a form: a read-only page, like Shopify's "Store activity log" under
  // Settings. It sits here and not under Staff because the log is the whole
  // store's — vendors, shoppers' security events and the system as well as the
  // team. Admin only; the settings layout admits nobody else.
  {
    id: "activityLog",
    path: "activity-log",
    group: "store",
    labelKey: "admin.sidebar.activityLog",
    defaultLabel: "Activity log",
    icon: History,
  },
  {
    id: "products",
    path: "products",
    group: "commerce",
    labelKey: "admin.settings.products.title",
    defaultLabel: "Products",
    icon: Boxes,
  },
  {
    id: "payment",
    path: "payment",
    group: "commerce",
    labelKey: "admin.settings.payment.title",
    defaultLabel: "Payment Settings",
    icon: CreditCard,
  },
  {
    id: "orders",
    path: "orders",
    group: "commerce",
    labelKey: "admin.settings.orders.title",
    defaultLabel: "Order Settings",
    icon: Package,
  },
  {
    id: "shipping",
    path: "shipping",
    group: "commerce",
    labelKey: "admin.settings.shipping.title",
    defaultLabel: "Shipping & Delivery",
    icon: Truck,
  },
  {
    id: "boosting",
    path: "boosting",
    group: "salesTools",
    labelKey: "admin.settings.boosting.title",
    defaultLabel: "Product Boosting",
    icon: Rocket,
  },
  {
    id: "pos",
    path: "pos",
    group: "salesTools",
    labelKey: "admin.settings.pos.title",
    defaultLabel: "POS",
    icon: Monitor,
  },
  {
    id: "mobileApp",
    path: "mobile-app",
    group: "salesTools",
    labelKey: "admin.settings.mobileApp.title",
    defaultLabel: "Mobile App",
    icon: Smartphone,
  },
  {
    id: "email",
    path: "email",
    group: "communication",
    labelKey: "admin.settings.email.title",
    defaultLabel: "Email",
    icon: Mail,
  },
  {
    id: "sms",
    path: "sms",
    group: "communication",
    labelKey: "admin.settings.sms.title",
    defaultLabel: "SMS (Twilio)",
    icon: MessageSquareText,
  },
  {
    id: "notifications",
    path: "notifications",
    group: "communication",
    labelKey: "admin.settings.notifications.title",
    defaultLabel: "Notifications",
    icon: Bell,
  },
  {
    id: "messaging",
    path: "messaging",
    group: "communication",
    labelKey: "admin.settings.messaging.title",
    defaultLabel: "Omnichannel Messaging",
    icon: MessagesSquare,
  },
  {
    id: "oauth",
    path: "oauth",
    group: "authentication",
    labelKey: "admin.settings.oauth.title",
    defaultLabel: "OAuth / Social Login",
    icon: KeyRound,
  },
  {
    id: "twoFactor",
    path: "two-factor",
    group: "authentication",
    labelKey: "admin.settings.twoFactor.title",
    defaultLabel: "Two-Factor Authentication",
    icon: Lock,
  },
  {
    id: "security",
    path: "security",
    group: "authentication",
    labelKey: "admin.settings.security.title",
    defaultLabel: "Security & Access Control",
    icon: Shield,
  },
  {
    id: "seo",
    path: "seo",
    group: "growth",
    labelKey: "admin.settings.seo.title",
    defaultLabel: "SEO Settings",
    icon: Search,
  },
  {
    id: "social",
    path: "social",
    group: "growth",
    labelKey: "admin.settings.social.title",
    defaultLabel: "Social / Links",
    icon: Link2,
  },
  {
    id: "analytics",
    path: "analytics",
    group: "growth",
    labelKey: "admin.settings.analytics.title",
    defaultLabel: "Analytics",
    icon: BarChart3,
  },
  {
    id: "metaCatalog",
    path: "meta-catalog",
    group: "growth",
    labelKey: "admin.settings.metaCatalog.title",
    defaultLabel: "Meta catalog",
    icon: Rss,
  },
  {
    id: "aiAuthoring",
    path: "ai",
    group: "growth",
    labelKey: "admin.settings.ai.title",
    defaultLabel: "AI Configuration",
    icon: Sparkles,
  },
  {
    id: "storage",
    path: "storage",
    group: "advanced",
    labelKey: "admin.settings.storage.title",
    defaultLabel: "Storage",
    icon: HardDrive,
  },
  {
    id: "maintenance",
    path: "maintenance",
    group: "advanced",
    labelKey: "admin.settings.maintenance.title",
    defaultLabel: "Maintenance",
    icon: Wrench,
  },
];

const SECTION_BY_PATH = new Map(
  ADMIN_SETTINGS_SECTIONS.map((section) => [section.path, section.id]),
);

/**
 * The settings section a page belongs to, or `null` outside settings. Takes
 * a locale-less path (`/admin/settings/payment`). A deeper path
 * (`/admin/settings/general/branding`) belongs to its first segment, and
 * the bare `/admin/settings` redirects to General.
 */
export function adminSettingsSectionFromPath(
  path: string,
): AdminSettingsSectionId | null {
  const match = /^\/admin\/settings(?:\/([^/?#]+))?(?:[/?#]|$)/.exec(path);
  if (!match) return null;
  return SECTION_BY_PATH.get(match[1] ?? "") ?? "general";
}

/**
 * Whether a section's page holds edits that are not saved yet. Two pages edit
 * blocks stored under other names: Multi-Vendor Management saves
 * `multiVendorMode` and the vendor pre-order rules (`preorder`), and Email
 * also owns the sign-up verification switches (`emailVerification`).
 */
export function isAdminSettingsSectionDirty(
  sectionId: AdminSettingsSectionId,
  dirtySections: ReadonlySet<string>,
): boolean {
  if (sectionId === "marketplace") {
    return dirtySections.has("multiVendorMode") || dirtySections.has("preorder");
  }
  if (sectionId === "email") {
    return (
      dirtySections.has("email") || dirtySections.has("emailVerification")
    );
  }
  return dirtySections.has(sectionId);
}

type SectionStatus = "ok" | "warning" | "disabled";

type StorageBlockForStatus = {
  bucketName?: string;
  endpoint?: string;
  // Secrets: present in the browser only while typed and unsaved (null after
  // a Remove); what is stored shows through `_meta.credentials`.
  accountId?: string | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
};

type SettingsForStatus = {
  maintenance?: { enabled?: boolean };
  mobileApp?: { shop?: { enabled?: boolean; scheme?: string } };
  boosting?: { enabled?: boolean };
  payment?: {
    stripe?: { enabled?: boolean };
    paypal?: { enabled?: boolean };
    razorpay?: { enabled?: boolean };
    paystack?: { enabled?: boolean };
    pesapal?: { enabled?: boolean };
    iotec?: { enabled?: boolean };
    orange_money?: { enabled?: boolean };
    mtn_momo?: { enabled?: boolean };
  };
  email?: {
    enabled?: boolean;
    smtp?: { user?: string; password?: string | null };
  };
  sms?: {
    enabled?: boolean;
    twilio?: { messagingServiceSid?: string; fromNumber?: string };
  };
  notifications?: NotificationSettings;
  shipping?: {
    enabled?: boolean;
    zones?: Array<{ rates?: unknown[] }>;
    carriers?: {
      enabled?: boolean;
      shippo?: { enabled?: boolean; mode?: "test" | "live" };
      shiprocket?: { enabled?: boolean; pickupLocationName?: string };
    };
  };
  storage?: {
    provider?: string;
    /** Pre-v1.5 flat fields, still read after the provider's own block. */
    bucketName?: string;
    endpoint?: string;
    r2?: StorageBlockForStatus;
    s3?: StorageBlockForStatus;
    minio?: StorageBlockForStatus;
    digitalocean?: StorageBlockForStatus;
  };
  security?: {
    twoFactorEnabled?: boolean;
    googleOAuthEnabled?: boolean;
    facebookOAuthEnabled?: boolean;
  };
  aiAuthoring?: { enabled?: boolean };
  _meta?: {
    credentials?: CredentialMetaMap;
    checkoutGateways?: Partial<
      Record<CheckoutGatewayId, CheckoutGatewayReadiness>
    >;
    envSources?: {
      ai?: { apiKey?: boolean };
      sms?: {
        accountSid?: boolean;
        authToken?: boolean;
        messagingServiceSid?: boolean;
        fromNumber?: boolean;
      };
      security?: {
        googleClientId?: boolean;
        googleClientSecret?: boolean;
        facebookAppId?: boolean;
        facebookAppSecret?: boolean;
      };
      email?: { user?: boolean; password?: boolean };
      storage?: Partial<Record<StorageReadinessField, boolean>>;
      shipping?: {
        shippo?: {
          testToken?: boolean;
          liveToken?: boolean;
          webhookSecret?: boolean;
        };
        shiprocket?: {
          email?: boolean;
          password?: boolean;
          pickupLocationName?: boolean;
          webhookToken?: boolean;
        };
      };
    };
  };
};

/**
 * Whether texts can go out, from what the browser can see: switched on, both
 * credentials stored or in `.env`, and a sender. The server's own check is
 * `resolveTwilioConfig`; this mirrors it for the sidebar and the matrix.
 */
export function isSmsConfigured(settings: SettingsForStatus): boolean {
  const sms = settings.sms;
  if (!sms?.enabled) return false;
  const cred = (path: string) =>
    Boolean(settings._meta?.credentials?.[path]?.set);
  const env = settings._meta?.envSources?.sms;
  const hasSid = cred("sms.twilio.accountSid") || Boolean(env?.accountSid);
  const hasToken = cred("sms.twilio.authToken") || Boolean(env?.authToken);
  const hasSender =
    Boolean(sms.twilio?.messagingServiceSid?.trim()) ||
    Boolean(sms.twilio?.fromNumber?.trim()) ||
    Boolean(env?.messagingServiceSid) ||
    Boolean(env?.fromNumber);
  return hasSid && hasToken && hasSender;
}

/**
 * Whether email goes out at all, as resolveSmtpConfig decides: the switch is
 * on, or the environment supplies a login.
 */
function isEmailSwitchedOn(settings: SettingsForStatus): boolean {
  const env = settings._meta?.envSources?.email;
  return Boolean(settings.email?.enabled) || Boolean(env?.user && env?.password);
}

/**
 * Whether email can go out, from what the browser can see: switched on (or a
 * login in `.env`), with a login and a password from the settings or the
 * environment. The host has a default, so it is not asked for. The server's
 * own check is `resolveSmtpConfig`.
 */
export function isEmailConfigured(settings: SettingsForStatus): boolean {
  if (!isEmailSwitchedOn(settings)) return false;
  const email = settings.email;
  const env = settings._meta?.envSources?.email;
  const user = Boolean(email?.smtp?.user?.trim()) || Boolean(env?.user);
  const password =
    hasSecret(settings, email?.smtp?.password, "email.smtp.password") ||
    Boolean(env?.password);
  return user && password;
}

/**
 * A secret the save would leave stored: typed into the form and not yet
 * saved, or already stored and not removed (a Remove sets the value to null
 * and drops the stored flag).
 */
function hasSecret(
  settings: SettingsForStatus,
  draft: string | null | undefined,
  path: string,
): boolean {
  if (typeof draft === "string" && draft.trim()) return true;
  return draft !== null && Boolean(settings._meta?.credentials?.[path]?.set);
}

export function getSectionStatus(
  sectionId: AdminSettingsSectionId,
  settings: SettingsForStatus,
): SectionStatus {
  if (sectionId === "maintenance") {
    return settings.maintenance?.enabled ? "warning" : "ok";
  }

  if (sectionId === "boosting") {
    return settings.boosting?.enabled ? "ok" : "disabled";
  }
  if (sectionId === "mobileApp") {
    // An app signs in and returns from payments through its scheme; an API
    // switched on without one serves an app that cannot finish either.
    const shop = settings.mobileApp?.shop;
    if (!shop?.enabled) return "disabled";
    return shop.scheme?.trim() ? "ok" : "warning";
  }

  if (sectionId === "payment") {
    // The payment screen's own rule, not a copy of it: a gateway switched on
    // that checkout will not offer, for missing keys or a store currency it
    // cannot settle. Readiness is the server's (resolveCheckoutGatewayReadiness,
    // over the saved keys and currency); the switches are the form's. The copy
    // this replaced checked one key where the rule needs two, and never the
    // currency, so a USD store's MTN MoMo was hidden at checkout unflagged.
    const readiness = settings._meta?.checkoutGateways;
    const switches: Record<CheckoutGatewayId, boolean | undefined> = {
      stripe: settings.payment?.stripe?.enabled,
      paypal: settings.payment?.paypal?.enabled,
      razorpay: settings.payment?.razorpay?.enabled,
      paystack: settings.payment?.paystack?.enabled,
      pesapal: settings.payment?.pesapal?.enabled,
      iotec: settings.payment?.iotec?.enabled,
      orange_money: settings.payment?.orange_money?.enabled,
      mtn_momo: settings.payment?.mtn_momo?.enabled,
    };
    return (Object.keys(switches) as CheckoutGatewayId[]).some(
      (gateway) => switches[gateway] && readiness?.[gateway]?.ready === false,
    )
      ? "warning"
      : "ok";
  }

  if (sectionId === "email") {
    if (!isEmailSwitchedOn(settings)) return "disabled";
    return isEmailConfigured(settings) ? "ok" : "warning";
  }

  if (sectionId === "sms") {
    if (!settings.sms?.enabled) return "disabled";
    return isSmsConfigured(settings) ? "ok" : "warning";
  }

  if (sectionId === "notifications") {
    // An event set to text or email while that channel cannot send sends
    // nothing, silently. Push is left out: its keys are an optional server
    // setting, and the page itself says when they are missing.
    const notifications = settings.notifications;
    if (!notifications) return "ok";
    const smsUnsent =
      hasAnySmsNotification(notifications) && !isSmsConfigured(settings);
    const emailUnsent =
      countChannelNotifications(notifications, "email") > 0 &&
      !isEmailConfigured(settings);
    return smsUnsent || emailUnsent ? "warning" : "ok";
  }

  if (sectionId === "storage") {
    const storage = settings.storage;
    if (!storage) return "ok";
    // The rule is the status route's (lib/storage/storage-readiness.ts); each
    // field is read with resolveStorageCredentials' precedence: the active
    // provider's block → the deprecated flat fields (pre-v1.5 documents) →
    // .env. It used to check the bucket and the access key only, so a missing
    // secret or R2 account read "ok" beside a page saying "Not connected".
    const provider = (
      storage.provider && storage.provider in STORAGE_CREDENTIAL_BLOCKS
        ? storage.provider
        : "cloudflare_r2"
    ) as keyof typeof STORAGE_CREDENTIAL_BLOCKS;
    const block = STORAGE_CREDENTIAL_BLOCKS[provider];
    const own = storage[block];
    const env = settings._meta?.envSources?.storage;
    const text = (value?: string) => Boolean(value?.trim());
    const has = (field: StorageReadinessField): boolean => {
      if (env?.[field]) return true;
      switch (field) {
        case "bucketName":
          return text(own?.bucketName) || text(storage.bucketName);
        case "endpoint":
          return text(own?.endpoint) || text(storage.endpoint);
        default:
          return (
            hasSecret(settings, own?.[field], `storage.${block}.${field}`) ||
            hasSecret(settings, undefined, `storage.${field}`)
          );
      }
    };
    return isStorageConfigured(provider, has) ? "ok" : "warning";
  }

  if (sectionId === "oauth") {
    const googleEnabled = settings.security?.googleOAuthEnabled ?? false;
    const facebookEnabled = settings.security?.facebookOAuthEnabled ?? false;
    const oauthEnv = settings._meta?.envSources?.security;
    const oauthCred = (path: string) =>
      Boolean(settings._meta?.credentials?.[path]?.set);
    const googleConfigured =
      (oauthCred("security.googleClientId") ||
        Boolean(oauthEnv?.googleClientId)) &&
      (oauthCred("security.googleClientSecret") ||
        Boolean(oauthEnv?.googleClientSecret));
    const facebookConfigured =
      (oauthCred("security.facebookAppId") ||
        Boolean(oauthEnv?.facebookAppId)) &&
      (oauthCred("security.facebookAppSecret") ||
        Boolean(oauthEnv?.facebookAppSecret));
    const hasWarning =
      (googleEnabled && !googleConfigured) || (facebookEnabled && !facebookConfigured);
    return hasWarning ? "warning" : "ok";
  }

  if (sectionId === "twoFactor") {
    const enabled = settings.security?.twoFactorEnabled ?? false;
    return enabled ? "ok" : "disabled";
  }

  if (sectionId === "shipping") {
    const enabled = settings.shipping?.enabled ?? false;
    if (!enabled) return "disabled";

    // A carrier switched on but missing its credentials will fail on the first
    // label purchase, which is the worst place to discover it — surface it here
    // the same way an unconfigured payment gateway is surfaced.
    const carriers = settings.shipping?.carriers;
    if (carriers?.enabled) {
      const cred = (path: string) =>
        Boolean(settings._meta?.credentials?.[path]?.set);
      const env = settings._meta?.envSources?.shipping;

      if (carriers.shippo?.enabled) {
        const tokenPath =
          carriers.shippo.mode === "live"
            ? "shipping.carriers.shippo.liveToken"
            : "shipping.carriers.shippo.testToken";
        const tokenFromEnv =
          carriers.shippo.mode === "live"
            ? env?.shippo?.liveToken
            : env?.shippo?.testToken;
        if (!cred(tokenPath) && !tokenFromEnv) return "warning";
      }

      if (carriers.shiprocket?.enabled) {
        const configured =
          (cred("shipping.carriers.shiprocket.email") ||
            Boolean(env?.shiprocket?.email)) &&
          (cred("shipping.carriers.shiprocket.password") ||
            Boolean(env?.shiprocket?.password)) &&
          // Shiprocket cannot dispatch without a registered pickup nickname,
          // so an unset one is as blocking as a missing password.
          (Boolean(carriers.shiprocket.pickupLocationName) ||
            Boolean(env?.shiprocket?.pickupLocationName));
        if (!configured) return "warning";
      }
    }

    const zones = settings.shipping?.zones ?? [];
    if (zones.length === 0) return "warning";
    const hasRates = zones.some((z) => Array.isArray(z.rates) && z.rates.length > 0);
    return hasRates ? "ok" : "warning";
  }

  if (sectionId === "aiAuthoring") {
    if (settings.aiAuthoring?.enabled === false) return "disabled";
    const keyAvailable =
      Boolean(settings._meta?.credentials?.["aiAuthoring.apiKey"]?.set) ||
      (settings._meta?.envSources?.ai?.apiKey ?? false);
    return keyAvailable ? "ok" : "warning";
  }

  return "ok";
}
