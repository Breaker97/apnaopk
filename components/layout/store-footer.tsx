"use client";

import { type CSSProperties } from "react";
import {
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  Phone,
  Store,
  Twitter,
  Youtube,
} from "lucide-react";
import Link from "@/components/language/link";
import { useTranslations } from "next-intl";
import { appConfig } from "@/config/app.config";
import { type Locale } from "@/config/i18n.config";
import { AppImage } from "@/components/ui/app-image";
import { useAppTheme } from "@/providers/theme-provider";
import { useAppSettings } from "@/providers/app-settings-provider";
import { useRenderNow } from "@/components/store/render-clock";
import { useVendorSignupVisible } from "@/hooks/use-vendor-signup-visible";
import { isVendorSignupHref } from "@/lib/vendors/vendor-signup-links";
import {
  getDefaultFooterSettings,
  resolveFooterContactDetails,
  resolveFooterLogoUrl,
  resolveFooterLogoWidths,
  type FooterSettings,
} from "@/lib/site-config/footer-config";
import type { LogoWidths } from "@/lib/site-config/header-config";
import { paddingStyle } from "@/lib/site-config/header-layout-style";
import {
  footerLayoutFromSettings,
  resolveFooterLayout,
  type FooterLayoutColumn,
  type FooterLayoutItem,
  type FooterLayoutRow,
} from "@/lib/site-config/footer-layout";
import { cn } from "@/lib/utils";

interface FooterColumn {
  title: string;
  links: { label: string; href: string; target?: string }[];
}

interface StoreFooterProps {
  locale: Locale;
  columns?: FooterColumn[];
  footerSettings?: FooterSettings;
  /** headerLogoWidths() of the header this footer sits under. */
  headerLogoWidths: LogoWidths;
}

const TikTokIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V9.84a8.16 8.16 0 0 0 4.77 1.52V8.07a4.85 4.85 0 0 1-1.84-1.38z" />
  </svg>
);

