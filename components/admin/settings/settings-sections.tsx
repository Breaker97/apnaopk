"use client";

import type { ComponentType } from "react";
import {
  BarChart3,
  Bell,
  CreditCard,
  HardDrive,
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
  Search,
  Shield,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
  Wrench,
} from "lucide-react";
import type { CredentialMetaMap } from "@/lib/settings/credential-fields";
import { STORAGE_CREDENTIAL_BLOCKS } from "@/lib/settings/credentials";
import {
  hasAnySmsNotification,
  type NotificationSettings,
} from "@/lib/notifications/notification-settings";

export type AdminSettingsSectionId =
  | "general"
  | "appearance"
  | "marketplace"
  | "boosting"
  | "pos"
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
  tab: AdminSettingsSectionId;
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
    tab: "general",
    group: "store",
    labelKey: "admin.settings.general.title",
    defaultLabel: "General",
    icon: Store,
  },
  {
    id: "appearance",
    tab: "appearance",
    group: "store",
    labelKey: "admin.settings.appearance.title",
    defaultLabel: "Branding",
    icon: Palette,
  },
  {
    id: "marketplace",
    tab: "marketplace",
    group: "store",
    labelKey: "admin.settings.security.multiVendor.label",
    defaultLabel: "Multi-Vendor Management",
    icon: ShoppingBag,
  },
  {
    id: "payment",
    tab: "payment",
    group: "commerce",
    labelKey: "admin.settings.payment.title",
    defaultLabel: "Payment Settings",
    icon: CreditCard,
  },
  {
    id: "orders",
    tab: "orders",
    group: "commerce",
    labelKey: "admin.settings.orders.title",
    defaultLabel: "Order Settings",
    icon: Package,
  },
  {
    id: "shipping",
    tab: "shipping",
    group: "commerce",
    labelKey: "admin.settings.shipping.title",
    defaultLabel: "Shipping & Delivery",
    icon: Truck,
  },
  {
    id: "boosting",
    tab: "boosting",
    group: "salesTools",
    labelKey: "admin.settings.boosting.title",
    defaultLabel: "Product Boosting",
    icon: Rocket,
  },
  {
    id: "pos",
    tab: "pos",
    group: "salesTools",
    labelKey: "admin.settings.pos.title",
    defaultLabel: "POS",
    icon: Monitor,
  },
  {
    id: "email",
    tab: "email",
    group: "communication",
    labelKey: "admin.settings.email.title",
    defaultLabel: "Email Configuration (SMTP)",
    icon: Mail,
  },
  {
    id: "sms",
    tab: "sms",
    group: "communication",
    labelKey: "admin.settings.sms.title",
    defaultLabel: "SMS (Twilio)",
    icon: MessageSquareText,
  },
  {
    id: "notifications",
    tab: "notifications",
    group: "communication",
    labelKey: "admin.settings.notifications.title",
    defaultLabel: "Notification Settings",
    icon: Bell,
  },
  {
    id: "messaging",
    tab: "messaging",
    group: "communication",
    labelKey: "admin.settings.messaging.title",
    defaultLabel: "Omnichannel Messaging",
    icon: MessagesSquare,
  },
  {
    id: "oauth",
    tab: "oauth",
    group: "authentication",
    labelKey: "admin.settings.oauth.title",
    defaultLabel: "OAuth / Social Login",
    icon: KeyRound,
  },
  {
    id: "twoFactor",
    tab: "twoFactor",
    group: "authentication",
    labelKey: "admin.settings.twoFactor.title",
    defaultLabel: "Two-Factor Authentication",
    icon: Lock,
  },
  {
    id: "security",
    tab: "security",
    group: "authentication",
    labelKey: "admin.settings.security.title",
    defaultLabel: "Security & Access Control",
    icon: Shield,
  },
  {
    id: "seo",
    tab: "seo",
    group: "growth",
    labelKey: "admin.settings.seo.title",
    defaultLabel: "SEO Settings",
    icon: Search,
  },
  {
    id: "social",
    tab: "social",
    group: "growth",
    labelKey: "admin.settings.social.title",
    defaultLabel: "Social / Links",
    icon: Link2,
  },
  {
    id: "analytics",
    tab: "analytics",
    group: "growth",
    labelKey: "admin.settings.analytics.title",
    defaultLabel: "Analytics",
    icon: BarChart3,
  },
  {
    id: "aiAuthoring",
    tab: "aiAuthoring",
    group: "growth",
    labelKey: "admin.settings.ai.title",
    defaultLabel: "AI Configuration",
    icon: Sparkles,
  },
  {
    id: "storage",
    tab: "storage",
    group: "advanced",
    labelKey: "admin.settings.storage.title",
    defaultLabel: "Storage",
    icon: HardDrive,
  },
  {
    id: "maintenance",
    tab: "maintenance",
    group: "advanced",
    labelKey: "admin.settings.maintenance.title",
    defaultLabel: "Maintenance",
    icon: Wrench,
  },
];

