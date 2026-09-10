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

export type FooterContactSource = "store" | "custom";

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
    logoUrl: string;
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
    source: FooterContactSource;
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
    logoUrl: "",
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

function normalizeContactSource(value: unknown): FooterContactSource {
  return value === "custom" ? "custom" : "store";
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
      logoUrl: normalizeString(brand.logoUrl, defaults.brand.logoUrl),
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
      source: normalizeContactSource(contact.source),
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
