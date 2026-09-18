import { colorTone } from "@/lib/site-config/appearance-colors";
import type { LogoWidths } from "@/lib/site-config/header-config";
import {
  MAX_HEADER_LOGO_SIZE,
  MIN_HEADER_LOGO_SIZE,
} from "@/lib/site-config/header-layout";
import { isRecord } from "@/lib/utils";
export interface FooterColorScheme {
  backgroundColor: string;
  textColor: string;
  mutedTextColor: string;
  borderColor: string;
  accentColor: string;
}

interface FooterLink {
  label: string;
  href: string;
  target: "_self" | "_blank";
  visible: boolean;
}

interface FooterLinkColumn {
  id: string;
  title: string;
  /**
   * Reusable-menu source (a Menu handle from Navigation). When set, the
   * column's links come from that menu at render time — the `links` array
   * below is ignored — and an empty title falls back to the menu's name.
   * "" / absent means the column's own hand-entered links (legacy shape).
   */
  menuHandle?: string;
  links: FooterLink[];
}

interface FooterPaymentMethodsSettings {
  enabled: boolean;
  imageUrl: string;
  imageAlt: string;
}

interface FooterSocialLinks {
  facebookUrl: string;
  twitterUrl: string;
  instagramUrl: string;
  youtubeUrl: string;
  linkedinUrl: string;
  tiktokUrl: string;
}

/**
 * Whether a footer block follows the store's own settings ("store") or uses
 * values entered only in the footer ("custom"). Contact details and the logo
 * both offer the choice.
 */
export type FooterSource = "store" | "custom";

/**
 * Which logo artwork the footer shows — the header logo item's Theme choice.
 * "auto" reads the footer's own paint in the active theme, so a dark footer
 * gets the dark artwork even on a light storefront.
 */
export const FOOTER_LOGO_THEMES = ["auto", "light", "dark"] as const;
export type FooterLogoTheme = (typeof FOOTER_LOGO_THEMES)[number];

export interface FooterContactDetails {
  phone: string;
  email: string;
  address: string;
}

export interface FooterSettings {
  layout: {
    fullWidth: boolean;
  };
  brand: {
    /**
     * "store" shows the store's light/dark logo pair from Branding, switching
     * with the theme exactly as the header does. The two URLs below are read
     * only under "custom" — see resolveFooterLogoUrl.
     */
    logoSource: FooterSource;
    logoUrl: string;
    darkLogoUrl: string;
    /**
     * Logo width in px — the axis the header's Size field sets. 0 draws it at
     * the header's own logo size on every screen (resolveFooterLogoWidths).
     */
    logoSize: number;
    logoTheme: FooterLogoTheme;
    logoAlt: string;
    description: string;
  };
  colors: {
    light: FooterColorScheme;
    dark: FooterColorScheme;
  };
  widgets: {
    showLogo: boolean;
    showDescription: boolean;
    showContact: boolean;
    showSocialLinks: boolean;
    showLinkColumns: boolean;
    showCopyright: boolean;
    showPaymentMethods: boolean;
  };
  contact: {
    source: FooterSource;
    title: string;
    phone: string;
    email: string;
    address: string;
    showPhone: boolean;
    showEmail: boolean;
    showAddress: boolean;
  };
  social: {
    title: string;
    links: FooterSocialLinks;
  };
  linkColumns: FooterLinkColumn[];
  copyright: {
    text: string;
    showYear: boolean;
    showStoreName: boolean;
  };
  paymentMethods: FooterPaymentMethodsSettings;
}