export function StoreFooter({
  locale,
  columns,
  footerSettings,
  headerLogoWidths,
}: StoreFooterProps) {
  const t = useTranslations();
  const {
    storeName,
    storeDescription,
    storeEmail,
    storePhone,
    storeAddress,
    logoUrl,
    darkModeLogoUrl,
    socialLinks,
  } = useAppSettings();
  const { isDark } = useAppTheme();
  // "Become a Vendor" is for shoppers; see lib/vendors/vendor-signup-links.ts.
  const showVendorSignup = useVendorSignupVisible();

  const resolvedStoreName =
    typeof storeName === "string" && storeName.trim()
      ? storeName
      : appConfig.name;
  const resolvedDescription =
    typeof storeDescription === "string" && storeDescription.trim()
      ? storeDescription
      : appConfig.description;
  const footerBrand = footerSettings?.brand ?? getDefaultFooterSettings().brand;
  const footerLogoAlt = footerBrand.logoAlt.trim();
  const footerDescription = footerBrand.description.trim();
  const activeColors = isDark
    ? footerSettings?.colors.dark
    : footerSettings?.colors.light;
  // ONE rule for the artwork and ONE for the size, shared with the admin's
  // footer preview — see resolveFooterLogoUrl / resolveFooterLogoWidths.
  const currentLogoUrl = resolveFooterLogoUrl({
    brand: footerBrand,
    storeLogoUrl: typeof logoUrl === "string" ? logoUrl : "",
    storeDarkLogoUrl:
      typeof darkModeLogoUrl === "string" ? darkModeLogoUrl : "",
    isDark,
    backgroundColor: activeColors?.backgroundColor ?? "",
  });
  const logoWidths = resolveFooterLogoWidths(
    footerBrand.logoSize,
    headerLogoWidths,
  );
  const resolvedFooterDescription = footerDescription || resolvedDescription;
  const resolvedContact = footerSettings
    ? resolveFooterContactDetails(footerSettings.contact, {
        phone: storePhone || "",
        email: storeEmail || "",
        address: storeAddress || "",
      })
    : {
        phone: storePhone?.trim() || "",
        email: storeEmail?.trim() || "",
        address: storeAddress?.trim() || "",
      };
  const footerStyle = activeColors
    ? ({
        "--footer-bg": activeColors.backgroundColor,
        "--footer-text": activeColors.textColor,
        "--footer-muted": activeColors.mutedTextColor,
        "--footer-border": activeColors.borderColor,
        "--footer-accent": activeColors.accentColor,
      } as CSSProperties)
    : undefined;
  const contentClass = footerSettings?.layout.fullWidth
    ? "w-full px-4 sm:px-6 lg:px-8"
    : "container mx-auto px-4";
  const resolveHref = (raw: string) => {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/")) {
      return raw.startsWith(`/${locale}`) ? raw : `/${locale}${raw}`;
    }
    return `/${locale}/${raw}`;
  };

  const fallbackShop: FooterColumn = {
    title: t("common.products"),
    links: [
      { label: t("nav.products"), href: "/products" },
      { label: t("nav.categories"), href: "/categories" },
      { label: t("nav.vendors"), href: "/vendors" },
      { label: t("nav.deals"), href: "/deals" },
      { label: t("nav.newArrivals"), href: "/new-arrivals" },
    ],
  };
  const fallbackSupport: FooterColumn = {
    title: t("nav.help"),
    links: [
      { label: "Track Order", href: "/track-order" },
      { label: t("nav.faq"), href: "/faq" },
      { label: t("footer.shippingInfo"), href: "/shipping" },
      { label: t("footer.returns"), href: "/returns" },
    ],
  };
  const fallbackCompany: FooterColumn = {
    title: resolvedStoreName,
    links: [
      { label: t("nav.aboutUs"), href: "/about" },
      { label: t("footer.careers"), href: "/careers" },
      { label: t("footer.press"), href: "/press" },
      { label: t("footer.blog"), href: "/blog" },
    ],
  };
  const fallbackLegal: FooterColumn = {
    title: "Legal",
    links: [
      { label: t("footer.termsOfService"), href: "/terms" },
      { label: t("footer.privacyPolicy"), href: "/privacy" },
      { label: t("footer.cookiePolicy"), href: "/cookies" },
      { label: t("footer.accessibility"), href: "/accessibility" },
    ],
  };

  const finalColumns =
    columns && columns.length > 0
      ? columns
      : [fallbackShop, fallbackSupport, fallbackCompany, fallbackLegal];

  const footerSocialLinks = footerSettings?.social.links;
  const socialItems = [
    {
      icon: Facebook,
      href: footerSocialLinks?.facebookUrl || socialLinks.facebookUrl,
      label: "Facebook",
    },
    {
      icon: Twitter,
      href: footerSocialLinks?.twitterUrl || socialLinks.twitterUrl,
      label: "Twitter",
    },
    {
      icon: Instagram,
      href: footerSocialLinks?.instagramUrl || socialLinks.instagramUrl,
      label: "Instagram",
    },
    {
      icon: Youtube,
      href: footerSocialLinks?.youtubeUrl || socialLinks.youtubeUrl,
      label: "YouTube",
    },
    {
      icon: Linkedin,
      href: footerSocialLinks?.linkedinUrl || socialLinks.linkedinUrl,
      label: "LinkedIn",
    },
    {
      icon: TikTokIcon,
      href: footerSocialLinks?.tiktokUrl || socialLinks.tiktokUrl,
      label: "TikTok",
    },
  ].filter((s) => typeof s.href === "string" && s.href.trim().length > 0);
  // The render's year, in UTC on both sides: a cached page hydrates on a
  // different day than it was drawn, in a different time zone.
  const currentYear = new Date(useRenderNow()).getUTCFullYear();
  const mutedStyle = activeColors
    ? ({ color: "var(--footer-muted)" } as CSSProperties)
    : undefined;
  const headingStyle = activeColors
    ? ({ color: "var(--footer-text)" } as CSSProperties)
    : undefined;

  /**
   * WHAT to draw, as a layout. A store that has built one gets theirs; one
   * that has not gets the arrangement its settings already describe, which
   * is the footer it already had — see footerLayoutFromSettings. There is
   * one renderer either way: a second "legacy" path would be a second
   * footer to keep in step, and the two would drift.
   */
  const layout = footerSettings
    ? resolveFooterLayout(footerSettings.builder, footerSettings)
    : fallbackLayout(finalColumns);

  /** One item, in the markup the footer has always drawn it with. */
  const renderItem = (item: FooterLayoutItem) => {
    const inset = paddingStyle(item.padding);
    switch (item.type) {
      case "brand":
        return (
          <Link
            key={item.id}
            href="/"
            className="flex items-center gap-2"
            style={inset}
          >
            {currentLogoUrl ? (
              // Sized by WIDTH, as the header sizes its logo. Matching the
              // header copies its two recipes exactly: the compact bar's
              // 32px-tall box below `lg`, the brand item's width-only box
              // from `lg` up.
              <span
                className={cn(
                  "relative block max-w-full",
                  logoWidths.matchesHeader
                    ? "h-8 w-(--footer-logo-width) lg:h-auto lg:w-(--footer-logo-width-lg)"
                    : "w-(--footer-logo-width)",
                )}
                style={
                  {
                    "--footer-logo-width": `${logoWidths.mobile}px`,
                    "--footer-logo-width-lg": `${logoWidths.desktop}px`,
                  } as CSSProperties
                }
              >
                <AppImage
                  src={currentLogoUrl}
                  alt={footerLogoAlt || resolvedStoreName}
                  className={cn(
                    "w-full object-contain object-left",
                    logoWidths.matchesHeader ? "h-8 lg:h-auto" : "h-auto",
                  )}
                  width={Math.round(logoWidths.desktop)}
                  height={Math.round(logoWidths.desktop / 4)}
                />
              </span>
            ) : (
              <>
                <Store
                  className="h-6 w-6 text-primary"
                  style={
                    activeColors
                      ? ({ color: "var(--footer-accent)" } as CSSProperties)
                      : undefined
                  }
                />
                <span className="text-xl font-bold">{resolvedStoreName}</span>
              </>
            )}
          </Link>
        );
      case "text":
        return (
          <p
            key={item.id}
            className="max-w-xs text-sm text-muted-foreground"
            style={{ ...mutedStyle, ...inset }}
          >
            {item.text.trim() || resolvedFooterDescription}
          </p>
        );
      case "contact":
        return (
          <div
            key={item.id}
            className="space-y-2 text-sm text-muted-foreground"
            style={{ ...mutedStyle, ...inset }}
          >
            {item.title ? (
              <p className="font-semibold" style={headingStyle}>
                {item.title}
              </p>
            ) : null}
            {resolvedContact.phone && item.showPhone ? (
              <a
                href={`tel:${resolvedContact.phone.replace(/\s+/g, "")}`}
                className="flex items-center gap-2 transition-colors hover:text-primary"
              >
                <Phone className="h-4 w-4" />
                <span>{resolvedContact.phone}</span>
              </a>
            ) : null}
            {resolvedContact.email && item.showEmail ? (
              <a
                href={`mailto:${resolvedContact.email}`}
                className="flex items-center gap-2 transition-colors hover:text-primary"
              >
                <Mail className="h-4 w-4" />
                <span>{resolvedContact.email}</span>
              </a>
            ) : null}
            {resolvedContact.address && item.showAddress ? (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <span>{resolvedContact.address}</span>
              </div>
            ) : null}
          </div>
        );
      case "links": {
        // A column sourced from a reusable menu has already had its links
        // resolved server-side (resolveFooterMenuColumns), which is why the
        // item carries both and reads whichever it was given.
        const links = item.links.filter(
          (link) =>
            link.label && (showVendorSignup || !isVendorSignupHref(link.url)),
        );
        if (links.length === 0) return null;
        return (
          <div key={item.id} style={inset}>
            {item.title ? (
              <h4 className="mb-4 font-semibold" style={headingStyle}>
                {item.title}
              </h4>
            ) : null}
            <ul className="space-y-2">
              {links.map((link, linkIdx) => (
                <li key={`${link.id}-${linkIdx}`}>
                  <Link
                    href={resolveHref(link.url)}
                    // Footer columns are ~25 links: with viewport prefetch
                    // every short page (cart, about, account) fired a server
                    // render per link before the shopper touched one. These
                    // are secondary pages; a click pays one round trip.
                    prefetch={false}
                    className="text-sm text-muted-foreground transition-colors hover:text-primary"
                    style={mutedStyle}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      }
      case "copyright": {
        const parts = [
          item.showYear ? currentYear : null,
          item.showStoreName ? resolvedStoreName : null,
        ].filter(Boolean);
        return (
          <p
            key={item.id}
            className="text-sm text-muted-foreground"
            style={{ ...mutedStyle, ...inset }}
          >
            {"\u00a9"} {parts.join(" ")}
            {parts.length > 0 ? ". " : ""}
            {item.text.trim() || t("common.allRightsReserved")}
          </p>
        );
      }
      case "payments":
        return item.imageUrl.trim() ? (
          <AppImage
            key={item.id}
            src={item.imageUrl}
            alt={item.imageAlt || "Payment methods"}
            width={240}
            height={40}
            className="h-8 max-w-[240px] object-contain"
            style={inset}
          />
        ) : null;
      case "social":
        return socialItems.length > 0 ? (
          <div key={item.id} className="flex items-center gap-4" style={inset}>
            {socialItems.map((social) => (
              <a
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground transition-colors hover:text-primary"
                style={mutedStyle}
                aria-label={social.label}
              >
                <social.icon className="h-5 w-5" />
              </a>
            ))}
          </div>
        ) : null;
    }
    return null;
  };

  const renderColumn = (column: FooterLayoutColumn, headingGap?: number) => {
    const drawn = column.items.map(renderItem).filter(Boolean);
    if (drawn.length === 0) return null;
    return (
      <div
        key={column.id}
        className={cn(
          "flex min-w-0",
          headingGap !== undefined && "footer-column--aligned",
          headingGap !== undefined &&
            column.items[0]?.type === "links" &&
            "footer-column--links",
          column.flow === "row" ? "flex-wrap items-center" : "flex-col",
          // Below `lg` the tracks are the grid's own, so a column wider than
          // one track says so by spanning; from `lg` the row states every
          // track explicitly and a span would fight it.
          column.width > 1 && "col-span-2 lg:col-span-1",
        )}
        style={{
          gap: headingGap ?? column.gap,
          justifyContent: FLOW_JUSTIFY[column.justify],
          alignItems:
            column.flow === "row"
              ? ALIGN_ITEMS[column.align.vertical]
              : ALIGN_ITEMS[column.align.horizontal],
        }}
      >
        {headingGap !== undefined && column.items[0]?.type === "brand" ? (
          <>
            {drawn[0]}
            <div
              className="footer-brand-content flex flex-col"
              style={{ gap: column.gap }}
            >
              {drawn.slice(1)}
            </div>
          </>
        ) : drawn}
      </div>
    );
  };

  const renderRow = (row: FooterLayoutRow) => {
    // Only the columns that actually DREW get a track. A column whose items
    // all resolved to nothing — no social URLs set, no payment artwork —
    // would otherwise leave an empty track behind and push its neighbours
    // off their share of the row.
    const drawnColumns = row.columns.filter((column) => renderColumn(column) !== null);
    // Share the logo/heading track in a conventional brand-and-links row.
    // A taller logo then cannot push only the description/contact down.
    const brandColumn = drawnColumns.find(
      (column) => column.items[0]?.type === "brand",
    );
    const alignHeadings = brandColumn && drawnColumns.length > 1 &&
      drawnColumns.every((column) =>
        column.flow === "stack" &&
        column.justify === "start" &&
        column.align.horizontal === "start" &&
        (column === brandColumn ||
          (column.items.length === 1 &&
            column.items[0]?.type === "links" &&
            column.items[0].title &&
            Object.values(column.items[0].padding).every((value) => value === 0))),
      );
    const headingGap = alignHeadings ? brandColumn.gap : undefined;
    const drawn = drawnColumns.map((column) => renderColumn(column, headingGap));
    if (drawn.length === 0) return null;
    const strip = drawnColumns.every((column) => column.width === 1);
    return (
      <div
        key={row.id}
        style={
          row.borderTop
            ? {
                borderTopWidth: row.borderTop,
                borderTopStyle: "solid",
                borderTopColor:
                  row.borderColor ||
                  (activeColors ? "var(--footer-border)" : undefined),
              }
            : undefined
        }
      >
        {/* The page gutter (`px-4`) lives on this box and the row's own
            padding on the one inside it. They used to share one element, and
            the row's inline `padding: 48 0` then overwrote the gutter's left
            and right — so on a phone the footer ran flush to the screen
            edge. Now the row's padding adds to the gutter instead. */}
        <div className={contentClass}>
          <div style={paddingStyle(row.padding)}>
            <div
              className={cn(
                "footer-row grid",
                alignHeadings && "footer-row--aligned",
                // Below `lg` the row keeps the shape the footer has always
                // had. A STRIP — every column one track, like the legal
                // line — stacked and centred on a phone and spread across
                // the width from `md`; a BANK with a wide brand column kept
                // the two- and four-track grids, the brand spanning two.
                strip
                  ? "footer-row--strip grid-cols-1 justify-items-center md:justify-items-stretch"
                  : "grid-cols-2 md:grid-cols-4",
              )}
              style={
                {
                  gap: row.gap,
                  "--footer-cols": drawnColumns
                    .map((column) => `minmax(0, ${column.width}fr)`)
                    .join(" "),
                } as CSSProperties
              }
            >
              {drawn}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <footer
      className="border-t bg-muted/30 text-foreground"
      style={{
        ...footerStyle,
        backgroundColor: activeColors ? "var(--footer-bg)" : undefined,
        color: activeColors ? "var(--footer-text)" : undefined,
        borderColor: activeColors ? "var(--footer-border)" : undefined,
      }}
    >
      {layout.rows.map(renderRow)}
    </footer>
  );
}

/** Where a column seats its items along its own flow. */
const FLOW_JUSTIFY: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
  between: "space-between",
};
const ALIGN_ITEMS: Record<string, string> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
};

/**
 * The footer for a surface that has no footer settings at all — the auth
 * pages, which pass their own columns. It is the same two rows, so the one
 * renderer above covers every case and there is no second footer to keep in
 * step with this one.
 */
function fallbackLayout(columns: FooterColumn[]) {
  return footerLayoutFromSettings({
    ...getDefaultFooterSettings(),
    linkColumns: columns.map((column, index) => ({
      id: `fallback-${index}`,
      title: column.title,
      links: column.links.map((link) => ({
        label: link.label,
        href: link.href,
        target: (link.target as "_self" | "_blank") ?? "_self",
        visible: true,
      })),
    })),
  });
}
