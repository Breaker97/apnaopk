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
import Link from "next/link";
import { useTranslations } from "next-intl";
import { appConfig } from "@/config/app.config";
import { type Locale } from "@/config/i18n.config";
import { Separator } from "@/components/ui/separator";
import { AppImage } from "@/components/ui/app-image";
import { useAppTheme } from "@/providers/theme-provider";
import { useAppSettings } from "@/providers/app-settings-provider";
import {
  getDefaultFooterSettings,
  resolveFooterContactDetails,
  resolveFooterLogoUrl,
  resolveFooterLogoWidths,
  type FooterSettings,
} from "@/lib/site-config/footer-config";
import type { LogoWidths } from "@/lib/site-config/header-config";
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
  const showLogo = footerSettings?.widgets.showLogo ?? true;
  const showDescription = footerSettings?.widgets.showDescription ?? true;
  const showContact = footerSettings?.widgets.showContact ?? true;
  const showSocialLinks = footerSettings?.widgets.showSocialLinks ?? true;
  const showLinkColumns = footerSettings?.widgets.showLinkColumns ?? true;
  const showCopyright = footerSettings?.widgets.showCopyright ?? true;
  const showPaymentMethods = footerSettings?.widgets.showPaymentMethods ?? true;

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
      { label: t("nav.products"), href: `/${locale}/products` },
      { label: t("nav.categories"), href: `/${locale}/categories` },
      { label: t("nav.vendors"), href: `/${locale}/vendors` },
      { label: t("nav.deals"), href: `/${locale}/deals` },
      { label: t("nav.newArrivals"), href: `/${locale}/new-arrivals` },
    ],
  };
  const fallbackSupport: FooterColumn = {
    title: t("nav.help"),
    links: [
      { label: "Track Order", href: `/${locale}/track-order` },
      { label: t("nav.faq"), href: `/${locale}/faq` },
      { label: t("footer.shippingInfo"), href: `/${locale}/shipping` },
      { label: t("footer.returns"), href: `/${locale}/returns` },
    ],
  };
  const fallbackCompany: FooterColumn = {
    title: resolvedStoreName,
    links: [
      { label: t("nav.aboutUs"), href: `/${locale}/about` },
      { label: t("footer.careers"), href: `/${locale}/careers` },
      { label: t("footer.press"), href: `/${locale}/press` },
      { label: t("footer.blog"), href: `/${locale}/blog` },
    ],
  };
  const fallbackLegal: FooterColumn = {
    title: "Legal",
    links: [
      { label: t("footer.termsOfService"), href: `/${locale}/terms` },
      { label: t("footer.privacyPolicy"), href: `/${locale}/privacy` },
      { label: t("footer.cookiePolicy"), href: `/${locale}/cookies` },
      { label: t("footer.accessibility"), href: `/${locale}/accessibility` },
    ],
  };

  const configuredColumns =
    footerSettings?.linkColumns
      .map((column) => ({
        title: column.title,
        links: column.links
          .filter((link) => link.visible)
          .map((link) => ({
            label: link.label,
            href: resolveHref(link.href),
            target: link.target,
          })),
      }))
      .filter((column) => column.links.length > 0) ?? [];
  const finalColumns = footerSettings
    ? showLinkColumns
      ? configuredColumns
      : []
    : columns && columns.length > 0
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
  const paymentMethodsImageUrl = footerSettings?.paymentMethods.imageUrl?.trim() || "";
  const showPaymentMethodsImage =
    showPaymentMethods &&
    (footerSettings?.paymentMethods.enabled ?? true) &&
    paymentMethodsImageUrl;
  const copyrightParts = [
    footerSettings?.copyright.showYear ?? true ? new Date().getFullYear() : null,
    footerSettings?.copyright.showStoreName ?? true ? resolvedStoreName : null,
  ].filter(Boolean);
  const copyrightText =
    footerSettings?.copyright.text?.trim() || t("common.allRightsReserved");
  const mutedStyle = activeColors
    ? ({ color: "var(--footer-muted)" } as CSSProperties)
    : undefined;
  const headingStyle = activeColors
    ? ({ color: "var(--footer-text)" } as CSSProperties)
    : undefined;

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
      <div className={`${contentClass} py-12`}>
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4 lg:grid-cols-6">
          <div className="col-span-2">
            {showLogo ? (
              <Link href={`/${locale}`} className="mb-4 flex items-center gap-2">
                {currentLogoUrl ? (
                  // Sized by WIDTH, as the header sizes its logo. Matching
                  // the header copies its two recipes exactly: the compact
                  // bar's 32px-tall box below `lg`, the brand item's
                  // width-only box from `lg` up.
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
            ) : null}
            {showDescription ? (
              <p className="mb-4 max-w-xs text-sm text-muted-foreground" style={mutedStyle}>
                {resolvedFooterDescription}
              </p>
            ) : null}
            {showContact ? (
              <div className="space-y-2 text-sm text-muted-foreground" style={mutedStyle}>
                {footerSettings?.contact.title ? (
                  <p className="font-semibold" style={headingStyle}>
                    {footerSettings.contact.title}
                  </p>
                ) : null}
                {resolvedContact.phone &&
                (footerSettings?.contact.showPhone ?? true) ? (
                  <a
                    href={`tel:${resolvedContact.phone.replace(/\s+/g, "")}`}
                    className="flex items-center gap-2 transition-colors hover:text-primary"
                  >
                    <Phone className="h-4 w-4" />
                    <span>{resolvedContact.phone}</span>
                  </a>
                ) : null}
                {resolvedContact.email &&
                (footerSettings?.contact.showEmail ?? true) ? (
                  <a
                    href={`mailto:${resolvedContact.email}`}
                    className="flex items-center gap-2 transition-colors hover:text-primary"
                  >
                    <Mail className="h-4 w-4" />
                    <span>{resolvedContact.email}</span>
                  </a>
                ) : null}
                {resolvedContact.address &&
                (footerSettings?.contact.showAddress ?? true) ? (
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    <span>{resolvedContact.address}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {finalColumns.map((column, idx) => (
            <div key={`${column.title}-${idx}`}>
              <h4 className="mb-4 font-semibold" style={headingStyle}>
                {column.title}
              </h4>
              <ul className="space-y-2">
                {column.links.map((link, linkIdx) => (
                  <li key={`${link.href}-${linkIdx}`}>
                    <Link
                      href={link.href}
                      // Footer columns are ~25 links: with viewport prefetch
                      // every short page (cart, about, account) fired a
                      // server render per link before the shopper touched
                      // one. These are secondary pages; a click pays one
                      // round trip instead.
                      prefetch={false}
                      target={link.target}
                      rel={link.target === "_blank" ? "noopener noreferrer" : undefined}
                      className="text-sm text-muted-foreground transition-colors hover:text-primary"
                      style={mutedStyle}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <Separator
        style={{
          backgroundColor: activeColors ? "var(--footer-border)" : undefined,
        }}
      />

      <div className={`${contentClass} py-6`}>
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          {showCopyright ? (
            <p className="text-sm text-muted-foreground" style={mutedStyle}>
              {"\u00a9"} {copyrightParts.join(" ")}
              {copyrightParts.length > 0 ? ". " : ""}
              {copyrightText}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-4 md:justify-end">
            {showPaymentMethodsImage ? (
              <AppImage
                src={paymentMethodsImageUrl}
                alt={footerSettings?.paymentMethods.imageAlt || "Payment methods"}
                width={240}
                height={40}
                className="h-8 max-w-[240px] object-contain"
              />
            ) : null}
            {showSocialLinks && socialItems.length > 0 ? (
              <div className="flex items-center gap-4">
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
            ) : null}
          </div>
        </div>
      </div>
    </footer>
  );
}