const DEFAULT_FOOTER_SETTINGS: FooterSettings = {
  layout: {
    fullWidth: false,
  },
  brand: {
    logoSource: "store",
    logoUrl: "",
    darkLogoUrl: "",
    logoSize: 0,
    logoTheme: "auto",
    logoAlt: "",
    description: "",
  },
  colors: {
    light: {
      backgroundColor: "#f8fafc",
      textColor: "#111827",
      mutedTextColor: "#6b7280",
      borderColor: "#e5e7eb",
      accentColor: "#2065D1",
    },
    dark: {
      backgroundColor: "#050505",
      textColor: "#ffffff",
      mutedTextColor: "#d1d5db",
      borderColor: "#27272a",
      accentColor: "#60a5fa",
    },
  },
  widgets: {
    showLogo: true,
    showDescription: true,
    showContact: true,
    showSocialLinks: true,
    showLinkColumns: true,
    showCopyright: true,
    showPaymentMethods: true,
  },
  contact: {
    source: "store",
    title: "Contact",
    phone: "",
    email: "",
    address: "",
    showPhone: true,
    showEmail: true,
    showAddress: true,
  },
  social: {
    title: "Follow us",
    links: {
      facebookUrl: "",
      twitterUrl: "",
      instagramUrl: "",
      youtubeUrl: "",
      linkedinUrl: "",
      tiktokUrl: "",
    },
  },
  linkColumns: [
    {
      id: "products",
      title: "Products",
      links: [
        { label: "Products", href: "/products", target: "_self", visible: true },
        { label: "Categories", href: "/categories", target: "_self", visible: true },
        { label: "Brands", href: "/brands", target: "_self", visible: true },
        { label: "Collections", href: "/collections", target: "_self", visible: true },
        { label: "Vendors", href: "/vendors", target: "_self", visible: true },
        { label: "New Arrivals", href: "/products", target: "_self", visible: true },
      ],
    },
    {
      id: "help",
      title: "Help",
      links: [
        { label: "Track Order", href: "/track-order", target: "_self", visible: true },
        { label: "FAQ", href: "/faq", target: "_self", visible: true },
        { label: "Returns", href: "/returns", target: "_self", visible: true },
        { label: "Contact", href: "/contact", target: "_self", visible: true },
      ],
    },
    {
      id: "company",
      title: "Company",
      links: [
        { label: "About Us", href: "/about", target: "_self", visible: true },
        { label: "Blog", href: "/blog", target: "_self", visible: true },
        { label: "Careers", href: "/careers", target: "_self", visible: true },
        {
          label: "Become a Vendor",
          href: "/become-vendor",
          target: "_self",
          visible: true,
        },
      ],
    },
    {
      id: "legal",
      title: "Legal",
      links: [
        { label: "Terms of Service", href: "/terms", target: "_self", visible: true },
        { label: "Privacy Policy", href: "/privacy", target: "_self", visible: true },
        { label: "Cookie Policy", href: "/cookies", target: "_self", visible: true },
        { label: "Accessibility", href: "/accessibility", target: "_self", visible: true },
      ],
    },
  ],
  copyright: {
    text: "All rights reserved.",
    showYear: true,
    showStoreName: true,
  },
  paymentMethods: {
    enabled: true,
    imageUrl: "",
    imageAlt: "Payment methods",
  },
};

function cloneDefaults(): FooterSettings {
  return JSON.parse(JSON.stringify(DEFAULT_FOOTER_SETTINGS)) as FooterSettings;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
    trimmed,
  )
    ? trimmed
    : fallback;
}

function normalizeTarget(value: unknown): "_self" | "_blank" {
  return value === "_blank" ? "_blank" : "_self";
}

function normalizeSource(value: unknown): FooterSource {
  return value === "custom" ? "custom" : "store";
}

/** 0 (the header's size) or a width inside the header's Size range. */
function normalizeLogoSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.round(
    Math.min(MAX_HEADER_LOGO_SIZE, Math.max(MIN_HEADER_LOGO_SIZE, value)),
  );
}

function normalizeLogoTheme(value: unknown): FooterLogoTheme {
  return FOOTER_LOGO_THEMES.find((theme) => theme === value) ?? "auto";
}

function normalizeColorScheme(
  value: unknown,
  fallback: FooterColorScheme,
): FooterColorScheme {
  const source = isRecord(value) ? value : {};

  return {
    backgroundColor: normalizeHexColor(
      source.backgroundColor,
      fallback.backgroundColor,
    ),
    textColor: normalizeHexColor(source.textColor, fallback.textColor),
    mutedTextColor: normalizeHexColor(
      source.mutedTextColor,
      fallback.mutedTextColor,
    ),
    borderColor: normalizeHexColor(source.borderColor, fallback.borderColor),
    accentColor: normalizeHexColor(source.accentColor, fallback.accentColor),
  };
}

function normalizeFooterLink(value: unknown, fallback: FooterLink): FooterLink {
  const source = isRecord(value) ? value : {};

  return {
    label: normalizeString(source.label, fallback.label),
    href: normalizeString(source.href, fallback.href),
    target: normalizeTarget(source.target ?? fallback.target),
    visible: normalizeBoolean(source.visible, fallback.visible ?? true),
  };
}

function normalizeFooterLinks(value: unknown, fallback: FooterLink[]) {
  if (!Array.isArray(value)) return fallback;

  return value
    .map((item, index) => normalizeFooterLink(item, fallback[index] ?? fallback[0]))
    .filter((link) => link.label.trim() && link.href.trim())
    .slice(0, 8);
}