type SectionStatus = "ok" | "warning" | "disabled";

type SettingsForStatus = {
  maintenance?: { enabled?: boolean };
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
  email?: { enabled?: boolean; provider?: string; smtp?: { host?: string; user?: string } };
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
    bucketName?: string;
    r2?: { bucketName?: string };
    s3?: { bucketName?: string };
    minio?: { bucketName?: string };
    digitalocean?: { bucketName?: string };
  };
  security?: {
    twoFactorEnabled?: boolean;
    googleOAuthEnabled?: boolean;
    facebookOAuthEnabled?: boolean;
  };
  aiAuthoring?: { enabled?: boolean };
  _meta?: {
    credentials?: CredentialMetaMap;
    envSources?: {
      ai?: { apiKey?: boolean };
      sms?: {
        accountSid?: boolean;
        authToken?: boolean;
        messagingServiceSid?: boolean;
        fromNumber?: boolean;
      };
      payment?: {
        stripe?: { publishableKey?: boolean; secretKey?: boolean };
        paypal?: { clientId?: boolean; clientSecret?: boolean };
        razorpay?: { keyId?: boolean; keySecret?: boolean };
        paystack?: { publicKey?: boolean; secretKey?: boolean };
        pesapal?: {
          consumerKey?: boolean;
          consumerSecret?: boolean;
          ipnId?: boolean;
        };
        iotec?: {
          clientId?: boolean;
          clientSecret?: boolean;
          walletId?: boolean;
        };
        orange_money?: {
          clientId?: boolean;
          clientSecret?: boolean;
          merchantKey?: boolean;
        };
        mtn_momo?: {
          subscriptionKey?: boolean;
          apiUser?: boolean;
          apiKey?: boolean;
        };
      };
      security?: {
        googleClientId?: boolean;
        googleClientSecret?: boolean;
        facebookAppId?: boolean;
        facebookAppSecret?: boolean;
      };
      storage?: { accessKeyId?: boolean; bucketName?: boolean };
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

  if (sectionId === "payment") {
    const cred = (path: string) =>
      Boolean(settings._meta?.credentials?.[path]?.set);
    const env = settings._meta?.envSources?.payment;

    const providers: Array<{ enabled: boolean; configured: boolean }> = [
      {
        enabled: settings.payment?.stripe?.enabled ?? false,
        configured:
          cred("payment.stripe.secretKey") || Boolean(env?.stripe?.secretKey),
      },
      {
        enabled: settings.payment?.paypal?.enabled ?? false,
        configured:
          cred("payment.paypal.clientSecret") ||
          Boolean(env?.paypal?.clientSecret),
      },
      {
        enabled: settings.payment?.razorpay?.enabled ?? false,
        configured:
          cred("payment.razorpay.keySecret") ||
          Boolean(env?.razorpay?.keySecret),
      },
      {
        enabled: settings.payment?.paystack?.enabled ?? false,
        configured:
          cred("payment.paystack.secretKey") ||
          Boolean(env?.paystack?.secretKey),
      },
      {
        enabled: settings.payment?.pesapal?.enabled ?? false,
        configured:
          (cred("payment.pesapal.consumerKey") ||
            Boolean(env?.pesapal?.consumerKey)) &&
          (cred("payment.pesapal.consumerSecret") ||
            Boolean(env?.pesapal?.consumerSecret)) &&
          (cred("payment.pesapal.ipnId") || Boolean(env?.pesapal?.ipnId)),
      },
      {
        enabled: settings.payment?.iotec?.enabled ?? false,
        configured:
          (cred("payment.iotec.clientId") || Boolean(env?.iotec?.clientId)) &&
          (cred("payment.iotec.clientSecret") ||
            Boolean(env?.iotec?.clientSecret)) &&
          (cred("payment.iotec.walletId") || Boolean(env?.iotec?.walletId)),
      },
      {
        enabled: settings.payment?.orange_money?.enabled ?? false,
        configured:
          (cred("payment.orange_money.clientId") ||
            Boolean(env?.orange_money?.clientId)) &&
          (cred("payment.orange_money.clientSecret") ||
            Boolean(env?.orange_money?.clientSecret)) &&
          (cred("payment.orange_money.merchantKey") ||
            Boolean(env?.orange_money?.merchantKey)),
      },
      {
        enabled: settings.payment?.mtn_momo?.enabled ?? false,
        configured:
          (cred("payment.mtn_momo.subscriptionKey") ||
            Boolean(env?.mtn_momo?.subscriptionKey)) &&
          (cred("payment.mtn_momo.apiUser") ||
            Boolean(env?.mtn_momo?.apiUser)) &&
          (cred("payment.mtn_momo.apiKey") || Boolean(env?.mtn_momo?.apiKey)),
      },
    ];

    return providers.some((p) => p.enabled && !p.configured)
      ? "warning"
      : "ok";
  }

  if (sectionId === "email") {
    if (!settings.email?.enabled) return "disabled";
    if (settings.email.provider !== "smtp") return "ok";
    const host = settings.email.smtp?.host;
    const user = settings.email.smtp?.user;
    return !host || !user ? "warning" : "ok";
  }

  if (sectionId === "sms") {
    if (!settings.sms?.enabled) return "disabled";
    return isSmsConfigured(settings) ? "ok" : "warning";
  }

  if (sectionId === "notifications") {
    // An event set to text while texts cannot go out sends nothing, silently.
    return settings.notifications &&
      hasAnySmsNotification(settings.notifications) &&
      !isSmsConfigured(settings)
      ? "warning"
      : "ok";
  }

  if (sectionId === "storage") {
    const storage = settings.storage;
    if (!storage) return "ok";
    // Same precedence as resolveStorageCredentials: the active provider's
    // block → the deprecated flat fields (pre-v1.5 documents) → .env. Reading
    // only the flat fields flagged every store configured through the v1.5+
    // form, which saves into the per-provider block.
    const provider = (
      storage.provider && storage.provider in STORAGE_CREDENTIAL_BLOCKS
        ? storage.provider
        : "cloudflare_r2"
    ) as keyof typeof STORAGE_CREDENTIAL_BLOCKS;
    const block = STORAGE_CREDENTIAL_BLOCKS[provider];
    const cred = (path: string) =>
      Boolean(settings._meta?.credentials?.[path]?.set);
    const env = settings._meta?.envSources?.storage;
    const bucketName =
      Boolean(storage[block]?.bucketName?.trim()) ||
      Boolean(storage.bucketName?.trim()) ||
      Boolean(env?.bucketName);
    const accessKeyId =
      cred(`storage.${block}.accessKeyId`) ||
      cred("storage.accessKeyId") ||
      Boolean(env?.accessKeyId);
    return !bucketName || !accessKeyId ? "warning" : "ok";
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
