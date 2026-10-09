import type { ContactLine, SocialLink, StoreContact } from "@/contracts/mobile/shop/v1/content";
import { MobileApiError } from "@/lib/api-core/errors";
import {
  type ContactPageData,
  type ContentPlaceholders,
  windowPlaceholders,
} from "@/lib/site-config/content-pages-config";
import { contactMapExternalUrl } from "@/lib/storefront/contact-map";
import type { getStorefrontSettings } from "@/lib/storefront/storefront-settings";

/**
 * What the About, Contact and Returns endpoints share: the store's ways to be
 * reached, as the website's contact rows show them, and the placeholders its
 * page copy is filled with.
 */

export type StorefrontSettings = Awaited<ReturnType<typeof getStorefrontSettings>>;

export const pageNotFound = () => new MobileApiError(404, "NOT_FOUND", "This page is not available.");

/** A string the website shows only when it has words, as an optional field. */
export function words(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

/** `{storeName}`, `{returnWindow}` and `{windowDays}`, as the website fills them. */
export function pagePlaceholders(settings: StorefrontSettings): ContentPlaceholders {
  return {
    storeName: settings.storeName,
    returnWindow: settings.contentPages.returns.returnWindowValue,
    ...windowPlaceholders(settings.returnWindowDays),
  };
}

function line(label: string, value: string | undefined, href?: string): ContactLine | undefined {
  if (!value) return undefined;
  return { label: label.trim() || value, value, ...(href ? { href } : {}) };
}

export function emailLine(label: string, email: string | undefined): ContactLine | undefined {
  const value = words(email);
  return line(label, value, value ? `mailto:${value}` : undefined);
}

export function phoneLine(label: string, phone: string | undefined): ContactLine | undefined {
  const value = words(phone);
  const dial = value?.replace(/[^\d+]/g, "");
  return line(label, value, dial ? `tel:${dial}` : undefined);
}

/** The profiles the website's social row links to, in its order. */
function socialLinks(social: StorefrontSettings["social"]): SocialLink[] {
  const candidates: [SocialLink["network"], string | undefined][] = [
    ["FACEBOOK", social.facebookUrl],
    ["TWITTER", social.twitterUrl],
    ["INSTAGRAM", social.instagramUrl],
    ["YOUTUBE", social.youtubeUrl],
    ["LINKEDIN", social.linkedinUrl],
  ];
  return candidates.flatMap(([network, url]) => {
    const value = words(url);
    return value ? [{ network, url: value }] : [];
  });
}

/**
 * The store's address (opening the Contact page's map), email, phone and
 * hours under the Contact page's headings, and its social profiles unless
 * `social` is false. Only what the store has filled in.
 */
export function storeContact(settings: StorefrontSettings, options: { social: boolean }): StoreContact {
  const page: ContactPageData = settings.contentPages.contact;
  const address = words(settings.storeAddress);
  return {
    address: line(
      page.headOfficeTitle,
      address,
      address ? contactMapExternalUrl(page, address, settings.storeName) : undefined,
    ),
    email: emailLine(page.emailTitle, settings.storeEmail),
    phone: phoneLine(page.phoneTitle, settings.storePhone),
    hours: line(page.hoursTitle, words(page.supportHours)),
    social: options.social ? socialLinks(settings.social) : [],
  };
}