function normalizeFooterColumns(value: unknown, fallback: FooterLinkColumn[]) {
  if (!Array.isArray(value)) return fallback;

  return value
    .map((item, index) => {
      const columnFallback = fallback[index] ?? fallback[0];
      const sourceColumn = isRecord(item) ? item : {};

      return {
        id: normalizeString(sourceColumn.id, columnFallback.id || `column-${index + 1}`),
        title: normalizeString(sourceColumn.title, columnFallback.title),
        menuHandle: normalizeString(sourceColumn.menuHandle, "").trim(),
        links: normalizeFooterLinks(sourceColumn.links, columnFallback.links),
      };
    })
    // A menu-sourced column may leave its title empty — the menu's name
    // fills it at render; only fully-anonymous custom columns are dropped.
    .filter((column) => column.title.trim() || column.menuHandle)
    .slice(0, 6);
}

function normalizePaymentMethods(
  value: unknown,
  fallback: FooterPaymentMethodsSettings,
): FooterPaymentMethodsSettings {
  if (Array.isArray(value)) {
    return {
      ...fallback,
      enabled: value.some((method) => isRecord(method) && method.enabled === true),
    };
  }

  const source = isRecord(value) ? value : {};

  return {
    enabled: normalizeBoolean(source.enabled, fallback.enabled),
    imageUrl: normalizeString(source.imageUrl, fallback.imageUrl),
    imageAlt: normalizeString(source.imageAlt, fallback.imageAlt),
  };
}

function normalizeSocialLinks(
  value: unknown,
  fallback: FooterSocialLinks,
): FooterSocialLinks {
  const source = isRecord(value) ? value : {};

  return {
    facebookUrl: normalizeString(source.facebookUrl, fallback.facebookUrl),
    twitterUrl: normalizeString(source.twitterUrl, fallback.twitterUrl),
    instagramUrl: normalizeString(source.instagramUrl, fallback.instagramUrl),
    youtubeUrl: normalizeString(source.youtubeUrl, fallback.youtubeUrl),
    linkedinUrl: normalizeString(source.linkedinUrl, fallback.linkedinUrl),
    tiktokUrl: normalizeString(source.tiktokUrl, fallback.tiktokUrl),
  };
}

export function getDefaultFooterSettings(): FooterSettings {
  return cloneDefaults();
}

/**
 * Store Information is the default source of truth for footer contact details.
 * A separate footer value is used only after an admin explicitly opts into it,
 * preventing copied values from silently becoming stale after a general settings
 * update.
 */
export function resolveFooterContactDetails(
  contact: FooterSettings["contact"],
  storeContact: FooterContactDetails,
): FooterContactDetails {
  const selected = contact.source === "custom" ? contact : storeContact;

  return {
    phone: selected.phone.trim(),
    email: selected.email.trim(),
    address: selected.address.trim(),
  };
}

/**
 * Which logo the footer paints, resolved ONCE for the storefront footer and
 * the builder's preview so the two cannot disagree.
 *
 * The pair: "store" follows the store's light/dark logos — the artwork the
 * header switches between. "custom" uses the footer's own: an empty custom
 * dark logo falls back to the custom light one, so a single uploaded footer
 * logo keeps showing in both themes, and a side with no custom artwork at
 * all falls back to the store's.
 *
 * The side: `logoTheme` names it, and "auto" reads the surface BEHIND the
 * logo — the footer's paint in the active theme, as the header's logo item
 * reads its row — falling back to the theme when the footer has no opaque
 * paint of its own. A missing side falls back to the other: a missing logo
 * reads as a broken store where a slightly low-contrast one merely reads as
 * plain.
 */
export function resolveFooterLogoUrl({
  brand,
  storeLogoUrl,
  storeDarkLogoUrl,
  isDark,
  backgroundColor,
}: {
  brand: Pick<
    FooterSettings["brand"],
    "logoSource" | "logoUrl" | "darkLogoUrl" | "logoTheme"
  >;
  storeLogoUrl: string;
  storeDarkLogoUrl: string;
  /** The shopper's (or preview's) active theme. */
  isDark: boolean;
  /** The footer's background in that theme; "" when it paints none. */
  backgroundColor: string;
}): string {
  const custom = brand.logoSource === "custom";
  const customLight = custom ? brand.logoUrl.trim() : "";
  const customDark = custom ? brand.darkLogoUrl.trim() || customLight : "";
  const light = customLight || storeLogoUrl.trim();
  const dark = customDark || storeDarkLogoUrl.trim();
  const surface =
    brand.logoTheme === "auto"
      ? (colorTone(backgroundColor) ?? (isDark ? "dark" : "light"))
      : brand.logoTheme;
  return surface === "dark" ? dark || light : light || dark;
}

/**
 * How wide the footer draws its logo on each side of the header's `lg`
 * breakpoint. A `logoSize` of 0 copies the header (see headerLogoWidths), so
 * the two logos stay the same size as either is edited; a set size applies
 * on every screen.
 */
export function resolveFooterLogoWidths(
  logoSize: number,
  header: LogoWidths,
): LogoWidths & { matchesHeader: boolean } {
  return logoSize > 0
    ? { desktop: logoSize, mobile: logoSize, matchesHeader: false }
    : { ...header, matchesHeader: true };
}

export function normalizeFooterSettings(value: unknown): FooterSettings {
  const defaults = cloneDefaults();
  const source = isRecord(value) ? value : {};

  const layout = isRecord(source.layout) ? source.layout : {};
  const brand = isRecord(source.brand) ? source.brand : {};
  const colors = isRecord(source.colors) ? source.colors : {};
  const legacyLightColors = {
    backgroundColor: colors.backgroundColor,
    textColor: colors.textColor,
    mutedTextColor: colors.mutedTextColor,
    borderColor: colors.borderColor,
    accentColor: colors.accentColor,
  };
  const widgets = isRecord(source.widgets) ? source.widgets : {};
  const contact = isRecord(source.contact) ? source.contact : {};
  const social = isRecord(source.social) ? source.social : {};
  const copyright = isRecord(source.copyright) ? source.copyright : {};

  return {
    layout: {
      fullWidth: normalizeBoolean(layout.fullWidth, defaults.layout.fullWidth),
    },
    brand: {
      // Footers saved before this choice existed carry a one-time COPY of the
      // store's light logo (the builder used to pre-fill the field), which
      // pinned the light artwork in dark mode. Reading them as "store" heals
      // them without deleting the value — the contact source's rule.
      logoSource: normalizeSource(brand.logoSource),
      logoUrl: normalizeString(brand.logoUrl, defaults.brand.logoUrl),
      darkLogoUrl: normalizeString(
        brand.darkLogoUrl,
        defaults.brand.darkLogoUrl,
      ),
      logoSize: normalizeLogoSize(brand.logoSize),
      logoTheme: normalizeLogoTheme(brand.logoTheme),
      logoAlt: normalizeString(brand.logoAlt, defaults.brand.logoAlt),
      description: normalizeString(brand.description, defaults.brand.description),
    },
    colors: {
      light: normalizeColorScheme(
        isRecord(colors.light) ? colors.light : legacyLightColors,
        defaults.colors.light,
      ),
      dark: normalizeColorScheme(colors.dark, defaults.colors.dark),
    },
    widgets: {
      showLogo: normalizeBoolean(widgets.showLogo, defaults.widgets.showLogo),
      showDescription: normalizeBoolean(
        widgets.showDescription,
        defaults.widgets.showDescription,
      ),
      showContact: normalizeBoolean(
        widgets.showContact,
        defaults.widgets.showContact,
      ),
      showSocialLinks: normalizeBoolean(
        widgets.showSocialLinks,
        defaults.widgets.showSocialLinks,
      ),
      showLinkColumns: normalizeBoolean(
        widgets.showLinkColumns,
        defaults.widgets.showLinkColumns,
      ),
      showCopyright: normalizeBoolean(
        widgets.showCopyright,
        defaults.widgets.showCopyright,
      ),
      showPaymentMethods: normalizeBoolean(
        widgets.showPaymentMethods,
        defaults.widgets.showPaymentMethods,
      ),
    },
    contact: {
      // Older footer documents did not record a source and often contained a
      // one-time copy of Store Information. Treating those documents as synced
      // fixes the stale-copy behaviour without deleting their custom values.
      source: normalizeSource(contact.source),
      title: normalizeString(contact.title, defaults.contact.title),
      phone: normalizeString(contact.phone, defaults.contact.phone),
      email: normalizeString(contact.email, defaults.contact.email),
      address: normalizeString(contact.address, defaults.contact.address),
      showPhone: normalizeBoolean(contact.showPhone, defaults.contact.showPhone),
      showEmail: normalizeBoolean(contact.showEmail, defaults.contact.showEmail),
      showAddress: normalizeBoolean(
        contact.showAddress,
        defaults.contact.showAddress,
      ),
    },
    social: {
      title: normalizeString(social.title, defaults.social.title),
      links: normalizeSocialLinks(social.links, defaults.social.links),
    },
    linkColumns: normalizeFooterColumns(source.linkColumns, defaults.linkColumns),
    copyright: {
      text: normalizeString(copyright.text, defaults.copyright.text),
      showYear: normalizeBoolean(
        copyright.showYear,
        defaults.copyright.showYear,
      ),
      showStoreName: normalizeBoolean(
        copyright.showStoreName,
        defaults.copyright.showStoreName,
      ),
    },
    paymentMethods: normalizePaymentMethods(
      source.paymentMethods,
      defaults.paymentMethods,
    ),
  };
}
